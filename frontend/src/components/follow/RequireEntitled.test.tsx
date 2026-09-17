import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/components/AuthContext";
import { server } from "@/test/msw/server";
import { meHandler } from "@/test/msw/me";
import { RequireEntitled } from "./RequireEntitled";

function renderGate() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([
    {
      path: "/me",
      Component: RequireEntitled,
      children: [{ path: "follows", Component: () => <p>My follows</p> }],
    },
    { path: "/feed", Component: () => <p>Global feed</p> },
  ]);
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={["/me/follows"]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("RequireEntitled", () => {
  it("lets an entitled account through to the page", async () => {
    server.use(meHandler({ entitled: true }));
    renderGate();
    expect(await screen.findByText("My follows")).toBeInTheDocument();
  });

  it("renders the locked panel for a signed-in account without a grant", async () => {
    server.use(meHandler({ entitled: false }));
    renderGate();

    expect(await screen.findByRole("heading", { name: /not open yet/i })).toBeInTheDocument();
    expect(screen.queryByText("My follows")).not.toBeInTheDocument();
  });

  it("tells a locked account their follows are kept, not deleted (D-40)", async () => {
    server.use(meHandler({ entitled: false }));
    renderGate();

    expect(await screen.findByText(/come back exactly as you left them/i)).toBeInTheDocument();
  });

  it("does not sell anything — there is nothing to buy yet (D-41)", async () => {
    server.use(meHandler({ entitled: false }));
    renderGate();

    expect(await screen.findByText(/nothing to buy yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /upgrade/i })).not.toBeInTheDocument();
  });

  it("offers the public feed as the thing a locked account can still do", async () => {
    server.use(meHandler({ entitled: false }));
    renderGate();

    expect(
      await screen.findByRole("link", { name: /browse everything we track/i }),
    ).toHaveAttribute("href", "/feed");
  });
});
