# upcoming-movies-frontend

React + TypeScript SPA for the Upcoming Movies Tracker. Vite, react-router, TanStack Query (server state), Tailwind v4 + Radix/shadcn-style UI primitives, Sentry, sonner. Tooling: ESLint, Prettier, `tsc`, Vitest + Testing Library + MSW. pnpm (`pnpm@9.15.0`). Runs in a container — **no local Node/pnpm**.

## Branching

Work happens on a release branch, `release/vX.Y.Z`, cut from `main` per release and merged back
when it ships. Branch each ticket from, and PR it to, the **current** release branch; `main` only
when none is open. The name is deliberately not written here: it changes every release, and the
`/implementit` / `/shipit` / `/doit` skills resolve it themselves (`--base`, else the checked-out
integration branch, else the one unmerged `origin/release/*`). Only pin a `loop_base:` line in
`CLAUDE.md` if that resolution picks wrong, and remove it as soon as the branch merges.

## Golden rule: everything runs in the container via `task`

Do **not** run `pnpm`, `vitest`, `eslint`, or `tsc` on the host. Use `task` targets (they `docker compose exec` into the `upmovies-frontend` container). Source is bind-mounted (Vite HMR is live); **dependency changes require `task build`** (rebuilds the image and syncs `node_modules` into the volume). Add deps with `task deps:add -- <pkg>` / `task deps:add-dev -- <pkg>`.

| Task | Runs |
|---|---|
| `task up` / `task down` / `task build` | container lifecycle (`build` reinstalls deps) |
| `task test` | `vitest run` (`task test -- src/pages/X.test.tsx` to scope) |
| `task lint` | `eslint src --max-warnings 0` |
| `task typecheck` | `tsc --noEmit` |
| `task format` | `prettier --write` |
| `task build:app` | `vite build` |
| `task shell` / `task logs` | shell in container / stream logs |

Before claiming work done, `task test`, `task lint`, `task typecheck` must be green, and new/changed files prettier-formatted. ESLint runs at **zero warnings** — unused imports fail the build.

## Layout (`src/`)

- `api/` — `client.ts` (`apiFetch` wrapper + `ApiError` + CSRF), `types.ts` (shared types), and one module per domain (`auth.ts`, `runs.ts`). TanStack Query hooks live alongside the fetchers (e.g. `useRuns` in `api/runs.ts`).
- `components/` — `AuthContext.tsx` (`useAuth`), route guards `RequireAuth` / `RequireAdmin`, `AppLayout` (header/nav shell), `ui/` (primitives).
- `pages/` — route components (`Login`, `Signup`, `Home`, `AdminIngest`).
- `router.tsx` — `createBrowserRouter`. Authed routes nest under `RequireAuth` → `AppLayout`; admin routes add `RequireAdmin`.
- `env.ts` — `env.apiBaseUrl` from `VITE_API_BASE_URL`. `test/` — MSW (`msw/server.ts`, `msw/handlers.ts`, `msw/me.ts`), `setup.ts`.
- Path alias: `@/` → `src/`.

## Conventions

- **HTTP** goes through `apiFetch<T>(path, init?)`: sends `credentials: "include"`, attaches the CSRF header on mutations, throws `ApiError` (with `.status`) on non-2xx, tolerates empty bodies. Don't call `fetch` directly.
- **Server state = TanStack Query**, not local state. Export typed fetchers + hooks from the relevant `api/*.ts`. Use stable `queryKey`s. The auto-refresh pattern: `refetchInterval: (query) => <condition on query.state.data> ? 5000 : false` (see `useRuns` — polls only while a run is `running`).
- **Auth/routing:** `useAuth()` exposes `user` (incl. `is_admin`), `login`/`signup`/`logout`/`refresh`. `RequireAuth` redirects anon → `/login?next=`; `RequireAdmin` (nested inside `RequireAuth`) redirects non-admins → `/`. Admin-only nav/UI keys off `user.is_admin`.
- Types mirror the backend response shapes (e.g. `IngestRun` ↔ backend `RunOut`). Keep them in sync when the API changes.

## Testing (Vitest + RTL + MSW)

- **TDD** — write the failing test first. MSW intercepts all HTTP (`onUnhandledRequest: "error"`); override per-test with `server.use(...)`. The `meHandler({ is_admin })` helper in `test/msw/me.ts` builds a `/me` response.
- Render with the providers the unit needs: `QueryClientProvider` (use `{ retry: false }`), `AuthProvider`, and `MemoryRouter` + `Routes` when the component uses router context.
- Auth resolves **asynchronously** via the `/me` query. Use `findBy*` for content gated on it, and key assertions off something that only appears post-auth (e.g. the "Log out" control) — not content that renders before auth resolves, or you'll get a false pass/fail.

## Sibling repo

The backend lives at `../backend`. Read its `AGENTS.md` before working on backend code.

## Gotchas

- A few pre-existing files (`AuthContext.*`) have Prettier drift on `main`. Don't reformat unrelated files in a PR — format only what you touch.
- Backend dev API comes from `VITE_API_BASE_URL` (`env.ts`), in dev as in prod. Its fallback is still `https://api.upmovies.localhost`, the retired Traefik host, so the variable has to be set in the workspace -- unset, every request goes to a name that does not resolve.

## Commits / PRs

Conventional commits with a **scope** and the Linear ID as a trailing parenthetical: `feat(auth): add X (NEU-123)`. **No** `Co-Authored-By`. The GitHub↔Linear connector moves ticket status automatically — don't touch it. Branch per ticket (Linear gives the branch name).

The scope is the component (`auth`, `feed`, `onboarding`, …), not the Linear project, and it is load-bearing rather than decorative: `cliff.toml` groups `RELEASE_NOTES.md` by scope, so a scopeless commit lands under a catch-all "General" heading.

## Release notes

Tag the release, then `task release-notes -- v0.4.1`. git-cliff renders only user-facing types (`feat`/`fix`/`perf`/`revert`) and **prepends** the new section — `RELEASE_NOTES.md` accumulates per-release chunks and is never rebuilt wholesale. It runs on the host rather than in the container, because git-cliff reads git history and tags, and neither it nor a usable `.git` is in the image. Don't call `git-cliff` directly.
