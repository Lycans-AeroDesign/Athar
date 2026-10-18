import type { ReactNode } from "react";

/** The "loading" / "not found" line a detail page shows instead of its content. */
export function DetailMessage({ error = false, children }: { error?: boolean; children: ReactNode }) {
  return (
    <p className={`font-body-md text-body-md ${error ? "text-error" : "text-on-surface-variant"}`}>{children}</p>
  );
}
