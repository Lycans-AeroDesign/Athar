"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

import { getOrganizationSettings } from "@/lib/api/organization";
import type { OrganizationSettings } from "@/lib/api/types";

interface OrganizationContextValue {
  settings: OrganizationSettings | null;
  refetch: () => void;
  /** Optimistically update the cached settings right after a successful save,
   * so the sidebar/title reflect a name/branding change without a refetch. */
  setSettings: (settings: OrganizationSettings) => void;
}

const OrganizationContext = createContext<OrganizationContextValue | null>(null);

// Runs before the browser paints on the client, but is a no-op on the server
// (there is no DOM to lay out yet) - avoids the "useLayoutEffect does
// nothing on the server" warning that a plain useLayoutEffect would trigger
// during SSR.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const CACHE_KEY = "athar:org-settings";

// See the layout.tsx comment on `metadata` for why this can't be resolved
// server-side instead (container-internal vs. public API URL). Caching the
// last-fetched settings client-side is the next best thing: it lets the
// sidebar/login logo render the real branding immediately on repeat visits
// instead of flashing the default BrandMark while the fetch is in flight.
function readCachedSettings(): OrganizationSettings | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as OrganizationSettings) : null;
  } catch {
    return null;
  }
}

function writeCachedSettings(settings: OrganizationSettings) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing / quota exceeded - fall back to fetch-only behavior.
  }
}

// Fetches once at the top of the tree (the read endpoint is public - see
// backend/organization/views.py - so this also works on the pre-login /login
// page) and updates document.title client-side once the name is known.
export function OrganizationProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<OrganizationSettings | null>(null);

  const setSettings = useCallback((next: OrganizationSettings) => {
    setSettingsState(next);
    writeCachedSettings(next);
  }, []);

  // Seed from the localStorage cache before the browser paints, so a reload
  // shows the org's real logo/name immediately rather than the default
  // BrandMark for one frame while the network request is still in flight.
  useIsomorphicLayoutEffect(() => {
    const cached = readCachedSettings();
    if (cached) setSettingsState(cached);
  }, []);

  const refetch = useCallback(() => {
    getOrganizationSettings().then(setSettings).catch(() => {});
  }, [setSettings]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    if (settings?.name) document.title = settings.name;
  }, [settings?.name]);

  return (
    <OrganizationContext.Provider value={{ settings, refetch, setSettings }}>
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization(): OrganizationContextValue {
  const ctx = useContext(OrganizationContext);
  if (!ctx) throw new Error("useOrganization must be used within an OrganizationProvider");
  return ctx;
}
