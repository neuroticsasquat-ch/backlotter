import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { server } from "@/test/msw/server";
import { meHandler } from "@/test/msw/me";
import { AuthProvider } from "@/components/AuthContext";
import Home from "./Home";

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Home />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("Home", () => {
  it("shows the BackLotter brand heading", async () => {
    server.use(meHandler({ is_admin: false }));
    renderHome();
    expect(await screen.findByRole("heading", { name: /backlotter/i })).toBeInTheDocument();
  });
});
