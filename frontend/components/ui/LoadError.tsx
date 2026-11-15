"use client";

import { useTranslations } from "next-intl";

/** Shown in place of a list/section whose initial fetch failed, instead of leaving its skeleton up
 * forever. `onRetry` re-runs the load. */
export function LoadError({ message, onRetry }: { message?: string | null; onRetry?: () => void }) {
  const t = useTranslations("common");
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 font-body-md text-body-md text-error">
      <span>
        {t("loadFailed")}
        {message ? ` ${message}` : null}
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="font-label-md text-label-md text-primary underline underline-offset-2 hover:no-underline"
        >
          {t("retry")}
        </button>
      )}
    </div>
  );
}
