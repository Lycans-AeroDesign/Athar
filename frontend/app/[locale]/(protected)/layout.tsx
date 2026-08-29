"use client";

import { useEffect } from "react";

import { SideNav } from "@/components/layout/SideNav";
import { TopBar } from "@/components/layout/TopBar";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // proxy.ts already redirects page loads with no refresh cookie to /login;
    // this is a defensive fallback for the client-only case where the
    // session expires/fails to refresh after the shell has already mounted.
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, user, router]);

  if (isLoading || !user) {
    return <LoadingScreen />;
  }

  return (
    <div className="bg-background text-on-background flex h-screen overflow-hidden">
      <SideNav />
      <div className="flex-1 flex flex-col ms-64 overflow-hidden bg-background">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-10 bg-background">
          <div className="max-w-[1200px] mx-auto space-y-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
