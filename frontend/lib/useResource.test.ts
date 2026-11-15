import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useResource } from "./useResource";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useResource", () => {
  it("ignores a slow response for an id the page has already left", async () => {
    const pending: Record<string, ReturnType<typeof deferred<string>>> = { a: deferred(), b: deferred() };
    const fetcher = (id: string) => pending[id].promise;
    const { result, rerender } = renderHook(({ id }) => useResource(id, fetcher), { initialProps: { id: "a" } });

    rerender({ id: "b" });
    await act(async () => pending.b.resolve("record b"));
    await act(async () => pending.a.resolve("record a"));

    expect(result.current.data).toBe("record b");
  });

  it("shows the loading state, not the previous record, after the id changes", async () => {
    const pending: Record<string, ReturnType<typeof deferred<string>>> = { a: deferred(), b: deferred() };
    const fetcher = (id: string) => pending[id].promise;
    const { result, rerender } = renderHook(({ id }) => useResource(id, fetcher), { initialProps: { id: "a" } });

    await act(async () => pending.a.resolve("record a"));
    expect(result.current.data).toBe("record a");

    rerender({ id: "b" });
    expect(result.current.data).toBeNull();
    expect(result.current.notFound).toBe(false);
  });

  it("flags notFound when the fetch fails", async () => {
    const fetcher = () => Promise.reject(new Error("404"));
    const { result } = renderHook(() => useResource("x", fetcher));
    await waitFor(() => expect(result.current.notFound).toBe(true));
  });
});
