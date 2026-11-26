import { describe, expect, it } from "vitest";
import fixture from "../../../../shared/roster-policy-cases.json";
import type {
  Credential,
  RosterOptions,
  RosterPolicy,
  Shift,
  Volunteer,
} from "../../../types/domain";
import { demoWorkspace } from "../dataset";
import { previewDayKey, previewPeriod } from "../dates";
import { createDefaultSnapshot } from "../previewRepository";
import { createPreviewRosterEngine } from "./rosterEngine";
import { createPreviewRosterPolicyStore } from "./rosterPolicyStore";

interface PolicyCase {
  name: string;
  score: number | null;
  skills?: string[];
  credential?: keyof typeof fixture.credentials | "missing";
  booking?: keyof typeof fixture.bookings;
  birthdate?: string;
  availability?: "none" | "partial";
  policy?: Partial<RosterPolicy>;
  options?: Partial<RosterOptions>;
}

const options: RosterOptions = {
  preferSpanish: false,
  blockConflicts: true,
  capWeekly: false,
  includeWaitlist: false,
};

describe("shared native/browser roster policy contract", () => {
  for (const sample of fixture.cases as PolicyCase[]) {
    it(sample.name, () => {
      const volunteer: Volunteer = {
        ...demoWorkspace.volunteers[0],
        id: "policy-person",
        birthdate: sample.birthdate ?? "1990-01-01",
        status: "active",
        skills: sample.skills ?? ["Driver"],
        languages: ["English"],
        causes: ["food"],
        attendanceRate: 100,
        eventsCompleted: 4,
        availability:
          sample.availability === "none"
            ? []
            : [{ day: "sat", period: sample.availability === "partial" ? "afternoon" : "morning" }],
      };
      const shift: Shift = {
        id: "policy-shift",
        opportunityId: "opp-food",
        startsAt: "2026-10-17T09:00:00-04:00",
        endsAt: "2026-10-17T12:00:00-04:00",
        capacity: 1,
        confirmed: 0,
        waitlisted: 0,
        status: "scheduled",
        roles: [{ name: "Driver", required: 1, filled: 0 }],
      };
      const bookings = sample.booking ? fixture.bookings[sample.booking] : [];
      const booked = bookings.map((row) => ({
        ...shift,
        id: row.shiftId,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
      }));
      const credentials: Credential[] =
        sample.credential === "missing"
          ? []
          : [
              {
                ...demoWorkspace.credentials[0],
                ...fixture.credentials[sample.credential ?? "current"],
                volunteerId: volunteer.id,
                name: "Safe driver clearance",
              },
            ];
      const defaults = createPreviewRosterPolicyStore(() => "parity-test-policy", []);
      const policy = { ...defaults.readRosterPolicy(), ...sample.policy };
      const engine = createPreviewRosterEngine({
        workspace: {
          ...demoWorkspace,
          volunteers: [volunteer],
          shifts: [shift, ...booked],
        },
        state: {
          ...createDefaultSnapshot(),
          waitlist: [],
          credentials,
          registrations: booked.map((row) => ({
            shiftId: row.id,
            volunteerId: volunteer.id,
            role: "Driver",
            status: "registered",
          })),
        },
        revision: 1,
        readRosterPolicy: () => policy,
        previewDayKey,
        previewPeriod,
      });
      const result = engine.previewEvaluation([shift.id], { ...options, ...sample.options });
      const evaluated = result.candidates[0].slots[0];
      expect(evaluated.eligible).toBe(sample.score !== null);
      expect(evaluated.score).toBe(sample.score);
      expect(result.plan.assignments).toHaveLength(sample.score === null ? 0 : 1);
    });
  }
});
