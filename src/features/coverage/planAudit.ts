import type { RosterPlan } from "../../types/domain";
import type { Candidate } from "./autoRosterModel";

/**
 * Independent, read-only audit of the *proposal*. It never certifies a roster
 * as fair to protected groups or a score as a probability.
 * The authoritative native/preview solver and transactional apply path remain
 * responsible for enforcing constraints on the latest workspace revision.
 */
export interface PlanAudit {
  openSeats: number;
  proposed: number;
  remaining: number;
  fillRate: number | null;
  score: number;
  scoreAverage: number | null;
  distinctPeople: number;
  provisionalAvailability: number;
  workload: {
    baselineMinimum: number;
    baselineMaximum: number;
    baselineSpread: number;
    minimum: number;
    maximum: number;
    spread: number;
    spreadChange: number;
    meanBefore: number;
    meanAfter: number;
    candidates: number;
  } | null;
  issues: string[];
  safeToApply: boolean;
  unfilledReasons: { reason: string; count: number }[];
}

export function auditRosterPlan(plan: RosterPlan, candidates: Candidate[]): PlanAudit {
  const issues: string[] = [];
  const slotIds = new Set<string>();
  const volunteerShifts = new Set<string>();
  const plannedByVolunteer = new Map<string, number>();
  const knownCandidates = new Map(candidates.map((row) => [row.volunteer.id, row]));
  if (knownCandidates.size !== candidates.length) {
    issues.push("The candidate pool contains duplicate volunteer identifiers.");
  }
  if (
    candidates.some(
      (candidate) => !Number.isSafeInteger(candidate.weeklyShifts) || candidate.weeklyShifts < 0,
    )
  ) {
    issues.push("A volunteer has invalid weekly workload data.");
  }
  if (!Number.isSafeInteger(plan.slotsConsidered) || plan.slotsConsidered < 0) {
    issues.push("The plan contains an invalid open-seat count.");
  }
  if (!Number.isFinite(plan.totalScore)) {
    issues.push("The plan contains a nonfinite total score.");
  }
  let provisionalAvailability = 0;
  let score = 0;

  for (const assignment of plan.assignments) {
    score += assignment.score;
    const explanation = assignment.explanation;
    if (!Number.isFinite(assignment.score) || !Number.isFinite(explanation?.totalScore)) {
      issues.push("An assignment contains a nonfinite weighted match score.");
    }
    if (
      !explanation ||
      !knownCandidates.has(assignment.candidateId) ||
      !explanation.eligible ||
      !explanation.selected ||
      explanation.candidateId !== assignment.candidateId ||
      explanation.shiftId !== assignment.shiftId ||
      explanation.totalScore !== assignment.score ||
      explanation.checks.some((check) => !check.passed)
    ) {
      issues.push("An assignment has inconsistent eligibility or explanation evidence.");
    }

    const slotId = explanation?.slotId;
    if (!slotId || slotIds.has(slotId)) {
      issues.push("A seat is missing its unique identifier or appears more than once.");
    } else {
      slotIds.add(slotId);
    }

    const volunteerShift = JSON.stringify([assignment.candidateId, assignment.shiftId]);
    if (volunteerShifts.has(volunteerShift)) {
      issues.push("A volunteer was proposed for more than one role in the same shift.");
    }
    volunteerShifts.add(volunteerShift);
    plannedByVolunteer.set(
      assignment.candidateId,
      (plannedByVolunteer.get(assignment.candidateId) ?? 0) + 1,
    );

    if (knownCandidates.get(assignment.candidateId)?.availability === "unknown") {
      provisionalAvailability += 1;
    }
  }

  if (plan.slotsConsidered !== plan.assignments.length + plan.unfilled.length) {
    issues.push("Proposed assignments and unfilled seats do not reconcile with the plan scope.");
  }
  if (score !== plan.totalScore) {
    issues.push("Individual match scores do not reconcile with the recorded plan total.");
  }

  const baselineLoads = candidates.map((candidate) => candidate.weeklyShifts);
  const projectedLoads = candidates.map(
    (candidate) => candidate.weeklyShifts + (plannedByVolunteer.get(candidate.volunteer.id) ?? 0),
  );
  const validLoads =
    projectedLoads.length > 0 &&
    [...baselineLoads, ...projectedLoads].every((load) => Number.isSafeInteger(load) && load >= 0);
  if (projectedLoads.length > 0 && !validLoads) {
    issues.push("Projected volunteer workload is invalid.");
  }
  const baselineMinimum = validLoads ? Math.min(...baselineLoads) : 0;
  const baselineMaximum = validLoads ? Math.max(...baselineLoads) : 0;
  const minimum = validLoads ? Math.min(...projectedLoads) : 0;
  const maximum = validLoads ? Math.max(...projectedLoads) : 0;
  const mean = (values: number[]) =>
    Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
  const reasons = new Map<string, number>();
  for (const slot of plan.unfilled) {
    const reason = slot.reason.trim() || "No eligible volunteer";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const uniqueIssues = [...new Set(issues)];

  return {
    openSeats: plan.slotsConsidered,
    proposed: plan.assignments.length,
    remaining: plan.unfilled.length,
    fillRate:
      plan.slotsConsidered > 0
        ? Math.round((plan.assignments.length / plan.slotsConsidered) * 100)
        : null,
    score,
    scoreAverage:
      plan.assignments.length > 0 && Number.isFinite(score)
        ? Math.round((score / plan.assignments.length) * 10) / 10
        : null,
    distinctPeople: plannedByVolunteer.size,
    provisionalAvailability,
    workload: validLoads
      ? {
          baselineMinimum,
          baselineMaximum,
          baselineSpread: baselineMaximum - baselineMinimum,
          minimum,
          maximum,
          spread: maximum - minimum,
          spreadChange: maximum - minimum - (baselineMaximum - baselineMinimum),
          meanBefore: mean(baselineLoads),
          meanAfter: mean(projectedLoads),
          candidates: projectedLoads.length,
        }
      : null,
    issues: uniqueIssues,
    safeToApply: uniqueIssues.length === 0,
    unfilledReasons: [...reasons]
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
  };
}
