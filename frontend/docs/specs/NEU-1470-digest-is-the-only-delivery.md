# NEU-1470 — The digest is the only delivery (frontend half)

**Ticket:** NEU-1470 "Why did I get two emails this morning?" (bl: Maintenance)
**Backend half and decision record:** `backend/docs/specs/NEU-1470-digest-is-the-only-delivery.md`
and backend ADR-0021. One ticket, two PRs, both on `release/v1.1.1`.

## 1. What and why

Backlotter sent Tom an alert mail and a digest for one trailer. ADR-0021 retires the alert
mail, Web Push and the per-beat store setting: **the digest is the only delivery**, and a
reader hears about a beat at the cadence they chose. This half removes the browser side of
push, the Alerts settings section, and every piece of copy that still promises alerts or
notifications outside the digest.

## 2. Acceptance

1. `/me/settings` shows Account, Digest email and the rest as today, with **no** Alerts
   section and **no** Browser notifications section. The Off cadence help no longer promises
   alerts.
2. No code calls `/me/push` or `/me/push/vapid-public-key`; `UserSettings` has no
   `alert_stores`; `AlertStore`, `PushSubscriptionPayload`, `VapidPublicKey` are gone.
3. A browser that registered the old service worker is cleaned up: `public/sw.js` becomes a
   self-unregistering shim (§3.2), permanently — it is ten lines and removes owed work.
4. No user-facing string says "alert" or "notification" in the delivery sense; "alert window"
   comments (`ImportReview.tsx`, `film/labels.ts`, `types.ts:510,646`) stay, as does
   `role="alert"`.
5. `pnpm typecheck`, lint and `vitest` pass; the manifest test no longer expects a badge.

## 3. Design

### 3.1 Delete

`src/components/push/PushSection.tsx`, `usePushToggle.ts`, `PushSection.test.tsx`;
`src/api/push.ts`; `src/lib/push-support.ts`, `push-support.test.ts`, `sw.test.ts`;
`src/test/msw/push.ts`; `src/test/push-env.ts`; `public/icons/badge-96.png` and the badge
half of `scripts/icons.mjs` (20-21, 40-68, 77-82, 89); `src/lib/manifest.test.ts:74-79`
loses the badge expectation (`icon-192` stays — it is a manifest icon, NEU-1404).

### 3.2 `public/sw.js` becomes a shim

Replace the 217-line worker with one that, on `install`, calls `self.skipWaiting()`, and on
`activate`, unsubscribes any push subscription (`self.registration.pushManager.getSubscription()
.then(s => s && s.unsubscribe())`) and then `self.registration.unregister()`. Browsers that
never registered fetch nothing; browsers that did pick the shim up on their next visit's
update check, drop the push registration and forget the worker. Keep the file forever: a 404
would leave the old worker installed indefinitely.

### 3.3 Settings page

`src/pages/Settings.tsx`: remove the `PushSection` import and mount (16, 91), the
`AlertsSection` mount (88), `STORES` + `AlertsSection` (334-411), the `useUpdateAlertStores`
and `AlertStore` imports (10, 13). Copy:

- CADENCES Off help (44): `"No digest. Alerts for the films you follow still arrive."` →
  `"No mail. Everything is still on your timeline."`
- Locked-panel copy (667): drop "and push notifications" — "Digest emails and calendar
  subscriptions are part of the subscription, …".

`src/api/me.ts`: remove `AlertStore` import (14), `updateAlertStores` (223-230),
`useUpdateAlertStores` (273-298). `src/api/types.ts`: remove `alert_stores` (30-32),
`AlertStore` (435-438), `PushSubscriptionPayload` / `VapidPublicKey` (762-776); reword the
comment at 236. `src/test/msw/settings.ts`: drop `alert_stores` from the default, the patch
type and the merge (3, 10, 20, 37-38, 42).

### 3.4 Other copy

- `src/pages/MyFollows.tsx:294` "Your timeline and your alerts are built from these." → "Your
  timeline and your digest are built from these." (test `MyFollows.test.tsx:468-471`).
- `src/components/VerifyEmailBanner.tsx:74` "Confirm your email address so we can send you
  alerts." → "… so we can send you your digest."
- `src/content/legal/privacy.md:31` "(e.g., release alerts you've opted into)" → "(e.g., the
  digest you've opted into)"; check 12 ("notification settings" → "digest settings") and 38
  ("any notifications you opt into" → "the digest you opt into").
- `src/components/film/WhereToWatch.tsx:5-8` comment: drop the D-14/D-44 reference.

### 3.5 Tests

`src/pages/Settings.test.tsx`: delete the `alert stores (D-44)` block (60-131), the Alerts
heading assertion (340), the browser-notifications assertion (350-354); update the Off copy
assertion (153-155) and the inline fixture at 461. `src/api/me.test.ts`: delete the import
(20) and `alert store fetchers` (99-137). Add one test that the settings page renders without
either removed section (a heading list assertion is enough).

## 4. Out of scope

- `public/manifest.webmanifest` and the PWA metas in `src/root.tsx` (NEU-1404): untouched.
- The digest section's copy and the `?digest=off` notice (NEU-1466): untouched.
- Frontend `CONTEXT.md` has no alert or push terms; nothing to edit.
