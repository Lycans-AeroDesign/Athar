import { hero, screenshots } from "@/content/site";
import { GitHub, ArrowRight } from "../icons";
import { BrowserFrame, LinkButton } from "../ui";

/** Drawing-style callouts over the hero screenshot. x/y are % of the frame. */
const callouts = [
  { x: 22, y: 15, label: "Auto table of contents" },
  { x: 78, y: 16, label: "Every linked record, beside the article" },
];

export function Hero() {
  const shot = screenshots[0];
  return (
    <section id="top" aria-labelledby="hero-heading" className="relative overflow-hidden pt-32 md:pt-40">
      <div aria-hidden="true" className="blueprint fade-mask pointer-events-none absolute inset-0" />

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <p className="label mb-6 text-accent!">{hero.eyebrow}</p>
        <h1
          id="hero-heading"
          className="max-w-4xl text-[2.75rem] leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-6xl md:text-7xl lg:text-[5.25rem]"
        >
          {hero.headlineLead}{" "}
          <span className="font-accent font-normal tracking-[-0.02em] text-accent italic">{hero.headlineAccent}</span>
        </h1>
        <p className="mt-7 max-w-2xl text-lg leading-relaxed text-fg-muted md:text-xl">{hero.body}</p>

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

      {/* Product visual */}
      <div id="product" className="relative mx-auto mt-20 max-w-6xl scroll-mt-24 px-4 sm:px-6 md:mt-28">
        <div className="relative lg:mt-16">
          <BrowserFrame shot={shot} priority />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden lg:block">
            {callouts.map((c) => (
              <div key={c.label} className="absolute" style={{ left: `${c.x}%`, top: "-3.25rem", height: `calc(${c.y}% + 3.25rem)` }}>
                <span className="absolute -top-1 left-0 -translate-x-1/2 rounded-sm border border-line-strong bg-bg px-2.5 py-1 font-mono text-[0.7rem] whitespace-nowrap text-fg">
                  {c.label}
                </span>
                <span className="absolute top-6 bottom-1.5 left-0 w-px bg-accent" />
                <span className="absolute bottom-0 left-0 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-accent bg-bg" />
              </div>
            ))}
          </div>
        </div>
        <div className="label mt-4 flex items-center justify-between">
          <span>Fig. 01 — A post-mortem article in Athar</span>
          <span className="hidden sm:inline">Demo data</span>
        </div>
      </div>
      <div className="h-20 md:h-28" />
    </section>
  );
}
