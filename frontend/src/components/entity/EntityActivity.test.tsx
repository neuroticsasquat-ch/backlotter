import { useEffect, useState } from "react";
import { createRoutesStub } from "react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/components/AuthContext";
import { server } from "@/test/msw/server";
import { entityEventsHandler, makeEvent } from "@/test/msw/entity-events";
import type { EntityEventsPage } from "@/api/types";
import { ACTIVITY_EMPTY, EntityActivitySection } from "@/components/entity/EntityActivity";

/** `n` cards, newest first as the backend orders them, each distinguishable by its summary. */
function stream(n: number) {
  return Array.from({ length: n }, (_, i) =>
    makeEvent({
      event_id: `e${i}111111-1111-4111-8111-111111111111`,
      summary: `Card ${i}`,
      created_at: `2026-09-${String(20 - i).padStart(2, "0")}T10:00:00Z`,
      occurred_at: `2026-09-${String(20 - i).padStart(2, "0")}T10:00:00Z`,
    }),
  );
}

function firstPage(events: ReturnType<typeof stream>, size: number): EntityEventsPage {
  return {
    items: events.slice(0, size),
    next_cursor: events.length > size ? String(size) : null,
  };
}

type SectionProps = {
  kind: "person" | "company" | "franchise";
  entityRef: string;
  initial: EntityEventsPage;
};

/**
 * Render the section once and keep that instance mounted.
 *
 * `navigateTo` swaps its props in place rather than re-rendering a fresh tree, because that is
 * what a same-route navigation does: the header's `SearchBox` can send a reader from one person
 * page straight to another, and React Router reuses the route component across it. A test that
 * rendered a second tree would unmount the first and pass whatever the component did with its
 * state, which is the bug it is meant to catch.
 */
function renderSection(
  initial: EntityEventsPage,
  kind: SectionProps["kind"],
  entityRef = "525-christopher-nolan",
) {
  // The setter is published from an effect rather than assigned during render: writing to an
  // outer binding mid-render is the side effect oxlint's react(globals) rule refuses, and the
  // effect has run by the time any test awaits its first card.
  const handle: { update?: (props: SectionProps) => void } = {};
  function Harness() {
    const [props, setProps] = useState<SectionProps>({ kind, entityRef, initial });
    useEffect(() => {
      handle.update = setProps;
    }, []);
    return <EntityActivitySection {...props} />;
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([{ path: "/e", Component: Harness }]);
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={["/e"]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return {
    navigateTo(next: EntityEventsPage, nextRef: string) {
      act(() => handle.update?.({ kind, entityRef: nextRef, initial: next }));
    },
  };
}

describe("EntityActivitySection", () => {
  it("renders the loader's first page as cards, newest first", async () => {
    const events = stream(2);
    renderSection(firstPage(events, 2), "person");

    const section = (await screen.findByRole("heading", { name: "Recent activity" }))
      .parentElement as HTMLElement;
    const cards = within(section).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText(/Card 0/)).toBeInTheDocument();
    expect(within(cards[1]).getByText(/Card 1/)).toBeInTheDocument();
    // The event's own type and confidence, drawn by the card the film page uses — the reader
    // sees the card a follow would deliver, not a preview of one.
    expect(within(cards[0]).getByText("Casting")).toBeInTheDocument();
  });

  it("dates each card by when the card was published", async () => {
    renderSection(firstPage(stream(1), 1), "person");
    expect(await screen.findByText("Sunday, September 20, 2026")).toBeInTheDocument();
  });

  it("appends the next page on Load more and drops the button at the end", async () => {
    const events = stream(3);
    server.use(entityEventsHandler("person", events));
    renderSection({ items: events.slice(0, 2), next_cursor: "2" }, "person");

    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));

    expect(await screen.findByText(/Card 2/)).toBeInTheDocument();
    expect(screen.getByText(/Card 0/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument(),
    );
  });

  it("asks the right route for a studio's next page", async () => {
    // The three kinds differ only in the path, and a franchise's is `/collections` — the one
    // place the on-screen word and the URL disagree (EF-19). MSW answers only `/companies`
    // here, so a section that asked anywhere else would fail on an unhandled request.
    const events = stream(2);
    server.use(entityEventsHandler("company", events));
    renderSection({ items: events.slice(0, 1), next_cursor: "1" }, "company");

    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByText(/Card 1/)).toBeInTheDocument();
  });

  it("offers no Load more when the first page is the last one", async () => {
    renderSection(firstPage(stream(1), 1), "person");
    await screen.findByRole("heading", { name: "Recent activity" });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("swaps the stream when the loader hands over a different entity's page", async () => {
    // Same-route navigation keeps this component mounted, so state seeded from the first
    // entity's page has to be dropped when the second's arrives — otherwise the new page
    // paints the old entity's cards, and "Load more" appends the new entity's page 2 under
    // them.
    const first = makeEvent({ summary: "NOLAN_CARD" });
    const second = makeEvent({
      event_id: "e9999999-9999-4999-8999-999999999999",
      summary: "VILLENEUVE_CARD",
    });
    const view = renderSection({ items: [first], next_cursor: null }, "person");
    expect(await screen.findByText(/NOLAN_CARD/)).toBeInTheDocument();

    view.navigateTo({ items: [second], next_cursor: null }, "1032-denis-villeneuve");

    expect(await screen.findByText(/VILLENEUVE_CARD/)).toBeInTheDocument();
    expect(screen.queryByText(/NOLAN_CARD/)).not.toBeInTheDocument();
  });

  it("re-offers Load more when the new entity has a next page and the old one did not", async () => {
    const view = renderSection({ items: [makeEvent()], next_cursor: null }, "person");
    await screen.findByRole("heading", { name: "Recent activity" });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();

    view.navigateTo(
      {
        items: [makeEvent({ event_id: "e8888888-8888-4888-8888-888888888888" })],
        next_cursor: "1",
      },
      "1032-denis-villeneuve",
    );

    expect(await screen.findByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it("says nothing has happened yet rather than hiding the section", async () => {
    // The section is an argument for the button above it, so an entity with no cards still
    // gets a sentence: "we have nothing on them yet" is real information to someone deciding
    // whether to follow.
    renderSection({ items: [], next_cursor: null }, "franchise");
    expect(await screen.findByText(ACTIVITY_EMPTY)).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
});
