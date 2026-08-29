import type { ReactNode } from "react";

import { useHasPermission } from "@/lib/auth/permissions";

interface CanProps {
  /** Permission codename required to render `children`; omit to always render (e.g. a nav item with no gate). */
  permission?: string;
  children: ReactNode;
  /** Rendered instead of `children` when the permission is missing. Defaults to nothing (fully hidden, not just disabled). */
  fallback?: ReactNode;
}

// Declarative counterpart to useHasPermission - use this to hide a button,
// menu entry, or whole section rather than writing `{allowed && <...>}`
// inline. Still UX-only: see useHasPermission's note on the real boundary.
export function Can({ permission, children, fallback = null }: CanProps) {
  const allowed = useHasPermission(permission);
  return <>{allowed ? children : fallback}</>;
}
