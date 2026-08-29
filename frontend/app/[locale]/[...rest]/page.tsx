import { notFound } from "next/navigation";

// Catches any path under a valid /<locale>/... prefix that doesn't match a
// real page. Without this, Next.js can't resolve the [locale] segment for a
// truly unmatched sub-path and falls back to its generic built-in 404
// instead of app/[locale]/not-found.tsx.
export default function CatchAll() {
  notFound();
}
