"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { BrandMark } from "@/components/ui/BrandMark";
import { FloatingLabelInput } from "@/components/ui/FloatingLabelInput";
import { getPathname, Link } from "@/i18n/navigation";
import { ApiError, apiUrl } from "@/lib/api/client";
import { requestPasswordReset } from "@/lib/api/passwordReset";
import { useOrganization } from "@/lib/organization/OrganizationProvider";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Public "Forgot password?" page linked from the login page. Emails the user
// a one-time link to /reset-password - only when the server has email set
// up (settings.email_enabled); otherwise it just tells them to ask an admin,
// who can generate a link from Settings > Users. The backend answers the
// same way whether or not the email has an account, so the "check your
// inbox" message is deliberately non-committal. Same card layout as login.
export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const { settings } = useOrganization();

  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const value = email.trim();
    if (!value) return setFieldError(t("fieldRequired"));
    if (!EMAIL_PATTERN.test(value)) return setFieldError(t("invalidEmail"));

    setIsSubmitting(true);
    try {
      const path = getPathname({ href: "/reset-password", locale });
      await requestPasswordReset(value, `${window.location.origin}${path}`, locale);
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? t("forgot.rateLimited") : t("forgot.error"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="bg-surface text-on-surface font-body-md text-body-md min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-8 shadow-[0_1px_3px_0_rgba(0,0,0,0.05)]">
          <div className="flex flex-col items-center mb-8 text-center">
            {settings?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- external backend URL, not a local asset next/image can optimize.
              <img src={apiUrl(settings.logo_url)} alt={settings.name} className="h-16 w-16 mb-4 object-contain" />
            ) : (
              <BrandMark className="h-16 w-16 mb-4" />
            )}
            <h1 className="font-headline-lg text-headline-lg text-on-surface">{t("forgot.title")}</h1>
            {settings?.email_enabled && !sent && (
              <p className="font-body-md text-body-md text-on-surface-variant mt-2">{t("forgot.subtitle")}</p>
            )}
          </div>

          {settings && !settings.email_enabled ? (
            <p className="text-center font-body-md text-body-md text-on-surface" role="status">
              {t("forgot.askAdmin")}
            </p>
          ) : sent ? (
            <p className="text-center font-body-md text-body-md text-on-surface" role="status">
              {t("forgot.sent", { email: email.trim() })}
            </p>
          ) : (
            <form className="space-y-6" method="post" noValidate onSubmit={handleSubmit}>
              <FloatingLabelInput
                autoComplete="email"
                error={fieldError}
                icon="mail"
                id="email"
                label={t("emailLabel")}
                name="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setFieldError(undefined);
                }}
              />

              {error && (
                <p className="font-body-md text-body-md text-error" role="alert">
                  {error}
                </p>
              )}

              <button
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-lg bg-primary font-label-caps text-label-caps text-on-primary hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-colors duration-150 uppercase shadow-[0_1px_3px_0_rgba(0,0,0,0.05)] disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={isSubmitting || !settings}
                type="submit"
              >
                {isSubmitting ? t("forgot.submitting") : t("forgot.submit")}
              </button>
            </form>
          )}

          <p className="text-center font-body-md text-body-md text-on-surface-variant mt-6">
            <Link href="/login" className="text-primary hover:underline">
              {t("reset.backToLogin")}
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
