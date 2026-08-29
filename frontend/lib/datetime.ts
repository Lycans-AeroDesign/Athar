// Timezone convention for the whole app: the backend always sends/receives
// timestamps as UTC ISO 8601 strings (Django's USE_TZ=True guarantees the
// "Z" suffix on every DateTimeField). Every value crossing that boundary
// must go through these helpers so the UTC<->local conversion happens in
// exactly one place, never ad hoc at each call site.
//
// `new Date(utcIsoString)` already parses a "...Z"-suffixed string as an
// absolute instant, and `Intl.DateTimeFormat`/`date.toLocaleString()` render
// it in the browser's local timezone by default - so "converting to local"
// is really just "format without forcing a timeZone". Going the other way,
// `date.toISOString()` always serializes in UTC regardless of local zone.
//
// This module is for timestamps (an instant), not timezone-less calendar
// dates (e.g. a birthday) - those should be stored/sent as plain
// "YYYY-MM-DD" strings with no UTC conversion at all.

export function utcToLocalDate(utcIsoString: string | null | undefined): Date | null {
  if (!utcIsoString) return null;
  const date = new Date(utcIsoString);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function localDateToUtcIsoString(date: Date | null | undefined): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const timeFormatter = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

/** Formats a backend UTC timestamp for display in the viewer's local timezone. */
export function formatDateTime(utcIsoString: string | null | undefined): string {
  const date = utcToLocalDate(utcIsoString);
  return date ? dateTimeFormatter.format(date) : "—";
}

export function formatDate(utcIsoString: string | null | undefined): string {
  const date = utcToLocalDate(utcIsoString);
  return date ? dateFormatter.format(date) : "—";
}

export function formatTime(utcIsoString: string | null | undefined): string {
  const date = utcToLocalDate(utcIsoString);
  return date ? timeFormatter.format(date) : "—";
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const RELATIVE_TIME_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
];

/** "2 hours ago" / "in 3 days" style formatting, falling back to a plain date past ~a year. */
export function formatRelativeTime(utcIsoString: string | null | undefined): string {
  const date = utcToLocalDate(utcIsoString);
  if (!date) return "—";
  const seconds = (date.getTime() - Date.now()) / 1000;
  for (const [unit, unitSeconds] of RELATIVE_TIME_UNITS) {
    if (Math.abs(seconds) >= unitSeconds) {
      return relativeTimeFormatter.format(Math.round(seconds / unitSeconds), unit);
    }
  }
  return relativeTimeFormatter.format(Math.round(seconds), "second");
}
