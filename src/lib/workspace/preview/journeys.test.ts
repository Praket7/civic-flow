import { beforeEach, describe, expect, it } from "vitest";
import { previewRepository as repository } from "../previewRepository";
import { demoWorkspace } from "../dataset";
import type { RosterOptions } from "../../../types/domain";

const options: RosterOptions = {
  preferSpanish: false,
  blockConflicts: true,
  capWeekly: false,
  includeWaitlist: true,
};

describe("connected sample journey", () => {
  beforeEach(async () => {
    await repository.resetDemo();
  });

  async function createProgram() {
    const { opportunity } = await repository.createOpportunity({
      title: "Journey acceptance program",
      cause: "community",
      description: "A reproducible community service shift for the isolated sample.",
      address: "214 Rivergate Avenue, Buffalo, NY",
      capacity: 2,
      duration: "2 hours",
      requirements: [],
    });
    const { shifts } = await repository.createShiftSeries(
      opportunity.id,
      {
        kind: "none",
        intervalWeeks: 1,
        weekdays: [],
        startsLocalTime: "08:00",
        durationMinutes: 120,
        startsOn: "2026-10-13",
        endsOn: null,
        occurrenceCount: null,
      },
      [{ name: "General support", required: 1 }],
    );
    return { opportunity, shift: shifts[0] };
  }

  it("creates, registers, checks in, checks out, reviews and reconciles one new program", async () => {
    const { opportunity, shift } = await createProgram();
    const initial = await repository.autoRoster([shift.id], options);
    const applicant = initial.assignments[0].candidateId;
    await repository.joinWaitlist(shift.id, applicant, "General support", true);
    const waiting = await repository.getSnapshot();
    expect(waiting.waitlist.find(row => row.shiftId === shift.id)?.requestReview).toBe(true);
    expect(waiting.registrations.some(row => row.shiftId === shift.id)).toBe(false);
    const plan = await repository.autoRoster([shift.id], options);
    expect(plan.slotsConsidered).toBe(1);
    const assignment = plan.assignments[0];
    expect(assignment).toBeDefined();
    expect(assignment.candidateId).toBe(applicant);
    expect(assignment.promoteWaitlist).toBe(true);
    await repository.applyRosterWeek(plan.revision, plan.policyVersion, [
      {
        shiftId: shift.id,
        candidateId: assignment.candidateId,
        role: assignment.role,
        promoteWaitlist: assignment.promoteWaitlist,
      },
    ]);
    const id = assignment.candidateId;
    const registered = await repository.getSnapshot();
    expect(registered.registrations.filter((row) => row.shiftId === shift.id)).toHaveLength(1);
    expect(registered.waitlist.find(row => row.shiftId === shift.id)?.status).toBe("promoted");
    expect(registered.journeyNotifications?.some(row => row.volunteerId === applicant && row.title === "Shift assignment confirmed")).toBe(true);
    expect(await repository.registerForShift(shift.id, id, assignment.role)).toEqual(registered);
    await expect(repository.checkOut(shift.id, id)).rejects.toThrow(/before checking/);
    const code = await repository.getCheckinCode(shift.id);
    const wrong = code.code === "000000" ? "111111" : "000000";
    await expect(repository.checkIn(shift.id, id, wrong)).rejects.toThrow(/not valid/);
    await repository.checkIn(shift.id, id, code.code);
    const checked = await repository.checkOut(shift.id, id);
    expect(await repository.checkOut(shift.id, id)).toEqual(checked);
    const service = checked.submittedHours?.find((row) => row.shiftId === shift.id);
    expect(service?.status).toBe("pending");
    expect(service?.minutes).toBeGreaterThan(0);
    const request = {
      template: "custom",
      fields: ["recordId", "program", "status", "hours"],
      dateStart: "2026-10-13",
      dateEnd: "2026-10-13",
      programId: opportunity.id,
      groupBy: "none" as const,
    };
    expect((await repository.generateReport(request)).rows).toEqual([
      [service?.id, opportunity.title, "pending", ""],
    ]);
    await repository.reviewHours(service!.id, {
      status: "verified",
      approvedMinutes: service!.minutes,
      reason: "Attendance verified",
      reviewedAt: demoWorkspace.now,
    });
    const report = await repository.generateReport(request);
    expect(report.rows).toEqual([
      [service?.id, opportunity.title, "verified", String(service?.minutes)],
    ]);
    await expect(
      repository.reviewHours(service!.id, {
        status: "rejected",
        approvedMinutes: null,
        reason: "Second decision",
        reviewedAt: demoWorkspace.now,
      }),
    ).rejects.toThrow(/pending/);
    const coverage = await repository.generateReport({ ...request, template: "coverage" });
    expect(coverage.rows[0].slice(1, 6)).toEqual([
      opportunity.title,
      "General support",
      "1",
      "1",
      "0",
    ]);
    const attendance = await repository.generateReport({ ...request, template: "attendance" });
    expect(attendance.rows[0][4]).toBe("completed");
  });

  it("refuses a full role and duplicate waitlist entry, then releases a seat only once", async () => {
    const { shift } = await createProgram();
    const plan = await repository.autoRoster([shift.id], options);
    const id = plan.assignments[0].candidateId;
    const other = demoWorkspace.volunteers.find(
      (v) =>
        v.id !== id &&
        v.status === "active" &&
        !demoWorkspace.registrations.some(
          (r) => r.volunteerId === v.id && r.shiftId === "sh-tue-pantry",
        ),
    )!;
    await repository.registerForShift(shift.id, id, "General support");
    await expect(
      repository.registerForShift(shift.id, other.id, "General support"),
    ).rejects.toThrow(/full/);
    await repository.joinWaitlist(shift.id, other.id, "General support");
    const waiting = await repository.joinWaitlist(shift.id, other.id, "General support");
    expect(waiting.waitlist.filter((row) => row.shiftId === shift.id)).toHaveLength(1);
    const released = await repository.cancelRegistration(shift.id, id, "Plans changed");
    expect(await repository.cancelRegistration(shift.id, id, "Repeated request")).toEqual(released);
    expect(
      released.registrations.filter(
        (row) => row.shiftId === shift.id && row.status === "registered",
      ),
    ).toHaveLength(1);
    expect(
      released.journeyNotifications?.some(
        (row) => row.volunteerId === other.id && row.kind === "WAITLIST_PROMOTED",
      ),
    ).toBe(true);
  });

  it("rejects credentials whose validity starts after the shift", async () => {
    const evaluation = await repository.evaluateRoster(["sh-sat-food"], options);
    const futureDriver = evaluation.candidates.find(
      (candidate) => candidate.candidateId === "vol-014",
    );
    expect(futureDriver).toBeDefined();
    const driver = futureDriver!.slots.find((slot) => slot.role === "Driver");
    expect(driver?.checks.find((check) => check.name === "Required credential")?.passed).toBe(
      false,
    );
    expect(driver?.eligible).toBe(false);
    await expect(repository.registerForShift("sh-sat-food", "vol-014", "Driver")).rejects.toThrow();
  });

  it("rejects an ineligible driver and does not mutate the snapshot", async () => {
    const before = await repository.getSnapshot();
    await expect(
      repository.registerForShift("sh-sat-food", "vol-maya", "Driver"),
    ).rejects.toThrow();
    expect(await repository.getSnapshot()).toEqual(before);
    await expect(
      repository.applyRoster("sh-sat-food", [
        { candidateId: "vol-maya", role: "Driver", promoteWaitlist: false },
      ]),
    ).rejects.toThrow();
    expect(await repository.getSnapshot()).toEqual(before);
  });
});
