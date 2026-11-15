"use client";

import { useEffect } from "react";

import { reportError } from "@/lib/errorReporting";

/** Forwards uncaught errors and unhandled promise rejections to the platform
 * error log. Render errors are caught by app/[locale]/error.tsx instead. */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => reportError(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => reportError(event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
