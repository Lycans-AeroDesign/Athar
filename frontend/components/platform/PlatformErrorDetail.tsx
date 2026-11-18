"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { LoadError } from "@/components/ui/LoadError";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { Link, useRouter } from "@/i18n/navigation";
import {
  deletePlatformError,
  getPlatformError,
  setPlatformErrorResolved,
  type PlatformErrorDetail as ErrorDetail,
} from "@/lib/api/platform";
import { formatDateTime, formatRelativeTime } from "@/lib/datetime";
import { errorMessage } from "@/lib/errors";

import { SourceBadge } from "./PlatformErrors";

export function PlatformErrorDetail({ id }: { id: string }) {
  const t = useTranslations("platform.errors");
  const router = useRouter();

  const [event, setEvent] = useState<ErrorDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    getPlatformError(id)
      .then(setEvent)
      .catch((err) => setLoadError(errorMessage(err)));
  }, [id, reloadKey]);

  async function toggleResolved() {
    if (!event) return;
    setBusy(true);
    setActionError(null);
    try {
      setEvent(await setPlatformErrorResolved(event.id, !event.resolved_at));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!event) return;
    setActionError(null);
    try {
      await deletePlatformError(event.id);
      router.push("/platform/errors");
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function copyDetails() {
    if (!event) return;
    const text = [
      `${event.exception_type ? `${event.exception_type}: ` : ""}${event.message}`,
      event.path ? `${event.method} ${event.path}`.trim() : "",
      "",
      event.traceback,
    ]
      .filter((line, idx) => idx >= 2 || line)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (e.g. insecure origin) - the traceback is still selectable.
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/platform/errors" className="inline-flex items-center gap-1 text-primary hover:underline">
        <Icon name="arrow_back" size={16} />
        {t("backToList")}
      </Link>

      {loadError ? (
        <LoadError
          message={loadError}
          onRetry={() => {
            setLoadError(null);
            setReloadKey((key) => key + 1);
          }}
        />
      ) : !event ? (
        <div className="space-y-6" role="status" aria-busy="true">
          <SkeletonText variant="headline-lg" width="w-2/3" />
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      ) : (
        <>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 font-mono-sm text-mono-sm">
              <SourceBadge source={event.source} />
              <span
                className={
                  event.resolved_at
                    ? "rounded-full px-2 py-0.5 bg-secondary-container text-on-secondary-container"
                    : "rounded-full px-2 py-0.5 bg-surface-container-high text-on-surface"
                }
              >
                {event.resolved_at ? t("resolvedBadge") : t("openBadge")}
              </span>
              <span className="text-on-surface-variant">{t("occurrences", { count: event.count })}</span>
            </div>
            <h1 className="font-headline-md text-headline-md text-on-surface [overflow-wrap:anywhere] whitespace-pre-wrap">
              {event.exception_type && <span className="font-bold">{event.exception_type}: </span>}
              {event.message}
            </h1>
            <div className="flex flex-wrap gap-2">
              <Button variant={event.resolved_at ? "secondary" : "primary"} onClick={toggleResolved} loading={busy}>
                {event.resolved_at ? t("reopen") : t("markResolved")}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
                {t("delete")}
              </Button>
            </div>
            {actionError && (
              <p className="font-body-md text-body-md text-error" role="alert">
                {actionError}
              </p>
            )}
          </div>

          <div className="bg-surface rounded-xl border border-outline-variant p-4 sm:p-6">
            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 font-body-md text-body-md">
              <Detail label={t("firstSeen")}>
                {formatDateTime(event.first_seen)} ({formatRelativeTime(event.first_seen)})
              </Detail>
              <Detail label={t("lastSeenLabel")}>
                {formatDateTime(event.last_seen)} ({formatRelativeTime(event.last_seen)})
              </Detail>
              {event.resolved_at && <Detail label={t("resolvedAt")}>{formatDateTime(event.resolved_at)}</Detail>}
              {event.path && (
                <Detail label={t("request")} mono>
                  {`${event.method} ${event.path}`.trim()}
                </Detail>
              )}
              {event.logger && (
                <Detail label={t("logger")} mono>
                  {event.logger}
                </Detail>
              )}
              <Detail label={t("level")} mono>
                {event.level}
              </Detail>
              {event.organization_name && <Detail label={t("organization")}>{event.organization_name}</Detail>}
              {event.user_email && <Detail label={t("user")}>{event.user_email}</Detail>}
              {event.user_agent && (
                <Detail label={t("userAgent")} wide>
                  {event.user_agent}
                </Detail>
              )}
            </dl>
            <p className="mt-4 font-body-md text-body-md text-on-surface-variant">{t("latestNote")}</p>
          </div>

          <div className="bg-surface rounded-xl border border-outline-variant overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:px-6">
              <h2 className="font-headline-md text-headline-md text-on-surface">{t("traceback")}</h2>
              {event.traceback && (
                <Button variant="secondary" size="sm" onClick={copyDetails}>
                  <Icon name={copied ? "check" : "content_copy"} size={16} />
                  {copied ? t("copied") : t("copy")}
                </Button>
              )}
            </div>
            {event.traceback ? (
              // Tracebacks are code: always LTR, never wrapped mid-line, scroll sideways instead.
              <pre
                dir="ltr"
                className="border-t border-outline-variant bg-surface-container-low p-4 sm:px-6 overflow-x-auto max-h-[70vh] font-mono-sm text-mono-sm text-on-surface whitespace-pre"
              >
                {event.traceback}
              </pre>
            ) : (
              <p className="border-t border-outline-variant p-4 sm:px-6 font-body-md text-body-md text-on-surface-variant">
                {t("noTraceback")}
              </p>
            )}
          </div>
        </>
      )}

      <ConfirmModal
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        danger
        title={t("deleteTitle")}
        description={t("deleteBody")}
        confirmLabel={t("delete")}
        onConfirm={remove}
      />
    </div>
  );
}

function Detail({
  label,
  children,
  mono = false,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`min-w-0 ${wide ? "sm:col-span-2 lg:col-span-3" : ""}`}>
      <dt className="text-on-surface-variant">{label}</dt>
      <dd
        dir={mono ? "ltr" : undefined}
        className={`text-on-surface [overflow-wrap:anywhere] ${mono ? "font-mono-sm text-mono-sm text-start" : ""}`}
      >
        {children}
      </dd>
    </div>
  );
}
