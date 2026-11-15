"use client";

import { useParams } from "next/navigation";

import { PlatformErrorDetail } from "@/components/platform/PlatformErrorDetail";
import { useRequirePlatformAdmin } from "@/components/platform/useRequirePlatformAdmin";

export default function PlatformErrorPage() {
  const { id } = useParams<{ id: string }>();
  return useRequirePlatformAdmin() ? <PlatformErrorDetail id={id} /> : null;
}
