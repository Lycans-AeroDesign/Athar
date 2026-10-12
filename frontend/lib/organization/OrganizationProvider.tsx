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

import { apiUrl } from "@/lib/api/client";
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

// Points every <link rel="icon"> at the org's uploaded favicon, or restores
// the originals (Next's own app/favicon.ico) when it's cleared. Rewrites the
// existing links rather than appending a new one, since browsers pick among
// several icon links by their `sizes` and could otherwise keep the default.
function applyFavicon(href: string | null) {
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
  if (href && links.length === 0) {
    const link = document.createElement("link");
    link.rel = "icon";
    link.dataset.orgFavicon = "true";
    document.head.appendChild(link);
    links.push(link);
  }
  for (const link of links) {
    if (href) {
      link.dataset.defaultHref ??= link.getAttribute("href") ?? "";
      link.dataset.defaultType ??= link.getAttribute("type") ?? "";
      // The default's type (image/x-icon) wouldn't match an uploaded PNG/SVG.
      link.removeAttribute("type");
      link.href = href;
    } else if (link.dataset.orgFavicon) {
      link.remove();
    } else if (link.dataset.defaultHref !== undefined) {
      link.href = link.dataset.defaultHref;
      if (link.dataset.defaultType) link.type = link.dataset.defaultType;
    }
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

  // Same client-side-only reasoning as document.title above. `updated_at` is
  // appended as a cache-buster since the favicon endpoint's URL never changes
  // when a new image is saved, and browsers cache favicons aggressively.
  const faviconHref = settings?.favicon_url
    ? `${apiUrl(settings.favicon_url)}?v=${encodeURIComponent(settings.updated_at)}`
    : null;
  useEffect(() => {
    applyFavicon(faviconHref);
  }, [faviconHref]);

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
