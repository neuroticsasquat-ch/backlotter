import { describe, expect, it } from "vitest";
import { HttpResponse, http } from "msw";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoutesStub } from "react-router";
import { server } from "@/test/msw/server";
import { forbiddenResolutionHandler, makeDecision, resolutionHandler } from "@/test/msw/resolution";
import { env } from "@/env";
import type { ResolutionDecision } from "@/api/types";
import { AdminResolution } from "./AdminResolution";

// The film cell renders a `Link`, so the page needs router context; `createRoutesStub` is the
// repo's way of getting it without standing up the whole app tree (CLAUDE.md, Testing).
function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([{ path: "/admin/resolution", Component: AdminResolution }]);
  return render(
    <QueryClientProvider client={qc}>
      <Stub initialEntries={["/admin/resolution"]} />
    </QueryClientProvider>,
  );
}

describe("AdminResolution", () => {
  it("renders a row per mention with story, film, name, evidence, path and confidence", async () => {
    const user = userEvent.setup();
    server.use(
      resolutionHandler([
        makeDecision({ id: "d1", name_as_written: "Chris Evans", confidence: 0.41 }),
        makeDecision({
          id: "d2",
          name_as_written: "Greta Gerwig",
          path: "tiebreak",
          confidence: 0.72,
        }),
      ]),
    );
    renderPage();
    await user.click(await screen.findByRole("tab", { name: "All" }));

    const row = (await screen.findByText("Chris Evans")).closest("tr")!;
    expect(within(row).getByRole("link", { name: /Chris Evans joins the cast/ })).toHaveAttribute(
      "href",
      "https://deadline.com/story",
    );
    expect(within(row).getByRole("link", { name: "A Film" })).toHaveAttribute("href", "/film/1234");
    expect(within(row).getByText("Person")).toBeInTheDocument();
    expect(within(row).getByText(/has joined the cast/)).toBeInTheDocument();
    expect(within(row).getByText("Unlinked")).toBeInTheDocument();
    expect(within(row).getByText("0.41")).toBeInTheDocument();

    const other = screen.getByText("Greta Gerwig").closest("tr")!;
    expect(within(other).getByText("Tiebreak")).toBeInTheDocument();
  });

  it("renders a mention whose film was unlinked after extraction", async () => {
    server.use(resolutionHandler([makeDecision({ film: null })]));
    renderPage();

    const row = (await screen.findByText("Chris Evans")).closest("tr")!;
    expect(within(row).queryByRole("link", { name: "A Film" })).not.toBeInTheDocument();
  });

  it("narrows the request to one path when a filter tab is picked", async () => {
    const user = userEvent.setup();
    server.use(
      resolutionHandler([
        makeDecision({ id: "d1", name_as_written: "Chris Evans", path: "unlinked" }),
        makeDecision({ id: "d2", name_as_written: "Greta Gerwig", path: "accepted" }),
      ]),
    );
    renderPage();
    await screen.findByText("Chris Evans");
    expect(screen.queryByText("Greta Gerwig")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Accepted" }));

    await waitFor(() => expect(screen.queryByText("Chris Evans")).not.toBeInTheDocument());
    expect(screen.getByText("Greta Gerwig")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Accepted" })).toHaveAttribute("aria-selected", "true");
  });

  it("expands a row to show the candidates and their feature scores", async () => {
    const user = userEvent.setup();
    server.use(
      resolutionHandler([
        makeDecision({
          candidates: [
            {
              person_id: 16828,
              name: "Chris Evans",
              score: 0.62,
              features: { name_match: 1, already_credited: true },
            },
            {
              person_id: 12835,
              name: "Chris Evans (II)",
              score: 0.58,
              features: { name_match: 1, already_credited: false },
            },
          ],
        }),
      ]),
    );
    renderPage();

    const toggle = await screen.findByRole("button", {
      name: "Show candidates for Chris Evans",
    });
    expect(screen.queryByText("Chris Evans (II)")).not.toBeInTheDocument();

    await user.click(toggle);

    expect(await screen.findByText("Chris Evans (II)")).toBeInTheDocument();
    expect(screen.getByText("TMDB #16828")).toBeInTheDocument();
    expect(screen.getByText("score 0.62")).toBeInTheDocument();
    // The decision's own features render alongside the shortlist's.
    expect(screen.getByRole("heading", { name: "Decision features" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Candidates (2)" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide candidates for Chris Evans" }));
    await waitFor(() => expect(screen.queryByText("Chris Evans (II)")).not.toBeInTheDocument());
  });

  it("renders a candidate the backend could not validate rather than dropping it", async () => {
    const user = userEvent.setup();
    server.use(
      resolutionHandler([
        makeDecision({
          candidates: [{ person_id: null, name: null, score: null, features: {} }],
        }),
      ]),
    );
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Show candidates for Chris Evans" }),
    );

    expect(await screen.findByText("Unnamed candidate")).toBeInTheDocument();
    expect(screen.getByText("score —")).toBeInTheDocument();
    expect(screen.getByText("No features recorded.")).toBeInTheDocument();
  });

  it("pages forward and back with the cursor the previous page returned", async () => {
    const user = userEvent.setup();
    server.use(
      resolutionHandler(
        [
          makeDecision({ id: "d1", name_as_written: "Chris Evans" }),
          makeDecision({ id: "d2", name_as_written: "Greta Gerwig" }),
        ],
        1,
      ),
    );
    renderPage();
    await screen.findByText("Chris Evans");
    expect(screen.getByText("Page 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("Greta Gerwig")).toBeInTheDocument();
    expect(screen.getByText("Page 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Previous" }));

    expect(await screen.findByText("Chris Evans")).toBeInTheDocument();
    expect(screen.getByText("Page 1")).toBeInTheDocument();
  });

  it("returns to the first page when the filter changes", async () => {
    const user = userEvent.setup();
    server.use(
      resolutionHandler(
        [
          makeDecision({ id: "d1", name_as_written: "Chris Evans", path: "unlinked" }),
          makeDecision({ id: "d2", name_as_written: "Greta Gerwig", path: "unlinked" }),
        ],
        1,
      ),
    );
    renderPage();
    await screen.findByText("Chris Evans");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page 2")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "All" }));

    expect(await screen.findByText("Page 1")).toBeInTheDocument();
    expect(screen.getByText("Chris Evans")).toBeInTheDocument();
  });

  it("opens on the unlinked queue D-25 asks for, with a filter-aware empty state", async () => {
    const user = userEvent.setup();
    server.use(resolutionHandler([makeDecision({ path: "accepted" })]));
    renderPage();

    expect(await screen.findByText("No unlinked person decisions.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Unlinked" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: "All" }));

    expect(await screen.findByText("Chris Evans")).toBeInTheDocument();
  });

  it("renders a path the D-24 vocabulary has outgrown rather than a blank badge", async () => {
    // The wire field is a bare string; a value this build does not know must read as itself.
    const user = userEvent.setup();
    server.use(
      resolutionHandler([makeDecision({ path: "provisional" as ResolutionDecision["path"] })]),
    );
    renderPage();
    await user.click(await screen.findByRole("tab", { name: "All" }));

    expect(await screen.findByText("provisional")).toBeInTheDocument();
  });

  it("opens on the person queue and narrows the request to one kind when a kind tab is picked", async () => {
    const user = userEvent.setup();
    server.use(
      resolutionHandler([
        makeDecision({ id: "d1", kind: "person", name_as_written: "Chris Evans" }),
        makeDecision({ id: "d2", kind: "company", name_as_written: "A24" }),
        makeDecision({ id: "d3", kind: "collection", name_as_written: "the Dune films" }),
      ]),
    );
    renderPage();

    await screen.findByText("Chris Evans");
    expect(screen.getByRole("tab", { name: "People" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("A24")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Studios" }));

    const studio = (await screen.findByText("A24")).closest("tr")!;
    expect(within(studio).getByText("Studio")).toBeInTheDocument();
    expect(screen.queryByText("Chris Evans")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Studios" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: "Franchises" }));

    const franchise = (await screen.findByText("the Dune films")).closest("tr")!;
    expect(within(franchise).getByText("Franchise")).toBeInTheDocument();
    expect(screen.queryByText("A24")).not.toBeInTheDocument();
  });

  it("leaves an organisation's role and department cell blank — they are person facts", async () => {
    const user = userEvent.setup();
    server.use(
      resolutionHandler([
        makeDecision({
          kind: "company",
          name_as_written: "A24",
          // `news.story_entity` has no column for either, so the wire always nulls them.
          role: null,
          department: null,
        }),
      ]),
    );
    renderPage();
    await user.click(await screen.findByRole("tab", { name: "Studios" }));

    const row = (await screen.findByText("A24")).closest("tr")!;
    expect(within(row).getByText("Studio")).toBeInTheDocument();
    expect(within(row).queryByText(/Acting/)).not.toBeInTheDocument();
  });

  it("links a resolved mention to its own entity page, per kind", async () => {
    const user = userEvent.setup();
    server.use(
      resolutionHandler([
        makeDecision({
          id: "d1",
          kind: "person",
          path: "accepted",
          name_as_written: "Chris Evans",
          entity_id: 16828,
          candidates: [{ person_id: 16828, name: "Chris Evans", score: 0.91, features: {} }],
        }),
        makeDecision({
          id: "d2",
          kind: "company",
          path: "accepted",
          name_as_written: "A24",
          entity_id: 41077,
          candidates: [
            { entity_id: 41077, person_id: null, name: "A24", score: 0.95, features: {} },
          ],
        }),
        makeDecision({
          id: "d3",
          kind: "collection",
          path: "accepted",
          name_as_written: "the Dune films",
          entity_id: 726871,
          candidates: [
            {
              entity_id: 726871,
              person_id: null,
              name: "Dune Collection",
              score: 0.88,
              features: {},
            },
          ],
        }),
      ]),
    );
    renderPage();
    await user.click(await screen.findByRole("tab", { name: "Accepted" }));

    // The person's own catalogue name comes off the winning candidate; the slug is decorative.
    expect(await screen.findByRole("link", { name: "Chris Evans" })).toHaveAttribute(
      "href",
      "/person/16828-chris-evans",
    );

    await user.click(screen.getByRole("tab", { name: "Studios" }));
    expect(await screen.findByRole("link", { name: "A24" })).toHaveAttribute(
      "href",
      "/studio/41077-a24",
    );

    await user.click(screen.getByRole("tab", { name: "Franchises" }));
    // Resolved to a name the story did not use — the link says the catalogue's word for it.
    expect(await screen.findByRole("link", { name: "Dune Collection" })).toHaveAttribute(
      "href",
      "/franchise/726871-dune-collection",
    );
  });

  it("names a resolved entity the shortlist does not, and nobody at all when nothing resolved", async () => {
    const user = userEvent.setup();
    server.use(
      resolutionHandler([
        // Accepted off an exact-match shortcut: an id, but no candidate carrying its name.
        makeDecision({
          id: "d1",
          kind: "company",
          path: "accepted",
          name_as_written: "Blumhouse",
          entity_id: 3172,
          candidates: [],
        }),
        makeDecision({
          id: "d2",
          kind: "company",
          path: "unlinked",
          name_as_written: "Some Outfit",
          entity_id: null,
        }),
      ]),
    );
    renderPage();
    await user.click(await screen.findByRole("tab", { name: "Studios" }));
    await user.click(screen.getByRole("tab", { name: "All" }));

    // Two cells carry the name here — the written one and the resolved one it stood in for.
    const accepted = (await screen.findAllByText("Blumhouse"))[0].closest("tr")!;
    expect(within(accepted).getByRole("link", { name: "Blumhouse" })).toHaveAttribute(
      "href",
      "/studio/3172-blumhouse",
    );

    const unlinked = screen.getByText("Some Outfit").closest("tr")!;
    expect(within(unlinked).queryByRole("link", { name: "Some Outfit" })).not.toBeInTheDocument();
    expect(within(unlinked).getByText("—")).toBeInTheDocument();
  });

  it("shows an organisation's TMDB id from the entity_id its resolver logs", async () => {
    const user = userEvent.setup();
    server.use(
      resolutionHandler([
        makeDecision({
          kind: "company",
          name_as_written: "A24",
          candidates: [
            { entity_id: 41077, person_id: null, name: "A24", score: 0.62, features: {} },
          ],
        }),
      ]),
    );
    renderPage();
    await user.click(await screen.findByRole("tab", { name: "Studios" }));

    await user.click(await screen.findByRole("button", { name: "Show candidates for A24" }));

    expect(await screen.findByText("TMDB #41077")).toBeInTheDocument();
  });

  it("returns to the first page when the kind changes", async () => {
    const user = userEvent.setup();
    server.use(
      resolutionHandler(
        [
          makeDecision({ id: "d1", kind: "company", name_as_written: "A24" }),
          makeDecision({ id: "d2", kind: "company", name_as_written: "Neon" }),
        ],
        1,
      ),
    );
    renderPage();
    await user.click(await screen.findByRole("tab", { name: "Studios" }));
    await screen.findByText("A24");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page 2")).toBeInTheDocument();
    expect(screen.getByText("Neon")).toBeInTheDocument();

    // A cursor is minted from one table's keyset, so it cannot survive a kind change.
    await user.click(screen.getByRole("tab", { name: "Franchises" }));
    await user.click(screen.getByRole("tab", { name: "Studios" }));

    expect(await screen.findByText("Page 1")).toBeInTheDocument();
    expect(screen.getByText("A24")).toBeInTheDocument();
  });

  it("renders a kind the EF-12 vocabulary has outgrown rather than a blank cell", async () => {
    // The wire field is a bare string, like `path`: a value this build has not learned reads as
    // itself and links nowhere, because there is no route to send it to. Answered by hand
    // rather than through `resolutionHandler`, which narrows on `kind` the way the backend
    // does and so would never hand the page a kind it did not ask for.
    server.use(
      http.get(`${env.apiBaseUrl}/admin/resolution`, () =>
        HttpResponse.json({
          items: [
            makeDecision({
              kind: "network" as ResolutionDecision["kind"],
              name_as_written: "HBO",
              path: "accepted",
              entity_id: 49,
            }),
          ],
          next_cursor: null,
        }),
      ),
    );
    renderPage();

    const row = (await screen.findAllByText("HBO"))[0].closest("tr")!;
    expect(within(row).getByText("network")).toBeInTheDocument();
    expect(within(row).queryByRole("link", { name: "HBO" })).not.toBeInTheDocument();
  });

  it("surfaces a failed load", async () => {
    server.use(forbiddenResolutionHandler());
    renderPage();

    expect(await screen.findByText(/Failed to load decisions/)).toBeInTheDocument();
  });
});
