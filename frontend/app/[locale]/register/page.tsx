"use client";

import { useTranslations } from "next-intl";
import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";

import { BrandMark } from "@/components/ui/BrandMark";
import { FloatingLabelInput } from "@/components/ui/FloatingLabelInput";
import { Link, useRouter } from "@/i18n/navigation";
import { ApiError, apiUrl } from "@/lib/api/client";
import { registerRequest } from "@/lib/api/auth";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useOrganization } from "@/lib/organization/OrganizationProvider";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Matches accounts/serializers.py's RegisterSerializer.password min_length=8.
const MIN_PASSWORD_LENGTH = 8;

interface FieldErrors {
  email?: string;
  password?: string;
  invitationCode?: string;
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const { login } = useAuth();
  const { settings } = useOrganization();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("auth");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invitationCode, setInvitationCode] = useState(searchParams.get("code") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!email.trim()) errors.email = t("fieldRequired");
    else if (!EMAIL_PATTERN.test(email)) errors.email = t("invalidEmail");
    if (!password) errors.password = t("fieldRequired");
    else if (password.length < MIN_PASSWORD_LENGTH) {
      errors.password = t("passwordTooShort", { min: MIN_PASSWORD_LENGTH });
    }
    if (!invitationCode.trim()) errors.invitationCode = t("fieldRequired");
    return errors;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsSubmitting(true);
    try {
      await registerRequest({
        email,
        password,
        invitation_code: invitationCode,
        first_name: firstName,
        last_name: lastName,
      });
      // register/ only creates the account (see lib/api/auth.ts) - log in
      // with the same credentials to actually start the session.
      await login(email, password);
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("register.error"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="bg-surface text-on-surface font-body-md text-body-md min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-8 shadow-[0_1px_3px_0_rgba(0,0,0,0.05)]">
          <div className="flex flex-col items-center mb-8">
            {settings?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- external backend URL, not a local asset next/image can optimize.
              <img
                src={apiUrl(settings.logo_url)}
                alt={settings.name}
                className="h-16 w-16 mb-4 object-contain"
              />
            ) : (
              <BrandMark className="h-16 w-16 mb-4" />
            )}
            <h1 className="font-headline-lg text-headline-lg text-on-surface">
              {settings?.name ?? "Athar"}
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant mt-2">
              {t("register.tagline")}
            </p>
          </div>

          <form className="space-y-6" noValidate onSubmit={handleSubmit}>
            <div className="space-y-1">
              <div className="grid grid-cols-2 gap-4">
                <FloatingLabelInput
                  autoComplete="given-name"
                  id="firstName"
                  label={t("register.firstNameLabel")}
                  name="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
                <FloatingLabelInput
                  autoComplete="family-name"
                  id="lastName"
                  label={t("register.lastNameLabel")}
                  name="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>

              <FloatingLabelInput
                autoComplete="email"
                error={fieldErrors.email}
                icon="mail"
                id="email"
                label={t("emailLabel")}
                name="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, email: undefined }));
                }}
              />

              <FloatingLabelInput
                autoComplete="new-password"
                error={fieldErrors.password}
                icon="lock"
                id="password"
                label={t("passwordLabel")}
                name="password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, password: undefined }));
                }}
              />

              <FloatingLabelInput
                autoComplete="off"
                error={fieldErrors.invitationCode}
                icon="label"
                id="invitationCode"
                label={t("register.invitationCodeLabel")}
                name="invitationCode"
                value={invitationCode}
                onChange={(e) => {
                  setInvitationCode(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, invitationCode: undefined }));
                }}
              />
            </div>

            {error && (
              <p className="font-body-md text-body-md text-error" role="alert">
                {error}
              </p>
            )}

            <div>
              <button
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-lg bg-primary font-label-caps text-label-caps text-on-primary hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-colors duration-150 uppercase shadow-[0_1px_3px_0_rgba(0,0,0,0.05)] disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? t("register.submitting") : t("register.submit")}
              </button>
            </div>
          </form>

          <p className="text-center font-body-md text-body-md text-on-surface-variant mt-6">
            {t("register.hasAccount")}{" "}
            <Link href="/login" className="text-primary hover:underline">
              {t("register.loginLink")}
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
