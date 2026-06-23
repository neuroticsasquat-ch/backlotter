export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "https://api.upmovies.localhost",
  publicSiteUrl: import.meta.env.VITE_PUBLIC_SITE_URL ?? "https://app.upmovies.localhost",
} as const;
