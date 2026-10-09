import { apiJson, apiVoid } from "./client";
import type { KnowledgeAuthor } from "./types";

export { POLICY_REQUIRED_EVENT } from "./client";

export type PolicyKind = "PRIVACY" | "CONFIDENTIALITY";

export const POLICY_KINDS: PolicyKind[] = ["PRIVACY", "CONFIDENTIALITY"];

export interface PolicyVersion {
  id: string;
  kind: PolicyKind;
  version: number;
  title: string;
  content: string;
  published_at: string;
  published_by: KnowledgeAuthor | null;
}

export interface CurrentPolicy extends PolicyVersion {
  accepted: boolean;
}

export interface PolicyOverview {
  kind: PolicyKind;
  draft: { title: string; content: string; updated_at: string; updated_by: KnowledgeAuthor | null } | null;
  current: PolicyVersion | null;
  accepted_count: number;
  member_count: number;
  has_unpublished_changes: boolean;
}

export function getCurrentPolicies(): Promise<CurrentPolicy[]> {
  return apiJson<CurrentPolicy[]>("/api/v1/policies/");
}

export function acceptPolicies(versionIds: string[]): Promise<void> {
  return apiVoid("/api/v1/policies/accept/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version_ids: versionIds }),
  });
}

/** Requires organization.manage. */
export function getPolicyOverview(): Promise<PolicyOverview[]> {
  return apiJson<PolicyOverview[]>("/api/v1/policies/manage/");
}

export function savePolicyDraft(kind: PolicyKind, payload: { title: string; content: string }) {
  return apiJson<NonNullable<PolicyOverview["draft"]>>(`/api/v1/policies/manage/${kind.toLowerCase()}/draft/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function publishPolicy(kind: PolicyKind): Promise<PolicyVersion> {
  return apiJson<PolicyVersion>(`/api/v1/policies/manage/${kind.toLowerCase()}/publish/`, { method: "POST" });
}
