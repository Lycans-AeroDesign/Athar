"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { formatDate } from "@/lib/datetime";
import { errorMessage } from "@/lib/errors";
import { formatPersonName } from "@/lib/format";
import { createShareLink, getShareLinks, publicShareUrl, revokeShareLink } from "@/lib/api/shareLinks";
import type { ShareableType, ShareLinkEntry } from "@/lib/api/types";
import { useHasPermission } from "@/lib/auth/permissions";

export interface PublicLinkTarget {
  type: ShareableType;
  objectId: string;
  /** Only published articles can be shared (SOPs have no status - pass true). */
  isPublished: boolean;
  isRestricted: boolean;
}

// Matches backend/knowledge/sharing.py's EXPIRY_CHOICES_DAYS; "never" = null.
const EXPIRY_OPTIONS = ["1", "7", "30", "90", "never"] as const;
// The type's edit override - required to share a RESTRICTED item (sharing.RESTRICTED_SHARE_PERMISSION).
const RESTRICTED_SHARE_PERMISSION: Record<ShareableType, string> = {
  article: "article.update",
  sop: "sop.update",
};

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: PublicLinkTarget;
}

export function ShareDialog({ open, onOpenChange, target }: ShareDialogProps) {
  const t = useTranslations("shareLinks");
  const locale = useLocale();
  const canShareRestricted = useHasPermission(RESTRICTED_SHARE_PERMISSION[target.type]);
  const [links, setLinks] = useState<ShareLinkEntry[] | null>(null);
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState<(typeof EXPIRY_OPTIONS)[number]>("30");
  const [isCreating, setIsCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const blockedReason = !target.isPublished
    ? t("notPublished")
    : target.isRestricted && !canShareRestricted
      ? t("restrictedNotAllowed")
      : null;

  useEffect(() => {
    if (!open) return;
    getShareLinks({ type: target.type, objectId: target.objectId })
      .then((data) => setLinks(data.results))
      .catch((err) => setError(errorMessage(err)));
  }, [open, target.type, target.objectId]);

  async function copy(text: string, id: string) {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500);
  }

  async function handleCreate() {
    setIsCreating(true);
    setError(null);
    try {
      const link = await createShareLink({
        type: target.type,
        object_id: target.objectId,
        label: label.trim(),
        expires_in_days: expiry === "never" ? null : Number(expiry),
      });
      setLinks((prev) => [link, ...(prev ?? [])]);
      setLabel("");
      await copy(publicShareUrl(link.token, locale), link.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    setError(null);
    try {
      await revokeShareLink(id);
      setLinks((prev) => (prev ?? []).filter((link) => link.id !== id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setConfirmRevokeId(null);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("dialogTitle")} wide>
      <div className="space-y-6">
        <section className="space-y-2">
          <h3 className="font-label-caps text-label-caps uppercase text-on-surface-variant">{t("memberLinkTitle")}</h3>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-body-md text-body-md text-on-surface-variant">{t("memberLinkDescription")}</p>
            <Button variant="secondary" size="sm" onClick={() => copy(window.location.href, "member")}>
              <Icon name={copiedId === "member" ? "check" : "content_copy"} size={16} />
              {copiedId === "member" ? t("copied") : t("copy")}
            </Button>
          </div>
        </section>

        <section className="space-y-3 pt-4 border-t border-outline-variant">
          <h3 className="font-label-caps text-label-caps uppercase text-on-surface-variant">{t("publicLinkTitle")}</h3>
          <p className="font-body-md text-body-md text-on-surface-variant">{t("publicLinkDescription")}</p>

          {blockedReason ? (
            <p className="flex items-start gap-2 font-body-md text-body-md text-on-surface-variant">
              <Icon name="lock" size={18} className="shrink-0 mt-0.5" />
              {blockedReason}
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex-1 min-w-48 space-y-1">
                <span className="block font-label-caps text-label-caps uppercase text-on-surface-variant">
                  {t("labelField")}
                </span>
                <input
                  value={label}
                  maxLength={100}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={t("labelPlaceholder")}
                  className="block w-full px-3 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                />
              </label>
              <div className="w-40">
                <Combobox
                  label={t("expiryField")}
                  options={EXPIRY_OPTIONS.map((option) => ({
                    value: option,
                    label: option === "never" ? t("expiryNever") : t("expiryDays", { count: Number(option) }),
                  }))}
                  value={expiry}
                  onChange={(value) => setExpiry(value as (typeof EXPIRY_OPTIONS)[number])}
                />
              </div>
              <Button onClick={handleCreate} loading={isCreating}>
                <Icon name="link" size={16} />
                {t("create")}
              </Button>
            </div>
          )}

          {error && (
            <p className="font-body-md text-body-md text-error" role="alert">
              {error}
            </p>
          )}

          {links && links.length > 0 && (
            <ul className="space-y-2">
              {links.map((link) => (
                <li
                  key={link.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-outline-variant bg-surface-container-low p-3"
                >
                  <div className="flex-1 min-w-48">
                    <p className="font-body-md text-body-md text-on-surface truncate">{link.label || t("unlabeled")}</p>
                    <p className="font-mono-sm text-mono-sm text-on-surface-variant">
                      {link.expires_at ? t("expiresOn", { date: formatDate(link.expires_at) }) : t("expiryNever")}
                      {" · "}
                      {t("views", { count: link.view_count })}
                      {link.created_by && (
                        <>
                          {" · "}
                          {formatPersonName(link.created_by)}
                        </>
                      )}
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => copy(publicShareUrl(link.token, locale), link.id)}>
                    <Icon name={copiedId === link.id ? "check" : "content_copy"} size={16} />
                    {copiedId === link.id ? t("copied") : t("copy")}
                  </Button>
                  {confirmRevokeId === link.id ? (
                    <Button variant="danger" size="sm" onClick={() => handleRevoke(link.id)}>
                      {t("confirmRevoke")}
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setConfirmRevokeId(link.id)}>
                      {t("revoke")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}
