import type { RosterPolicy, PriorityLevel } from "../../../types/domain";

/** Preview-only, organization-scoped matching policy and semantic validation. */
export function createPreviewRosterPolicyStore(
  scoped: (key: string) => string,
  levels: readonly PriorityLevel[],
) {
  const POLICY_KEY = "civicflow.roster-policy.v1";

  function defaultRosterPolicy(): RosterPolicy {
    return {
      version: 1,
      maxShiftsPerDay: null,
      maxMinutesPerDay: null,
      maxShiftsPerWeek: null,
      maxMinutesPerWeek: null,
      minimumGapMinutes: 0,
      unknownAgeBehavior: "block",
      unknownCredentialBehavior: "block",
      skillWeight: 35,
      interestWeight: 15,
      languageWeight: 10,
      fairnessWeight: 10,
      reliabilityWeight: 5,
      waitlistPreference: false,
    };
  }

  function readRosterPolicy(): RosterPolicy {
    try {
      const raw = localStorage.getItem(scoped(POLICY_KEY));
      if (!raw) return defaultRosterPolicy();
      const parsed = JSON.parse(raw) as Partial<RosterPolicy>;
      const result = { ...defaultRosterPolicy(), ...parsed };
      validateRosterPolicy(result);
      return result;
    } catch {
      return defaultRosterPolicy();
    }
  }

  function writeRosterPolicy(policy: RosterPolicy): void {
    try {
      localStorage.setItem(scoped(POLICY_KEY), JSON.stringify(policy));
    } catch {
      // Storage can be unavailable in hardened webviews; the run still works.
    }
  }

  function validateRosterPolicy(policy: RosterPolicy): void {
    const limits: [string, number | null, number, number][] = [
      ["Maximum shifts a day", policy.maxShiftsPerDay, 1, 12],
      ["Maximum shifts a week", policy.maxShiftsPerWeek, 1, 40],
      ["Maximum minutes a day", policy.maxMinutesPerDay, 15, 1_440],
      ["Maximum minutes a week", policy.maxMinutesPerWeek, 60, 10_080],
    ];
    for (const [label, value, low, high] of limits) {
      if (value !== null && (!Number.isSafeInteger(value) || value < low || value > high)) {
        throw new Error(`${label} must be between ${low} and ${high}.`);
      }
    }
    if (
      !Number.isSafeInteger(policy.minimumGapMinutes) ||
      policy.minimumGapMinutes < 0 ||
      policy.minimumGapMinutes > 1_440
    ) {
      throw new Error("Keep the minimum time between shifts under 24 hours.");
    }
    const weights = [
      policy.skillWeight,
      policy.interestWeight,
      policy.languageWeight,
      policy.fairnessWeight,
      policy.reliabilityWeight,
    ];
    if (weights.some((weight) => !levels.some((level) => level.weight === weight))) {
      throw new Error("Choose one of the offered match priorities.");
    }
    if (weights.reduce((total, weight) => total + weight, 0) > 100) {
      throw new Error("Those priorities add up past a perfect match. Lower one of them.");
    }
  }

  return { readRosterPolicy, writeRosterPolicy, validateRosterPolicy };
}
