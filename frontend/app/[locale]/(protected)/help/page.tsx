import { getTranslations } from "next-intl/server";

import { AboutAthar } from "@/components/help/AboutAthar";
import { HelpGuide } from "@/components/help/HelpGuide";
import { MarkdownGuide } from "@/components/help/MarkdownGuide";
import { Link } from "@/i18n/navigation";

const TAB_IDS = ["guide", "writing", "about"] as const;
type TabId = (typeof TAB_IDS)[number];

function isTabId(value: unknown): value is TabId {
  return typeof value === "string" && (TAB_IDS as readonly string[]).includes(value);
}

// The active tab lives in ?tab= (not client state) so each one is linkable -
// the editor's formatting tips link straight to ?tab=writing, and the old
// /about route redirects to ?tab=about. Plain server component: nothing here
// fetches data or needs client state.
export default async function HelpPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const t = await getTranslations("help");
  const { tab } = await searchParams;
  const activeTab: TabId = isTabId(tab) ? tab : "guide";

  return (
    <section>
      <h1 className="font-display text-display text-on-surface">{t("title")}</h1>
      <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">{t("description")}</p>

      {/* Same tab-strip styling as the Settings page. */}
      <div className="flex gap-6 overflow-x-auto border-b border-outline-variant mt-6 mb-6">
        {TAB_IDS.map((tabId) => (
          <Link
            key={tabId}
            href={tabId === "guide" ? "/help" : `/help?tab=${tabId}`}
            aria-current={activeTab === tabId ? "page" : undefined}
            className={`shrink-0 pb-3 font-label-caps text-label-caps uppercase border-b-2 transition-colors -mb-px ${
              activeTab === tabId
                ? "border-primary text-primary"
                : "border-transparent text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {t(`tabs.${tabId}`)}
          </Link>
        ))}
      </div>

      {activeTab === "guide" ? <HelpGuide /> : activeTab === "writing" ? <MarkdownGuide /> : <AboutAthar />}
    </section>
  );
}
