import type { Cause, NewOpportunityInput } from "../../types/domain";

/**
 * A single validation boundary for the creation wizard and its final save.
 * Checks syntax (integer capacity, numeric duration) AND service semantics
 * (positive, plausible staffing and shift time) before data is persisted.
 */
export interface OpportunityDraft {
  title: string;
  cause: Cause;
  description: string;
  address: string;
  capacity: string;
  duration: string;
  requirements: string;
}

export type OpportunityDraftField = keyof OpportunityDraft;

export type OpportunityValidation =
  | { valid: true; input: NewOpportunityInput }
  | { valid: false; field: OpportunityDraftField; message: string };

const CAUSES: ReadonlySet<string> = new Set([
  "food",
  "education",
  "environment",
  "health",
  "community",
  "animals",
]);

const fail = (field: OpportunityDraftField, message: string): OpportunityValidation => ({
  valid: false,
  field,
  message,
});

export function validateOpportunityDraft(draft: OpportunityDraft): OpportunityValidation {
  const title = draft.title.trim();
  const description = draft.description.trim();
  const address = draft.address.trim();
  if (title.length < 3 || title.length > 100) {
    return fail("title", "Use an opportunity name between 3 and 100 characters.");
  }
  if (!CAUSES.has(draft.cause)) {
    return fail("cause", "Select one of the available service causes.");
  }
  if (description.length < 20 || description.length > 1500) {
    return fail("description", "Describe the volunteer activity in 20–1,500 characters.");
  }
  if (address.length < 5 || address.length > 240) {
    return fail("address", "Enter a useful arrival location (5–240 characters).");
  }

  const capacityText = draft.capacity.trim();
  if (!/^[1-9]\d{0,2}$/.test(capacityText)) {
    return fail("capacity", "Capacity must be a whole number from 1 to 200.");
  }
  const capacity = Number(capacityText);
  if (!Number.isSafeInteger(capacity) || capacity > 200) {
    return fail("capacity", "Capacity must be a whole number from 1 to 200.");
  }

  const durationText = draft.duration.trim();
  const durationMatch = /^(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)$/i.exec(durationText);
  if (!durationMatch) {
    return fail("duration", "Enter a shift length like “2 hours” or “90 minutes”.");
  }
  const quantity = Number(durationMatch[1]);
  const unit = durationMatch[2].toLowerCase();
  const minutes = unit.startsWith("h") ? quantity * 60 : quantity;
  if (!Number.isFinite(minutes) || minutes < 15 || minutes > 720) {
    return fail("duration", "A typical shift must last between 15 minutes and 12 hours.");
  }

  const requirements = Array.from(
    new Set(
      draft.requirements
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
  if (requirements.length > 12 || requirements.some((item) => item.length > 60)) {
    return fail("requirements", "List at most 12 requirements, each under 60 characters.");
  }

  return {
    valid: true,
    input: {
      title,
      cause: draft.cause,
      description,
      address,
      capacity,
      duration: durationText,
      requirements,
    },
  };
}
