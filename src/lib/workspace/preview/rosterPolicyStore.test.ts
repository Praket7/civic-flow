import { beforeEach, describe, expect, it } from "vitest";
import type { PriorityLevel, RosterPolicy } from "../../../types/domain";
import { createPreviewRosterPolicyStore } from "./rosterPolicyStore";

const levels: PriorityLevel[] = [
  { key: "none", weight: 0 },
  { key: "low", weight: 5 },
  { key: "medium", weight: 10 },
  { key: "high", weight: 15 },
  { key: "top", weight: 35 },
];

describe("preview policy storage and semantic validation", () => {
  let org = "A";
  const store = createPreviewRosterPolicyStore((key) => org + ":" + key, levels);
  beforeEach(() => {
    localStorage.clear();
    org = "A";
  });

  it("isolates policies by organization", () => {
    store.writeRosterPolicy({ ...store.readRosterPolicy(), maxShiftsPerDay: 4 });
    org = "B";
    expect(store.readRosterPolicy().maxShiftsPerDay).toBeNull();
    org = "A";
    expect(store.readRosterPolicy().maxShiftsPerDay).toBe(4);
  });
  it.each([
    { maxShiftsPerDay: 1.5 },
    { maxShiftsPerWeek: Infinity },
    { minimumGapMinutes: -1 },
    { minimumGapMinutes: 8.5 },
    { skillWeight: 999 },
    { maxMinutesPerDay: NaN },
  ])("rejects malformed policy values %j", (patch) => {
    expect(() => store.validateRosterPolicy({ ...store.readRosterPolicy(), ...patch })).toThrow();
  });
  it.each([
    { version: 0 },
    { version: 1.5 },
    { unknownAgeBehavior: "unchecked" },
    { unknownCredentialBehavior: "bypass" },
    { waitlistPreference: "true" },
  ])("rejects invalid policy state and enum values %j", (patch) => {
    const invalid = { ...store.readRosterPolicy(), ...patch } as RosterPolicy;
    expect(() => store.validateRosterPolicy(invalid)).toThrow();
    expect(() => store.writeRosterPolicy(invalid)).toThrow();
    expect(localStorage.getItem("A:civicflow.roster-policy.v1")).toBeNull();
  });
  it("falls back rather than retaining unsafe stored behavior settings", () => {
    const key = "A:civicflow.roster-policy.v1";
    localStorage.setItem(key, '{"unknownAgeBehavior":"unchecked","waitlistPreference":"true"}');
    const recovered = store.readRosterPolicy();
    expect(recovered.unknownAgeBehavior).toBe("block");
    expect(recovered.waitlistPreference).toBe(false);
  });
  it("falls back to safe defaults for corrupt or obsolete saved policies", () => {
    const key = "A:civicflow.roster-policy.v1";
    localStorage.setItem(key, '{"maxShiftsPerDay":0}');
    expect(store.readRosterPolicy().maxShiftsPerDay).toBeNull();
    localStorage.setItem(key, "{");
    expect(store.readRosterPolicy().maxShiftsPerDay).toBeNull();
  });
});
