import { links, selfHost, site } from "@/content/site";
import { CopyButton } from "../CopyButton";
import { GitHub } from "../icons";
import { LinkButton, Section, TextLink } from "../ui";

export function SelfHost() {
  return (
    <Section id="self-host" index="06" eyebrow={selfHost.eyebrow} labelledBy="selfhost-heading">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <h2 id="selfhost-heading" className="text-3xl leading-tight font-semibold tracking-tight text-balance md:text-[2.6rem]">
            {selfHost.heading}
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-fg-muted">{selfHost.body}</p>

          <dl className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {selfHost.points.map((p) => (
              <div key={p.title} className="border-t border-line-strong pt-4">
                <dt className="font-medium">{p.title}</dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-fg-muted">{p.body}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div data-reveal className="lg:col-span-7">
          <div className="overflow-hidden rounded-lg border border-line-strong bg-[#070a11]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
              <span className="font-mono text-xs text-white/50">Quickstart · Docker Compose</span>
              <CopyButton text={selfHost.commands.join("\n")} />
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-[0.82rem] leading-7 text-[#dce1ff]">
              <code>
                {selfHost.commands.map((c) => (
                  <span key={c} className="block">
                    <span aria-hidden="true" className="mr-3 text-[#b7c4ff]/50 select-none">$</span>
                    {c}
                  </span>
                ))}
              </code>
            </pre>
          </div>
          <p className="mt-3 text-sm text-fg-subtle">
            Requires Docker and Python 3. For a production server — HTTPS, prebuilt images, backups — follow the{" "}
            <TextLink href={links.deployment}>deployment guide</TextLink>.
          </p>

          <div className="mt-8">
            <p className="label mb-3">Built on</p>
            <ul className="flex flex-wrap gap-2">
              {selfHost.stack.map((s) => (
                <li key={s} className="rounded-sm border border-line px-2.5 py-1 font-mono text-xs text-fg-muted">{s}</li>
              ))}
            </ul>
          </div>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <LinkButton href={links.repo}>
              <GitHub className="h-4 w-4" />
              View the source
            </LinkButton>
            <LinkButton href={links.quickstart} variant="secondary">Installation docs</LinkButton>
          </div>
          <p className="mt-5 text-sm text-fg-subtle">
            Licensed under the <TextLink href={links.license}>{site.license.name}</TextLink>.
          </p>
        </div>
      </div>
    </Section>
  );
}
