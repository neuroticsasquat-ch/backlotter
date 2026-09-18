import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoutesStub } from "react-router";
import { server } from "@/test/msw/server";
import { forbiddenResolutionHandler, makeDecision, resolutionHandler } from "@/test/msw/resolution";
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

    expect(await screen.findByText("No unlinked decisions.")).toBeInTheDocument();
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

  it("surfaces a failed load", async () => {
    server.use(forbiddenResolutionHandler());
    renderPage();

    expect(await screen.findByText(/Failed to load decisions/)).toBeInTheDocument();
  });
});
