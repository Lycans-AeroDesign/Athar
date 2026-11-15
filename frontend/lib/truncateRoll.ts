// App-wide behavior for Tailwind's `truncate` (single line + "…"): when such
// text is actually clipped, pointing at it - or at the link/button/row/card it
// sits in - focusing it from the keyboard, or touching it scrolls ("rolls") the
// hidden part into view and back, then it settles to the ellipsis when left.
//
// Plain text rolls by translating the element itself (a GPU transform, placed
// at subpixel precision, so slow motion stays smooth) while a clip-path moving
// the opposite way keeps the visible window fixed - overflow is lifted for the
// duration, so the clip-path does the clipping overflow:hidden normally does.
// Both run as one Web Animation, no per-frame script. Elements with their own
// background or border (tag pills, ...) can't move like that without their
// box sliding out of place, so they scroll their content instead (scrollLeft
// from a rAF loop - smooth in timing, but snapped to whole pixels). Neither
// approach touches the element's children, so React's DOM stays intact.
//
// Everything inside the hovered "host" rolls as one group and only resets when
// the pointer moves to a *different* host - moving across a card's title,
// excerpt and padding must not restart the roll on every pointerover.

const SPEED_PX_PER_S = 45;
const MIN_TRAVEL_MS = 1200;
const HOLD_START_MS = 700;
const HOLD_END_MS = 1000;
const HOST_SELECTOR = "a, button, [role='button'], [role='option'], [role='menuitem'], li, tr";

type Source = "pointer" | "touch" | "focus";

interface Roll {
  distance: number;
  sign: 1 | -1;
  travelMs: number;
  startedAt: number;
  /** Set for transform-mode rolls; scroll-mode ones are driven by tick(). */
  animation?: Animation;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** 0 at the start edge .. 1 fully scrolled, for a roll `elapsed` ms in. */
function progressAt(roll: Roll, elapsed: number): number {
  // Out: hold, travel, hold at the end; back: travel, then the next cycle's start hold.
  let t = elapsed % cycleMs(roll);
  if (t < HOLD_START_MS) return 0;
  t -= HOLD_START_MS;
  if (t < roll.travelMs) return easeInOut(t / roll.travelMs);
  t -= roll.travelMs;
  if (t < HOLD_END_MS) return 1;
  t -= HOLD_END_MS;
  return 1 - easeInOut(t / roll.travelMs);
}

/** One full out-and-back cycle, in ms. */
function cycleMs(roll: Roll): number {
  return HOLD_START_MS + roll.travelMs + HOLD_END_MS + roll.travelMs;
}

function overflowOf(el: HTMLElement): number {
  return el.scrollWidth - el.clientWidth;
}

/** Whether moving the element's own box would visibly drag a background/border along. */
function hasOwnBox(style: CSSStyleDeclaration): boolean {
  const transparentBg = style.backgroundColor === "transparent" || /rgba\(.*,\s*0\)$/.test(style.backgroundColor);
  const borders = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth];
  return !transparentBg || style.backgroundImage !== "none" || borders.some((w) => parseFloat(w) > 0);
}

/**
 * The out-hold-back-hold cycle as Web Animation keyframes: the element moves
 * by `shift` px while its clip window moves back by the same amount, so the
 * text slides under a stationary window. offsets mirror progressAt().
 */
function rollKeyframes(roll: Roll): Keyframe[] {
  const cycle = cycleMs(roll);
  const shift = -roll.sign * roll.distance; // LTR text moves left, RTL right
  const rest = { transform: "translateX(0px)", clipPath: "inset(0px 0px 0px 0px)" };
  // Visible window in the element's own (moved) coordinates: [d, d + width] in LTR.
  const left = roll.sign === 1 ? roll.distance : -roll.distance;
  const moved = { transform: `translateX(${shift}px)`, clipPath: `inset(0px ${-left}px 0px ${left}px)` };
  const ease = "cubic-bezier(0.65, 0, 0.35, 1)";
  return [
    { ...rest, offset: 0 },
    { ...rest, offset: HOLD_START_MS / cycle, easing: ease },
    { ...moved, offset: (HOLD_START_MS + roll.travelMs) / cycle },
    { ...moved, offset: (HOLD_START_MS + roll.travelMs + HOLD_END_MS) / cycle, easing: ease },
    { ...rest, offset: 1 },
  ];
}

export function installTruncateRoller(doc: Document = document): () => void {
  const win = doc.defaultView;
  if (!win) return () => {};
  const reducedMotion = win.matchMedia("(prefers-reduced-motion: reduce)");

  const rolls = new Map<HTMLElement, Roll>();
  let host: Element | null = null;
  let source: Source | null = null;
  let frame = 0;
  let touchTimer: ReturnType<typeof setTimeout> | undefined;

  function tick(now: number) {
    frame = 0;
    let scrolling = false;
    for (const [el, roll] of rolls) {
      if (!el.isConnected) {
        rolls.delete(el);
        continue;
      }
      if (roll.animation) continue;
      scrolling = true;
      el.scrollLeft = roll.sign * roll.distance * progressAt(roll, now - roll.startedAt);
    }
    if (scrolling) frame = win!.requestAnimationFrame(tick);
  }

  function stopAll() {
    clearTimeout(touchTimer);
    for (const [el, roll] of rolls) {
      roll.animation?.cancel();
      delete el.dataset.rolling;
      el.scrollLeft = 0;
    }
    rolls.clear();
    host = null;
    source = null;
    if (frame) win!.cancelAnimationFrame(frame);
    frame = 0;
  }

  /** The element whose clipped texts roll together for a pointer/touch/focus on `target`. */
  function hostFor(target: EventTarget | null): Element | null {
    if (!(target instanceof win!.Element)) return null;
    return target.closest(HOST_SELECTOR) ?? target.closest(".truncate");
  }

  function startFor(nextHost: Element, nextSource: Source) {
    stopAll();
    if (reducedMotion.matches) return;
    const candidates = [
      ...(nextHost.matches(".truncate") ? [nextHost] : []),
      ...nextHost.querySelectorAll(".truncate"),
    ] as HTMLElement[];
    const now = win!.performance.now();
    for (const el of candidates) {
      const distance = overflowOf(el);
      if (distance <= 1) continue;
      const style = win!.getComputedStyle(el);
      const roll: Roll = {
        distance,
        // RTL content overflows to the left (and scrolls toward negative scrollLeft).
        sign: style.direction === "rtl" ? -1 : 1,
        travelMs: Math.max(MIN_TRAVEL_MS, (distance / SPEED_PX_PER_S) * 1000),
        startedAt: now,
      };
      const useTransform = typeof el.animate === "function" && !hasOwnBox(style);
      // "transform" also lifts overflow:hidden (globals.css) - set in the same
      // task as the animation starts, so no frame paints the overflow unclipped.
      el.dataset.rolling = useTransform ? "transform" : "scroll";
      if (useTransform) {
        roll.animation = el.animate(rollKeyframes(roll), { duration: cycleMs(roll), iterations: Infinity });
      }
      rolls.set(el, roll);
    }
    if (rolls.size === 0) return;
    host = nextHost;
    source = nextSource;
    if ([...rolls.values()].some((r) => !r.animation)) frame = win!.requestAnimationFrame(tick);
  }

  function onPointerOver(e: PointerEvent) {
    if (e.pointerType === "touch") return; // onTouchStart handles touch
    const next = hostFor(e.target);
    if (next === host) return; // still within the same card/link - keep rolling
    if (next) startFor(next, "pointer");
    else stopAll();
  }

  // No hover on touch: a touch plays one full out-and-back roll, then resets.
  function onTouchStart(e: TouchEvent) {
    const next = hostFor(e.target);
    if (!next) {
      stopAll();
      return;
    }
    if (next !== host) startFor(next, "touch");
    if (rolls.size > 0) {
      clearTimeout(touchTimer);
      const longest = Math.max(...Array.from(rolls.values(), cycleMs));
      touchTimer = setTimeout(stopAll, longest);
    }
  }

  function onFocusIn(e: FocusEvent) {
    const target = e.target as Element | null;
    if (!target?.matches?.(":focus-visible")) return; // a click's focus - pointer already covers it
    const next = hostFor(target);
    if (next && next !== host) startFor(next, "focus");
  }

  function onFocusOut() {
    if (source === "focus") stopAll();
  }

  function onPointerLeaveDocument() {
    if (source === "pointer") stopAll();
  }

  // Our own scrollLeft writes fire scroll events too - only a scroll of
  // something else (the page, a list) while touch-rolling ends the roll.
  function onScroll(e: Event) {
    if (source !== "touch") return;
    if (e.target instanceof win!.HTMLElement && rolls.has(e.target)) return;
    stopAll();
  }

  doc.addEventListener("pointerover", onPointerOver);
  doc.documentElement.addEventListener("pointerleave", onPointerLeaveDocument);
  doc.addEventListener("touchstart", onTouchStart, { passive: true });
  doc.addEventListener("focusin", onFocusIn);
  doc.addEventListener("focusout", onFocusOut);
  win.addEventListener("scroll", onScroll, { passive: true, capture: true });

  return () => {
    stopAll();
    doc.removeEventListener("pointerover", onPointerOver);
    doc.documentElement.removeEventListener("pointerleave", onPointerLeaveDocument);
    doc.removeEventListener("touchstart", onTouchStart);
    doc.removeEventListener("focusin", onFocusIn);
    doc.removeEventListener("focusout", onFocusOut);
    win.removeEventListener("scroll", onScroll, { capture: true });
  };
}
