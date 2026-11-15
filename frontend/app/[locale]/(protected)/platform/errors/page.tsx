"use client";

import { PlatformErrors } from "@/components/platform/PlatformErrors";
import { useRequirePlatformAdmin } from "@/components/platform/useRequirePlatformAdmin";

export default function PlatformErrorsPage() {
  return useRequirePlatformAdmin() ? <PlatformErrors /> : null;
}
