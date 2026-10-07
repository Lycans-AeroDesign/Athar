"use client";

import { useRef, useState } from "react";

interface SaveContext {
  /** Id of the item this editor already created on an earlier attempt that
   * then failed partway (e.g. syncing access grants) - when set, the task
   * must update this id instead of creating again. */
  createdId: string | null;
  /** Call right after the create succeeds, before any follow-up step that
   * could still fail. */
  markCreated: (id: string) => void;
}

/** Guards an editor's save so it can only ever create its item once:
 *
 * - A ref (not just the isSaving state) blocks re-entry, so a fast double
 *   click can't fire two requests before React re-renders the disabled button.
 * - The created item's id is remembered across attempts, so retrying after a
 *   failed follow-up step updates that item rather than creating a duplicate.
 *
 * On success isSaving deliberately stays true - every editor navigates away
 * right after, and the saving overlay should stay up until it does. */
export function useSaveOnce() {
  const savingRef = useRef(false);
  const createdIdRef = useRef<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function run(task: (context: SaveContext) => Promise<void>): Promise<void> {
    if (savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    try {
      await task({
        createdId: createdIdRef.current,
        markCreated: (id) => {
          createdIdRef.current = id;
        },
      });
    } catch (err) {
      savingRef.current = false;
      setIsSaving(false);
      throw err;
    }
  }

  return { isSaving, run };
}
