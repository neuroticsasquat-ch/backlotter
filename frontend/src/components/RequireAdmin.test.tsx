import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { server } from "@/test/msw/server";
import { meHandler } from "@/test/msw/me";
import { AuthProvider } from "@/components/AuthContext";
import { RequireAdmin } from "./RequireAdmin";

function renderAtAdmin() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/admin"]}>
          <Routes>
            <Route path="/" element={<div>home feed</div>} />
            <Route element={<RequireAdmin />}>
              <Route path="/admin" element={<div>secret admin area</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("RequireAdmin", () => {
  it("renders the gated content for an admin", async () => {
    server.use(meHandler({ is_admin: true }));
    renderAtAdmin();
    await waitFor(() => expect(screen.getByText("secret admin area")).toBeInTheDocument());
  });

  it("redirects a non-admin to the home feed", async () => {
    server.use(meHandler({ is_admin: false }));
    renderAtAdmin();
    await waitFor(() => expect(screen.getByText("home feed")).toBeInTheDocument());
    expect(screen.queryByText("secret admin area")).not.toBeInTheDocument();
  });
});
