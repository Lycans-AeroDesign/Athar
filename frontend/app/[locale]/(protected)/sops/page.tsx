"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Can } from "@/components/auth/Can";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Icon } from "@/components/ui/Icon";
import { Link } from "@/i18n/navigation";
import { getSops } from "@/lib/api/engineering";
import { getCategories } from "@/lib/api/knowledge";
import type { Category, SopSummary } from "@/lib/api/types";

export default function SopsPage() {
  const t = useTranslations("engineering.sop");
  const commonT = useTranslations("common");

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  // Keyed by the filter it was fetched for - see projects/page.tsx's
  // matching comment for why this avoids a plain setSops(null) reset.
  const [result, setResult] = useState<{ filter: string | null; sops: SopSummary[] } | null>(null);
  const sops = result?.filter === categoryFilter ? result.sops : null;

  useEffect(() => {
    getCategories().then(setCategories);
  }, []);

  useEffect(() => {
    getSops({ category: categoryFilter ?? undefined }).then((fetched) => setResult({ filter: categoryFilter, sops: fetched }));
  }, [categoryFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-display text-on-surface">{t("listTitle")}</h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">{t("listDescription")}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <Combobox
              placeholder={t("allCategories")}
              options={[{ value: "", label: t("allCategories") }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
              value={categoryFilter ?? ""}
              onChange={(value) => setCategoryFilter(value || null)}
            />
          </div>
          <Can permission="sop.create">
            <Link href="/sops/new">
              <Button>
                <Icon name="add" size={18} />
                {t("newButton")}
              </Button>
            </Link>
          </Can>
        </div>
      </div>

      {sops === null ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
      ) : sops.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
      ) : (
        <ul className="space-y-3">
          {sops.map((sop) => (
            <li key={sop.id}>
              <Link
                href={`/sops/${sop.id}`}
                className="flex items-center justify-between gap-4 bg-surface-container-low border border-outline-variant rounded-xl p-4 hover:shadow-[0_1px_3px_0_rgba(0,0,0,0.08)] transition-shadow"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon name="description" size={20} className="text-on-surface-variant shrink-0" />
                  <div className="min-w-0">
                    <h3 className="font-headline-md text-headline-md text-on-surface truncate">{sop.title}</h3>
                    {sop.category && (
                      <p className="font-label-caps text-label-caps text-primary uppercase">{sop.category.name}</p>
                    )}
                  </div>
                </div>
                {sop.mandatory && (
                  <span className="shrink-0 font-label-caps text-label-caps uppercase bg-surface-container-high text-on-surface-variant px-2.5 py-1 rounded-full">
                    {t("mandatoryLabel")}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
