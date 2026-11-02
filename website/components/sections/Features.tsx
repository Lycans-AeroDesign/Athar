import { features, links, roadmap } from "@/content/site";
import { Icon } from "../icons";
import { Section, TextLink } from "../ui";

export function Features() {
  return (
    <Section id="features" index="03" eyebrow="What's in it today" labelledBy="features-heading">
      <div className="max-w-3xl">
        <h2 id="features-heading" className="text-3xl leading-tight font-semibold tracking-tight text-balance md:text-[2.6rem]">
          Everything a team learns, in one place it can search.
        </h2>
        <p className="mt-6 text-lg leading-relaxed text-fg-muted">
          These modules are built, tested and running in Athar today. Planned work is listed separately below.
        </p>
      </div>

      <div className="mt-14 grid gap-x-10 gap-y-14 lg:grid-cols-3">
        {features.map((group, gi) => (
          <div key={group.id} data-reveal style={{ transitionDelay: `${gi * 90}ms` }}>
            <div className="border-b border-line-strong pb-4">
              <h3 className="flex items-baseline gap-3 text-lg font-semibold">
                <span className="font-mono text-xs text-accent">{String(gi + 1).padStart(2, "0")}</span>
                {group.label}
              </h3>
              <p className="mt-1 text-sm text-fg-subtle lg:min-h-10">{group.summary}</p>
            </div>
            <ul>
              {group.items.map((item) => (
                <li key={item.title} className="flex gap-4 border-b border-line py-5">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line-strong text-accent">
                    <Icon name={item.icon} className="h-[18px] w-[18px]" />
                  </span>
                  <div>
                    <h4 className="font-medium text-fg">{item.title}</h4>
                    <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div data-reveal className="mt-16 rounded-lg border border-dashed border-line-strong p-6 md:p-8">
        <div className="flex flex-col gap-2 md:flex-row md:items-baseline md:justify-between">
          <h3 className="flex items-center gap-3 font-semibold">
            <span className="rounded-sm border border-line-strong px-2 py-0.5 font-mono text-[0.68rem] tracking-wider text-fg-subtle">
              PLANNED
            </span>
            On the roadmap — not available yet
          </h3>
          <TextLink href={links.vision} className="text-sm">Read the full roadmap</TextLink>
        </div>
        <ul className="mt-5 flex flex-wrap gap-2">
          {roadmap.map((r) => (
            <li key={r} className="rounded-full border border-dashed border-line-strong px-3.5 py-1.5 text-sm text-fg-muted">
              {r}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
