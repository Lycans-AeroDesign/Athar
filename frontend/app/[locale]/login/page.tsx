"use client";

import { useTranslations } from "next-intl";
import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";

import { BrandMark } from "@/components/ui/BrandMark";
import { FloatingLabelInput } from "@/components/ui/FloatingLabelInput";
import { Link, useRouter } from "@/i18n/navigation";
import { ApiError, apiUrl } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useOrganization } from "@/lib/organization/OrganizationProvider";

interface FieldErrors {
  identifier?: string;
  password?: string;
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const { login } = useAuth();
  const { settings } = useOrganization();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("auth");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!identifier.trim()) errors.identifier = t("fieldRequired");
    if (!password) errors.password = t("fieldRequired");
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
      // The wire field is still called "email" (see backend/accounts/serializers.py's
      // CustomTokenObtainPairSerializer / User.USERNAME_FIELD) - the backend's
      // EmailOrUsernameBackend treats its value as either credential, so this
      // can be an email address or a username.
      await login(identifier, password);
      router.push(searchParams.get("next") || "/");
    } catch (err) {
      // A 429 (rate limited) isn't a credentials problem - telling them
      // apart avoids "Invalid email/username or password" showing for a
      // burst of attempts that were never actually checked against the
      // database.
      setError(err instanceof ApiError && err.status === 429 ? t("login.rateLimited") : t("login.error"));
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
              {t("login.tagline")}
            </p>
          </div>

          <form className="space-y-6" noValidate onSubmit={handleSubmit}>
            <div className="space-y-1">
              <FloatingLabelInput
                autoComplete="username"
                error={fieldErrors.identifier}
                icon="account"
                id="identifier"
                label={t("login.identifierLabel")}
                name="identifier"
                type="text"
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, identifier: undefined }));
                }}
              />

              <FloatingLabelInput
                autoComplete="current-password"
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
                {isSubmitting ? t("login.submitting") : t("login.submit")}
              </button>
            </div>
          </form>

          <p className="text-center font-body-md text-body-md text-on-surface-variant mt-6">
            {t("login.needAccount")}{" "}
            <Link href="/register" className="text-primary hover:underline">
              {t("login.registerLink")}
            </Link>
          </p>
        </div>

        <div className="mt-8 text-center">
          <a
            className="font-label-caps text-label-caps text-on-surface-variant uppercase hover:text-primary hover:underline transition-colors"
            href="https://lycansteam.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("login.credit")}
          </a>
        </div>
      </div>
    </main>
  );
}
