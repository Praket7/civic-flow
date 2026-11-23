import type {
  CandidateAnswer,
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
  }

  interface PreviewBlock {
    start: number;
    end: number;
  }

  interface PreviewLoad {
    blocks: Map<string, PreviewBlock[]>;
    dayCount: Map<string, number>;
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
    beforeSeat: Map<string, PreviewLoad>;
  }

  /**
   * The skill and credential a role demands, by the same name rules the Rust
   * core applies when it seeds requirements. The browser has to agree with the
   * desktop here, otherwise the preview would show a different shortlist than
   * the optimizer actually used.
   */
  function previewRoleRequirement(role: string): { skill: string; credential: string | null } {
    const lower = role.toLowerCase();
    if (lower.includes("spanish")) return { skill: "Spanish", credential: null };
    if (lower.includes("driver") || lower.includes("delivery")) {
      return { skill: "Driver", credential: "Safe driver clearance" };
    }
    if (lower.includes("tutor")) return { skill: "Tutoring", credential: "Tutor certification" };
    if (lower.includes("food") || lower.includes("pantry") || lower.includes("sort")) {
      return { skill: "Food handling", credential: "Food safety handler" };
    }
    if (lower.includes("garden") || lower.includes("tool")) {
      return { skill: "Gardening", credential: "Garden tool safety" };
    }
    return { skill: "", credential: null };
  }

  function previewSeats(shiftIds: string[]): PreviewSeat[] {
    const seats: PreviewSeat[] = [];
    for (const shift of workspace.shifts.filter((row) => shiftIds.includes(row.id))) {
      const opportunity = workspace.opportunities.find((row) => row.id === shift.opportunityId);
      const live = state.registrations.filter(
        (row) => row.shiftId === shift.id && row.status === "registered",
      );
      for (const role of shift.roles) {
        const requirement = previewRoleRequirement(role.name);
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
          });
        }
      }
    }
    return seats;
  }

  function emptyLoad(): PreviewLoad {
    return { blocks: new Map(), dayCount: new Map(), weekCount: new Map() };
  }

  function cloneLoad(load: PreviewLoad): PreviewLoad {
    return {
      blocks: new Map(
        [...load.blocks].map(([volunteerId, blocks]) => [
          volunteerId,
          blocks.map((block) => ({ ...block })),
        ]),
      ),
      dayCount: new Map(load.dayCount),
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
    for (const registration of state.registrations) {
      if (registration.status !== "registered") continue;
      const shift = workspace.shifts.find((row) => row.id === registration.shiftId);
      if (!shift) continue;
      const start = new Date(shift.startsAt).getTime();
      const blocks = load.blocks.get(registration.volunteerId) ?? [];
      blocks.push({ start, end: new Date(shift.endsAt).getTime() });
      load.blocks.set(registration.volunteerId, blocks);
      if (start < now || start > horizon) continue;
      const day = previewDayKey(shift.startsAt);
      const dayKey = `${registration.volunteerId}:${day}`;
      load.dayCount.set(dayKey, (load.dayCount.get(dayKey) ?? 0) + 1);
      load.weekCount.set(
        registration.volunteerId,
        (load.weekCount.get(registration.volunteerId) ?? 0) + 1,
      );
    }
    return load;
  }

  function previewAvailability(volunteer: Volunteer, seat: PreviewSeat): boolean {
    if (volunteer.availability.length === 0) return true;
    const period = previewPeriod(seat.startsAt);
    return volunteer.availability.some(
      (slot) => slot.day === seat.dayKey && slot.period === period,
    );
  }

  function previewChecks(
    volunteer: Volunteer,
    seat: PreviewSeat,
    options: RosterOptions,
    policy: RosterPolicy,
    load: PreviewLoad,
  ): ConstraintCheck[] {
    const checks: ConstraintCheck[] = [];
    const registered = state.registrations.some(
      (row) =>
        row.shiftId === seat.shiftId &&
        row.volunteerId === volunteer.id &&
        row.status === "registered",
    );
    checks.push({
      name: "Already on this shift",
      passed: !registered,
      detail: registered
        ? "This volunteer is already registered for the shift"
        : "Not registered yet",
    });
    if (seat.requiredSkill) {
      const skillMatch = volunteer.skills.some((skill) =>
        skill.toLowerCase().includes(seat.requiredSkill.toLowerCase()),
      );
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
      const current = held.some((row) => row.validThrough.slice(0, 10) >= on);
      const expired = !current && held.length > 0;
      checks.push({
        name: "Required credential",
        passed: current,
        detail: current
          ? `${seat.requiredCredential} current`
          : expired
            ? `${seat.requiredCredential} expired`
            : `No ${seat.requiredCredential} on record`,
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

    if (options.blockConflicts) {
      const start = new Date(seat.startsAt).getTime();
      const end = new Date(seat.endsAt).getTime();
      const clash = (load.blocks.get(volunteer.id) ?? []).some(
        (block) => block.start < end && block.end > start,
      );
      checks.push({
        name: "No overlapping shift",
        passed: !clash,
        detail: clash ? "Already booked at this time" : "No shift overlaps this time",
      });
    }

    const dayTaken = (load.dayCount.get(`${volunteer.id}:${seat.dayKey}`) ?? 0) + 1;
    if (policy.maxShiftsPerDay !== null) {
      checks.push({
        name: "Daily shift limit",
        passed: dayTaken <= policy.maxShiftsPerDay,
        detail: `${dayTaken} of ${policy.maxShiftsPerDay} that day`,
      });
    }

    const weekTaken = (load.weekCount.get(volunteer.id) ?? 0) + 1;
    const weekLimit = policy.maxShiftsPerWeek ?? (options.capWeekly ? 2 : null);
    if (weekLimit !== null) {
      checks.push({
        name: "Weekly shift limit",
        passed: weekTaken <= weekLimit,
        detail: `${weekTaken} of ${weekLimit} this week`,
      });
    }
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
    load: PreviewLoad,
  ): { components: ScoreComponent[]; total: number } {
    const skillMatches =
      !seat.requiredSkill ||
      volunteer.skills.some((skill) =>
        skill.toLowerCase().includes(seat.requiredSkill.toLowerCase()),
      );
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
    const spanish = volunteer.languages.includes("Spanish");
    const preference =
      seat.role.toLowerCase().includes("spanish") && spanish
        ? policy.languageWeight
        : options.preferSpanish && spanish
          ? previewShare(policy.languageWeight, 8, 10)
          : previewShare(policy.languageWeight, 6, 10);
    const weekShifts = load.weekCount.get(volunteer.id) ?? 0;
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
  function previewPlanShape(
    shiftIds: string[],
    options: RosterOptions,
    policy: RosterPolicy,
    forced?: { candidateId: string; slotId: string },
  ): PreviewPlanShape {
    const seats = previewSeats(shiftIds);
    const pool = workspace.volunteers.filter((volunteer) => volunteer.status === "active");
    const load = previewBaseLoad();
    const choices: PreviewChoice[] = [];
    const unfilled: { seat: PreviewSeat; reason: string }[] = [];
    const beforeSeat = new Map<string, PreviewLoad>();

    for (const seat of seats) {
      beforeSeat.set(seat.slotId, cloneLoad(load));
      const isForcedSeat = forced?.slotId === seat.slotId;
      const considered = isForcedSeat
        ? pool.filter((volunteer) => volunteer.id === forced?.candidateId)
        : pool.filter((volunteer) => volunteer.id !== forced?.candidateId);

      let best: PreviewChoice | null = null;
      for (const volunteer of considered) {
        const checks = previewChecks(volunteer, seat, options, policy, load);
        if (checks.some((check) => !check.passed)) continue;
        const { components, total } = previewScore(volunteer, seat, options, policy, load);
        if (!best || total > best.score) {
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
        end: new Date(seat.endsAt).getTime(),
      });
      load.blocks.set(best.volunteer.id, blocks);
      load.dayCount.set(
        `${best.volunteer.id}:${seat.dayKey}`,
        (load.dayCount.get(`${best.volunteer.id}:${seat.dayKey}`) ?? 0) + 1,
      );
      load.weekCount.set(best.volunteer.id, (load.weekCount.get(best.volunteer.id) ?? 0) + 1);
    }

    return { choices, unfilled, beforeSeat };
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
    const eligible = checks.every((check) => check.passed);
    const { components, total } = previewScore(volunteer, seat, options, policy, load);
    const choice: PreviewChoice = { seat, volunteer, checks, components, score: total };
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
      totalScore: eligible ? total : null,
      selected,
      selectionReason: eligible
        ? previewReason(choice)
        : `${volunteer.name} failed one requirement — ${
            checks.find((check) => !check.passed)?.name.toLowerCase() ?? "eligibility"
          }`,
    };
  }

  function previewRequiredFilled(shape: PreviewPlanShape): number {
    return shape.choices.length;
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
        "Highest score among the eligible volunteers",
      ],
      promoteWaitlist: false,
      eligibleRoles: seats
        .filter((row) => row.shiftId === choice.seat.shiftId)
        .filter((row) =>
          choice.volunteer.skills.some((skill) =>
            skill.toLowerCase().includes(row.requiredSkill.toLowerCase()),
          ),
        )
        .map((row) => row.role),
      explanation: previewExplanation(
        choice.volunteer,
        choice.seat,
        options,
        policy,
        shape.beforeSeat.get(choice.seat.slotId) ?? emptyLoad(),
        true,
      ),
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
      candidatesConsidered: workspace.volunteers.filter(
        (volunteer) => volunteer.status === "active",
      ).length,
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
    const baseLoad = previewBaseLoad();

    const candidates: CandidateEvaluation[] = workspace.volunteers
      .filter((volunteer) => volunteer.status === "active")
      .map((volunteer) => {
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
          weeklyMinutes: 0,
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
      candidates,
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
    const volunteer = workspace.volunteers.find((row) => row.id === candidateId);
    if (!volunteer) throw new Error("That volunteer is not on file.");

    const base = previewPlanShape(shiftIds, options, policy);
    const held = base.choices.find((choice) => choice.seat.slotId === slotId);
    const selected = held?.volunteer.id === candidateId;
    const explanation =
      selected && held
        ? previewExplanation(
            volunteer,
            seat,
            options,
            policy,
            base.beforeSeat.get(slotId) ?? emptyLoad(),
            true,
          )
        : previewExplanation(
            volunteer,
            seat,
            options,
            policy,
            base.beforeSeat.get(slotId) ?? emptyLoad(),
            false,
          );

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
