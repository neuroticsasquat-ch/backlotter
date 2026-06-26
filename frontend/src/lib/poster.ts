import { env } from "@/env";

export function posterUrl(path: string | null, size: string): string | null {
  if (!path) return null;
  return `${env.tmdbImageBase}/${size}${path}`;
}

export function profileUrl(path: string | null, size = "w185"): string | null {
  if (!path) return null;
  return `${env.tmdbImageBase}/${size}${path}`;
}
