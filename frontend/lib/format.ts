interface NamedPerson {
  first_name: string;
  last_name: string;
  email: string;
  username?: string | null;
}

/** "@username" when the person has set one (site-wide precedent - see
 * accounts/models.py's username field), else "First Last", falling back to
 * the email when both name fields are blank too. Repeated inline as
 * `[x.first_name, x.last_name].filter(Boolean).join(" ") || x.email` across
 * TopBar, ArticleCard, QuestionCard, and the article/question detail pages
 * before being pulled out here. */
export function formatPersonName(person: NamedPerson | null | undefined): string | null {
  if (!person) return null;
  if (person.username) return `@${person.username}`;
  return [person.first_name, person.last_name].filter(Boolean).join(" ") || person.email;
}

/** 1-2 letter initials for an Avatar - "AR" for Ahmad R., falling back to
 * the first letter of the email, then "?" when there's no person at all
 * (e.g. a revision with edited_by=null after the editor's account was deleted). */
export function getInitials(person: NamedPerson | null | undefined): string {
  if (!person) return "?";
  const initials = `${person.first_name?.[0] ?? ""}${person.last_name?.[0] ?? ""}`;
  return (initials || person.email?.[0] || "?").toUpperCase();
}

/** A plain "YYYY-MM-DD" (Failure.date/Test.date/Document.publication_date -
 * a DateField, not a datetime) formatted for display - parsed manually
 * rather than `new Date(isoDate)` because that parses a bare date as UTC
 * midnight, which can display as the previous day in a negative-UTC-offset
 * timezone; building the Date from local y/m/d components avoids that.
 * Originally duplicated identically in failures/page.tsx and tests/page.tsx
 * before being pulled out here. */
export function formatCalendarDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(year, month - 1, day));
}
