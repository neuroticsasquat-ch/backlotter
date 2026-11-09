export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "https://api.upmovies.localhost",
  publicSiteUrl: import.meta.env.VITE_PUBLIC_SITE_URL ?? "https://app.upmovies.localhost",
  tmdbImageBase: import.meta.env.VITE_TMDB_IMAGE_BASE ?? "https://image.tmdb.org/t/p",
  // Cloudflare Turnstile, the bot check on signup (NEU-1345, D-18). A site key is public by
  // design; the TURNSTILE_SECRET it pairs with never leaves the API.
  //
  // The fallback is Cloudflare's documented always-passes test key, and it is deliberately
  // **dev-only**. Falling back in a production build would ship a widget that solves for
  // everyone, including bots; the API would then refuse every one of those tokens with 403
  // invalid_turnstile, and a missing build variable would present as a signup outage that
  // looks like a broken widget. Empty is the honest value — `<Turnstile>` renders nothing
  // and says so, which is a failure someone can read.
  turnstileSiteKey:
    import.meta.env.VITE_TURNSTILE_SITE_KEY ??
    (import.meta.env.DEV ? "1x00000000000000000000AA" : ""),
} as const;
