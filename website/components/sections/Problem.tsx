import { problem } from "@/content/site";
import { Section } from "../ui";

/**
 * Conceptual diagram: what a team knows across six seasons. Without a shared
 * record it resets at every graduation; with one, it accumulates.
 * Explicitly labelled as illustrative - there is no measured data here.
 */
function HandoverDiagram() {
  const W = 560, H = 240, padL = 16, padR = 16, top = 24, base = 196;
  const seasons = 6;
  const step = (W - padL - padR) / seasons;
  const xs = Array.from({ length: seasons + 1 }, (_, i) => padL + i * step);

  // Sawtooth: rises through each season, collapses at each handover.
  let saw = `M ${xs[0]} ${base}`;
  for (let i = 0; i < seasons; i++) {
    saw += ` L ${xs[i + 1] - 4} ${base - 92} L ${xs[i + 1]} ${base - 30}`;
  }
  // Accumulating: each season builds on the last.
  let acc = `M ${xs[0]} ${base}`;
  for (let i = 0; i < seasons; i++) {
    const y = base - 30 - (i + 1) * 23;
    acc += ` L ${xs[i + 1]} ${Math.max(y, top + 4)}`;
  }

  return (
    <figure data-reveal className="rounded-lg border border-line bg-bg-raised p-5 sm:p-6">
      <div className="label mb-4 flex items-center justify-between">
        <span>Fig. 02 — Team knowledge across seasons</span>
        <span>Illustrative</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby="handover-title handover-desc">
        <title id="handover-title">What a team knows over six seasons</title>
        <desc id="handover-desc">
          An illustrative diagram. Without a shared record, team knowledge climbs during each season and drops sharply at each
          graduation. With a shared record, each season builds on the one before.
        </desc>
        {xs.slice(1, -1).map((x) => (
          <line key={x} x1={x} x2={x} y1={top} y2={base} stroke="var(--line-strong)" strokeDasharray="2 4" />
        ))}
        <line x1={padL} x2={W - padR} y1={base} y2={base} stroke="var(--line-strong)" />
        <path d={saw} fill="none" stroke="var(--signal)" strokeWidth={1.6} strokeLinejoin="round" />
        <path d={acc} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
        {xs.slice(0, -1).map((x, i) => (
          <text key={x} x={x + step / 2} y={base + 22} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="11" fill="var(--fg-subtle)">
            S{i + 1}
          </text>
        ))}
        {xs.slice(1, -1).map((x) => (
          <text key={`g${x}`} x={x} y={top - 8} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="9" fill="var(--fg-subtle)">
            ▼
          </text>
        ))}
      </svg>
      <figcaption className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-fg-muted">
        <span className="flex items-center gap-2"><span aria-hidden="true" className="h-0.5 w-5 bg-signal" />Knowledge kept in people</span>
        <span className="flex items-center gap-2"><span aria-hidden="true" className="h-0.5 w-5 bg-accent" />Knowledge kept in a shared record</span>
        <span className="flex items-center gap-2 font-mono text-xs text-fg-subtle"><span aria-hidden="true">▼</span>Handover / graduation</span>
      </figcaption>
    </figure>
  );
}

export function Problem() {
  return (
    <Section id="problem" index="01" eyebrow={problem.eyebrow} labelledBy="problem-heading">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <h2 id="problem-heading" className="text-3xl leading-tight font-semibold tracking-tight text-balance md:text-[2.6rem]">
            {problem.heading}
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-fg-muted">{problem.body}</p>
        </div>
        <div className="lg:col-span-7">
          <HandoverDiagram />
        </div>
      </div>

      {/* Loss log, ruled like an incident register */}
      <div className="mt-16">
        <p className="label mb-4">Loss register</p>
        <ol className="grid border-t border-line sm:grid-cols-2 lg:grid-cols-5">
          {problem.incidents.map((item, i) => (
            <li
              key={item.code}
              data-reveal
              style={{ transitionDelay: `${i * 70}ms` }}
              className="border-b border-line py-6 sm:pr-6 lg:border-b-0 lg:border-l lg:px-5 lg:first:border-l-0 lg:first:pl-0"
            >
              <span className="font-mono text-xs tracking-wider text-signal">{item.code}</span>
              <h3 className="mt-3 text-base font-semibold text-fg">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">{item.detail}</p>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}
