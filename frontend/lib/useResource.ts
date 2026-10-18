import { useEffect, useState } from "react";

/** Loads one record by id for a detail/edit page. `notFound` flips on any fetch failure; `setData`
 * lets the page apply an updated record after an action. `fetcher` must be a stable (module-level)
 * function so the effect only re-runs when `id` changes. */
export function useResource<T>(id: string, fetcher: (id: string) => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetcher(id).then(setData, () => setNotFound(true));
  }, [id, fetcher]);

  return { data, setData, notFound };
}
