"use client";

import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/Icon";

// Shown under the login/register submit button - a plain-language
// reassurance, deliberately not technical. What backs it: passwords are
// stored hashed, backups are encrypted (backend/core/crypto.py), and
// production traffic is HTTPS-only (nginx/templates/prod.conf.template).
export function SecurityNote() {
  const t = useTranslations("auth");

  return (
    <p className="flex items-start justify-center gap-1.5 text-center font-body-md text-body-md text-on-surface-variant">
      <Icon name="verified_user" size={16} className="mt-0.5 shrink-0" />
      <span>{t("secureNote")}</span>
    </p>
  );
}
