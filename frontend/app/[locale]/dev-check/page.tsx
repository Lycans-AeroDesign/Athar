"use client";

// Throwaway verification page for the auth/authz infrastructure - delete once
// real pages (from the Stitch design) are wired up. Exists because proxy.ts
// only fires on real browser navigations and the refresh/retry interceptor
// only shows itself through real network round-trips visible in devtools.
import { useState } from "react";

import { apiFetch } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/AuthProvider";
import { tokenStore } from "@/lib/auth/token-store";

export default function DevCheckPage() {
  const { user, accessToken, isLoading, login, logout } = useAuth();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("adminpass123");
  const [log, setLog] = useState<string[]>([]);

  function append(line: string) {
    setLog((prev) => [`${new Date().toLocaleTimeString()} - ${line}`, ...prev]);
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 p-8 text-slate-900 dark:text-slate-100">
      <h1 className="text-xl font-semibold">Auth/authz dev check</h1>

      <p className="text-sm text-slate-600 dark:text-slate-400">
        {isLoading ? "Checking session..." : user ? `Logged in as ${user.email}` : "Not logged in"}
      </p>

      <div className="flex flex-col gap-2">
        <input
          className="rounded border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email"
        />
        <input
          className="rounded border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password"
          type="password"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="rounded bg-slate-900 px-3 py-2 text-white dark:bg-slate-100 dark:text-slate-900"
          onClick={async () => {
            try {
              await login(email, password);
              append("login ok");
            } catch (err) {
              append(`login failed: ${(err as Error).message}`);
            }
          }}
        >
          Login
        </button>

        <button
          className="rounded border border-slate-300 px-3 py-2 dark:border-slate-700"
          onClick={async () => {
            const res = await apiFetch("/api/v1/auth/me/");
            append(`call protected endpoint -> ${res.status}`);
          }}
        >
          Call Protected Endpoint
        </button>

        <button
          className="rounded border border-slate-300 px-3 py-2 dark:border-slate-700"
          onClick={() => {
            tokenStore.setAccessToken("garbage.expired.token");
            append("access token force-expired");
          }}
        >
          Force-expire token
        </button>

        <button
          className="rounded border border-slate-300 px-3 py-2 dark:border-slate-700"
          onClick={async () => {
            await logout();
            append("logout ok");
          }}
        >
          Logout
        </button>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-500">
        access token in memory: {accessToken ? `${accessToken.slice(0, 24)}...` : "none"}
      </p>

      <ul className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
        {log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </main>
  );
}
