/** Display message for a caught value: an Error's message, otherwise the stringified value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
