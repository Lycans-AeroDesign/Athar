"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Markdown } from "@/components/ui/Markdown";
import { getCurrentPolicies, type CurrentPolicy } from "@/lib/api/policies";
import { formatDateTime } from "@/lib/datetime";

// Read-only view of the currently published policies (the ones every member
// has accepted to get past PolicyGate), linked from the account menu.
export default function PoliciesPage() {
  const t = useTranslations("policies");
  const commonT = useTranslations("common");
  const [policies, setPolicies] = useState<CurrentPolicy[] | null>(null);

  useEffect(() => {
    getCurrentPolicies().then(setPolicies);
  }, []);

  return (
    <section className="max-w-3xl space-y-8">
      <h1 className="font-display text-display text-on-surface">{t("pageTitle")}</h1>
      {!policies ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
      ) : policies.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("noneYet")}</p>
      ) : (
        policies.map((policy) => (
          <article key={policy.id} className="bg-surface rounded-xl border border-outline-variant p-6 space-y-4">
            <div>
              <h2 className="font-headline-md text-headline-md text-on-surface">{policy.title}</h2>
              <p className="font-label-caps text-label-caps uppercase text-on-surface-variant">
                {t("versionLine", { version: policy.version, date: formatDateTime(policy.published_at) })}
              </p>
            </div>
            <Markdown content={policy.content} />
          </article>
        ))
      )}
    </section>
  );
}
