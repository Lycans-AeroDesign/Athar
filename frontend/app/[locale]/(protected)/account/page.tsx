"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { updateMe } from "@/lib/api/accounts";
import { useAuth } from "@/lib/auth/AuthProvider";

// Structured like GeneralSettingsForm.tsx - a single always-editable card,
// no dirty-tracking/discard since there's only one save target (the user's
// own profile) and nothing else on the page to accidentally lose.
export default function AccountPage() {
  const t = useTranslations("account");
  const commonT = useTranslations("common");
  const { user, updateUser } = useAuth();

  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [title, setTitle] = useState(user?.title ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const updated = await updateMe({ first_name: firstName, last_name: lastName, title });
      updateUser(updated);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section>
      <h1 className="font-display text-display text-on-surface">{t("title")}</h1>
      <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">{t("description")}</p>

      <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-6 mt-6 max-w-2xl">
        <div className="space-y-2">
          <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
            {t("emailLabel")}
          </label>
          <input
            className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface-variant bg-surface-container-low border border-outline-variant rounded-lg outline-none"
            value={user.email}
            disabled
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
              {t("firstNameLabel")}
            </label>
            <input
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
              {t("lastNameLabel")}
            </label>
            <input
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
            {t("titleLabel")}
          </label>
          <input
            className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
            placeholder={t("titlePlaceholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {user.roles.length > 0 && (
          <div className="space-y-2">
            <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
              {t("rolesLabel")}
            </label>
            <div className="flex flex-wrap gap-2">
              {user.roles.map((role) => (
                <span
                  key={role}
                  className="px-2.5 py-1 rounded-full bg-surface-container text-on-surface font-label-caps text-label-caps uppercase"
                >
                  {role}
                </span>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="font-body-md text-body-md text-error" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center gap-4">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? commonT("saving") : commonT("save")}
          </Button>
          {savedAt && <span className="font-body-md text-body-md text-on-surface-variant">{commonT("saved")}</span>}
        </div>
      </div>
    </section>
  );
}
