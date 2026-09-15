"use client";

import { useTranslations } from "next-intl";
import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";

import { BrandMark } from "@/components/ui/BrandMark";
import { FloatingLabelInput } from "@/components/ui/FloatingLabelInput";
import { Link, useRouter } from "@/i18n/navigation";
import { ApiError, apiUrl } from "@/lib/api/client";
import { createOrganizationRequest, registerRequest } from "@/lib/api/auth";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useOrganization } from "@/lib/organization/OrganizationProvider";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Matches accounts/serializers.py's RegisterSerializer.password min_length=8
// and organization/serializers.py's OrganizationCreateSerializer.admin_password.
const MIN_PASSWORD_LENGTH = 8;

type Mode = "invite" | "organization";

interface FieldErrors {
  email?: string;
  password?: string;
  invitationCode?: string;
  organizationName?: string;
  username?: string;
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

  // Defaults to "invite" - most visitors to a self-hosted Athar instance are
  // joining an existing team, not starting a new SaaS org. Anyone landing
  // with an invite link (?code=...) gets this anyway, and "Create a new
  // organization" is one tab click away for the rarer self-service signup.
  const [mode, setMode] = useState<Mode>("invite");
  const [organizationName, setOrganizationName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invitationCode, setInvitationCode] = useState(searchParams.get("code") ?? "");
  // True only while the code still matches what the invite link handed us -
  // clears as soon as the visitor edits it, so the highlight always means
  // "this came from your link", never "this happens to look prefilled".
  const [codeAutoFilled, setCodeAutoFilled] = useState(() => Boolean(searchParams.get("code")));
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
    if (mode === "invite" && !invitationCode.trim()) errors.invitationCode = t("fieldRequired");
    if (mode === "organization" && !organizationName.trim()) errors.organizationName = t("fieldRequired");
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
      if (mode === "invite") {
        await registerRequest({
          email,
          password,
          invitation_code: invitationCode,
          first_name: firstName,
          last_name: lastName,
          username: username.trim() || undefined,
        });
      } else {
        await createOrganizationRequest({
          name: organizationName,
          admin_email: email,
          admin_password: password,
          admin_first_name: firstName,
          admin_last_name: lastName,
          admin_username: username.trim() || undefined,
        });
      }
      // Neither endpoint logs the caller in (see lib/api/auth.ts) - log in
      // with the same credentials to actually start the session.
      await login(email, password);
      router.push("/");
    } catch (err) {
      // Organization mode's field is "admin_username" server-side (see
      // OrganizationCreateSerializer) but this form has just one shared
      // username input either way - normalize both to the same fieldErrors key.
      const usernameMessage = err instanceof ApiError ? err.fields.username ?? err.fields.admin_username : undefined;
      if (usernameMessage) {
        setFieldErrors((prev) => ({ ...prev, username: usernameMessage }));
      } else {
        setError(err instanceof ApiError ? err.message : t("register.error"));
      }
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

          <div className="flex bg-surface-container rounded-lg p-1 mb-6" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "invite"}
              onClick={() => setMode("invite")}
              className={`flex-1 py-2 rounded-md font-label-caps text-label-caps uppercase transition-colors ${
                mode === "invite"
                  ? "bg-surface-container-lowest text-primary shadow-[0_1px_3px_0_rgba(0,0,0,0.08)]"
                  : "text-on-surface-variant"
              }`}
            >
              {t("register.modeInvite")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "organization"}
              onClick={() => setMode("organization")}
              className={`flex-1 py-2 rounded-md font-label-caps text-label-caps uppercase transition-colors ${
                mode === "organization"
                  ? "bg-surface-container-lowest text-primary shadow-[0_1px_3px_0_rgba(0,0,0,0.08)]"
                  : "text-on-surface-variant"
              }`}
            >
              {t("register.modeOrganization")}
            </button>
          </div>

          <form className="space-y-6" noValidate onSubmit={handleSubmit}>
            <div className="space-y-1">
              {mode === "organization" && (
                <FloatingLabelInput
                  autoComplete="organization"
                  error={fieldErrors.organizationName}
                  icon="architecture"
                  id="organizationName"
                  label={t("register.organizationNameLabel")}
                  name="organizationName"
                  value={organizationName}
                  onChange={(e) => {
                    setOrganizationName(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, organizationName: undefined }));
                  }}
                />
              )}

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
                autoComplete="username"
                error={fieldErrors.username}
                icon="account"
                id="username"
                label={t("register.usernameLabel")}
                name="username"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, username: undefined }));
                }}
              />

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

              {mode === "invite" && (
                <FloatingLabelInput
                  autoComplete="off"
                  className={codeAutoFilled ? "ring-2 ring-primary/60 border-primary" : undefined}
                  error={fieldErrors.invitationCode}
                  hint={codeAutoFilled ? t("register.invitationCodePrefilled") : undefined}
                  icon="label"
                  id="invitationCode"
                  label={t("register.invitationCodeLabel")}
                  name="invitationCode"
                  value={invitationCode}
                  onChange={(e) => {
                    setInvitationCode(e.target.value);
                    setCodeAutoFilled(false);
                    setFieldErrors((prev) => ({ ...prev, invitationCode: undefined }));
                  }}
                />
              )}
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
                {isSubmitting
                  ? t("register.submitting")
                  : mode === "organization"
                    ? t("register.submitOrganization")
                    : t("register.submit")}
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
