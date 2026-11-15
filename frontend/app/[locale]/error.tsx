"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { reportError } from "@/lib/errorReporting";

// Next.js route error boundary: a component that throws while rendering lands
// here instead of blanking the page, and the error goes to the platform error log.
export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations("errorBoundary");

  useEffect(() => {
    reportError(error);
  }, [error]);

  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <Icon name="report_problem" size={40} className="text-error" />
      <div>
        <h1 className="font-headline-md text-headline-md text-on-surface">{t("title")}</h1>
        <p className="font-body-md text-body-md text-on-surface-variant mt-1 max-w-md">{t("body")}</p>
      </div>
      <Button onClick={() => retry()}>{t("retry")}</Button>
    </div>
  );
}
