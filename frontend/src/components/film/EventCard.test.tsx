import { render, screen, waitFor } from "@testing-library/react";
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
  summary: "Bogus recast.",
  sources: [{ url: "https://x.test/a", source: "ScreenRant", title: "t", published_at: null }],
};

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: "/", element: <EventCard event={event} /> }]);
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

it("omits the per-event date and confidence (the day heading carries the date)", async () => {
  server.use(meHandler({ is_admin: false }));
  renderCard();
  await waitFor(() => expect(screen.getByText("Bogus recast.")).toBeInTheDocument());
  expect(screen.queryByText("Confirmed")).not.toBeInTheDocument();
  expect(screen.queryByText("Rumored")).not.toBeInTheDocument();
  expect(document.querySelector("time")).toBeNull();
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
