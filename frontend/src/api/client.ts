import { env } from "@/env";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

let _csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  _csrfToken = token;
}

export function getCsrfToken(): string | null {
  return _csrfToken;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers({ Accept: "application/json", ...(init?.headers ?? {}) });

  if (method !== "GET" && method !== "HEAD") {
    if (_csrfToken) headers.set("X-CSRF-Token", _csrfToken);
  }

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${env.apiBaseUrl}${path}`, {
    ...init,
    method,
    credentials: "include",
    headers,
  });

  if (!res.ok) {
    let body: unknown = null;
    let message = `Request failed with status ${res.status}`;
    try {
      body = await res.json();
      if (body && typeof body === "object" && "detail" in body && typeof body.detail === "string") {
        message = body.detail;
      }
    } catch {
      // non-JSON body; keep generic message
    }
    throw new ApiError(res.status, message, body);
  }

  // 204 and 205 are explicitly no-content; many of our 202 endpoints return
  // no body either. Avoid `res.json()` on those — empty-body parses throw.
  if (res.status === 204 || res.status === 205) return undefined as T;
  const text = await res.text();
  if (text.length === 0) return undefined as T;
  return JSON.parse(text) as T;
}
