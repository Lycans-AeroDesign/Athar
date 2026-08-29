import type { LoginResponse } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export async function loginRequest(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${API_URL}/api/v1/auth/login/`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error("Invalid email or password");
  return res.json();
}

export async function logoutRequest(): Promise<void> {
  await fetch(`${API_URL}/api/v1/auth/logout/`, {
    method: "POST",
    credentials: "include",
  }).catch(() => {
    // Token store is cleared client-side regardless of network/server outcome.
  });
}

export async function refreshRequest(): Promise<{ access: string }> {
  const res = await fetch(`${API_URL}/api/v1/auth/refresh/`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Refresh failed");
  return res.json();
}
