//! Deterministic roster selection, unchanged from the previous module.
use super::*;

/// Fills slots the flow pass left open with same-day candidates who do not
/// overlap a decided booking.
#[allow(clippy::too_many_arguments)]
fn fill_same_day_slots(
    candidates: &[&Candidate],
    slots: &[&Slot],
    policy: &RosterPolicy,
    options: &RosterOptions,
    decided: &HashSet<&str>,
    committed: &mut HashMap<String, Vec<TimeBlock>>,
    assignments: &mut Vec<PlannedAssignment>,
    filled_slots: &mut HashSet<usize>,
) {
    if !options.block_conflicts {
        return;
    }
    let mut pending: Vec<usize> = slots
        .iter()
        .enumerate()
        .filter(|(index, _)| !filled_slots.contains(index))
        .map(|(index, _)| index)
        .collect();
    if pending.is_empty() {
        return;
    }

    let eligible_count = |index: usize| -> usize {
        candidates
            .iter()
            .filter(|candidate| !decided.contains(candidate.id.as_str()))
            .filter(|candidate| {
                let blocks = committed
                    .get(&candidate.id)
                    .map(Vec::as_slice)
                    .unwrap_or_default();
                evaluate(
                    candidate,
                    slots[index],
                    blocks,
                    RunLoad::default(),
                    policy,
                    options,
                )
                .eligible
            })
            .count()
    };
    pending.sort_by(|left, right| {
        let (left_slot, right_slot) = (slots[*left], slots[*right]);
        right_slot
            .mandatory
            .cmp(&left_slot.mandatory)
            .then_with(|| eligible_count(*left).cmp(&eligible_count(*right)))
            .then_with(|| left_slot.starts_at.cmp(&right_slot.starts_at))
            .then_with(|| left_slot.id.cmp(&right_slot.id))
    });

    let mut run_load: HashMap<String, RunLoad> = HashMap::new();
    for assignment in assignments.iter() {
        if let Some(slot) = slots
            .iter()
            .find(|slot| slot.role == assignment.role && slot.shift_id == assignment.shift_id)
        {
            let entry = run_load.entry(assignment.candidate_id.clone()).or_default();
            entry.shifts += 1;
            entry.minutes += minutes_between(slot.starts_at, slot.ends_at);
        }
    }

    for index in pending {
        let slot = slots[index];
        let mut chosen: Option<(&Candidate, i32, RunLoad)> = None;
        for candidate in candidates {
            if decided.contains(candidate.id.as_str()) {
                continue;
            }
            let load = run_load.get(&candidate.id).copied().unwrap_or_default();
            let blocks = committed
                .get(&candidate.id)
                .map(Vec::as_slice)
                .unwrap_or_default();
            if !evaluate(candidate, slot, blocks, load, policy, options).eligible {
                continue;
            }
            let (score, _) = score_candidate(candidate, slot, policy, options);
            // Ordered by id, so the first on a tie wins deterministically.
            let better = match &chosen {
                None => true,
                Some((_, best, _)) => score.total > *best,
            };
            if better {
                chosen = Some((candidate, score.total, load));
            }
        }
        let Some((candidate, _, load)) = chosen else {
            continue;
        };
        filled_slots.insert(index);
        committed
            .entry(candidate.id.clone())
            .or_default()
            .push(TimeBlock {
                starts_at: slot.starts_at,
                ends_at: slot.ends_at,
            });
        let entry = run_load.entry(candidate.id.clone()).or_default();
        entry.shifts += 1;
        entry.minutes += minutes_between(slot.starts_at, slot.ends_at);
        assignments.push(assignment_for(
            candidate,
            slot,
            &committed.get(&candidate.id).cloned().unwrap_or_default(),
            load,
            policy,
            options,
            slots,
        ));
    }
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
    let forced_slot_for = |candidate_id: &str| -> Option<&Slot> {
        forced
            .iter()
            .find(|(forced_candidate, _)| forced_candidate == candidate_id)
            .and_then(|(_, slot_id)| slots.iter().find(|slot| &slot.id == slot_id))
    };
    let is_forced = |candidate_id: &str, slot: &Slot| -> bool {
        forced.iter().any(|(forced_candidate, forced_slot)| {
            forced_candidate == candidate_id && forced_slot == &slot.id
        })
    };
    // A decided seat is out of the solver's pool entirely, and so is the person
    // already holding it. Otherwise the flow would hand the same seat to a second
    // volunteer, or give the fixed volunteer a second shift, and the plan would
    // no longer describe what the coordinator fixed.
    let forced_slot_ids: HashSet<&str> =
        forced.iter().map(|(_, slot_id)| slot_id.as_str()).collect();
    let forced_candidate_ids: HashSet<&str> = forced
        .iter()
        .map(|(candidate_id, _)| candidate_id.as_str())
        .collect();

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

    let source = 0;
    let mut nodes = 1;
    let mut day_nodes: BTreeMap<(String, String), usize> = BTreeMap::new();
    // Allocate one node per actual candidate/day, not per candidate/slot.
    // First-occurrence order remains identical, preserving tie-breaking IDs.
    let mut seen_days = HashSet::new();
    let days: Vec<&str> = ordered_slots
        .iter()
        .filter_map(|slot| {
            let day = slot.day_key.as_str();
            seen_days.insert(day).then_some(day)
        })
        .collect();
    for candidate in &ordered_candidates {
        for day in &days {
            day_nodes
                .entry((candidate.id.clone(), (*day).to_string()))
                .or_insert_with(|| {
                    let node = nodes;
                    nodes += 1;
                    node
                });
        }
    }
    let slot_offset = nodes;
    nodes += ordered_slots.len();
    let sink = nodes;
    nodes += 1;

    // Forced assignments are decided before the solver runs.
    let mut assignments = Vec::new();
    let mut filled_slots: HashSet<usize> = HashSet::new();
    let mut committed: HashMap<String, Vec<TimeBlock>> = HashMap::new();
    for candidate in &ordered_candidates {
        if candidate.assigned_blocks.is_empty() {
            continue;
        }
        committed
            .entry(candidate.id.clone())
            .or_default()
            .extend(candidate.assigned_blocks.iter().cloned());
    }
    for candidate in &ordered_candidates {
        let Some(slot) = forced_slot_for(&candidate.id) else {
            continue;
        };
        let Some(index) = ordered_slots.iter().position(|other| other.id == slot.id) else {
            continue;
        };
        filled_slots.insert(index);
        committed
            .entry(candidate.id.clone())
            .or_default()
            .push(TimeBlock {
                starts_at: slot.starts_at,
                ends_at: slot.ends_at,
            });
        assignments.push(assignment_for(
            candidate,
            slot,
            &committed.get(&candidate.id).cloned().unwrap_or_default(),
            RunLoad::default(),
            policy,
            options,
            &ordered_slots,
        ));
    }

    let mut flow = Flow::new(nodes);
    for node in day_nodes.values() {
        flow.add_edge(source, *node, 1, 0);
    }

    let mut candidate_by_id: HashMap<&str, &Candidate> = HashMap::new();
    for candidate in &ordered_candidates {
        candidate_by_id.insert(candidate.id.as_str(), candidate);
    }
    for (slot_index, slot) in ordered_slots.iter().enumerate() {
        if forced_slot_ids.contains(slot.id.as_str()) {
            continue;
        }
        let slot_node = slot_offset + slot_index;
        let priority = if slot.mandatory {
            MANDATORY_SLOT_BONUS
        } else {
            0
        };
        flow.add_edge(slot_node, sink, 1, -priority);
        for ((candidate_id, day), node) in &day_nodes {
            if day != &slot.day_key {
                continue;
            }
            if forced_candidate_ids.contains(candidate_id.as_str()) {
                continue;
            }
            let Some(candidate) = candidate_by_id.get(candidate_id.as_str()) else {
                continue;
            };
            if is_forced(&candidate.id, slot) {
                continue;
            }
            if !evaluate(
                candidate,
                slot,
                &committed.get(&candidate.id).cloned().unwrap_or_default(),
                RunLoad::default(),
                policy,
                options,
            )
            .eligible
            {
                continue;
            }
            let (score, _) = score_candidate(candidate, slot, policy, options);
            let tie = (slot_index as i32) % SCORE_UNIT;
            let cost = (MAX_SCORE - score.total) * SCORE_UNIT + tie;
            flow.add_edge(*node, slot_node, 1, cost);
        }
    }

    flow.min_cost_max_flow(source, sink);

    for ((candidate_id, _), node) in &day_nodes {
        let Some(candidate) = candidate_by_id.get(candidate_id.as_str()) else {
            continue;
        };
        for destination in flow.used_destinations(*node) {
            if destination < slot_offset || destination >= slot_offset + ordered_slots.len() {
                continue;
            }
            let slot_index = destination - slot_offset;
            let slot = ordered_slots[slot_index];
            if is_forced(&candidate.id, slot) {
                continue;
            }
            filled_slots.insert(slot_index);
            assignments.push(assignment_for(
                candidate,
                slot,
                &committed.get(&candidate.id).cloned().unwrap_or_default(),
                RunLoad::default(),
                policy,
                options,
                &ordered_slots,
            ));
            committed
                .entry(candidate.id.clone())
                .or_default()
                .push(TimeBlock {
                    starts_at: slot.starts_at,
                    ends_at: slot.ends_at,
                });
        }
    }

    fill_same_day_slots(
        &ordered_candidates,
        &ordered_slots,
        policy,
        options,
        &forced_candidate_ids,
        &mut committed,
        &mut assignments,
        &mut filled_slots,
    );

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
