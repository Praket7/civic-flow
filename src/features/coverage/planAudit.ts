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
  workload: { minimum: number; maximum: number; spread: number; candidates: number } | null;
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
  let provisionalAvailability = 0;
  let score = 0;

  for (const assignment of plan.assignments) {
    score += assignment.score;
    const explanation = assignment.explanation;
    if (
      !explanation ||
      !explanation.eligible ||
      !explanation.selected ||
      explanation.candidateId !== assignment.candidateI¶»§q«^