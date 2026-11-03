import { hero, screenshots } from "@/content/site";
import { GitHub, ArrowRight } from "../icons";
import { BrowserFrame, LinkButton } from "../ui";

/** Callouts that rise out of the hero screenshot. x/y are % of the frame. */
const callouts = [
  { x: 22, y: 15, label: "Auto table of contents" },
  { x: 78, y: 16, label: "Every linked record, beside the article" },
];

export function Hero() {
  const shot = screenshots[0];
  return (
    <section id="top" aria-labelledby="hero-heading" className="relative overflow-hidden pt-32 md:pt-40">
      <div aria-hidden="true" className="blueprint fade-mask pointer-events-none absolute inset-0" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-y-20 px-4 sm:px-6 md:gap-y-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-x-10">
        <div>
          <p className="label mb-6 text-accent!">{hero.eyebrow}</p>
          <h1
            id="hero-heading"
            className="max-w-4xl text-[2.75rem] leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-6xl md:text-7xl lg:text-6xl xl:text-7xl"
          >
            {hero.headlineLead}{" "}
            <span className="font-accent font-normal tracking-[-0.02em] text-accent italic">{hero.headlineAccent}</span>
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-relaxed text-fg-muted md:text-xl lg:text-lg">{hero.body}</p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <LinkButton href={hero.primaryCta.href}>
              <GitHub className="h-4 w-4" />
              {hero.primaryCta.label}
            </LinkButton>
            <LinkButton href={hero.secondaryCta.href} variant="secondary">
              {hero.secondaryCta.label}
              <ArrowRight className="h-4 w-4" />
            </LinkButton>
          </div>

          <ul className="label mt-8 flex flex-wrap gap-x-6 gap-y-2" aria-label="Project facts">
            {hero.specs.map((s) => (
              <li key={s} className="flex items-center gap-2">
                <span aria-hidden="true" className="h-1 w-1 bg-accent" />
                {s}
              </li>
            ))}
          </ul>
        </div>

        {/* Product visual: tilted toward the headline, callouts rising out of it */}
        <div id="product" className="relative scroll-mt-24 lg:pt-16">
          <div className="hero-stage lg:w-[108%]">
            <div className="hero-tilt">
              <BrowserFrame shot={shot} priority sizes="(min-width: 1024px) 760px, 100vw" />
              <div aria-hidden="true" className="hero-callouts">
                {callouts.map((c) => (
                  <div key={c.label} className="hero-pin" style={{ left: `${c.x}%`, top: `${c.y}%` }}>
                    <span className="hero-pin-dot" />
                    <span className="hero-stalk" />
                    <span className="hero-stalk cross" />
                    <span className="hero-label rounded-sm border border-line-strong bg-bg px-2.5 py-1 font-mono text-[0.7rem] whitespace-nowrap text-fg shadow-lg">
                      {c.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="label mt-6 flex items-center justify-between lg:mt-10">
            <span>Fig. 01 — A post-mortem article in Athar</span>
            <span className="hidden sm:inline">Demo data</span>
          </div>
        </div>
      </div>
      <div className="h-20 md:h-28" />
    </section>
  );
}
