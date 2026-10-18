// Timezone convention: the backend sends/receives timestamps as UTC ISO 8601 strings (USE_TZ=True
// guarantees the "Z" suffix). Every value crossing that boundary goes through these helpers, so
// UTC<->local conversion happens in one place. `new Date("...Z")` parses an absolute instant and
// Intl.DateTimeFormat renders it in the browser's local zone; `toISOString()` always serializes UTC.
//
// For instants only: timezone-less calendar dates (e.g. a birthday) should be plain "YYYY-MM-DD"
// strings with no UTC conversion.

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

/** Formats a backend UTC timestamp for display in the viewer's local timezone. */
export function formatDateTime(utcIsoString: string | null | undefined): string {
  const date = utcToLocalDate(utcIsoString);
  return date ? dateTimeFormatter.format(date) : "—";
}

export function formatDate(utcIsoString: string | null | undefined): string {
  const date = utcToLocalDate(utcIsoString);
  return date ? dateFormatter.format(date) : "—";
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
