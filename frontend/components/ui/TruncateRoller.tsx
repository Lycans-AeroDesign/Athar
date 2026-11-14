"use client";

import { useEffect } from "react";

// App-wide behavior for Tailwind's `truncate` (single line + "…"): when such
// text is actually clipped, hovering/focusing it - or the link/button/card it
// sits in - or touching it on a phone scrolls ("rolls") the rest into view,
// then it settles back to the ellipsis. Done by delegation on `document`
// rather than a wrapper component so every existing `truncate` call site gets
// it with no per-site change. It only animates `text-indent` via a CSS
// variable + data attribute (globals.css's [data-rolling]) and never touches
// the element's children, so React's DOM stays intact. text-indent is
// direction-relative, so the same negative distance rolls correctly in RTL.

const ROLL_SPEED_PX_PER_S = 40;
const MIN_DURATION_S = 2.5;
// What counts as "the thing being pointed at" when the pointer is on a card
// or nav item rather than on the clipped text itself.
const HOST_SELECTOR = "a, button, [role='button'], [role='option'], [role='menuitem'], li, tr";

function isRollable(el: HTMLElement): boolean {
  const display = getComputedStyle(el).display;
  // text-indent only shifts block-level line boxes.
  if (!["block", "inline-block", "list-item", "table-cell", "flow-root"].includes(display)) return false;
  return el.scrollWidth - el.clientWidth > 1;
}

function startRolling(el: HTMLElement) {
  if (el.dataset.rolling !== undefined || !isRollable(el)) return;
  const distance = el.scrollWidth - el.clientWidth;
  // Rolls out and back (alternate), with a pause at each end baked into the keyframes.
  const duration = Math.max(MIN_DURATION_S, distance / ROLL_SPEED_PX_PER_S);
  el.style.setProperty("--roll-distance", `-${distance}px`);
  el.style.setProperty("--roll-duration", `${duration}s`);
  el.dataset.rolling = "";
}

function stopRolling(el: HTMLElement) {
  if (el.dataset.rolling === undefined) return;
  delete el.dataset.rolling;
  el.style.removeProperty("--roll-distance");
  el.style.removeProperty("--roll-duration");
}

function truncatedIn(target: EventTarget | null): HTMLElement[] {
  if (!(target instanceof Element)) return [];
  const own = target.closest<HTMLElement>(".truncate");
  if (own) return [own];
  const host = target.closest<HTMLElement>(HOST_SELECTOR);
  return host ? Array.from(host.querySelectorAll<HTMLElement>(".truncate")) : [];
}

export function TruncateRoller() {
  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const active = new Set<HTMLElement>();
    let touchTimer: ReturnType<typeof setTimeout> | undefined;

    function begin(target: EventTarget | null) {
      if (reducedMotion.matches) return;
      for (const el of truncatedIn(target)) {
        startRolling(el);
        if (el.dataset.rolling !== undefined) active.add(el);
      }
    }

    function endAll() {
      for (const el of active) stopRolling(el);
      active.clear();
    }

    function onPointerOver(e: PointerEvent) {
      if (e.pointerType === "touch") return; // handled by onTouchStart
      const els = truncatedIn(e.target);
      // Moving onto something else ends the previous roll.
      for (const el of active) {
        if (!els.includes(el)) {
          stopRolling(el);
          active.delete(el);
        }
      }
      begin(e.target);
    }

    // Touch has no hover: a touch starts the roll, which keeps going long
    // enough to read the text before resetting.
    function onTouchStart(e: TouchEvent) {
      endAll();
      clearTimeout(touchTimer);
      begin(e.target);
      const longest = Math.max(
        0,
        ...Array.from(active, (el) => parseFloat(el.style.getPropertyValue("--roll-duration")) || 0),
      );
      if (longest > 0) touchTimer = setTimeout(endAll, longest * 2 * 1000 + 500);
    }

    function onFocusIn(e: FocusEvent) {
      if ((e.target as Element | null)?.matches?.(":focus-visible")) begin(e.target);
    }

    document.addEventListener("pointerover", onPointerOver);
    document.documentElement.addEventListener("pointerleave", endAll);
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", endAll);
    window.addEventListener("scroll", endAll, { passive: true, capture: true });
    return () => {
      clearTimeout(touchTimer);
      endAll();
      document.removeEventListener("pointerover", onPointerOver);
      document.documentElement.removeEventListener("pointerleave", endAll);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", endAll);
      window.removeEventListener("scroll", endAll, { capture: true });
    };
  }, []);

  return null;
}
