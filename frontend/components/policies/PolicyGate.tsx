"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { Markdown } from "@/components/ui/Markdown";
import { useRouter } from "@/i18n/navigation";
import { acceptPolicies, getCurrentPolicies, POLICY_REQUIRED_EVENT, type CurrentPolicy } from "@/lib/api/policies";
import { useAuth } from "@/lib/auth/AuthProvider";
import { formatDateTime } from "@/lib/datetime";
import { errorMessage } from "@/lib/errors";

// Wraps the signed-in app shell: while the user has an unaccepted published policy version, it
// renders a blocking acceptance screen instead of the app (nothing behind it can be used or
// start, like the product tour). The backend enforces the same rule on every API call
// (backend/policies/authentication.py); this is the UX. It re-checks when an API call is refused
// for that reason mid-session (POLICY_REQUIRED_EVENT from lib/api/client.ts).
//
// One policy per step, so there's never an acceptance checkbox buried mid-scroll between two
// documents: the policy text gets the whole body, and its checkbox sits in the fixed footer next
// to the button it unlocks. The checkbox only enables once the reader has reached the end of that
// policy (a short one that fits on screen counts as read straight away).
export function PolicyGate({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<CurrentPolicy[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    function check() {
      getCurrentPolicies()
        .then((policies) => {
          if (!cancelled) setPending(policies.filter((policy) => !policy.accepted));
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
  // Keyed by the pending set so a mid-session re-check that finds different
  // policies starts the walkthrough over instead of keeping stale ticks.
  return (
    <PolicyWalkthrough
      key={pending.map((policy) => policy.id).join(",")}
      policies={pending}
      onAccepted={() => setPending([])}
    />
  );
}

function PolicyWalkthrough({ policies, onAccepted }: { policies: CurrentPolicy[]; onAccepted: () => void }) {
  const t = useTranslations("policies");
  const { logout } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [read, setRead] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const policy = policies[step];
  const isLast = step === policies.length - 1;
  const hasRead = read.has(policy.id);
  const isChecked = checked.has(policy.id);
  const allChecked = policies.every((item) => checked.has(item.id));

  // Mark the current policy as read once the end of its text scrolls into
  // view (immediately, if it all fits). IntersectionObserver rather than a
  // scroll handler, so late-loading images that grow the text still count.
  useEffect(() => {
    const root = scrollRef.current;
    const end = endRef.current;
    if (!root || !end) return;
    const policyId = policy.id;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRead((previous) => (previous.has(policyId) ? previous : new Set(previous).add(policyId)));
        }
      },
      { root, threshold: 0 },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [policy.id]);

  function goTo(index: number) {
    setStep(index);
    setError(null);
    scrollRef.current?.scrollTo({ top: 0 });
    // Move focus to the new policy's title so keyboard/screen-reader users
    // land at its start too.
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  function toggle(value: boolean) {
    const next = new Set(checked);
    if (value) next.add(policy.id);
    else next.delete(policy.id);
    setChecked(next);
  }

  async function handleAccept() {
    setIsSubmitting(true);
    setError(null);
    try {
      await acceptPolicies(policies.map((item) => item.id));
      onAccepted();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDecline() {
    await logout();
    router.replace("/login");
  }

  // A step is reachable once every step before it has been accepted.
  const furthestReachable = policies.findIndex((item) => !checked.has(item.id));
  const canOpenStep = (index: number) => furthestReachable === -1 || index <= furthestReachable;

  return (
    <div className="min-h-dvh bg-background flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="policy-gate-title"
        className="w-full max-w-3xl h-[calc(100dvh-2rem)] max-h-[56rem] flex flex-col bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg"
      >
        <div className="p-6 border-b border-outline-variant">
          <h1 id="policy-gate-title" className="font-headline-md text-headline-md text-on-surface">
            {t("gateTitle")}
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("gateDescription")}</p>
          {policies.length > 1 && (
            <ol className="mt-4 flex flex-wrap items-center gap-2" aria-label={t("stepLabel", { current: step + 1, total: policies.length })}>
              {policies.map((item, index) => {
                const done = checked.has(item.id);
                const current = index === step;
                return (
                  <li key={item.id} className="flex items-center gap-2">
                    {index > 0 && <span aria-hidden className="h-px w-4 bg-outline-variant" />}
                    <button
                      type="button"
                      onClick={() => goTo(index)}
                      disabled={!canOpenStep(index)}
                      aria-current={current ? "step" : undefined}
                      className={`flex items-center gap-2 rounded-full border px-3 py-1 font-body-md text-body-md transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        current
                          ? "border-primary text-on-surface ring-1 ring-primary"
                          : done
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
                      {item.title}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-6">
          <div className="mb-4">
            {policies.length > 1 && (
              <p className="font-label-caps text-label-caps uppercase text-primary">
                {t("stepLabel", { current: step + 1, total: policies.length })}
              </p>
            )}
            <h2 ref={headingRef} tabIndex={-1} className="font-headline-md text-headline-md text-on-surface outline-none">
              {policy.title}
            </h2>
            <p className="font-label-caps text-label-caps uppercase text-on-surface-variant">
              {t("versionLine", { version: policy.version, date: formatDateTime(policy.published_at) })}
            </p>
          </div>
          <Markdown content={policy.content} />
          <div ref={endRef} className="h-px" aria-hidden />
        </div>

        <div className="p-4 sm:p-6 border-t border-outline-variant space-y-3 bg-surface-container-lowest rounded-b-xl">
          {error && (
            <p className="font-body-md text-body-md text-error" role="alert">
              {error}
            </p>
          )}
          <label
            className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
              !hasRead
                ? "border-outline-variant opacity-60 cursor-not-allowed"
                : isChecked
                  ? "border-primary bg-primary-container/40 cursor-pointer"
                  : "border-primary/60 cursor-pointer"
            }`}
          >
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-primary"
              checked={isChecked}
              disabled={!hasRead}
              onChange={(e) => toggle(e.target.checked)}
              aria-describedby={hasRead ? undefined : "policy-scroll-hint"}
            />
            <span className="font-body-md text-body-md text-on-surface">
              {t("acceptCheckbox", { title: policy.title })}
            </span>
          </label>
          {!hasRead && (
            <p id="policy-scroll-hint" className="flex items-center gap-1.5 font-body-md text-body-md text-on-surface-variant">
              <Icon name="arrow_downward" size={16} className="shrink-0" />
              {t("scrollToAccept", { title: policy.title })}
            </p>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
            <Button variant="secondary" onClick={handleDecline} disabled={isSubmitting}>
              {t("declineAndLogout")}
            </Button>
            <div className="flex flex-col-reverse sm:flex-row gap-3">
              {step > 0 && (
                <Button variant="secondary" onClick={() => goTo(step - 1)} disabled={isSubmitting}>
                  <Icon name="arrow_back" size={16} className="rtl:rotate-180" />
                  {t("back")}
                </Button>
              )}
              {isLast ? (
                <Button onClick={handleAccept} loading={isSubmitting} disabled={!allChecked}>
                  {t("acceptAndContinue")}
                </Button>
              ) : (
                <Button onClick={() => goTo(step + 1)} disabled={!isChecked}>
                  {t("next")}
                  <Icon name="arrow_forward" size={16} className="rtl:rotate-180" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
