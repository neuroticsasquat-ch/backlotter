import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { delay, http, HttpResponse } from "msw";
import type { AuthedUser } from "@/api/types";
import { env } from "@/env";
import { server } from "@/test/msw/server";
import { AuthProvider } from "@/components/AuthContext";
import { useFollowAccess } from "@/components/follow/access";
import { writeTimelineHint } from "@/lib/timeline-hint";

function Probe() {
  return <p>access: {useFollowAccess()}</p>;
}

/** `/me` held open for a real window, then answering with `entitled` or a 401. */
function slowMe(answer: "entitled" | "unentitled" | "anonymous") {
  return http.get(`${env.apiBaseUrl}/me`, async () => {
    await delay(100);
    if (answer === "anonymous") {
      return HttpResponse.json({ detail: "auth_required" }, { status: 401 });
    }
    return HttpResponse.json({
      id: "u1",
      email: "a@b.com",
      display_name: "Test User",
      is_admin: false,
      email_verified: true,
      entitled: answer === "entitled",
      created_at: new Date().toISOString(),
      csrf_token: "t",
    });
  });
}

function renderProbe(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const hint = () => writeTimelineHint({ entitled: true } as AuthedUser);

describe("useFollowAccess — the hinted state (NEU-1468, D-1468.4)", () => {
  it("is hinted while /me is in flight and the hint is present", () => {
    hint();
    server.use(slowMe("entitled"));
    renderProbe();
    expect(screen.getByText("access: hinted")).toBeInTheDocument();
  });

  it("is anonymous while /me is in flight and there is no hint", () => {
    server.use(slowMe("entitled"));
    renderProbe();
    expect(screen.getByText("access: anonymous")).toBeInTheDocument();
  });

  it.each([
    ["entitled", "ready"],
    ["unentitled", "locked"],
    ["anonymous", "anonymous"],
  ] as const)("resolves as today once /me answers %s, hint or no hint", async (answer, state) => {
    hint();
    server.use(slowMe(answer));
    renderProbe();
    expect(await screen.findByText(`access: ${state}`)).toBeInTheDocument();
  });

  it("is hinted over a cached null while a refetch is in flight (the post-login landing)", () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnMount: "always" } },
    });
    qc.setQueryData(["me"], null);
    hint();
    server.use(slowMe("entitled"));
    renderProbe(qc);
    expect(screen.getByText("access: hinted")).toBeInTheDocument();
  });

  it("is anonymous when the hint is present but nothing is being read", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["me"], null);
    hint();
    renderProbe(qc);
    expect(screen.getByText("access: anonymous")).toBeInTheDocument();
  });
});
