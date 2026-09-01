import { getTranslations } from "next-intl/server";

// Purely informational - what "Athar" is and where the name comes from
// (mirrors README.md's "Why" section). No data fetching, so this is a plain
// server component rather than the "use client" shell most other pages use.
export default async function AboutPage() {
  const t = await getTranslations("about");

  const principles = [
    { title: t("principle1Title"), body: t("principle1Body") },
    { title: t("principle2Title"), body: t("principle2Body") },
    { title: t("principle3Title"), body: t("principle3Body") },
  ];

  return (
    <section className="max-w-3xl">
      <h1 className="font-display text-display text-on-surface">{t("title")}</h1>
      <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">{t("tagline")}</p>

      <div className="bg-surface rounded-xl border border-outline-variant p-6 mt-6">
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("whyTitle")}</h2>
        <p className="font-body-md text-body-md text-on-surface-variant mt-3 leading-relaxed">{t("whyBody")}</p>
      </div>

      <div className="bg-surface rounded-xl border border-outline-variant p-6 mt-6">
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("nameTitle")}</h2>
        <div className="flex items-baseline gap-3 mt-3">
          <span className="font-display text-display text-primary">{t("nameArabic")}</span>
          <span className="font-body-lg text-body-lg text-on-surface italic">{t("nameWord")}</span>
          <span className="font-body-md text-body-md text-on-surface-variant">{t("namePronunciation")}</span>
        </div>
        <p className="font-body-md text-body-md text-on-surface-variant mt-2">{t("nameMeaning")}</p>
        <p className="font-body-md text-body-md text-on-surface-variant mt-3 leading-relaxed">{t("nameBody")}</p>
      </div>

      <div className="mt-6">
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("principlesTitle")}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
          {principles.map((principle) => (
            <div key={principle.title} className="bg-surface rounded-xl border border-outline-variant p-4">
              <h3 className="font-label-caps text-label-caps text-on-surface uppercase">{principle.title}</h3>
              <p className="font-body-md text-body-md text-on-surface-variant mt-2 leading-relaxed">{principle.body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-surface-container-low rounded-xl border border-outline-variant p-6 mt-6">
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("creditTitle")}</h2>
        <p className="font-body-md text-body-md text-on-surface-variant mt-3 leading-relaxed">{t("creditBody")}</p>
      </div>
    </section>
  );
}
