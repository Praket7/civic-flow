//! Deterministic roster selection using flow followed by a policy-safe completion pass.
use super::*;

#[derive(Default)]
struct RunState {
    blocks: Vec<TimeBlock>,
    shifts: HashSet<String>,
    load: RunLoad,
}

impl RunState {
    fn eligible(
        &self,
        candidate: &Candidate,
        slot: &Slot,
        policy: &RosterPolicy,
        options: &RosterOptions,
    ) -> bool {
        !self.shifts.contains(&slot.shift_id)
            && evaluate(candidate, slot, &self.blocks, self.load, policy, options).eligible
    }

    fn assign(
        &mut self,
        candidate: &Candidate,
        slot: &Slot,
        policy: &RosterPolicy,
        options: &RosterOptions,
        slots: &[&Slot],
    ) -> PlannedAssignment {
        // Explain the choice before adding its own block or consuming its own quota.
        let assignment = assignment_for(
            candidate,
            slot,
            &self.blocks,
            self.load,
            policy,
            options,
            slots,
        );
        self.blocks.push(TimeBlock {
            starts_at: slot.starts_at,
            ends_at: slot.ends_at,
        });
        self.shifts.insert(slot.shift_id.clone());
        self.load.shifts += 1;
        self.load.minutes += minutes_between(slot.starts_at, slot.ends_at);
        assignment
    }
}

fn rank(candidate: &Candidate, slot: &Slot, policy: &RosterPolicy, options: &RosterOptions) -> i32 {
    let score = score_candidate(candidate, slot, policy, options).0.total;
    let waiting = options.include_waitlist
        && policy.waitlist_preference
        && candidate.waitlisted_shift_ids.contains(&slot.shift_id);
    score + i32::from(waiting) * (MAX_SCORE + 1)
}

/// Fills slots first, then maximizes match quality. Deterministic for equal input.
pub fn plan(
    candidates: &[Candidate],
    slots: &[Slot],
    policy: &RosterPolicy,
    options: &RosterOptions,
) -> RosterPlan {
    plan_inner(candidates, slots, policy, options, &[])
}

/// The plan with these assignments fixed, for "why not that person?" comparisons.
pub fn plan_with_forced(
    candidates: &[Candidate],
    slots: &[Slot],
    policy: &RosterPolicy,
    options: &RosterOptions,
    forced: &[(String, String)],
) -> RosterPlan {
    plan_inner(candidates, slots, policy, options, forced)
}

fn plan_inner(
    candidates: &[Candidate],
    slots: &[Slot],
    policy: &RosterPolicy,
    options: &RosterOptions,
    forced: &[(String, String)],
) -> RosterPlan {
    let mut ordered_candidates: Vec<&Candidate> = candidates.iter().collect();
    ordered_candidates.sort_by(|a, b| a.id.cmp(&b.id));
    let mut ordered_slots: Vec<&Slot> = slots.iter().collect();
    ordered_slots.sort_by(|a, b| {
        a.starts_at
            .cmp(&b.starts_at)
            .then_with(|| a.shift_id.cmp(&b.shift_id))
            .then_with(|| a.role.cmp(&b.role))
            .then_with(|| a.id.cmp(&b.id))
    });

    let days: BTreeMap<NaiveDate, usize> = ordered_slots
        .iter()
        .map(|slot| slot.starts_at.date_naive())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .enumerate()
        .map(|(index, day)| (day, index))
        .collect();
    let source = 0;
    let slot_offset = 1 + days.len() * ordered_candidates.len();
    let sink = slot_offset + ordered_slots.len();
    let node_for = |candidate: usize, day: usize| 1 + candidate * days.len() + day;
    let mut flow = Flow::new(sink + 1);
    let mut runs: Vec<RunState> = ordered_candidates
        .iter()
        .map(|candidate| RunState {
            blocks: candidate.assigned_blocks.clone(),
            ..RunState::default()
        })
        .collect();
    let mut assignments = Vec::new();
    let mut filled_slots = HashSet::new();
    let mut fixed_candidates = HashSet::new();

    for (candidate_id, slot_id) in forced {
        let Some(person) = ordered_candidates
            .iter()
            .position(|c| &c.id == candidate_id)
        else {
            continue;
        };
        let Some(index) = ordered_slots.iter().position(|s| &s.id == slot_id) else {
            continue;
        };
        let (candidate, slot) = (ordered_candidates[person], ordered_slots[index]);
        if fixed_candidates.contains(&person)
            || filled_slots.contains(&index)
            || !runs[person].eligible(candidate, slot, policy, options)
        {
            continue;
        }
        assignments.push(runs[person].assign(candidate, slot, policy, options, &ordered_slots));
        filled_slots.insert(index);
        fixed_candidates.insert(person);
    }

    for person in 0..ordered_candidates.len() {
        if !fixed_candidates.contains(&person) {
            for day in 0..days.len() {
                flow.add_edge(source, node_for(person, day), 1, 0);
            }
        }
    }
    for (index, slot) in ordered_slots.iter().enumerate() {
        if filled_slots.contains(&index) {
            continue;
        }
        let day = days[&slot.starts_at.date_naive()];
        let priority = if slot.mandatory {
            MANDATORY_SLOT_BONUS + i32::from(policy.waitlist_preference) * SCORE_UNIT
        } else {
            0
        };
        flow.add_edge(slot_offset + index, sink, 1, -priority);
        for (person, candidate) in ordered_candidates.iter().enumerate() {
            if fixed_candidates.contains(&person)
                || !runs[person].eligible(candidate, slot, policy, options)
            {
                continue;
            }
            let tie = (index as i32) % SCORE_UNIT;
            let cost = (MAX_SCORE - rank(candidate, slot, policy, options)) * SCORE_UNIT + tie;
            flow.add_edge(node_for(person, day), slot_offset + index, 1, cost);
        }
    }
    flow.min_cost_max_flow(source, sink);

    // Flow proposes one seat per calendar day. Cross-day caps, rest, and
    // duplicate registrations can interact, so commit only still-eligible edges.
    let mut proposed = Vec::new();
    for person in 0..ordered_candidates.len() {
        for day in 0..days.len() {
            for destination in flow.used_destinations(node_for(person, day)) {
                if (slot_offset..sink).contains(&destination) {
                    proposed.push((person, destination - slot_offset));
                }
            }
        }
    }
    proposed.sort_by_key(|&(person, index)| (!ordered_slots[index].mandatory, index, person));
    for (person, index) in proposed {
        let (candidate, slot) = (ordered_candidates[person], ordered_slots[index]);
        if runs[person].eligible(candidate, slot, policy, options) {
            assignments.push(runs[person].assign(candidate, slot, policy, options, &ordered_slots));
            filled_slots.insert(index);
        }
    }

    // Fill remaining seats by scarcity and rank, enforcing exactly the same
    // constraints and preserving deterministic ID tie-breaking.
    let mut pending: Vec<_> = ordered_slots
        .iter()
        .enumerate()
        .filter(|(index, _)| !filled_slots.contains(index))
        .map(|(index, slot)| {
            let eligible = ordered_candidates
                .iter()
                .enumerate()
                .filter(|(person, candidate)| {
                    !fixed_candidates.contains(person)
                        && runs[*person].eligible(candidate, slot, policy, options)
                })
                .count();
            (!slot.mandatory, eligible, index)
        })
        .collect();
    pending.sort_unstable();
    for (_, _, index) in pending {
        let slot = ordered_slots[index];
        let best = ordered_candidates
            .iter()
            .enumerate()
            .filter(|(person, candidate)| {
                !fixed_candidates.contains(person)
                    && runs[*person].eligible(candidate, slot, policy, options)
            })
            .max_by_key(|(person, candidate)| {
                (
                    rank(candidate, slot, policy, options),
                    std::cmp::Reverse(*person),
                )
            });
        if let Some((person, candidate)) = best {
            assignments.push(runs[person].assign(candidate, slot, policy, options, &ordered_slots));
            filled_slots.insert(index);
        }
    }

    assignments.sort_by(|a, b| {
        a.starts_at
            .cmp(&b.starts_at)
            .then_with(|| a.shift_id.cmp(&b.shift_id))
            .then_with(|| a.role.cmp(&b.role))
            .then_with(|| a.candidate_id.cmp(&b.candidate_id))
    });

    let mut unfilled = Vec::new();
    for (index, slot) in ordered_slots.iter().enumerate() {
        if filled_slots.contains(&index) {
            continue;
        }
        let reason = if ordered_candidates.is_empty() {
            "No candidates supplied".to_string()
        } else if ordered_candidates
            .iter()
            .any(|candidate| is_eligible(candidate, slot, policy, options).is_ok())
        {
            "Eligible candidates were already assigned".to_string()
        } else {
            "No eligible candidate".to_string()
        };
        unfilled.push(UnfilledSlot {
            shift_id: slot.shift_id.clone(),
            role: slot.role.clone(),
            reason,
            required_skill: slot.required_skill.clone(),
            required_credential: slot.required_credential.clone(),
        });
    }
    unfilled.sort_by(|a, b| {
        a.shift_id
            .cmp(&b.shift_id)
            .then_with(|| a.role.cmp(&b.role))
    });

    let total_score = assignments.iter().map(|assignment| assignment.score).sum();
    RosterPlan {
        assignments,
        unfilled,
        total_score,
        slots_considered: ordered_slots.len(),
        candidates_considered: ordered_candidates.len(),
        deterministic_seed: 20_261_013,
        policy_version: policy.version,
        generated_at: String::new(),
        revision: 0,
    }
}
