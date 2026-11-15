import { useCallback, useEffect, useState } from "react";

type Loaded<T> = { id: string; data: T | null; notFound: boolean };

/** Loads one record by id for a detail/edit page. `notFound` flips on any fetch failure; `setData`
 * lets the page apply an updated record after an action. `fetcher` must be a stable (module-level)
 * function so the effect only re-runs when `id` changes.
 *
 * State is tagged with the id it was loaded for, so navigating from one record to another shows the
 * loading state instead of the previous record, and a slow response for an id the page has already
 * left is dropped rather than overwriting the current one. */
export function useResource<T>(id: string, fetcher: (id: string) => Promise<T>) {
  const [loaded, setLoaded] = useState<Loaded<T>>({ id, data: null, notFound: false });

  useEffect(() => {
    let active = true;
    fetcher(id).then(
      (data) => {
        if (active) setLoaded({ id, data, notFound: false });
      },
      () => {
        if (active) setLoaded({ id, data: null, notFound: true });
      },
    );
    return () => {
      active = false;
    };
  }, [id, fetcher]);

  const current = loaded.id === id;
  const setData = useCallback((data: T) => setLoaded({ id, data, notFound: false }), [id]);

  return { data: current ? loaded.data : null, setData, notFound: current && loaded.notFound };
}
