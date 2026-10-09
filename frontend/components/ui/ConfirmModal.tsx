"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { Button } from "./Button";
import { Modal } from "./Modal";

interface ConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  /** Optional extra content (e.g. an option checkbox) shown under the description. */
  children?: ReactNode;
}

// Reusable "are you sure?" dialog for destructive/important actions
// (delete a role, revoke a permission, remove a user, ...).
export function ConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  children,
}: ConfirmModalProps) {
  const t = useTranslations("common");
  const [isConfirming, setIsConfirming] = useState(false);

  async function handleConfirm() {
    setIsConfirming(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setIsConfirming(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isConfirming}>
            {cancelLabel ?? t("cancel")}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={handleConfirm}
            disabled={isConfirming}
          >
            {isConfirming ? t("working") : (confirmLabel ?? t("confirm"))}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
