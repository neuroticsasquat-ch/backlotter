export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "https://api.upmovies.localhost",
  publicSiteUrl: import.meta.env.VITE_PUBLIC_SITE_URL ?? "https://app.upmovies.localhost",
  tmdbImageBase: import.meta.env.VITE_TMDB_IMAGE_BASE ?? "https://image.tmdb.org/t/p",
} as const;
