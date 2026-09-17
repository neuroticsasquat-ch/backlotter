import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";
import { AuthProvider } from "@/components/AuthContext";
import { server } from "@/test/msw/server";
import { meHandler } from "@/test/msw/me";
import { env } from "@/env";
import { EventCard } from "./EventCard";
import type { FilmEvent } from "@/api/types";

const event: FilmEvent = {
  event_id: "evt-1",
  event_type: "casting",
  confidence: "confirmed",
  created_at: "2026-06-30T00:00:00Z",
  occurred_at: "2026-06-30T00:00:00Z",
  summary: "Bogus recast.",
  summary_edited: false,
  status: "published",
  superseded_by: null,
  provenance: "story",
  sources: [{ url: "https://x.test/a", source: "ScreenRant", title: "t", published_at: null }],
};

function renderCard(overrides: Partial<FilmEvent> = {}, day?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const cardEvent = { ...event, ...overrides };
  const router = createMemoryRouter([
    { path: "/", element: <EventCard event={cardEvent} day={day} /> },
  ]);
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

it("omits the per-event date when the event falls on the heading's day", async () => {
  server.use(meHandler({ is_admin: false }));
  renderCard({}, "2026-06-30");
  await waitFor(() => expect(screen.getByText("Bogus recast.")).toBeInTheDocument());
  expect(screen.queryByText(/first seen/)).toBeNull();
  expect(document.querySelector("time")).toBeNull();
});

it("badges a confirmed event as confirmed (D-9: confidence is visible on every card)", async () => {
  server.use(meHandler({ is_admin: false }));
  renderCard();
  await screen.findByText("Bogus recast.");
  expect(screen.getByText("confirmed")).toBeInTheDocument();
  expect(screen.queryByText("unconfirmed")).toBeNull();
});

it("badges a rumored event as unconfirmed", async () => {
  server.use(meHandler({ is_admin: false }));
  renderCard({ confidence: "rumored" });
  await screen.findByText("Bogus recast.");
  expect(screen.getByText("unconfirmed")).toBeInTheDocument();
});

it("anchors every card by event id so a retraction marker can point at it", async () => {
  server.use(meHandler({ is_admin: false }));
  renderCard();
  await screen.findByText("Bogus recast.");
  expect(document.getElementById("event-evt-1")?.tagName).toBe("ARTICLE");
});

it("marks a superseded event 'later retracted', linked to the retraction on the page", async () => {
  // D-2: the original stays in place on every surface; the marker is the only change.
  server.use(meHandler({ is_admin: false }));
  renderCard({ status: "superseded", superseded_by: "evt-9" });
  await screen.findByText("Bogus recast.");
  const marker = screen.getByRole("link", { name: /later retracted/i });
  expect(marker).toHaveAttribute("href", "#event-evt-9");
});

it("still marks a superseded event whose retraction id is missing, without a link", async () => {
  server.use(meHandler({ is_admin: false }));
  renderCard({ status: "superseded", superseded_by: null });
  await screen.findByText("Bogus recast.");
  expect(screen.getByText(/later retracted/i)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /later retracted/i })).toBeNull();
});

it("renders no retraction marker on a published event", async () => {
  server.use(meHandler({ is_admin: false }));
  renderCard();
  await screen.findByText("Bogus recast.");
  expect(screen.queryByText(/later retracted/i)).toBeNull();
});

it("discloses 'first seen <occurred_at>' when the beat falls outside the heading's day", async () => {
  // The ADR-0016 residual: a backdated beat carries no other hint of the gap.
  server.use(meHandler({ is_admin: false }));
  renderCard({ occurred_at: "2026-06-23T09:00:00Z" }, "2026-06-30");
  await screen.findByText("Bogus recast.");
  const line = screen.getByText(/first seen/);
  expect(line).toHaveTextContent("first seen Jun 23, 2026");
  expect(line.querySelector("time")).toHaveAttribute("dateTime", "2026-06-23T09:00:00Z");
});

it("never discloses first seen without a day to compare against", async () => {
  server.use(meHandler({ is_admin: false }));
  renderCard({ occurred_at: "2026-06-23T09:00:00Z" });
  await screen.findByText("Bogus recast.");
  expect(screen.queryByText(/first seen/)).toBeNull();
});

it("hides admin controls for non-admins", async () => {
  server.use(meHandler({ is_admin: false }));
  renderCard();
  // wait for auth to resolve, then assert no delink control
  await waitFor(() => expect(screen.getByText("Bogus recast.")).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: /delink/i })).toBeNull();
});

it("delinks a source and revalidates for an admin", async () => {
  server.use(meHandler({ is_admin: true }));
  let called = false;
  server.use(
    http.post(`${env.apiBaseUrl}/admin/events/evt-1/delink`, () => {
      called = true;
      return HttpResponse.json({ delinked: 1, event_removed: true, resummarize_queued: false });
    }),
  );
  renderCard();
  const btn = await screen.findByRole("button", { name: /delink ScreenRant/i });
  await userEvent.click(btn);
  await waitFor(() => expect(called).toBe(true));
});

it("hides edit and reset controls for non-admins (edited badge still shows)", async () => {
  server.use(meHandler({ is_admin: false }));
  renderCard({ summary_edited: true });
  await waitFor(() => expect(screen.getByText("Bogus recast.")).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /reset to ai/i })).toBeNull();
  expect(screen.getByText("edited")).toBeInTheDocument();
});

it("shows the edited badge and Reset to AI only when summary_edited is true", async () => {
  server.use(meHandler({ is_admin: true }));
  renderCard({ summary_edited: true });
  await screen.findByText("Bogus recast.");
  expect(screen.getByText("edited")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: /reset to ai/i })).toBeInTheDocument();
});

it("hides Reset to AI when the summary has never been edited", async () => {
  server.use(meHandler({ is_admin: true }));
  renderCard({ summary_edited: false });
  await screen.findByText("Bogus recast.");
  expect(screen.queryByText("edited")).toBeNull();
  expect(screen.queryByRole("button", { name: /reset to ai/i })).toBeNull();
});

it("edits the summary and shows the new text and edited badge", async () => {
  server.use(meHandler({ is_admin: true }));
  let receivedBody: unknown = null;
  server.use(
    http.patch(`${env.apiBaseUrl}/admin/events/evt-1/summary`, async ({ request }) => {
      receivedBody = await request.json();
      return HttpResponse.json({
        summary: "Updated summary.",
        edited: true,
        edited_at: "2026-07-06T00:00:00Z",
      });
    }),
  );
  renderCard();
  await screen.findByText("Bogus recast.");
  await userEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
  const textarea = await screen.findByRole("textbox");
  await userEvent.clear(textarea);
  await userEvent.type(textarea, "Updated summary.");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(receivedBody).toEqual({ summary: "Updated summary." });
  await waitFor(() => expect(screen.getByText("Updated summary.")).toBeInTheDocument());
  expect(screen.getByText("edited")).toBeInTheDocument();
});

it("resets the summary to AI after confirmation", async () => {
  server.use(meHandler({ is_admin: true }));
  let called = false;
  server.use(
    http.delete(`${env.apiBaseUrl}/admin/events/evt-1/summary`, () => {
      called = true;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  renderCard({ summary_edited: true });
  await screen.findByText("Bogus recast.");
  await userEvent.click(await screen.findByRole("button", { name: /reset to ai/i }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: /reset to ai/i }));
  await waitFor(() => expect(called).toBe(true));
});

it("renders no attribution for a source-less catalog event", async () => {
  server.use(meHandler({ is_admin: false }));
  renderCard({ event_type: "crew_attached", provenance: "catalog", sources: [] });
  await screen.findByText("Bogus recast.");
  expect(screen.queryByText("via TMDB")).toBeNull();
  expect(screen.getByText("Crew attached")).toBeInTheDocument();
});

it("shows the outlets on a catalog event that has gained sources", async () => {
  server.use(meHandler({ is_admin: false }));
  renderCard({ provenance: "catalog" });
  await screen.findByText("Bogus recast.");
  expect(screen.getByRole("link", { name: "ScreenRant" })).toBeInTheDocument();
  expect(screen.queryByText("via TMDB")).toBeNull();
});

it("leaves an ordinary story event unattributed", async () => {
  server.use(meHandler({ is_admin: false }));
  renderCard({ sources: [] });
  await screen.findByText("Bogus recast.");
  expect(screen.queryByText("via TMDB")).toBeNull();
});
