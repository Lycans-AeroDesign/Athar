"use client";

import { useCallback, useEffect, useState } from "react";

import { SideNav } from "@/components/layout/SideNav";
import { TopBar } from "@/components/layout/TopBar";
import { ProductTourAutostart } from "@/components/onboarding/ProductTourAutostart";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Stable references (setMobileNavOpen itself never changes) rather than
  // inline closures - ProductTourAutostart depends on these in a useEffect,
  // and a fresh closure every render would re-run that effect (and reset its
  // one-shot start timer) on every unrelated re-render of this layout.
  const openMobileNav = useCallback(() => setMobileNavOpen(true), []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
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
    // h-dvh, not h-screen - see SideNav.tsx's own comment on the same
    // mobile-viewport issue; this wrapper sets the height SideNav's h-dvh
    // sits inside, so it needs to match rather than reintroduce the gap.
    <div className="bg-background text-on-background flex h-dvh overflow-hidden">
      <ProductTourAutostart openMobileNav={openMobileNav} closeMobileNav={closeMobileNav} />
      <SideNav open={mobileNavOpen} onClose={closeMobileNav} />
      <div className="flex-1 flex flex-col lg:ms-64 overflow-hidden bg-background">
        <TopBar onOpenMenu={openMobileNav} onCloseMenu={closeMobileNav} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-10 bg-background">
          <div className="max-w-[1200px] mx-auto space-y-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
