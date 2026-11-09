import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse, delay } from "msw";
import { env } from "@/env";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/components/AuthContext";
import type { Follow } from "@/api/types";
import type { FollowTarget } from "@/lib/film-entities";
import { server } from "@/test/msw/server";
import { meHandler, unauthMeHandler } from "@/test/msw/me";
import { followGraphHandlers, makeFollow } from "@/test/msw/follows";
import { LOCKED_COPY } from "./access";
import { TitleFollowButton } from "./TitleFollowButton";

const FILM_ID = "11111111-1111-4111-8111-111111111111";

/** What `titleTarget()` builds on the film page: the film's UUID, not its TMDB id. */
const target: FollowTarget = {
  entityType: "title",
  entityId: FILM_ID,
  label: "The Odyssey",
};

/** The reader's own follow of this film, as `GET /me/follows` returns it. */
const titleFollow = (): Follow =>
  makeFollow({ entity_type: "title", entity_id: FILM_ID, name: "The Odyssey" });

function renderButton({ entitled = true, anonymous = false, follows = [] as Follow[] } = {}) {
  const graph = followGraphHandlers({ follows });
  server.use(anonymous ? unauthMeHandler() : meHandler({ entitled }), ...graph.handlers);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([
    { path: "/film/:ref", Component: () => <TitleFollowButton target={target} /> },
    { path: "/login", Component: () => <h1>Log in</h1> },
  ]);
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={["/film/603-the-odyssey"]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return graph;
}

beforeEach(() => localStorage.clear());

describe("TitleFollowButton — access states", () => {
  it("sends an anonymous visitor to sign in rather than showing a dead button", async () => {
    renderButton({ anonymous: true });
    expect(
      await screen.findByRole("link", { name: "Sign in to follow The Odyssey" }),
    ).toHaveAttribute("href", expect.stringContaining("/login"));
  });

  it("shows a signed-in account without a grant what it is missing (D-41)", async () => {
    renderButton({ entitled: false });
    const button = await screen.findByRole("button", { name: "Follow The Odyssey" });
    expect(button).toBeDisabled();
    // On the wrapper, not the button: a disabled button takes no pointer events, so a tooltip
    // hung on it never opens.
    expect(button.parentElement).toHaveAttribute("title", LOCKED_COPY);
  });
});

describe("TitleFollowButton — state read from the follows cache", () => {
  it("offers Follow for a film the reader does not follow", async () => {
    renderButton();
    const button = await screen.findByRole("button", { name: "Follow The Odyssey" });
    expect(button).toHaveTextContent("Follow");
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("says Following once the film's own title row is in the list", async () => {
    renderButton({ follows: [titleFollow()] });
    const button = await screen.findByRole("button", { name: "Unfollow The Odyssey" });
    expect(button).toHaveTextContent("Following");
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("stays unfollowed for a person follow that merely reaches the film", async () => {
    // The whole of EF-16 in one assertion: following the director does not follow the film.
    // The old control read a computed watchlist, where a directorial follow *did* light it up.
    renderButton({ follows: [makeFollow({ entity_id: "525", name: "Christopher Nolan" })] });
    const button = await screen.findByRole("button", { name: "Follow The Odyssey" });
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("does not answer to another film's title follow", async () => {
    renderButton({
      follows: [
        makeFollow({ entity_type: "title", entity_id: "22222222-2222-4222-8222-222222222222" }),
      ],
    });
    expect(await screen.findByRole("button", { name: "Follow The Odyssey" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("TitleFollowButton — what a press sends", () => {
  it("creates the title follow, keyed on the film's UUID", async () => {
    const graph = renderButton();

    await userEvent.click(await screen.findByRole("button", { name: "Follow The Odyssey" }));

    await waitFor(() => expect(graph.follows).toHaveLength(1));
    expect(graph.follows[0]).toMatchObject({ entity_type: "title", entity_id: FILM_ID });
    expect(await screen.findByRole("button", { name: "Unfollow The Odyssey" })).toBeInTheDocument();
  });

  it("deletes it again on a second press, leaving nothing behind", async () => {
    // No mute to fall back to: the watchlist that made *stop* ambiguous is gone (EF-14), so
    // unfollowing is the whole of it.
    const graph = renderButton({ follows: [titleFollow()] });

    await userEvent.click(await screen.findByRole("button", { name: "Unfollow The Odyssey" }));

    await waitFor(() => expect(graph.follows).toHaveLength(0));
    expect(await screen.findByRole("button", { name: "Follow The Odyssey" })).toBeInTheDocument();
  });

  it("leaves a person follow alone when the film is unfollowed", async () => {
    const nolan = makeFollow({ entity_id: "525", name: "Christopher Nolan" });
    const graph = renderButton({ follows: [titleFollow(), nolan] });

    await userEvent.click(await screen.findByRole("button", { name: "Unfollow The Odyssey" }));

    await waitFor(() => expect(graph.follows).toEqual([nolan]));
  });
});

describe("TitleFollowButton — while the request is in flight", () => {
  it("shows the new state optimistically and refuses a second press", async () => {
    // The optimistic edit is the point of the hook, and a settled assertion cannot see it:
    // holding the response open is what separates "the cache flipped under the finger" from
    // "the refetch landed".
    renderButton();
    // The request never completes, which is what makes this deterministic rather than a race:
    // anything the button says from here can only be the optimistic edit, because the server
    // has not answered and cannot.
    server.use(
      http.post(`${env.apiBaseUrl}/me/follows`, async () => {
        await delay("infinite");
        return HttpResponse.json(titleFollow(), { status: 201 });
      }),
    );

    await userEvent.click(await screen.findByRole("button", { name: "Follow The Odyssey" }));

    const pending = await screen.findByRole("button", { name: "Unfollow The Odyssey" });
    expect(pending).toHaveTextContent("Following");
    expect(pending).toBeDisabled();
  });
});
