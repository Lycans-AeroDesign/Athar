"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { getPathname } from "@/i18n/navigation";
import { createPasswordResetLink, passwordResetUrl } from "@/lib/api/passwordReset";
import { getUsers, setUserActive } from "@/lib/api/rbac";
import type { User } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { formatDateTime } from "@/lib/datetime";

// Rendered only when the viewer has user.manage (see settings/page.tsx),
// same gate RolesSettingsForm's own user-assignment section and
// InvitationsSettingsForm use. Structured like InvitationsSettingsForm.tsx:
// fetch-all list, per-row action, ConfirmModal for the destructive one -
// block goes through it (danger), unblock is a direct action (like
// RolesSettingsForm's "Undo delete" button). The viewer's own row never
// shows a block/unblock control - see rbac.services.set_user_active's
// matching backend guard against self-block.
export function UsersSettingsForm() {
  const t = useTranslations("settings.users");
  const commonT = useTranslations("common");
  const { user: viewer } = useAuth();
  const locale = useLocale();

  const [users, setUsers] = useState<User[] | null>(null);
  const [blockTarget, setBlockTarget] = useState<User | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  // The generated link - shown once, in a modal; only its hash is stored server-side.
  const [resetLink, setResetLink] = useState<{ email: string; url: string; expiresAt: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    getUsers().then(setUsers);
  }, []);

  async function handleBlock() {
    if (!blockTarget) return;
    setWorkingId(blockTarget.id);
    setError(null);
    try {
      const updated = await setUserActive(blockTarget.id, false);
      setUsers((prev) => (prev ?? []).map((u) => (u.id === updated.id ? updated : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorkingId(null);
      setBlockTarget(null);
    }
  }

  async function handleUnblock(user: User) {
    setWorkingId(user.id);
    setError(null);
    try {
      const updated = await setUserActive(user.id, true);
      setUsers((prev) => (prev ?? []).map((u) => (u.id === updated.id ? updated : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorkingId(null);
    }
  }

  async function handleGenerateResetLink() {
    if (!resetTarget) return;
    setWorkingId(resetTarget.id);
    setError(null);
    try {
      const link = await createPasswordResetLink(resetTarget.id);
      const path = getPathname({ href: "/reset-password", locale });
      setResetLink({
        email: link.email,
        url: passwordResetUrl(window.location.origin, path, link.token),
        expiresAt: link.expires_at,
      });
      setLinkCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorkingId(null);
      setResetTarget(null);
    }
  }

  async function handleCopyResetLink() {
    if (!resetLink) return;
    await navigator.clipboard.writeText(resetLink.url);
    setLinkCopied(true);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-4">
        <div>
          <h2 className="font-headline-md text-headline-md text-on-surface">{t("title")}</h2>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("description")}</p>
        </div>

        {!users ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
        ) : (
          <ul className="space-y-1">
            {users.map((user) => {
              const isSelf = user.id === viewer?.id;
              return (
                <li
                  key={user.id}
                  className="flex items-center justify-between gap-4 px-3 py-2 rounded-lg bg-surface-container"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-body-md text-body-md text-on-surface truncate">{user.email}</span>
                      <span
                        className={`font-label-caps text-label-caps uppercase rounded-full px-2 py-0.5 ${
                          user.is_active
                            ? "bg-secondary-container text-on-secondary-container"
                            : "bg-error-container text-on-error-container"
                        }`}
                      >
                        {user.is_active ? t("statusActive") : t("statusBlocked")}
                      </span>
                    </div>
                    {user.roles.length > 0 && (
                      <p className="font-body-md text-body-md text-on-surface-variant truncate">
                        {user.roles.join(", ")}
                      </p>
                    )}
                  </div>
                  {isSelf ? (
                    <span className="font-label-caps text-label-caps uppercase text-on-surface-variant shrink-0">
                      {t("selfHint")}
                    </span>
                  ) : (
                    <div className="shrink-0 flex items-center gap-4">
                      {user.is_active && (
                        <button
                          type="button"
                          onClick={() => setResetTarget(user)}
                          disabled={workingId === user.id}
                          className="font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-primary transition-colors"
                        >
                          {t("resetLinkAction")}
                        </button>
                      )}
                      {user.is_active ? (
                        <button
                          type="button"
                          onClick={() => setBlockTarget(user)}
                          disabled={workingId === user.id}
                          className="font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-error transition-colors"
                        >
                          {t("blockAction")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleUnblock(user)}
                          disabled={workingId === user.id}
                          className="font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-primary transition-colors"
                        >
                          {t("unblockAction")}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {error && (
          <p className="font-body-md text-body-md text-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <ConfirmModal
        open={blockTarget !== null}
        onOpenChange={(open) => !open && setBlockTarget(null)}
        title={t("blockConfirmTitle")}
        description={blockTarget ? t("blockConfirmBody", { email: blockTarget.email }) : ""}
        confirmLabel={t("blockAction")}
        danger
        onConfirm={handleBlock}
      />

      <ConfirmModal
        open={resetTarget !== null}
        onOpenChange={(open) => !open && setResetTarget(null)}
        title={t("resetLinkConfirmTitle")}
        description={resetTarget ? t("resetLinkConfirmBody", { email: resetTarget.email }) : ""}
        confirmLabel={t("resetLinkConfirm")}
        onConfirm={handleGenerateResetLink}
      />

      <Modal
        open={resetLink !== null}
        onOpenChange={(open) => !open && setResetLink(null)}
        title={t("resetLinkTitle")}
        description={resetLink ? t("resetLinkBody", { email: resetLink.email }) : undefined}
        footer={
          <Button variant="secondary" onClick={() => setResetLink(null)}>
            {t("resetLinkDone")}
          </Button>
        }
      >
        {resetLink && (
          <div className="space-y-3">
            <div className="flex items-stretch gap-2">
              <input
                readOnly
                value={resetLink.url}
                onFocus={(e) => e.target.select()}
                aria-label={t("resetLinkTitle")}
                className="min-w-0 flex-1 px-3 py-2 font-mono-sm text-mono-sm text-on-surface bg-surface-container border border-outline-variant rounded-lg outline-none"
              />
              <Button onClick={handleCopyResetLink}>
                <Icon name={linkCopied ? "check" : "content_copy"} size={14} />
                {linkCopied ? commonT("copied") : t("resetLinkCopy")}
              </Button>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              {t("resetLinkExpires", { time: formatDateTime(resetLink.expiresAt) })}
            </p>
            <p className="font-body-sm text-body-sm text-on-surface-variant">{t("resetLinkOnce")}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
