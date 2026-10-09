"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { Markdown } from "@/components/ui/Markdown";
import { useRouter } from "@/i18n/navigation";
import { acceptPolicies, getCurrentPolicies, POLICY_REQUIRED_EVENT, type CurrentPolicy } from "@/lib/api/policies";
import { useAuth } from "@/lib/auth/AuthProvider";
import { formatDateTime } from "@/lib/datetime";

// Wraps the whole signed-in app shell: while the user has a published policy
// version they haven't accepted (a new policy, or a new version of one they
// accepted before), this renders a blocking acceptance screen *instead of*
// the app - nothing behind it can be used (or start, like the product tour).
// The backend enforces the same rule on every API call (see
// backend/policies/authentication.py); this is the UX for it. Re-checks when
// any API call is refused for that reason mid-session (POLICY_REQUIRED_EVENT,
// dispatched from lib/api/client.ts) - e.g. an admin published a new version.
export function PolicyGate({ children }: { children: ReactNode }) {
  const t = useTranslations("policies");
  const { logout } = useAuth();
  const router = useRouter();

  const [pending, setPending] = useState<CurrentPolicy[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    function check() {
      getCurrentPolicies()
        .then((policies) => {
          if (cancelled) return;
          setPending(policies.filter((policy) => !policy.accepted));
          setChecked(new Set());
        })
        // Fail open on a network error - the backend still refuses every
        // other call until the policies are accepted.
        .catch(() => !cancelled && setPending([]));
    }
    check();
    window.addEventListener(POLICY_REQUIRED_EVENT, check);
    return () => {
      cancelled = true;
      window.removeEventListener(POLICY_REQUIRED_EVENT, check);
    };
  }, []);

  if (pending === null) return <LoadingScreen />;
  if (pending.length === 0) return <>{children}</>;

  const allChecked = pending.every((policy) => checked.has(policy.id));

  async function handleAccept() {
    setIsSubmitting(true);
    setError(null);
    try {
      await acceptPolicies(pending!.map((policy) => policy.id));
      setPending([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDecline() {
    await logout();
    router.replace("/login");
  }

  return (
    <div className="min-h-dvh bg-background flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="policy-gate-title"
        className="w-full max-w-3xl max-h-[calc(100dvh-2rem)] flex flex-col bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg"
      >
        <div className="p-6 border-b border-outline-variant">
          <h1 id="policy-gate-title" className="font-headline-md text-headline-md text-on-surface">
            {t("gateTitle")}
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("gateDescription")}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {pending.map((policy) => (
            <section key={policy.id} className="space-y-3">
              <div>
                <h2 className="font-body-lg text-body-lg font-semibold text-on-surface">{policy.title}</h2>
                <p className="font-label-caps text-label-caps uppercase text-on-surface-variant">
                  {t("versionLine", { version: policy.version, date: formatDateTime(policy.published_at) })}
                </p>
              </div>
              <div className="rounded-lg border border-outline-variant bg-surface p-4 max-h-80 overflow-y-auto">
                <Markdown content={policy.content} />
              </div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-primary"
                  checked={checked.has(policy.id)}
                  onChange={(e) => {
                    const next = new Set(checked);
                    if (e.target.checked) next.add(policy.id);
                    else next.delete(policy.id);
                    setChecked(next);
                  }}
                />
                <span className="font-body-md text-body-md text-on-surface">
                  {t("acceptCheckbox", { title: policy.title })}
                </span>
              </label>
            </section>
          ))}
        </div>

        <div className="p-6 border-t border-outline-variant space-y-3">
          {error && (
            <p className="font-body-md text-body-md text-error" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
            <Button variant="secondary" onClick={handleDecline} disabled={isSubmitting}>
              {t("declineAndLogout")}
            </Button>
            <Button onClick={handleAccept} loading={isSubmitting} disabled={!allChecked}>
              {t("acceptAndContinue")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
