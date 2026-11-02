import { footer, links, site } from "@/content/site";
import { Wordmark } from "../Logo";

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 md:grid-cols-12">
        <div className="md:col-span-6">
          <Wordmark />
          <p className="mt-4 font-accent text-xl text-fg-muted italic">{site.tagline}</p>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-fg-subtle">
            An open-source, self-hosted knowledge management system for engineering and student teams.
          </p>
        </div>
        {footer.columns.map((col) => (
          <nav key={col.title} aria-label={col.title} className="md:col-span-3">
            <h2 className="label">{col.title}</h2>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((l) => (
                <li key={l.label}>
                  <a href={l.href} target="_blank" rel="noopener noreferrer" className="text-sm text-fg-muted transition-colors hover:text-accent">
                    {l.label}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-fg-subtle sm:flex-row sm:justify-between sm:px-6">
          <p>© {year} Lycans AeroDesign Team. Athar is open source under the{" "}
            <a href={links.license} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-accent">
              {site.license.name}
            </a>.
          </p>
          <p className="font-mono">Athar is not a hosted service. Run your own instance.</p>
        </div>
      </div>
    </footer>
  );
}
