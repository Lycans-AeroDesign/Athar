"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { MarkdownEditor } from "@/components/ui/MarkdownEditor";
import {
  getPolicyOverview,
  POLICY_KINDS,
  publishPolicy,
  savePolicyDraft,
  type PolicyKind,
  type PolicyOverview,
} from "@/lib/api/policies";
import { formatDateTime } from "@/lib/datetime";

// Rendered only with organization.manage (see settings/page.tsx). One card
// per policy kind: edit a draft (invisible to members), then publish it as a
// new version - after which every member, the publisher included, has to
// accept it before they can keep using the app (see PolicyGate).
export function PoliciesSettingsForm() {
  const t = useTranslations("settings.policies");
  const commonT = useTranslations("common");
  const [overview, setOverview] = useState<PolicyOverview[] | null>(null);

  function reload() {
    getPolicyOverview().then(setOverview);
  }

  useEffect(() => {
    getPolicyOverview().then(setOverview);
  }, []);

  if (!overview) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <p className="font-body-md text-body-md text-on-surface-variant">{t("description")}</p>
      {POLICY_KINDS.map((kind) => {
        const row = overview.find((r) => r.kind === kind);
        return row ? <PolicyCard key={`${kind}-${row.current?.version ?? 0}`} row={row} onChanged={reload} /> : null;
      })}
    </div>
  );
}

function PolicyCard({ row, onChanged }: { row: PolicyOverview; onChanged: () => void }) {
  const t = useTranslations("settings.policies");
  const kind: PolicyKind = row.kind;
  const savedTitle = row.draft?.title ?? row.current?.title ?? "";
  const savedContent = row.draft?.content ?? row.current?.content ?? "";

  const [title, setTitle] = useState(savedTitle);
  const [content, setContent] = useState(savedContent);
  const [baseline, setBaseline] = useState({ title: savedTitle, content: savedContent });
  const [hasUnpublished, setHasUnpublished] = useState(row.has_unpublished_changes);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmPublishOpen, setConfirmPublishOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty = title !== baseline.title || content !== baseline.content;

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const draft = await savePolicyDraft(kind, { title, content });
      setBaseline({ title: draft.title, content: draft.content });
      setHasUnpublished(
        !row.current || draft.title !== row.current.title || draft.content !== row.current.content,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePublish() {
    setError(null);
    try {
      await publishPolicy(kind);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-headline-md text-headline-md text-on-surface">{t(`kind${kind}`)}</h2>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">
            {row.current
              ? t("currentVersion", {
                  version: row.current.version,
                  date: formatDateTime(row.current.published_at),
                  accepted: row.accepted_count,
                  members: row.member_count,
                })
              : t("notPublished")}
          </p>
        </div>
        {hasUnpublished && (
          <span className="font-label-caps text-label-caps uppercase rounded-full px-2 py-0.5 bg-tertiary-container text-on-tertiary-container">
            {t("unpublishedChanges")}
          </span>
        )}
      </div>

      <input
        className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
        placeholder={t("titlePlaceholder")}
        aria-label={t("titlePlaceholder")}
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
      />
      <MarkdownEditor value={content} onChange={setContent} placeholder={t("contentPlaceholder")} />

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-col sm:flex-row sm:justify-end gap-3 *:w-full sm:*:w-auto">
        <Button variant="secondary" onClick={handleSave} loading={isSaving} disabled={!isDirty || !title.trim()}>
          {t("saveDraft")}
        </Button>
        <Button onClick={() => setConfirmPublishOpen(true)} disabled={isDirty || isSaving || !hasUnpublished}>
          {t("publish")}
        </Button>
      </div>
      {isDirty && <p className="font-body-sm text-body-sm text-on-surface-variant text-end">{t("saveBeforePublish")}</p>}

      <ConfirmModal
        open={confirmPublishOpen}
        onOpenChange={setConfirmPublishOpen}
        title={t("publishConfirmTitle")}
        description={t("publishConfirmBody")}
        confirmLabel={t("publish")}
        onConfirm={handlePublish}
      />
    </div>
  );
}
