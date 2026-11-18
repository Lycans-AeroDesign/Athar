"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { getOrganizationSubscription, type OrganizationSubscription } from "@/lib/api/billing";
import { SUBSCRIPTION_EXPIRED_EVENT } from "@/lib/api/client";

interface SubscriptionContextValue {
  /** Null while loading, or if the request failed (treated as "nothing to show"). */
  subscription: OrganizationSubscription | null;
  /** True until the first response (or failure) arrives. */
  isLoading: boolean;
  refetch: () => void;
}

const SubscriptionContext = createContext<SubscriptionContextValue>({
  subscription: null,
  isLoading: false,
  refetch: () => {},
});

// The signed-in org's subscription status, for the renewal banner and Settings > Subscription.
// Mounted inside PolicyGate (the endpoint is refused until policies are accepted). Re-checks when
// a write is refused with `subscription_expired` mid-session (lib/api/client.ts). UX only - the
// backend enforces read-only mode on every request (backend/policies/authentication.py).
export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const [subscription, setSubscription] = useState<OrganizationSubscription | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(() => {
    getOrganizationSubscription()
      .then(setSubscription)
      .catch(() => setSubscription(null))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    refetch();
    window.addEventListener(SUBSCRIPTION_EXPIRED_EVENT, refetch);
    return () => window.removeEventListener(SUBSCRIPTION_EXPIRED_EVENT, refetch);
  }, [refetch]);

  return (
    <SubscriptionContext.Provider value={{ subscription, isLoading, refetch }}>{children}</SubscriptionContext.Provider>
  );
}

export function useSubscription(): SubscriptionContextValue {
  return useContext(SubscriptionContext);
}
