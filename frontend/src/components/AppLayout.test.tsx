import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { server } from "@/test/msw/server";
import { meHandler } from "@/test/msw/me";
import { AuthProvider } from "@/components/AuthContext";
import { AppLayout } from "./AppLayout";

function renderLayout() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<div>home content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("AppLayout", () => {
  it("renders the admin nav link for an admin", async () => {
    server.use(meHandler({ is_admin: true }));
    renderLayout();
    expect(await screen.findByRole("link", { name: /admin/i })).toBeInTheDocument();
  });

  it("hides the admin nav link for a non-admin", async () => {
    server.use(meHandler({ is_admin: false }));
    renderLayout();
    // Wait for auth to resolve (the Log out control appears once a user is present).
    await screen.findByRole("button", { name: /log out/i });
    expect(screen.queryByRole("link", { name: /admin/i })).not.toBeInTheDocument();
  });

  it("shows the BackLotter brand wordmark in the header", async () => {
    server.use(meHandler({ is_admin: false }));
    renderLayout();
    expect(await screen.findByRole("link", { name: /backlotter/i })).toBeInTheDocument();
  });
});
