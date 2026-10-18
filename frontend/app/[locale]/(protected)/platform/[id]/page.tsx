"use client";

import { useParams } from "next/navigation";

import { PlatformOrganizationDetail } from "@/components/platform/PlatformOrganizationDetail";
import { useRequirePlatformAdmin } from "@/components/platform/useRequirePlatformAdmin";

export default function PlatformOrganizationPage() {
  const { id } = useParams<{ id: string }>();
  return useRequirePlatformAdmin() ? <PlatformOrganizationDetail id={id} /> : null;
}
