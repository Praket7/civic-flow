/**
 * Native bridges and hosted providers reject with Error, string, or a plain
 * response object. Normalize these at the UI boundary instead of showing
 * unhelpful "[object Object]" or "null" in a volunteer-facing alert.
 */
export function messageOf(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (typeof error === "object" && error !== null) {
    const response = error as Record<string, unknown>;
    if (typeof response.message === "string" && response.message.trim()) {
      return response.message.trim();
    }
    if (typeof response.error_description === "string" && response.error_description.trim()) {
      return response.error_description.trim();
    }
  }
  return fallback;
}
