"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { DatePicker } from "@/components/ui/DatePicker";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { formatDateTime } from "@/lib/datetime";
import { getPathname } from "@/i18n/navigation";
import { createInvitationCode, getInvitationCodes, revokeInvitationCode } from "@/lib/api/invitations";
import type { InvitationCode } from "@/lib/api/types";

// Rendered only when the viewer has user.manage (see settings/page.tsx),
// which also gates the underlying GET/POST/revoke endpoints - see
// InvitationCodeListCreateView/InvitationCodeRevokeView in
// backend/accounts/views.py. Structured like CategorySettingsForm.tsx:
// fetch-all list (no "load more" pagination here either, same as every
// other admin screen right now), a create Modal, and per-row actions.
export function InvitationsSettingsForm() {
  const t = useTranslations("settings.invitations");
  const commonT = useTranslations("common");
  const locale = useLocale();

  const [codes, setCodes] = useState<InvitationCode[] | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [maxUses, setMaxUses] = useState(1);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<InvitationCode | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    getInvitationCodes().then(setCodes);
  }, []);

  function openCreate() {
    setMaxUses(1);
    setExpiresAt(null);
    setCreateError(null);
    setIsCreateOpen(true);
  }

  async function handleCreate() {
    setIsCreating(true);
    setCreateError(null);
    try {
      const created = await createInvitationCode({ max_uses: maxUses, expires_at: expiresAt });
      setCodes((prev) => [created, ...(prev ?? [])]);
      setIsCreateOpen(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    const revoked = await revokeInvitationCode(revokeTarget.id);
    setCodes((prev) => (prev ?? []).map((c) => (c.id === revoked.id ? revoked : c)));
  }

  async function handleCopyLink(code: InvitationCode) {
    const path = getPathname({ href: "/register", locale });
    const link = `${window.location.origin}${path}?code=${encodeURIComponent(code.code)}`;
    await navigator.clipboard.writeText(link);
    setCopiedId(code.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-headline-md text-headline-md text-on-surface">{t("title")}</h2>
            <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("description")}</p>
          </div>
          <Button onClick={openCreate}>
            <Icon name="add" size={18} />
            {t("generateCode")}
          </Button>
        </div>

        {!codes ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
        ) : codes.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
        ) : (
          <ul className="space-y-1">
            {codes.map((code) => {
              const isActive = code.is_valid;
              return (
                <li
                  key={code.id}
                  className="flex items-center justify-between gap-4 px-3 py-2 rounded-lg bg-surface-container"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono-sm text-mono-sm text-on-surface">{code.code}</span>
                      {!isActive && (
                        <span className="font-label-caps text-label-caps uppercase text-on-surface-variant">
                          {code.revoked_at ? t("statusRevoked") : t("statusExhaustedOrExpired")}
                        </span>
                      )}
                    </div>
                    <p className="font-body-md text-body-md text-on-surface-variant truncate">
                      {t("usesLabel", { used: code.uses_count, max: code.max_uses })}
                      {code.expires_at && ` · ${t("expiresLabel", { date: formatDateTime(code.expires_at) })}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {isActive && (
                      <button
                        type="button"
                        onClick={() => handleCopyLink(code)}
                        aria-label={t("copyLink")}
                        title={t("copyLink")}
                        className="text-on-surface-variant hover:text-primary transition-colors"
                      >
                        <Icon name={copiedId === code.id ? "check" : "content_copy"} size={18} />
                      </button>
                    )}
                    {isActive && !code.revoked_at && (
                      <button
                        type="button"
                        onClick={() => setRevokeTarget(code)}
                        aria-label={t("revoke")}
                        className="text-on-surface-variant hover:text-error transition-colors"
                      >
                        <Icon name="delete" size={18} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Modal
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        title={t("generateCode")}
        footer={
          <Button onClick={handleCreate} disabled={isCreating || maxUses < 1}>
            {isCreating ? commonT("saving") : t("generateCode")}
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
              {t("maxUsesLabel")}
            </label>
            <input
              type="number"
              min={1}
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              value={maxUses}
              onChange={(e) => setMaxUses(Math.max(1, Number(e.target.value)))}
            />
          </div>
          <DatePicker label={t("expiresAtLabel")} value={expiresAt} onChange={setExpiresAt} includeTime />
          {createError && (
            <p className="font-body-md text-body-md text-error" role="alert">
              {createError}
            </p>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={t("revokeConfirmTitle")}
        description={t("revokeConfirmBody")}
        confirmLabel={t("revoke")}
        danger
        onConfirm={handleRevoke}
      />
    </div>
  );
}
