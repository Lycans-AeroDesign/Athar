import { getTranslations } from "next-intl/server";

import { Icon } from "@/components/ui/Icon";

// Same icons as SideNav's NAV_ITEMS, so each card is recognizable as the
// section it describes.
const SECTIONS = [
  { key: "articles", icon: "article" },
  { key: "questions", icon: "forum" },
  { key: "projects", icon: "architecture" },
  { key: "components", icon: "settings_input_component" },
  { key: "failures", icon: "report_problem" },
  { key: "sops", icon: "description" },
  { key: "tests", icon: "science" },
  { key: "documents", icon: "folder" },
  { key: "training", icon: "school" },
  { key: "bookmarks", icon: "bookmark" },
] as const;

const TIPS = [
  { key: "link", icon: "alternate_email" },
  { key: "visibility", icon: "lock" },
  { key: "search", icon: "search" },
] as const;

// "What goes where" - one card per section of the app, describing what it's
// for and what a useful entry contains.
export async function HelpGuide() {
  const t = await getTranslations("help.guide");

  return (
    <div className="space-y-6">
      <p className="font-body-lg text-body-lg text-on-surface-variant max-w-3xl">{t("intro")}</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {SECTIONS.map(({ key, icon }) => {
          const include = t.raw(`sections.${key}.include`) as string[];
          const note = t.has(`sections.${key}.note`) ? t(`sections.${key}.note`) : null;
          return (
            <article key={key} className="bg-surface rounded-xl border border-outline-variant p-5 space-y-3">
              <h2 className="flex items-center gap-2 font-headline-md text-headline-md text-on-surface">
                <Icon name={icon} size={20} className="text-primary shrink-0" />
                {t(`sections.${key}.title`)}
              </h2>
              <p className="font-body-md text-body-md text-on-surface-variant leading-relaxed">
                {t(`sections.${key}.purpose`)}
              </p>
              {include.length > 0 && (
                <div>
                  <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-1.5">
                    {t("includeTitle")}
                  </h3>
                  <ul className="space-y-1.5">
                    {include.map((item) => (
                      <li key={item} className="flex items-start gap-2 font-body-md text-body-md text-on-surface">
                        <Icon name="check" size={16} className="text-primary shrink-0 mt-0.5" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {note && (
                <p className="font-body-md text-body-md text-on-surface-variant bg-surface-container-low rounded-lg px-3 py-2">
                  {note}
                </p>
              )}
            </article>
          );
        })}
      </div>

      <div>
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("tipsTitle")}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
          {TIPS.map(({ key, icon }) => (
            <div key={key} className="bg-surface rounded-xl border border-outline-variant p-4">
              <h3 className="flex items-center gap-2 font-label-caps text-label-caps text-on-surface uppercase">
                <Icon name={icon} size={16} className="text-primary shrink-0" />
                {t(`tips.${key}Title`)}
              </h3>
              <p className="font-body-md text-body-md text-on-surface-variant mt-2 leading-relaxed">
                {t(`tips.${key}Body`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
