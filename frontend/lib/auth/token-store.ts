// Access token lives here only: a module-level JS variable, never
// localStorage/sessionStorage/a cookie. It is wiped on logout or a failed
// refresh, and is naturally gone after a hard page reload (by design).
let accessToken: string | null = null;
const listeners = new Set<() => void>();

export const tokenStore = {
  getAccessToken: () => accessToken,
  setAccessToken: (token: string | null) => {
    accessToken = token;
    listeners.forEach((listener) => listener());
  },
  clearAccessToken: () => {
    tokenStore.setAccessToken(null);
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
