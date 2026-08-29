"use client";

import { useTranslations } from "next-intl";
import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";

import { BrandMark } from "@/components/ui/BrandMark";
import { FloatingLabelInput } from "@/components/ui/FloatingLabelInput";
import { useRouter } from "@/i18n/navigation";
import { apiUrl } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useOrganization } from "@/lib/organization/OrganizationProvider";

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

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      router.push(searchParams.get("next") || "/");
    } catch {
      setError(t("login.error"));
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
              {settings?.name ?? "AeroKMS"}
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant mt-2">
              {t("login.tagline")}
            </p>
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
            <FloatingLabelInput
              autoComplete="email"
              icon="mail"
              id="email"
              label={t("emailLabel")}
              name="email"
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <FloatingLabelInput
              autoComplete="current-password"
              icon="lock"
              id="password"
              label={t("passwordLabel")}
              name="password"
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            {error && (
              <p className="font-body-md text-body-md text-error" role="alert">
                {error}
              </p>
            )}

            <div>
              <button
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-lg bg-primary-container font-label-caps text-label-caps text-on-primary hover:bg-on-primary-fixed-variant focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-colors duration-150 uppercase shadow-[0_1px_3px_0_rgba(0,0,0,0.05)] disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? t("login.submitting") : t("login.submit")}
              </button>
            </div>
          </form>
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
