"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { Button } from "./Button";
import { Icon } from "./Icon";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  /**
   * When true, any dismiss attempt (outside click, Escape, the X button)
   * prompts a "discard unsaved changes?" confirmation instead of closing
   * immediately. Pass your form's dirty state here.
   */
  isDirty?: boolean;
  /** max-w-2xl instead of max-w-md - for content wider than a form fits,
   * e.g. an image-crop canvas. */
  wide?: boolean;
}

// Generic popup/dialog primitive - built on Radix so focus-trapping, ESC to
// close, outside-click dismissal, and ARIA wiring are correct without
// reimplementing them by hand. Radix funnels outside-click, Escape, and
// Dialog.Close all through the same onOpenChange(false) call when the
// dialog is controlled, so intercepting it here is enough to catch every
// dismiss path uniformly.
function ModalBase({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  isDirty = false,
  wide = false,
  allowNestedConfirm,
}: ModalProps & { allowNestedConfirm: boolean }) {
  const t = useTranslations("modal");
  const commonT = useTranslations("common");
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  function handleOpenChange(next: boolean) {
    if (!next && isDirty) {
      setConfirmingDiscard(true);
      return;
    }
    onOpenChange(next);
  }

  return (
    <>
      <Dialog.Root open={open} onOpenChange={handleOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-inverse-surface/40 z-40" />
          <Dialog.Content className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] ${wide ? "max-w-2xl" : "max-w-md"} max-h-[85vh] flex flex-col overflow-hidden bg-surface-container-lowest border border-outline-variant rounded-xl shadow-[0_4px_16px_0_rgba(0,0,0,0.12)] focus:outline-none`}>
            {/* Fixed header and footer; only the body scrolls, so its scrollbar
                sits inside the content area instead of riding the rounded edge. */}
            <div className="shrink-0 flex items-start justify-between gap-4 px-6 pt-6 pb-4">
              <div>
                <Dialog.Title className="font-headline-md text-headline-md text-on-surface">
                  {title}
                </Dialog.Title>
                {description && (
                  <Dialog.Description className="font-body-md text-body-md text-on-surface-variant mt-1">
                    {description}
                  </Dialog.Description>
                )}
              </div>
              <Dialog.Close asChild>
                <button
                  aria-label={t("close")}
                  className="text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  <Icon name="close" />
                </button>
              </Dialog.Close>
            </div>

            <div className={`min-h-0 flex-1 overflow-y-auto mx-2 px-4 ${footer ? "pb-1" : "pb-6"}`}>
              {children}
            </div>

            {footer && <div className="shrink-0 flex justify-end gap-2 px-6 pt-5 pb-6">{footer}</div>}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* allowNestedConfirm=false on this nested instance stops the
          recursion at depth 1 - without it, every Modal would render another
          Modal for its own discard-prompt, forever. */}
      {allowNestedConfirm && (
        <ModalBase
          open={confirmingDiscard}
          onOpenChange={setConfirmingDiscard}
          title={t("discardTitle")}
          description={t("discardDescription")}
          allowNestedConfirm={false}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmingDiscard(false)}>
                {t("keepEditing")}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirmingDiscard(false);
                  onOpenChange(false);
                }}
              >
                {commonT("discard")}
              </Button>
            </>
          }
        />
      )}
    </>
  );
}

export function Modal(props: ModalProps) {
  return <ModalBase {...props} allowNestedConfirm />;
}
