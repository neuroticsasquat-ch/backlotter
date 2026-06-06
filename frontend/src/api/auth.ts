import { apiFetch } from "./client";
import type { AuthedUser } from "./types";

export const fetchMe = () => apiFetch<AuthedUser>("/me");

export const signup = (body: {
  email: string;
  password: string;
  display_name: string;
  invite_code: string;
}) => apiFetch<AuthedUser>("/auth/signup", { method: "POST", body: JSON.stringify(body) });

export const login = (body: { email: string; password: string }) =>
  apiFetch<AuthedUser>("/auth/login", { method: "POST", body: JSON.stringify(body) });

export const logout = () => apiFetch<void>("/auth/logout", { method: "POST" });
