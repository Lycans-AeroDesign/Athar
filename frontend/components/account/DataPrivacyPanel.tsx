"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { FloatingLabelInput } from "@/components/ui/FloatingLabelInput";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { useRouter } from "@/i18n/navigation";
import { deleteMyAccount, downloadMyData } from "@/lib/api/accounts";
import { useAuth } from "@/lib/auth/AuthProvider";
import { errorMessage } from "@/lib/errors";

// Self-service data rights on My Account: download everything Athar holds about you, or delete
// the account (password-confirmed; the backend refuses it for an organization's only admin).
export function DataPrivacyPanel() {
  const t = useTranslations("account.data");
  const commonT = useTranslations("common");
  const router = useRouter();
  const { logout } = useAuth();
  const [isExporting, setIsExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setError(null);
    setIsExporting(true);
    try {
      await downloadMyData();
    } catch (err) {
      setError(t("exportError", { message: errorMessage(err) }));
    } finally {
      setIsExporting(false);
    }
  }

  async function handleDelete() {
    setError(null);
    setIsDeleting(true);
    try {
      await deleteMyAccount(password);
    } catch (err) {
      // Stays open so the message shows inside the dialog next to the password field.
      setError(errorMessage(err));
      setIsDeleting(false);
      return;
    }
    await logout();
    router.push("/login");
  }

  function handleOpenChange(open: boolean) {
    setDeleteOpen(open);
    if (!open) {
      setPassword("");
      setError(null);
    }
  }

  return (
    <div className="space-y-6">
      <p className="font-body-md text-body-md text-on-surface-variant">{t("description")}</p>

      <div className="bg-surface-container-low border border-outline-variant rounded-xl p-5 space-y-3">
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("exportTitle")}</h2>
        <p className="font-body-md text-body-md text-on-surface-variant">{t("exportDescription")}</p>
        <Button variant="secondary" onClick={handleExport} disabled={isExporting}>
          <Icon name="download" size={16} />
          {isExporting ? commonT("working") : t("exportButton")}
        </Button>
      </div>

      <div className="bg-surface-container-low border border-error rounded-xl p-5 space-y-3">
        <h2 className="font-headline-md text-headline-md text-error">{t("deleteTitle")}</h2>
        <p className="font-body-md text-body-md text-on-surface-variant">{t("deleteDescription")}</p>
        <Button variant="danger" onClick={() => setDeleteOpen(true)}>
          <Icon name="delete" size={16} />
          {t("deleteButton")}
        </Button>
      </div>

      {error && !deleteOpen && (
        <p role="alert" className="font-body-md text-body-md text-error">
          {error}
        </p>
      )}

      <Modal
        open={deleteOpen}
        onOpenChange={handleOpenChange}
        title={t("deleteConfirmTitle")}
        description={t("deleteConfirmDescription")}
        footer={
          <>
            <Button variant="secondary" onClick={() => handleOpenChange(false)} disabled={isDeleting}>
              {commonT("cancel")}
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={isDeleting || !password}>
              {isDeleting ? commonT("working") : t("deleteButton")}
            </Button>
          </>
        }
      >
        <FloatingLabelInput
          type="password"
          label={t("passwordLabel")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          error={error ?? undefined}
        />
      </Modal>
    </div>
  );
}
