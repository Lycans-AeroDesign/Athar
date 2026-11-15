"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { formatDateTime } from "@/lib/datetime";
import { diffLines, withContext } from "@/lib/diff";
import { errorMessage } from "@/lib/errors";
import { formatPersonName } from "@/lib/format";
import { restoreArticleRevision } from "@/lib/api/knowledge";
import type { ArticleDetail, ArticleRevision } from "@/lib/api/types";

type Mode = "previous" | "current";

interface Props {
  article: ArticleDetail;
  /** Newest first, as the revisions endpoint returns them. */
  revisions: ArticleRevision[];
  /** Index into `revisions` of the revision being looked at; null = closed. */
  index: number | null;
  onClose: () => void;
  canRestore: boolean;
  onRestored: (article: ArticleDetail) => void;
}

const LINE_CLASSES = {
  same: "text-on-surface-variant",
  added: "bg-callout-tip/15 text-on-surface",
  removed: "bg-callout-caution/15 text-on-surface line-through decoration-callout-caution/60",
} as const;

const LINE_MARKERS = { same: " ", added: "+", removed: "-" } as const;

export function RevisionCompareModal({ article, revisions, index, onClose, canRestore, onRestored }: Props) {
  const t = useTranslations("knowledge.article.revisions");
  const [mode, setMode] = useState<Mode>("previous");
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revision = index === null ? null : revisions[index];
  const isCurrent = !!revision && revision.title === article.title && revision.content === article.content;

  // "previous": what this edit changed. "current": how far the live article
  // has moved on since - the view to check before restoring.
  const [before, after] = useMemo((): [{ title: string; content: string }, { title: string; content: string }] => {
    if (!revision || index === null) return [EMPTY, EMPTY];
    if (mode === "current") return [revision, article];
    return [revisions[index + 1] ?? EMPTY, revision];
  }, [mode, revision, index, revisions, article]);

  const lines = useMemo(() => withContext(diffLines(before.content, after.content)), [before, after]);
  const hasChanges = before.title !== after.title || lines.some((line) => line.type !== "gap");

  function close() {
    setMode("previous");
    setError(null);
    onClose();
  }

  async function handleRestore() {
    if (!revision) return;
    setIsRestoring(true);
    setError(null);
    try {
      onRestored(await restoreArticleRevision(article.id, revision.id));
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsRestoring(false);
    }
  }

  return (
    <Modal
      open={revision !== null}
      onOpenChange={(open) => !open && close()}
      title={t("modalTitle")}
      description={
        revision
          ? t("modalDescription", {
              name: (revision.edited_by && formatPersonName(revision.edited_by)) || t("system"),
              date: formatDateTime(revision.created_at) ?? "",
            })
          : undefined
      }
      wide
      footer={
        canRestore && !isCurrent ? (
          <Button onClick={handleRestore} loading={isRestoring}>
            <Icon name="undo" size={18} />
            {t("restoreButton")}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <div role="tablist" className="inline-flex rounded-lg border border-outline-variant p-0.5">
          {(["previous", "current"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={mode === option}
              onClick={() => setMode(option)}
              className={`px-3 py-1.5 rounded-md font-label-caps text-label-caps uppercase transition-colors ${
                mode === option ? "bg-primary text-on-primary" : "text-on-surface-variant hover:bg-surface-variant"
              }`}
            >
              {t(option === "previous" ? "comparePrevious" : "compareCurrent")}
            </button>
          ))}
        </div>

        {isCurrent && <p className="font-body-md text-body-md text-on-surface-variant">{t("isCurrent")}</p>}
        {canRestore && !isCurrent && (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("restoreHint")}</p>
        )}

        {before.title !== after.title && (
          <div className="font-body-md text-body-md space-y-1">
            <span className="font-label-caps text-label-caps uppercase text-on-surface-variant">{t("titleLabel")}</span>
            <p className={`px-2 rounded ${LINE_CLASSES.removed}`}>{before.title || " "}</p>
            <p className={`px-2 rounded ${LINE_CLASSES.added}`}>{after.title}</p>
          </div>
        )}

        {hasChanges ? (
          <div
            dir="auto"
            className="max-h-[55vh] overflow-auto rounded-lg border border-outline-variant bg-surface-container-lowest font-mono-sm text-mono-sm"
          >
            {lines.map((line, i) =>
              line.type === "gap" ? (
                <div
                  key={i}
                  className="px-3 py-1 bg-surface-container text-on-surface-variant italic border-y border-outline-variant"
                >
                  {t("unchangedLines", { count: line.count })}
                </div>
              ) : (
                <div key={i} className={`flex gap-2 px-3 whitespace-pre-wrap break-words ${LINE_CLASSES[line.type]}`}>
                  <span aria-hidden className="select-none shrink-0 w-3 text-on-surface-variant">
                    {LINE_MARKERS[line.type]}
                  </span>
                  <span className="sr-only">{t(`line_${line.type}`)}</span>
                  <span className="min-w-0">{line.text || " "}</span>
                </div>
              ),
            )}
          </div>
        ) : (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("noChanges")}</p>
        )}

        {error && (
          <p className="font-body-md text-body-md text-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

const EMPTY = { title: "", content: "" };
