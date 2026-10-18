"use client";

import { PlatformOverview } from "@/components/platform/PlatformOverview";
import { useRequirePlatformAdmin } from "@/components/platform/useRequirePlatformAdmin";

export default function PlatformPage() {
  return useRequirePlatformAdmin() ? <PlatformOverview /> : null;
}
