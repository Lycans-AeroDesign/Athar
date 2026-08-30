"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "./Button";
import { Icon } from "./Icon";

interface ShareButtonProps {
  title: string;
}

// window.location.href is read inside the click handler (never at render
// time), so this needs no prop/effect to dodge the SSR "window is not
// defined" issue - by the time a click can happen, we're client-side.
// Prefers the native share sheet (mobile, and some desktop browsers) and
// falls back to copying the link, with the same icon-swap "Copied!"
// feedback as the code-block copy button in Markdown.tsx.
export function ShareButton({ title }: ShareButtonProps) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        // User dismissed the share sheet - not an error.
      }
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Button variant="secondary" onClick={handleShare}>
      <Icon name={copied ? "check" : "share"} size={16} />
      {copied ? t("copiedLink") : t("share")}
    </Button>
  );
}
