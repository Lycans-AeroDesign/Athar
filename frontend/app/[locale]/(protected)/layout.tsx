"use client";

import { useEffect, useState } from "react";

import { SideNav } from "@/components/layout/SideNav";
import { TopBar } from "@/components/layout/TopBar";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Below lg, SideNav is an off-canvas drawer (see SideNav.tsx) - close it on
  // every navigation so it doesn't stay open over the new page. Reset during
  // render (React's documented pattern for "adjust state when a prop
  // changes") rather than in an effect, which would cost an extra commit.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMobileNavOpen(false);
  }

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
      <SideNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="flex-1 flex flex-col lg:ms-64 overflow-hidden bg-background">
        <TopBar onOpenMenu={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-10 bg-background">
          <div className="max-w-[1200px] mx-auto space-y-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
