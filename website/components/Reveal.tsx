"use client";

import { useEffect } from "react";

/**
 * Adds `is-visible` to every [data-reveal] element as it scrolls into view.
 * Mounted once on the page. Styles live in globals.css and are only active
 * when the boot script has added the `js` class, so content is never hidden
 * for no-JS visitors; reduced-motion users get no transition.
 */
export function RevealObserver() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}
