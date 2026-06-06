import { createContext, useCallback, useContext, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as authApi from "@/api/auth";
import { ApiError, setCsrfToken } from "@/api/client";
import type { AuthedUser } from "@/api/types";

type AuthContextValue = {
  user: AuthedUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (
    email: string,
    password: string,
    displayName: string,
    inviteCode: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();

  const meQuery = useQuery<AuthedUser | null>({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        const user = await authApi.fetchMe();
        setCsrfToken(user.csrf_token);
        return user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          setCsrfToken(null);
          return null;
        }
        throw e;
      }
    },
    staleTime: 60_000,
  });

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["me"] });
  }, [qc]);

  const loginMut = useMutation({
    mutationFn: (vars: { email: string; password: string }) => authApi.login(vars),
    onSuccess: (user) => {
      setCsrfToken(user.csrf_token);
      qc.setQueryData(["me"], user);
    },
  });
  const signupMut = useMutation({
    mutationFn: (vars: {
      email: string;
      password: string;
      display_name: string;
      invite_code: string;
    }) => authApi.signup(vars),
    onSuccess: (user) => {
      setCsrfToken(user.csrf_token);
      qc.setQueryData(["me"], user);
    },
  });
  const logoutMut = useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => {
      setCsrfToken(null);
      qc.setQueryData(["me"], null);
    },
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data ?? null,
      loading: meQuery.isLoading,
      login: async (email, password) => {
        await loginMut.mutateAsync({ email, password });
      },
      signup: async (email, password, displayName, inviteCode) => {
        await signupMut.mutateAsync({
          email,
          password,
          display_name: displayName,
          invite_code: inviteCode,
        });
      },
      logout: async () => {
        await logoutMut.mutateAsync();
      },
      refresh,
    }),
    [
      meQuery.data,
      meQuery.isLoading,
      loginMut,
      signupMut,
      logoutMut,
      refresh,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
