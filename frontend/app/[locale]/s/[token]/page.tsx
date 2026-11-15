"use client";

import { useTranslations } from "next-intl";
import { use, useEffect, useState } from "react";

import { BrandMark } from "@/components/ui/BrandMark";
import { Icon } from "@/components/ui/Icon";
import { Markdown } from "@/components/ui/Markdown";
import { formatBytes } from "@/lib/bytes";
import { formatDate } from "@/lib/datetime";
import { getPublicShare, publicShareFileUrl } from "@/lib/api/shareLinks";
import type { PublicShare } from "@/lib/api/types";

type State = { status: "loading" } | { status: "missing" } | { status: "error" } | { status: "ready"; share: PublicShare };

// A read-only page for someone holding a share link - no account, no app
// chrome (side nav, search). Everything shown comes from the public share
// endpoint, which applies every rule in backend/knowledge/sharing.py; a link
// that's revoked, expired, switched off or whose item is gone simply 404s.
export default function SharedItemPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useTranslations("sharedPage");
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    getPublicShare(token)
      .then((share) => {
        if (!cancelled) setState(share ? { status: "ready", share } : { status: "missing" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const fileUrl = (fileId: string) => publicShareFileUrl(token, fileId);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-outline-variant bg-surface">
        <div className="mx-auto max-w-[840px] px-4 py-3 flex items-center gap-3">
          <BrandMark className="h-8 w-8" />
          <span className="font-headline-md text-headline-md text-on-surface truncate">
            {state.status === "ready" ? state.share.organization_name : t("brand")}
          </span>
          <span className="ms-auto flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant">
            <Icon name="visibility" size={14} />
            {t("readOnly")}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[840px] px-4 py-8">
        {state.status === "loading" && (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>
        )}

        {(state.status === "missing" || state.status === "error") && (
          <div className="rounded-xl border border-outline-variant bg-surface p-8 text-center space-y-2">
            <Icon name="link_off" size={32} className="text-on-surface-variant mx-auto" />
            <h1 className="font-headline-md text-headline-md text-on-surface">
              {state.status === "missing" ? t("unavailableTitle") : t("errorTitle")}
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant">
              {state.status === "missing" ? t("unavailableBody") : t("errorBody")}
            </p>
          </div>
        )}

        {state.status === "ready" && (
          <article className="space-y-6">
            <div className="space-y-2">
              <span className="flex items-center gap-1 font-label-caps text-label-caps uppercase text-primary">
                <Icon name={state.share.type === "sop" ? "description" : "menu_book"} size={14} />
                {t(state.share.type === "sop" ? "typeSop" : "typeArticle")}
              </span>
              <h1 className="font-display text-display text-on-surface">{state.share.title}</h1>
              <p className="font-mono-sm text-mono-sm text-on-surface-variant">
                {state.share.author_name && <>{t("byAuthor", { name: state.share.author_name })} · </>}
                {t("updatedOn", { date: formatDate(state.share.updated_at) })}
              </p>
            </div>

            {state.share.safety_notes && (
              <div className="rounded-xl border border-callout-warning/40 bg-callout-warning/10 p-4 space-y-2">
                <p className="flex items-center gap-2 font-label-caps text-label-caps uppercase text-callout-warning">
                  <Icon name="warning" size={16} />
                  {t("safetyNotes")}
                </p>
                <Markdown content={state.share.safety_notes} publicFileUrl={fileUrl} />
              </div>
            )}

            <Markdown content={state.share.content} publicFileUrl={fileUrl} />

            {state.share.attachments.length > 0 && (
              <section className="pt-6 border-t border-outline-variant space-y-3">
                <h2 className="font-headline-md text-headline-md text-on-surface">{t("attachments")}</h2>
                <ul className="space-y-2">
                  {state.share.attachments.map((file) => (
                    <li key={file.id}>
                      <a
                        href={fileUrl(file.id)}
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 rounded-lg border border-outline-variant bg-surface-container-low p-3 hover:border-primary transition-colors"
                      >
                        <Icon name="attach_file" size={18} className="text-on-surface-variant shrink-0" />
                        <span className="flex-1 min-w-0 truncate font-body-md text-body-md text-on-surface">
                          {file.original_filename}
                        </span>
                        <span className="font-mono-sm text-mono-sm text-on-surface-variant">{formatBytes(file.size)}</span>
                        <Icon name="download" size={18} className="text-on-surface-variant shrink-0" />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <footer className="pt-6 border-t border-outline-variant font-body-sm text-body-sm text-on-surface-variant">
              {state.share.expires_at
                ? t("expiresOn", { date: formatDate(state.share.expires_at) })
                : t("sharedBy", { organization: state.share.organization_name })}
            </footer>
          </article>
        )}
      </main>
    </div>
  );
}
