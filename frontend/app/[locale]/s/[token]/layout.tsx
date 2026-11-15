import type { Metadata } from "next";

// Public share pages (no login) are for whoever holds the link, not search
// engines - the API response also carries X-Robots-Tag, this covers the page.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function SharedPageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
