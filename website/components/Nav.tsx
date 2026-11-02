"use client";

import { useEffect, useRef, useState } from "react";
import { links, nav } from "@/content/site";
import { Wordmark } from "./Logo";
import { Close, GitHub, Menu, Moon, Sun } from "./icons";

function ThemeToggle() {
  const [light, setLight] = useState(false);
  useEffect(() => {
    // Sync with whatever the boot script applied before hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLight(document.documentElement.dataset.theme === "light");
  }, []);
  const toggle = () => {
    const next = !light;
    setLight(next);
    if (next) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("athar-theme", next ? "light" : "dark");
    } catch {}
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-accent-soft hover:text-fg"
    >
      {light ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />}
    </button>
  );
}

export function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const linkProps = (external?: boolean) =>
    external ? { target: "_blank", rel: "noopener noreferrer" } : {};

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300 ${
        scrolled || open ? "border-line bg-bg/85 backdrop-blur-md" : "border-transparent bg-transparent"
      }`}
    >
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="#top" className="rounded-md" aria-label="Athar, back to top">
          <Wordmark />
        </a>

        <ul className="hidden items-center gap-1 md:flex">
          {nav.map((item) => (
            <li key={item.label}>
              <a
                href={item.href}
                {...linkProps(item.external)}
                className="rounded-md px-3 py-2 text-sm text-fg-muted transition-colors hover:text-fg"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-1">
          <ThemeToggle />
          <a
            href={links.repo}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 hidden h-9 items-center gap-2 rounded-md border border-line-strong px-3.5 text-sm font-medium text-fg transition-colors hover:border-accent hover:text-accent sm:inline-flex"
          >
            <GitHub className="h-4 w-4" />
            GitHub
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <button
            ref={buttonRef}
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-fg md:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <Close className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      <div id="mobile-menu" hidden={!open} className="border-t border-line md:hidden">
        <ul className="mx-auto max-w-6xl px-4 py-3">
          {nav.map((item) => (
            <li key={item.label}>
              <a
                href={item.href}
                {...linkProps(item.external)}
                onClick={() => setOpen(false)}
                className="block rounded-md px-2 py-3 text-base text-fg-muted hover:text-fg"
              >
                {item.label}
              </a>
            </li>
          ))}
          <li className="mt-2 border-t border-line pt-3">
            <a
              href={links.repo}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-md px-2 py-3 text-base font-medium text-fg"
            >
              <GitHub className="h-4 w-4" /> GitHub
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        </ul>
      </div>
    </header>
  );
}
