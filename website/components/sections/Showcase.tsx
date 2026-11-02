"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { screenshots } from "@/content/site";
import { BrowserFrame, Section } from "../ui";

export function Showcase() {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  // WAI-ARIA tabs: arrow keys move focus and selection, Home/End jump.
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const n = screenshots.length;
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % n;
    else if (e.key === "ArrowLeft") next = (i - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  };

  return (
    <Section id="showcase" index="04" eyebrow="Product tour" labelledBy="showcase-heading">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <h2 id="showcase-heading" className="max-w-2xl text-3xl leading-tight font-semibold tracking-tight text-balance md:text-[2.6rem]">
          The real application, with demo data.
        </h2>
        <p className="max-w-sm text-fg-muted">
          Unedited screenshots from an Athar instance seeded with a fictional team&rsquo;s records.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Screenshots"
        className="mt-10 -mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0"
      >
        {screenshots.map((s, i) => (
          <button
            key={s.id}
            ref={(el) => { tabs.current[i] = el; }}
            role="tab"
            type="button"
            id={`tab-${s.id}`}
            aria-selected={active === i}
            aria-controls={`panel-${s.id}`}
            tabIndex={active === i ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`relative shrink-0 px-3.5 py-3 text-sm whitespace-nowrap transition-colors ${
              active === i ? "text-fg" : "text-fg-subtle hover:text-fg-muted"
            }`}
          >
            <span className="mr-2 font-mono text-[0.68rem] text-accent">{String(i + 1).padStart(2, "0")}</span>
            {s.label}
            <span
              aria-hidden="true"
              className={`absolute inset-x-2 -bottom-px h-0.5 transition-colors ${active === i ? "bg-accent" : "bg-transparent"}`}
            />
          </button>
        ))}
      </div>

      {screenshots.map((s, i) => (
        <div
          key={s.id}
          role="tabpanel"
          id={`panel-${s.id}`}
          aria-labelledby={`tab-${s.id}`}
          hidden={active !== i}
          tabIndex={0}
          className="mt-8 rounded-lg"
        >
          <BrowserFrame shot={s} />
          <p className="mt-4 text-sm text-fg-muted">
            <span className="label mr-3">Fig. 04.{i + 1}</span>
            {s.caption}
          </p>
        </div>
      ))}

      {/* Mobile view */}
      <div data-reveal className="mt-20 grid items-center gap-10 md:grid-cols-12">
        <div className="md:col-span-7 md:col-start-1">
          <p className="label mb-3">Fig. 05 — Same article, on a phone</p>
          <h3 className="text-2xl font-semibold tracking-tight">Readable in the workshop, not just at a desk.</h3>
          <p className="mt-4 max-w-lg leading-relaxed text-fg-muted">
            The interface is responsive, so a procedure or failure write-up can be checked on a phone at the test stand. Arabic
            users get the full interface in Arabic with a right-to-left layout.
          </p>
        </div>
        <div className="md:col-span-4 md:col-start-9">
          <div
            className="mx-auto w-full max-w-[260px] overflow-hidden rounded-[2rem] border-[6px] border-panel bg-panel ring-1 ring-line-strong"
            style={{ boxShadow: "var(--shot-shadow)" }}
          >
            <Image
              src="/screenshots/light-mobile-article.png"
              width={1170}
              height={2532}
              sizes="260px"
              alt="The Battery Thermal Runaway article in Athar on a phone-sized screen, showing the title, status, tags and summary."
              className="block h-auto w-full rounded-[1.6rem]"
            />
          </div>
        </div>
      </div>
    </Section>
  );
}
