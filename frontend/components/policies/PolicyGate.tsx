"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
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
// With several policies pending, it guides the user through all of them: a
// progress stepper up top, auto-scroll to the next unaccepted one after each
// checkbox, and a footer hint naming what's still missing - people would
// otherwise tick the first one and not notice the rest below the fold.
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

  const remaining = pending.filter((policy) => !checked.has(policy.id));
  const allChecked = remaining.length === 0;

  function scrollToPolicy(id: string) {
    document.getElementById(`policy-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toggle(id: string, isChecked: boolean) {
    const next = new Set(checked);
    if (isChecked) next.add(id);
    else next.delete(id);
    setChecked(next);
    if (isChecked) {
      const nextPending = pending!.find((policy) => !next.has(policy.id));
      if (nextPending) scrollToPolicy(nextPending.id);
    }
  }

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
          {pending.length > 1 && (
            <div className="mt-4 space-y-2">
              <p className="font-label-caps text-label-caps uppercase text-on-surface-variant">
                {t("progress", { accepted: pending.length - remaining.length, total: pending.length })}
              </p>
              <ol className="flex flex-wrap gap-2">
                {pending.map((policy, index) => {
                  const done = checked.has(policy.id);
                  return (
                    <li key={policy.id}>
                      <button
                        type="button"
                        onClick={() => scrollToPolicy(policy.id)}
                        className={`flex items-center gap-2 rounded-full border px-3 py-1 font-body-md text-body-md transition-colors ${
                          done
                            ? "border-primary bg-primary-container text-on-primary-container"
                            : "border-outline-variant text-on-surface hover:bg-surface-variant"
                        }`}
                      >
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                            done ? "bg-primary text-on-primary" : "bg-surface-variant text-on-surface-variant"
                          }`}
                        >
                          {done ? <Icon name="check" size={12} /> : index + 1}
                        </span>
                        {policy.title}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {pending.map((policy) => (
            <section key={policy.id} id={`policy-${policy.id}`} className="space-y-3 scroll-mt-6">
              <div>
                <h2 className="font-body-lg text-body-lg font-semibold text-on-surface">{policy.title}</h2>
                <p className="font-label-caps text-label-caps uppercase text-on-surface-variant">
                  {t("versionLine", { version: policy.version, date: formatDateTime(policy.published_at) })}
                </p>
              </div>
              <div className="rounded-lg border border-outline-variant bg-surface p-4 max-h-80 overflow-y-auto">
                <Markdown content={policy.content} />
              </div>
              <label
                className={`flex items-start gap-3 cursor-pointer rounded-lg border p-3 transition-colors ${
                  checked.has(policy.id) ? "border-primary bg-primary-container/40" : "border-outline-variant"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-primary"
                  checked={checked.has(policy.id)}
                  onChange={(e) => toggle(policy.id, e.target.checked)}
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
          {!allChecked && pending.length > 1 && (
            <p className="flex flex-wrap items-center gap-x-1 font-body-md text-body-md text-on-surface-variant">
              <Icon name="info" size={16} className="shrink-0" />
              <span>{t("remainingHint")}</span>
              {remaining.map((policy, index) => (
                <span key={policy.id}>
                  <button
                    type="button"
                    onClick={() => scrollToPolicy(policy.id)}
                    className="font-semibold text-primary underline underline-offset-2"
                  >
                    {policy.title}
                  </button>
                  {index < remaining.length - 1 && ","}
                </span>
              ))}
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
