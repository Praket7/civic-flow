import type {
  CandidateAnswer,
  Credential,
  CandidateEvaluation,
  ConstraintCheck,
  DemoWorkspace,
  EvaluatedSlot,
  ForcedComparison,
  MatchExplanation,
  PlannedAssignment,
  RosterEvaluation,
  RosterOptions,
  RosterPlan,
  RosterPolicy,
  ScoreComponent,
  SessionSnapshot,
  Volunteer,
} from "../../../types/domain";
import { validIsoDate } from "../dates";

export function roleRequirement(role: string): {
  skill: string;
  credential: string | null;
  minimumAge?: number;
} {
  const lower = role.toLowerCase();
  if (lower.includes("spanish")) return { skill: "Spanish", credential: null };
  if (lower.includes("driver") || lower.includes("delivery")) {
    return { skill: "Driver", credential: "Safe driver clearance", minimumAge: 18 };
  }
  if (lower.includes("tutor"))
    return { skill: "Tutoring", credential: "Tutor certification", minimumAge: 16 };
  if (lower.includes("food") || lower.includes("pantry") || lower.includes("sort")) {
    return { skill: "Food handling", credential: "Food safety handler" };
  }
  if (lower.includes("garden") || lower.includes("tool")) {
    return { skill: "Gardening", credential: "Garden tool safety" };
  }
  return { skill: "", credential: null };
}

export function hasRosterSkill(volunteer: Volunteer, skill: string): boolean {
  return volunteer.skills.some((value) => value.toLowerCase() === skill.toLowerCase());
}

export function validRosterCredential(credential: Credential, on: string): boolean {
  const from = credential.validFrom.slice(0, 10);
  const through = credential.validThrough.slice(0, 10);
  return Boolean(
    credential.verifiedAt?.trim() &&
    validIsoDate(from) &&
    validIsoDate(through) &&
    from <= on &&
    through >= on,
  );
}

export function rosterAgeOn(birthday: string | null | undefined, on: string): number | null {
  if (!birthday || !validIsoDate(birthday)) return null;
  return (
    Number(on.slice(0, 4)) - Number(birthday.slice(0, 4)) - Number(on.slice(5) < birthday.slice(5))
  );
}

/** Demo-only matching implementation; native Rust remains the production authority. */
export function createPreviewRosterEngine(context: {
  workspace: DemoWorkspace;
  state: SessionSnapshot;
  revision: number;
  readRosterPolicy: () => RosterPolicy;
  previewDayKey: (stamp: string) => string;
  previewPeriod: (stamp: string) => string;
}) {
  const { workspace, state, revision, readRosterPolicy, previewDayKey, previewPeriod } = context;
  interface PreviewSeat {
    slotId: string;
    shiftId: string;
    opportunityId: string;
    shiftTitle: string;
    role: string;
    cause: string;
    startsAt: string;
    endsAt: string;
    dayKey: string;
    requiredSkill: string;
    requiredCredential: string | null;
    minimumAge?: number;
  }

  interface PreviewBlock {
    start: number;
    end: number;
    shiftId: string;
    day: string;
  }

  interface PreviewLoad {
    blocks: Map<string, PreviewBlock[]>;
    weekMinutes: Map<string, number>;
    weekCount: Map<string, number>;
  }

  interface PreviewChoice {
    seat: PreviewSeat;
    volunteer: Volunteer;
    checks: ConstraintCheck[];
    components: ScoreComponent[];
    score: number;
  }

  interface PreviewPlanShape {
    choices: PreviewChoice[];
    unfilled: { seat: PreviewSeat; reason: string }[];
  }

  /**
   * The skill and credential a role demands, by the same name rules the Rust
   * core applies when it seeds requirements. The browser has to agree with the
   * desktop here, otherwise the preview would show a different shortlist than
   * the optimizer actually used.
   */

  function previewSeats(shiftIds: string[]): PreviewSeat[] {
    const seats: PreviewSeat[] = [];
    for (const shift of workspace.shifts.filter(
      (row) =>
        (!shiftIds.length || shiftIds.includes(row.id)) &&
        row.status === "scheduled" &&
        Date.parse(row.startsAt) > Date.parse(workspace.now),
    )) {
      const opportunity = workspace.opportunities.find((row) => row.id === shift.opportunityId);
      const live = state.registrations.filter(
        (row) => row.shiftId === shift.id && row.status === "registered",
      );
      for (const role of shift.roles) {
        const requirement = roleRequirement(role.name);
        const filled = live.filter((row) => row.role === role.name).length;
        for (let seat = 0; seat < Math.max(0, role.required - filled); seat += 1) {
          seats.push({
            slotId: `${shift.id}-${role.name}-${seat + 1}`,
            shiftId: shift.id,
            opportunityId: shift.opportunityId,
            shiftTitle: opportunity?.title ?? "Shift",
            role: role.name,
            cause: opportunity?.cause ?? "food",
            startsAt: shift.startsAt,
            endsAt: shift.endsAt,
            dayKey: previewDayKey(shift.startsAt),
            requiredSkill: requirement.skill,
            requiredCredential: requirement.credential,
            minimumAge: requirement.minimumAge,
          });
        }
      }
    }
    return seats;
  }

  function emptyLoad(): PreviewLoad {
    return { blocks: new Map(), weekMinutes: new Map(), weekCount: new Map() };
  }

  function cloneLoad(load: PreviewLoad): PreviewLoad {
    return {
      blocks: new Map([...load.blocks].map(([volunteerId, blocks]) => [volunteerId, [...blocks]])),
      weekMinutes: new Map(load.weekMinutes),
      weekCount: new Map(load.weekCount),
    };
  }

  /**
   * Everything the roster already holds: blocks for overlap checks, plus the
   * day and week counts the limits read. Building it once keeps the plan and the
   * candidate browser on the same starting point.
   */
  function previewBaseLoad(): PreviewLoad {
    const load = emptyLoad();
    const now = new Date(workspace.now).getTime();
    const horizon = now + 7 * 86_400_000;
    const shifts = new Map(workspace.shifts.map((shift) => [shift.id, shift]));
    for (const registration of state.registrations) {
      if (registration.status !== "registered") continue;
      const shift = shifts.get(registration.shiftId);
      if (!shift) continue;
      const start = new Date(shift.startsAt).getTime();
      const blocks = load.blocks.get(registration.volunteerId) ?? [];
      const end = Date.parse(shift.endsAt);
      blocks.push({ start, end, shiftId: shift.id, day: shift.startsAt.slice(0, 10) });
      load.blocks.set(registration.volunteerId, blocks);
      if (start < now || start > horizon) continue;
      load.weekMinutes.set(
        registration.volunteerId,
        (load.weekMinutes.get(registration.volunteerId) ?? 0) + Math.max(0, (end - start) / 60000),
      );
      load.weekCount.set(
        registration.volunteerId,
        (load.weekCount.get(registration.volunteerId) ?? 0) + 1,
      );
    }
    return load;
  }

  const baseLoad = previewBaseLoad();

  function previewAvailability(volunteer: Volunteer, seat: PreviewSeat): boolean {
    return previewAvailabilityState(volunteer, seat) === "available";
  }

  function previewChecks(
    volunteer: Volunteer,
    seat: PreviewSeat,
    options: RosterOptions,
    policy: RosterPolicy,
    load: PreviewLoad,
  ): ConstraintCheck[] {
    const checks: ConstraintCheck[] = [];
    const blocks = load.blocks.get(volunteer.id) ?? [];
    const registered = blocks.some((block) => block.shiftId === seat.shiftId);
    checks.push({
      name: "Already on this shift",
      passed: !registered,
      detail: registered
        ? "This volunteer is already registered for the shift"
        : "Not registered yet",
    });
    if (seat.requiredSkill) {
      const skillMatch = hasRosterSkill(volunteer, seat.requiredSkill);
      checks.push({
        name: "Required skill",
        passed: skillMatch,
        detail: skillMatch ? `${seat.requiredSkill} on the profile` : `Needs ${seat.requiredSkill}`,
      });
    }

    if (seat.requiredCredential) {
      const on = seat.startsAt.slice(0, 10);
      const held = state.credentials.filter(
        (row) =>
          row.volunteerId === volunteer.id &&
          row.name.toLowerCase() === seat.requiredCredential!.toLowerCase(),
      );
      const current = held.some((row) => validRosterCredential(row, on));
      const expired = !current && held.length > 0;
      checks.push({
        name: "Required credential",
        passed: current || (!held.length && policy.unknownCredentialBehavior === "allow"),
        detail: current
          ? `${seat.requiredCredential} current`
          : expired
            ? `${seat.requiredCredential} expired`
            : `No ${seat.requiredCredential} on record${policy.unknownCredentialBehavior === "allow" ? "; the policy allows this" : ""}`,
      });
    }

    if (seat.minimumAge !== undefined) {
      const age = rosterAgeOn(volunteer.birthdate, seat.startsAt.slice(0, 10));
      checks.push({
        name: "Minimum age",
        passed: age === null ? policy.unknownAgeBehavior === "allow" : age >= seat.minimumAge,
        detail: age === null ? "No birthdate on record" : `${age} on the shift date`,
      });
    }

    const available = previewAvailability(volunteer, seat);
    checks.push({
      name: "Availability",
      passed: available,
      detail: available
        ? `Available ${seat.dayKey.toUpperCase()} ${previewPeriod(seat.startsAt)}`
        : `Not available ${seat.dayKey.toUpperCase()} ${previewPeriod(seat.startsAt)}`,
    });

    const start = Date.parse(seat.startsAt);
    const end = Date.parse(seat.endsAt);
    const minutes = Math.max(0, (end - start) / 60000);
    if (options.blockConflicts) {
      const clash = blocks.some((block) => block.start < end && block.end > start);
      checks.push({
        name: "No overlapping shift",
        passed: !clash,
        detail: clash ? "Already booked at this time" : "No shift overlaps this time",
      });
    }

    if (options.blockConflicts && policy.minimumGapMinutes > 0) {
      const tooClose = blocks.some(
        (block) =>
          (block.end <= start && start - block.end < policy.minimumGapMinutes * 60000) ||
          (block.start >= end && block.start - end < policy.minimumGapMinutes * 60000),
      );
      checks.push({
        name: "Rest between shifts",
        passed: !tooClose,
        detail: `At least ${policy.minimumGapMinutes} minutes either side`,
      });
    }
    const sameDay = blocks.filter((block) => block.day === seat.startsAt.slice(0, 10));
    const limit = (name: string, used: number, cap: number | null) => {
      if (cap !== null) checks.push({ name, passed: used <= cap, detail: `${used} of ${cap}` });
    };
    limit("Daily shift limit", sameDay.length + 1, policy.maxShiftsPerDay);
    limit(
      "Daily minute limit",
      sameDay.reduce((total, block) => total + (block.end - block.start) / 60000, minutes),
      policy.maxMinutesPerDay,
    );
    const weekLimit = options.capWeekly
      ? Math.min(policy.maxShiftsPerWeek ?? 2, 2)
      : policy.maxShiftsPerWeek;
    limit("Weekly shift limit", (load.weekCount.get(volunteer.id) ?? 0) + 1, weekLimit);
    limit(
      "Weekly minute limit",
      (load.weekMinutes.get(volunteer.id) ?? 0) + minutes,
      policy.maxMinutesPerWeek,
    );
    return checks;
  }

  function previewShare(weight: number, numerator: number, denominator: number): number {
    return Math.floor((weight * numerator) / denominator);
  }

  function previewScore(
    volunteer: Volunteer,
    seat: PreviewSeat,
    options: RosterOptions,
    policy: RosterPolicy,
  ): { components: ScoreComponent[]; total: number } {
    const skillMatches = !seat.requiredSkill || hasRosterSkill(volunteer, seat.requiredSkill);
    // A role with no requirement fits anyone eligible, slightly less precisely
    // than a matched requirement, which is how the solver scores it too.
    const skill = seat.requiredSkill
      ? skillMatches
        ? policy.skillWeight
        : 0
      : previewShare(policy.skillWeight, 6, 7);
    const availability = 25;
    const interest = volunteer.causes.includes(seat.cause as Volunteer["causes"][number])
      ? policy.interestWeight
      : 0;
    const spanish = volunteer.languages.includes("Spanish") || hasRosterSkill(volunteer, "Spanish");
    const preference =
      seat.role.toLowerCase().includes("spanish") && spanish
        ? policy.languageWeight
        : options.preferSpanish && spanish
          ? previewShare(policy.languageWeight, 8, 10)
          : previewShare(policy.languageWeight, 6, 10);
    const weekShifts = baseLoad.weekCount.get(volunteer.id) ?? 0;
    const fairness = previewShare(policy.fairnessWeight, 10 - Math.min(weekShifts, 4) * 2, 10);
    const reliability =
      volunteer.eventsCompleted === 0
        ? previewShare(policy.reliabilityWeight, 3, 5)
        : Math.round((volunteer.attendanceRate / 100) * policy.reliabilityWeight);
    const components: ScoreComponent[] = [
      { label: "Skill", awarded: skill, maximum: policy.skillWeight },
      { label: "Availability", awarded: availability, maximum: 25 },
      { label: "Interest", awarded: interest, maximum: policy.interestWeight },
      { label: "Language", awarded: preference, maximum: policy.languageWeight },
      { label: "Fairness", awarded: fairness, maximum: policy.fairnessWeight },
      { label: "Reliability", awarded: reliability, maximum: policy.reliabilityWeight },
    ];
    const total = Math.max(
      0,
      Math.min(
        100,
        components.reduce((sum, component) => sum + component.awarded, 0),
      ),
    );
    return { components, total };
  }

  const PREVIEW_MAX_WEIGHT = 100;

  function previewBreakdown(components: ScoreComponent[]) {
    const value = (label: string) =>
      components.find((component) => component.label === label)?.awarded ?? 0;
    return {
      skill: value("Skill"),
      availability: value("Availability"),
      interest: value("Interest"),
      preference: value("Language"),
      fairness: value("Fairness"),
      reliability: value("Reliability"),
      total: Math.max(
        0,
        Math.min(
          PREVIEW_MAX_WEIGHT,
          components.reduce((sum, row) => sum + row.awarded, 0),
        ),
      ),
    };
  }

  function previewReason(choice: PreviewChoice): string {
    const parts: string[] = [
      choice.seat.requiredSkill
        ? `matches the required ${choice.seat.requiredSkill} skill`
        : "needs no special skill",
    ];
    if (choice.volunteer.causes.includes(choice.seat.cause as Volunteer["causes"][number])) {
      parts.push(`is interested in ${choice.seat.cause}`);
    }
    if (choice.volunteer.attendanceRate >= 80) {
      parts.push(`has ${choice.volunteer.attendanceRate}% attendance`);
    }
    return `${choice.volunteer.name} ${parts.join(", ")}`;
  }

  /**
   * One pass over open seats. `forced` pins a volunteer, as the Rust planner does.
   */
  function waitlisted(volunteerId: string, seat: PreviewSeat): boolean {
    return state.waitlist.some(
      (row) =>
        row.status === "waiting" && row.shiftId === seat.shiftId && row.volunteerId === volunteerId,
    );
  }

  function candidates(options: RosterOptions) {
    return workspace.volunteers.filter(
      (volunteer) =>
        volunteer.status === "active" &&
        (options.includeWaitlist ||
          !state.waitlist.some(
            (row) => row.volunteerId === volunteer.id && row.status === "waiting",
          )),
    );
  }

  function previewPlanShape(
    shiftIds: string[],
    options: RosterOptions,
    policy: RosterPolicy,
    forced?: { candidateId: string; slotId: string },
  ): PreviewPlanShape {
    const seats = previewSeats(shiftIds);
    const pool = candidates(options);
    const load = cloneLoad(baseLoad);
    const choices: PreviewChoice[] = [];
    const unfilled: { seat: PreviewSeat; reason: string }[] = [];

    for (const seat of seats) {
      const isForcedSeat = forced?.slotId === seat.slotId;
      const considered = isForcedSeat
        ? pool.filter((volunteer) => volunteer.id === forced?.candidateId)
        : pool.filter((volunteer) => volunteer.id !== forced?.candidateId);

      let best: PreviewChoice | null = null;
      for (const volunteer of considered) {
        const checks = previewChecks(volunteer, seat, options, policy, load);
        if (checks.some((check) => !check.passed)) continue;
        const { components, total } = previewScore(volunteer, seat, options, policy);
        const requested =
          policy.waitlistPreference && options.includeWaitlist && waitlisted(volunteer.id, seat);
        const bestRequested =
          best &&
          policy.waitlistPreference &&
          options.includeWaitlist &&
          waitlisted(best.volunteer.id, seat);
        if (
          !best ||
          (requested && !bestRequested) ||
          (requested === Boolean(bestRequested) && total > best.score)
        ) {
          best = { seat, volunteer, checks, components, score: total };
        }
      }

      if (!best) {
        unfilled.push({
          seat,
          reason: isForcedSeat
            ? "The chosen volunteer does not clear the current rules for this seat."
            : "No eligible volunteer is available for this slot.",
        });
        continue;
      }

      choices.push(best);
      const blocks = load.blocks.get(best.volunteer.id) ?? [];
      blocks.push({
        start: new Date(seat.startsAt).getTime(),
        end: Date.parse(seat.endsAt),
        shiftId: seat.shiftId,
        day: seat.startsAt.slice(0, 10),
      });
      load.blocks.set(best.volunteer.id, blocks);
      load.weekMinutes.set(
        best.volunteer.id,
        (load.weekMinutes.get(best.volunteer.id) ?? 0) +
          Math.max(0, (Date.parse(seat.endsAt) - Date.parse(seat.startsAt)) / 60000),
      );
      load.weekCount.set(best.volunteer.id, (load.weekCount.get(best.volunteer.id) ?? 0) + 1);
    }

    return { choices, unfilled };
  }

  function previewExplanation(
    volunteer: Volunteer,
    seat: PreviewSeat,
    options: RosterOptions,
    policy: RosterPolicy,
    load: PreviewLoad,
    selected: boolean,
  ): MatchExplanation {
    const checks = previewChecks(volunteer, seat, options, policy, load);
    const { components, total } = previewScore(volunteer, seat, options, policy);
    return choiceExplanation({ seat, volunteer, checks, components, score: total }, selected);
  }

  function choiceExplanation(choice: PreviewChoice, selected: boolean): MatchExplanation {
    const { volunteer, seat, checks, components, score } = choice;
    const eligible = checks.every((check) => check.passed);
    return {
      candidateId: volunteer.id,
      candidateName: volunteer.name,
      candidateInitials: volunteer.initials,
      slotId: seat.slotId,
      shiftId: seat.shiftId,
      role: seat.role,
      eligible,
      checks,
      components,
      totalScore: eligible ? score : null,
      selected,
      selectionReason: eligible
        ? previewReason(choice)
        : `${volunteer.name} failed one requirement — ${
            checks.find((check) => !check.passed)?.name.toLowerCase() ?? "eligibility"
          }`,
    };
  }

  function previewRequiredFilled(shape: PreviewPlanShape): number {
    return shape.choices.filter(({ seat }) => seat.requiredSkill || seat.requiredCredential)
      .length;
  }

  function previewComparison(
    before: PreviewPlanShape,
    after: PreviewPlanShape,
    volunteer: Volunteer,
    seat: PreviewSeat,
  ): ForcedComparison {
    const beforeBySlot = new Map(before.choices.map((choice) => [choice.seat.slotId, choice]));
    const afterBySlot = new Map(after.choices.map((choice) => [choice.seat.slotId, choice]));
    const changedAssignments: ForcedComparison["changedAssignments"] = [];
    const becomesUncovered: string[] = [];

    for (const [slotId, choice] of beforeBySlot) {
      const now = afterBySlot.get(slotId);
      if (now?.volunteer.id === choice.volunteer.id) continue;
      if (!now) becomesUncovered.push(`${choice.seat.role} on ${choice.seat.shiftTitle}`);
      changedAssignments.push({
        kind: now ? "moved" : "lost",
        shiftId: choice.seat.shiftId,
        shiftTitle: choice.seat.shiftTitle,
        role: choice.seat.role,
        fromCandidate: choice.volunteer.id,
        toCandidate: now?.volunteer.id ?? null,
      });
    }
    for (const [slotId, choice] of afterBySlot) {
      if (beforeBySlot.has(slotId)) continue;
      changedAssignments.push({
        kind: "gained",
        shiftId: choice.seat.shiftId,
        shiftTitle: choice.seat.shiftTitle,
        role: choice.seat.role,
        fromCandidate: null,
        toCandidate: choice.volunteer.id,
      });
    }

    const summary = [
      `Forcing ${volunteer.name} into ${seat.role}: required seats filled ${previewRequiredFilled(
        before,
      )} to ${previewRequiredFilled(after)}`,
    ];
    const score = (shape: PreviewPlanShape) =>
      shape.choices.reduce((total, choice) => total + choice.score, 0);
    if (score(before) !== score(after)) {
      summary.push(`Total match score ${score(before)} to ${score(after)}`);
    }
    summary.push(
      becomesUncovered.length === 0
        ? "No seat loses its volunteer"
        : `Uncovered: ${becomesUncovered.join(", ")}`,
    );

    return {
      candidateId: volunteer.id,
      candidateName: volunteer.name,
      slotId: seat.slotId,
      shiftId: seat.shiftId,
      role: seat.role,
      filledBefore: before.choices.length,
      filledAfter: after.choices.length,
      requiredFilledBefore: previewRequiredFilled(before),
      requiredFilledAfter: previewRequiredFilled(after),
      totalScoreBefore: score(before),
      totalScoreAfter: score(after),
      changedAssignments,
      becomesUncovered,
      summary,
    };
  }

  function previewRosterPlan(
    shiftIds: string[],
    options: RosterOptions,
    policy: RosterPolicy,
    forced?: { candidateId: string; slotId: string },
  ): RosterPlan {
    const shape = previewPlanShape(shiftIds, options, policy, forced);
    const seats = previewSeats(shiftIds);
    const assignments: PlannedAssignment[] = shape.choices.map((choice) => ({
      shiftId: choice.seat.shiftId,
      opportunityId: choice.seat.opportunityId,
      shiftTitle: choice.seat.shiftTitle,
      role: choice.seat.role,
      candidateId: choice.volunteer.id,
      candidateName: choice.volunteer.name,
      candidateInitials: choice.volunteer.initials,
      startsAt: choice.seat.startsAt,
      score: choice.score,
      breakdown: previewBreakdown(choice.components),
      reasons: [
        `Skill match: ${choice.seat.role}`,
        `${options.preferSpanish && choice.volunteer.languages.includes("Spanish") ? "Spanish-speaking" : "Available"} for ${choice.seat.shiftId}`,
        options.includeWaitlist && waitlisted(choice.volunteer.id, choice.seat)
          ? "Eligible applicant is on the shift waitlist"
          : "Highest score among the eligible volunteers",
      ],
      promoteWaitlist: waitlisted(choice.volunteer.id, choice.seat),
      eligibleRoles: seats
        .filter((row) => row.shiftId === choice.seat.shiftId)
        .filter((row) =>
          previewChecks(choice.volunteer, row, options, policy, baseLoad).every(
            (check) => check.passed,
          ),
        )
        .map((row) => row.role),
      explanation: choiceExplanation(choice, true),
    }));

    return {
      assignments,
      unfilled: shape.unfilled.map((row) => ({
        shiftId: row.seat.shiftId,
        role: row.seat.role,
        reason: row.reason,
        requiredSkill: row.seat.requiredSkill,
        requiredCredential: row.seat.requiredCredential,
      })),
      totalScore: assignments.reduce((total, assignment) => total + assignment.score, 0),
      slotsConsidered: seats.length,
      candidatesConsidered: candidates(options).length,
      deterministicSeed: 20260415,
      policyVersion: policy.version,
      generatedAt: workspace.now,
      revision,
    };
  }

  function previewAvailabilityState(
    volunteer: Volunteer,
    seat: PreviewSeat,
  ): CandidateEvaluation["availability"] {
    if (volunteer.availability.length === 0) return "unknown";
    const exact = volunteer.availability.some(
      (slot) => slot.day === seat.dayKey && slot.period === previewPeriod(seat.startsAt),
    );
    if (exact) return "available";
    return volunteer.availability.some((slot) => slot.day === seat.dayKey)
      ? "partial"
      : "unavailable";
  }

  /** The read model Rust returns; the screen parses it the same in both modes. */
  function previewEvaluation(shiftIds: string[], options: RosterOptions): RosterEvaluation {
    const policy = readRosterPolicy();
    const plan = previewRosterPlan(shiftIds, options, policy);
    const seats = previewSeats(shiftIds);
    const evaluations: CandidateEvaluation[] = candidates(options).map((volunteer) => {
      const slots: EvaluatedSlot[] = seats.map((seat) => {
        const explanation = previewExplanation(volunteer, seat, options, policy, baseLoad, false);
        return {
          slotId: seat.slotId,
          shiftId: seat.shiftId,
          shiftTitle: seat.shiftTitle,
          role: seat.role,
          startsAt: seat.startsAt,
          endsAt: seat.endsAt,
          eligible: explanation.eligible,
          selected: plan.assignments.some(
            (assignment) =>
              assignment.candidateId === volunteer.id &&
              assignment.explanation.slotId === seat.slotId,
          ),
          score: explanation.totalScore,
          checks: explanation.checks,
          components: explanation.components,
          selectionReason: explanation.selectionReason,
        };
      });
      const eligibleRoles = [
        ...new Set(slots.filter((slot) => slot.eligible).map((slot) => slot.role)),
      ].sort();
      const bestScore = slots
        .filter((slot) => slot.eligible)
        .map((slot) => slot.score ?? 0)
        .reduce<number | null>(
          (best, score) => (best === null || score > best ? score : best),
          null,
        );
      const conflict = slots
        .flatMap((slot) => slot.checks)
        .find((check) => check.name === "No overlapping shift" && !check.passed)?.detail;
      const eligibleIndex = slots.findIndex((slot) => slot.eligible);
      const availabilitySeat = eligibleIndex >= 0 ? seats[eligibleIndex] : seats[0];
      return {
        candidateId: volunteer.id,
        candidateName: volunteer.name,
        candidateInitials: volunteer.initials,
        eligibleRoles,
        bestScore,
        availability: availabilitySeat
          ? previewAvailabilityState(volunteer, availabilitySeat)
          : "unknown",
        conflict: conflict ?? null,
        weeklyShifts: baseLoad.weekCount.get(volunteer.id) ?? 0,
        weeklyMinutes: baseLoad.weekMinutes.get(volunteer.id) ?? 0,
        waitlistedShiftIds: state.waitlist
          .filter((row) => row.volunteerId === volunteer.id && row.status === "waiting")
          .map((row) => row.shiftId),
        slots,
      };
    });

    return {
      generatedAt: workspace.now,
      policyVersion: policy.version,
      revision,
      plan,
      candidates: evaluations,
    };
  }

  function previewExplain(
    shiftIds: string[],
    options: RosterOptions,
    candidateId: string,
    slotId: string,
  ): CandidateAnswer {
    const policy = readRosterPolicy();
    const seat = previewSeats(shiftIds).find((row) => row.slotId === slotId);
    if (!seat) throw new Error("That seat is not open on this shift.");
    const volunteer = candidates(options).find((row) => row.id === candidateId);
    if (!volunteer) throw new Error("That volunteer is not on file.");

    const base = previewPlanShape(shiftIds, options, policy);
    const held = base.choices.find((choice) => choice.seat.slotId === slotId);
    const selected = held?.volunteer.id === candidateId;
    const explanation =
      held && selected
        ? choiceExplanation(held, true)
        : previewExplanation(volunteer, seat, options, policy, baseLoad, false);

    const comparison =
      !selected && explanation.eligible
        ? previewComparison(
            base,
            previewPlanShape(shiftIds, options, policy, { candidateId, slotId }),
            volunteer,
            seat,
          )
        : null;

    return { explanation, comparison };
  }

  return { previewRosterPlan, previewEvaluation, previewExplain };
}
