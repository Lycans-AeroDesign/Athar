"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";

interface ProjectParamProps {
  children: (projectId: string | null) => ReactNode;
}

function ProjectParamContent({ children }: ProjectParamProps) {
  const searchParams = useSearchParams();
  return children(searchParams.get("project"));
}

/** Reads `?project=<id>` for a creation page (so a project's own page can
 * link to "new X in this project") - wrapped in its own Suspense boundary,
 * which useSearchParams requires, same as the knowledge search page. */
export function ProjectParam({ children }: ProjectParamProps) {
  return (
    <Suspense>
      <ProjectParamContent>{children}</ProjectParamContent>
    </Suspense>
  );
}
