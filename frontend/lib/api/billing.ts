import { apiJson } from "./client";

/** Derived on the backend from the stored dates (backend/billing/services.py `evaluate`). */
export type SubscriptionStatus = "exempt" | "trialing" | "active" | "grace" | "expired";

export interface OrganizationPayment {
  amount: string;
  currency: string;
  paid_on: string;
  period_start: string;
  period_end: string;
  reference: string;
}

/** The caller's own organization's subscription. `payments` is only filled for organization
 * admins (organization.manage). */
export interface OrganizationSubscription {
  /** Whether subscriptions are enforced on this instance at all. */
  enabled: boolean;
  status: SubscriptionStatus;
  /** True once the grace period is over: every write is refused (403 `subscription_expired`). */
  read_only: boolean;
  access_until: string | null;
  read_only_from: string | null;
  renewal_due: boolean;
  /** Decimal as a string, e.g. "120.00". */
  price: string | null;
  currency: string;
  payment_instructions: string;
  max_users: number | null;
  max_storage_gb: number | null;
  user_count: number;
  storage_bytes: number;
  payments: OrganizationPayment[];
}

export function getOrganizationSubscription(): Promise<OrganizationSubscription> {
  return apiJson<OrganizationSubscription>("/api/v1/billing/subscription/");
}
