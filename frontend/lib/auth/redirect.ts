// A full navigation, not router.push: this runs from lib/api/client.ts,
// outside the React tree, and a full navigation guarantees every protected
// component unmounts instead of continuing to render with stale auth state.
export function redirectToLogin() {
  if (typeof window !== "undefined") {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- runs outside the React tree (lib/api/client.ts), so useRouter() isn't available; a full navigation is also required here to force protected components to unmount.
    window.location.href = "/login";
  }
}
