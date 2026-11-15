"use client";

import { useEffect } from "react";

import { installTruncateRoller } from "@/lib/truncateRoll";

// Mounted once in the root layout - see lib/truncateRoll.ts for what it does.
export function TruncateRoller() {
  useEffect(() => installTruncateRoller(), []);
  return null;
}
