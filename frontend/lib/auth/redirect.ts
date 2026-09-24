// A full navigation, not router.push: this runs from lib/api/client.ts,
// outside the React tree, and a full navigation guarantees every protected
// component unmounts instead of continuing to render with stale auth state.
export function redirectToLogin() {
  if (typeof window !== "undefined") {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- runs outside the React tree (lib/api/client.ts), so useRouter() isn't available; a full navigation is also required here to force protected components to unmount.
    window.location.href = "/login";
  }
}

// Where to send the user after login, from a `?next=` query param - only
// ever a same-site path. Anything else ("https://evil.example", the
// protocol-relative "//evil.example", or "/\evil.example", which browsers
// normalize to "//evil.example") falls back to "/"; passing it straight to
// router.push would turn the login page into an open redirect - a phishing
// link that really does start on our login screen.
export function safeRedirectPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/";
  }
  return next;
}
