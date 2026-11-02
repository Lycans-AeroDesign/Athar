import { links, origin } from "@/content/site";
import { Section, TextLink } from "../ui";

export function Origin() {
  const d = origin.definition;
  return (
    <Section id="about" index="05" eyebrow={origin.eyebrow} labelledBy="about-heading">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-7">
          <h2 id="about-heading" className="text-3xl leading-tight font-semibold tracking-tight text-balance md:text-[2.6rem]">
            {origin.heading}
          </h2>
          {origin.body.map((p) => (
            <p key={p} className="mt-6 text-lg leading-relaxed text-fg-muted">{p}</p>
          ))}
          <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3">
            <TextLink href={links.lycansSite}>Lycans AeroDesign</TextLink>
            <TextLink href={links.lycansGithub}>Lycans on GitHub</TextLink>
          </div>
        </div>

        {/* Dictionary entry for the name */}
        <aside data-reveal aria-label="Meaning of the name Athar" className="lg:col-span-5">
          <div className="relative overflow-hidden rounded-lg border border-line bg-bg-raised p-8">
            <div aria-hidden="true" className="blueprint absolute inset-0 opacity-60" />
            <div className="relative">
              <p className="label">Etymology</p>
              <p lang="ar" dir="rtl" className="mt-6 text-right font-arabic text-7xl leading-none font-semibold text-accent md:text-8xl">
                {d.word}
              </p>
              <div className="mt-8 flex items-baseline gap-3 border-t border-line pt-5">
                <span className="text-xl font-semibold">{d.transliteration}</span>
                <span className="font-mono text-sm text-fg-subtle">{d.ipa}</span>
                <span className="font-accent text-fg-subtle italic">n., Arabic</span>
              </div>
              <p className="mt-3 text-fg-muted">{d.meaning}</p>
              <p className="mt-6 border-l-2 border-accent pl-4 text-sm leading-relaxed text-fg-muted">
                The trace a team&rsquo;s work leaves behind — kept so it outlives the people who made it.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </Section>
  );
}
