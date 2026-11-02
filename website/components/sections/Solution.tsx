import { solution } from "@/content/site";
import type { IconName } from "@/content/site";
import { Icon } from "../icons";
import { Section } from "../ui";

/**
 * Records linked to one article in the Athar demo dataset, taken from that
 * article's Related Content panel (see public/screenshots/light-hero.png).
 */
const center = { type: "Article", icon: "article" as IconName, title: "Battery thermal runaway: root cause" };
const related: { type: string; icon: IconName; title: string }[] = [
  { type: "Project", icon: "project", title: "Falcon Aircraft 2027" },
  { type: "Failure", icon: "failure", title: "Thermal runaway in ground test" },
  { type: "Component", icon: "component", title: "4S 6000mAh LiPo battery" },
  { type: "SOP", icon: "sop", title: "LiPo handling & charging" },
  { type: "Test", icon: "test", title: "Static thrust test MN5212" },
  { type: "Document", icon: "document", title: "2027 competition rules" },
  { type: "Component", icon: "component", title: "Bat-Safe charging enclosure" },
  { type: "Article", icon: "article", title: "Battery safety best practices" },
];

const W = 800, H = 520, CX = 400, CY = 260, RX = 290, RY = 200;
const NW = 204, NH = 52;

function Graph() {
  const nodes = related.map((n, i) => {
    const a = (-90 + i * (360 / related.length)) * (Math.PI / 180);
    return { ...n, x: CX + RX * Math.cos(a), y: CY + RY * Math.sin(a) };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" aria-hidden="true">
      {nodes.map((n, i) => (
        <g key={`e${i}`}>
          <line
            className="graph-edge"
            style={{ transitionDelay: `${i * 90}ms` }}
            x1={CX} y1={CY} x2={n.x} y2={n.y}
            stroke="var(--accent)" strokeOpacity={0.45} strokeWidth={1.2}
          />
        </g>
      ))}
      {nodes.map((n, i) => (
        <g key={`n${i}`} className="graph-node" style={{ transitionDelay: `${300 + i * 90}ms` }}>
          <rect x={n.x - NW / 2} y={n.y - NH / 2} width={NW} height={NH} rx={6} fill="var(--panel)" stroke="var(--line-strong)" />
          <text x={n.x - NW / 2 + 14} y={n.y - 5} fontFamily="var(--font-mono)" fontSize="10" letterSpacing="1" fill="var(--accent)">
            {n.type.toUpperCase()}
          </text>
          <text x={n.x - NW / 2 + 14} y={n.y + 13} fontFamily="var(--font-sans)" fontSize="12" fill="var(--fg)">
            {n.title}
          </text>
        </g>
      ))}
      <g className="graph-node">
        <rect x={CX - 150} y={CY - 36} width={300} height={72} rx={8} fill="var(--panel)" stroke="var(--accent)" strokeWidth={1.5} />
        <text x={CX - 132} y={CY - 7} fontFamily="var(--font-mono)" fontSize="10.5" letterSpacing="1" fill="var(--accent)">
          {center.type.toUpperCase()} · ART-FFB3B66F
        </text>
        <text x={CX - 132} y={CY + 15} fontFamily="var(--font-sans)" fontSize="14" fontWeight="600" fill="var(--fg)">
          {center.title}
        </text>
      </g>
    </svg>
  );
}

export function Solution() {
  return (
    <Section id="solution" index="02" eyebrow={solution.eyebrow} labelledBy="solution-heading">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-4">
          <h2 id="solution-heading" className="text-3xl leading-tight font-semibold tracking-tight text-balance md:text-[2.6rem]">
            {solution.heading}
          </h2>
          {solution.body.map((p) => (
            <p key={p} className="mt-6 text-lg leading-relaxed text-fg-muted">{p}</p>
          ))}
        </div>

        <figure data-reveal className="lg:col-span-8">
          <div className="relative overflow-hidden rounded-lg border border-line bg-bg-raised">
            <div aria-hidden="true" className="blueprint absolute inset-0 opacity-70" />
            <div className="label relative flex items-center justify-between border-b border-line px-5 py-3">
              <span>Fig. 03 — Related content graph</span>
              <span>Demo data</span>
            </div>
            <div className="relative hidden p-4 sm:block md:p-6">
              <Graph />
            </div>
            {/* Small screens: the same relationships as a readable list */}
            <div className="relative p-5 sm:hidden">
              <div className="rounded-md border border-accent bg-panel p-4">
                <p className="font-mono text-[0.68rem] tracking-wider text-accent">ARTICLE</p>
                <p className="mt-1 font-semibold">{center.title}</p>
              </div>
              <ul className="mt-2 ml-4 border-l border-accent/50">
                {related.map((n) => (
                  <li key={n.title} className="relative py-2 pl-5">
                    <span aria-hidden="true" className="absolute top-1/2 left-0 h-px w-4 bg-accent/50" />
                    <span className="flex items-center gap-2 font-mono text-[0.68rem] tracking-wider text-accent">
                      <Icon name={n.icon} className="h-3.5 w-3.5" /> {n.type.toUpperCase()}
                    </span>
                    <span className="text-sm">{n.title}</span>
                  </li>
                ))}
              </ul>
            </div>
            {/* Screen-reader description of the graph */}
            <p className="sr-only">
              The article &ldquo;{center.title}&rdquo; is linked to: {related.map((n) => `${n.type} “${n.title}”`).join(", ")}.
            </p>
          </div>
          <figcaption className="mt-3 text-sm text-fg-subtle">{solution.figureCaption}</figcaption>
        </figure>
      </div>
    </Section>
  );
}
