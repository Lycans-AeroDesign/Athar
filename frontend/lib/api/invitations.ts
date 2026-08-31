import { apiJson } from "./client";
import type { InvitationCode, Paginated } from "./types";

// Same "page 1 only" convention as rbac.ts's getRoles()/getUsers() - see
// that file's top-of-file note.
export function getInvitationCodes(): Promise<InvitationCode[]> {
  return apiJson<Paginated<InvitationCode>>("/api/v1/auth/invitations/").then((data) => data.results);
}

export function createInvitationCode(payload: { max_uses?: number; expires_at?: string | null }): Promise<InvitationCode> {
  return apiJson<InvitationCode>("/api/v1/auth/invitations/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function revokeInvitationCode(id: string): Promise<InvitationCode> {
  return apiJson<InvitationCode>(`/api/v1/auth/invitations/${id}/revoke/`, { method: "POST" });
}
