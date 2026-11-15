"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Pagination } from "@/components/ui/Pagination";
import { Switch } from "@/components/ui/Switch";
import { Link } from "@/i18n/navigation";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { errorMessage } from "@/lib/errors";
import { formatPersonName } from "@/lib/format";
import { getShareLinks, publicShareUrl, revokeShareLink } from "@/lib/api/shareLinks";
import type { ShareLinkEntry } from "@/lib/api/types";
import { RELATABLE_ICON, RELATABLE_ROUTE_PREFIX } from "@/lib/knowledgeTypes";

// Every public link in the organization, for share_link.manage holders -
// who shared what, with whom (label), until when, and how often it's opened.
export function SharedLinksSettings() {
  const t = useTranslations("shareLinks");
  const locale = useLocale();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ key: string; links: ShareLinkEntry[]; hasNext: boolean; count: number } | null>(
    null,
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resultKey = `${includeInactive}:${page}`;
  const links = result?.key === resultKey ? result.links : null;

  useEffect(() => {
    getShareLinks({ includeInactive, page })
      .then((data) => setResult({ key: resultKey, links: data.results, hasNext: data.next !== null, count: data.count }))
      .catch((err) => setError(errorMessage(err)));
  }, [includeInactive, page, resultKey]);

  async function copy(link: ShareLinkEntry) {
    await navigator.clipboard.writeText(publicShareUrl(link.token, locale));
    setCopiedId(link.id);
    setTimeout(() => setCopiedId((current) => (current === link.id ? null : current)), 1500);
  }

  async function handleRevoke(id: string) {
    setError(null);
    try {
      const revoked = await revokeShareLink(id);
      setResult((prev) =>
        prev
          ? {
              ...prev,
              links: includeInactive
                ? prev.links.map((link) => (link.id === id ? revoked : link))
                : prev.links.filter((link) => link.id !== id),
            }
          : prev,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setConfirmRevokeId(null);
    }
  }

  return (
    <div className="max-w-4xl bg-surface rounded-xl border border-outline-variant p-6 space-y-6">
      <div>
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("settingsTitle")}</h2>
        <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("settingsDescription")}</p>
      </div>

      <Switch
        checked={includeInactive}
        onChange={(next) => {
          setIncludeInactive(next);
          setPage(1);
        }}
        label={t("showInactive")}
      />

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      {links === null ? (
        !error && <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>
      ) : links.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
      ) : (
        <ul className="space-y-2">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-outline-variant bg-surface-container-low p-3"
            >
              <Icon name={RELATABLE_ICON[link.type]} size={20} className="text-on-surface-variant shrink-0" />
              <div className="flex-1 min-w-56">
                <p className="font-body-md text-body-md text-on-surface truncate">
                  {link.target_title ? (
                    <Link
                      href={`${RELATABLE_ROUTE_PREFIX[link.type]}/${link.object_id}`}
                      className="hover:text-primary hover:underline"
                    >
                      {link.target_title}
                    </Link>
                  ) : (
                    t("deletedItem")
                  )}
                  {link.label && <span className="text-on-surface-variant"> · {link.label}</span>}
                </p>
                <p className="font-mono-sm text-mono-sm text-on-surface-variant">
                  {link.created_by && <>{formatPersonName(link.created_by)} · </>}
                  {formatDateTime(link.created_at)}
                  {" · "}
                  {link.revoked_at
                    ? t("revokedOn", { date: formatDate(link.revoked_at) })
                    : link.expires_at
                      ? t(link.is_active ? "expiresOn" : "expiredOn", { date: formatDate(link.expires_at) })
                      : t("expiryNever")}
                  {" · "}
                  {t("views", { count: link.view_count })}
                </p>
              </div>
              {link.is_active && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => copy(link)}>
                    <Icon name={copiedId === link.id ? "check" : "content_copy"} size={16} />
                    {copiedId === link.id ? t("copied") : t("copy")}
                  </Button>
                  {confirmRevokeId === link.id ? (
                    <Button variant="danger" size="sm" onClick={() => handleRevoke(link.id)}>
                      {t("confirmRevoke")}
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setConfirmRevokeId(link.id)}>
                      {t("revoke")}
                    </Button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {links && links.length > 0 && (
        <Pagination
          page={page}
          hasNext={result?.hasNext ?? false}
          hasPrevious={page > 1}
          onPageChange={setPage}
          totalCount={result?.count}
        />
      )}
    </div>
  );
}
