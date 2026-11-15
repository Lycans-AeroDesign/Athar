import { useEffect } from "react";

/** While `dirty` is true, asks the browser to confirm before a reload, tab close, or navigation to
 * another site, so an editor's unsaved text isn't lost to a stray Ctrl+R. In-app link clicks are
 * client-side navigations the browser doesn't see, so they are not covered by this. */
export function useUnsavedChangesGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Older browsers only show the prompt when returnValue is set.
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}
