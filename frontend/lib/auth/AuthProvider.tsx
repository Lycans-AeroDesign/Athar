"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { apiFetch } from "@/lib/api/client";
import { loginRequest, logoutRequest, refreshRequest } from "@/lib/api/auth";
import type { User } from "@/lib/api/types";

import { tokenStore } from "./token-store";

interface AuthContextValue {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const accessToken = useSyncExternalStore(
    tokenStore.subscribe,
    tokenStore.getAccessToken,
    () => null,
  );
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const login = useCallback(async (email: string, password: string) => {
    const data = await loginRequest(email, password);
    tokenStore.setAccessToken(data.access);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    tokenStore.clearAccessToken();
    setUser(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Eager silent refresh on mount: a hard reload wipes the in-memory access
    // token, so this repopulates it (and `user`) from the httpOnly refresh
    // cookie before children render, avoiding a flash of logged-out UI.
    // A failure here just means "not logged in" - it must not redirect,
    // since this provider also wraps public pages like /login.
    async function silentRefresh() {
      try {
        const { access } = await refreshRequest();
        if (cancelled) return;
        tokenStore.setAccessToken(access);

        const meRes = await apiFetch("/api/v1/auth/me/");
        if (!cancelled && meRes.ok) {
          setUser(await meRes.json());
        }
      } catch {
        // Not logged in - normal for a fresh visitor on a public page.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    silentRefresh();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, accessToken, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
