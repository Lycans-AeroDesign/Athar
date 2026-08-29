"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

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

// Fetches once at the top of the tree (the read endpoint is public - see
// backend/organization/views.py - so this also works on the pre-login /login
// page) and updates document.title client-side once the name is known.
export function OrganizationProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);

  const refetch = useCallback(() => {
    getOrganizationSettings().then(setSettings).catch(() => {});
  }, []);

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
