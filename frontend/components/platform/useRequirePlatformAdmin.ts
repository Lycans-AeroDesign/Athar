"use client";

import { useEffect } from "react";

import { useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";

/** True once the viewer is a platform admin; redirects everyone else home (UX only: the
 * backend enforces is_superuser on every /platform endpoint). */
export function useRequirePlatformAdmin(): boolean {
  const { user } = useAuth();
  const router = useRouter();
  const allowed = Boolean(user?.is_superuser);

  useEffect(() => {
    if (user && !allowed) router.replace("/");
  }, [user, allowed, router]);

  return allowed;
}
