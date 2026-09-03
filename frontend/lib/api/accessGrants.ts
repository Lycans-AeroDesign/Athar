// Managing who's explicitly granted access to a RESTRICTED item, on top of
// its owner/creator - see backend/knowledge/serializers.py's
// AccessGrantSerializer/CreateAccessGrantSerializer and
// services.add_restricted_access/remove_restricted_access. Listing who
// already has access happens via the item's own Detail payload
// (`restricted_to`), not a GET here - see AccessGrantListCreateView's
// own docstring.

import { apiJson, apiVoid } from "./client";
import type { AccessGrant, RelatableType } from "./types";

export function addAccessGrant(type: RelatableType, objectId: string, userId: string): Promise<AccessGrant> {
  return apiJson<{ id: string; granted_user: AccessGrant["user"]; created_at: string }>(
    "/api/v1/knowledge/access-grants/",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content_type: type, object_id: objectId, user_id: userId }),
    },
  ).then((data) => ({ grant_id: data.id, user: data.granted_user }));
}

export function removeAccessGrant(grantId: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/access-grants/${grantId}/`, { method: "DELETE" });
}
