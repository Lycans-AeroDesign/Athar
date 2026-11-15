"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { ShareDialog, type PublicLinkTarget } from "@/components/knowledge/ShareDialog";
import { useHasPermission } from "@/lib/auth/permissions";
import { useOrganization } from "@/lib/organization/OrganizationProvider";

import { Button } from "./Button";
import { Icon } from "./Icon";

interface ShareButtonProps {
  title: string;
  /** Articles/SOPs: when the organization allows public links and the viewer
   * holds share_link.create, the button opens ShareDialog (member link +
   * public links) instead of sharing the page URL directly. */
  publicLink?: PublicLinkTarget;
}

// window.location.href is read inside the click handler (never at render
// time), so this needs no prop/effect to dodge the SSR "window is not
// defined" issue - by the time a click can happen, we're client-side.
// Prefers the native share sheet (mobile, and some desktop browsers) and
// falls back to copying the link, with the same icon-swap "Copied!"
// feedback as the code-block copy button in Markdown.tsx.
export function ShareButton({ title, publicLink }: ShareButtonProps) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { settings } = useOrganization();
  const canCreatePublicLinks = useHasPermission("share_link.create");
  const usesDialog = !!publicLink && !!settings?.share_links_enabled && canCreatePublicLinks;

  async function handleShare() {
    if (usesDialog) {
      setDialogOpen(true);
      return;
    }
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

  const button = (
    <Button variant="secondary" onClick={handleShare}>
      <Icon name={copied ? "check" : "share"} size={16} />
      {copied ? t("copiedLink") : t("share")}
    </Button>
  );

  if (!usesDialog || !publicLink) return button;
  return (
    <>
      {button}
      <ShareDialog open={dialogOpen} onOpenChange={setDialogOpen} target={publicLink} />
    </>
  );
}
