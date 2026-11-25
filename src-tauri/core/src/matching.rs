//! Deterministic, explainable assignment planning.
//!
//! Eligibility is a hard gate. Assignment is min-cost max-flow:
//!
//! ```text
//! source -> candidate-day (capacity 1) -> role slot (capacity 1) -> sink
//! ```
//!
//! Edge cost is `MAX_SCORE - score`; a required role carries a priority bonus.
//! The flow allows one slot per calendar day, so a second pass offers remaining
//! same-day slots to candidates with no time overlap.

use std::collections::{BTreeMap, HashSet};

use chrono::{DateTime, Datelike, FixedOffset, NaiveDate, Timelike};
use serde::{Deserialize, Serialize};

use crate::policy::RosterPolicy;

mod flow;
mod planner;
use flow::Flow;
pub use planner::{plan, plan_with_forced};

pub const MAX_SCORE: i32 = 100;

/// Availability is a gate, so the points are constant; the policy weights
/// separate candidates. Default weights plus this constant reach `MAX_SCORE`.
pub const AVAILABILITY_POINTS: i32 = 25;

/// Applied once, so required roles fill before optional ones.
pub const MANDATORY_SLOT_BONUS: i32 = 20_000;

/// One score point in flow cost; tiebreaks stay below it.
const SCORE_UNIT: i32 = 100;

#[derive(Debug, Clone, PartialEq)]
pub struct TimeBlock {
    pub starts_at: DateTime<FixedOffset>,
    pub ends_at: DateTime<FixedOffset>,
}

/// Half-open overlap: a shift that ends exactly when the next one starts is not
/// a conflict.
fn overlaps(
    starts_at: DateTime<FixedOffset>,
    ends_at: DateTime<FixedOffset>,
    other_start: DateTime<FixedOffset>,
    other_end: DateTime<FixedOffset>,
) -> bool {
    starts_at < other_end && other_start < ends_at
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RosterOptions {
    #[serde(default)]
    pub prefer_spanish: bool,
    #[serde(default = "default_true")]
    pub block_conflicts: bool,
    #[serde(default)]
    pub cap_weekly: bool,
    #[serde(default)]
    pub include_waitlist: bool,
}

/// The omitted and constructed defaults must agree.
impl Default for RosterOptions {
    fn default() -> Self {
        Self {
            prefer_spanish: false,
            block_conflicts: true,
            cap_weekly: false,
            include_waitlist: false,
        }
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq)]
pub struct Credential {
    pub name: String,
    pub valid_from: Option<NaiveDate>,
    pub valid_through: Option<NaiveDate>,
    pub verified: bool,
}

impl Credential {
    pub(crate) fn from_dates(
        name: String,
        start: Option<&str>,
        end: Option<&str>,
        verified_at: Option<&str>,
    ) -> Self {
        let parse = |value: &str| {
            NaiveDate::parse_from_str(value.get(..10).unwrap_or(value), "%Y-%m-%d").ok()
        };
        Self {
            name,
            valid_from: start.and_then(parse),
            valid_through: end.and_then(parse),
            verified: verified_at.is_some_and(|value| !value.trim().is_empty()),
        }
    }

    fn valid_on(&self, on: NaiveDate) -> bool {
        self.verified
            && self.valid_from.is_some_and(|start| start <= on)
            && self.valid_through.is_some_and(|end| on <= end)
    }
}

#[derive(Debug, Clone)]
pub struct Candidate {
    pub id: String,
    pub name: String,
    pub initials: String,
    pub skills: Vec<String>,
    pub languages: Vec<String>,
    pub causes: Vec<String>,
    pub availability: HashSet<String>,
    pub birthdate: Option<NaiveDate>,
    pub attendance_rate: i64,
    pub events_completed: i64,
    pub credentials: Vec<Credential>,
    pub assigned_blocks: Vec<TimeBlock>,
    pub assigned_shift_ids: HashSet<String>,
    pub waitlisted_shift_ids: HashSet<String>,
    pub weekly_load: i64,
    /// Minutes already committed inside the next seven days, so a policy can cap
    /// time rather than only shifts.
    pub weekly_minutes: i64,
}

/// One hard requirement, evaluated and explained. A coordinator asking "why not
/// this volunteer?" gets the failed check rather than a single sentence.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConstraintCheck {
    pub name: String,
    pub passed: bool,
    pub detail: String,
}

/// One soft component of a match score.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScoreComponent {
    pub label: String,
    pub awarded: i32,
    pub maximum: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MatchExplanation {
    pub candidate_id: String,
    pub candidate_name: String,
    pub candidate_initials: String,
    pub slot_id: String,
    pub shift_id: String,
    pub role: String,
    pub eligible: bool,
    pub checks: Vec<ConstraintCheck>,
    pub components: Vec<ScoreComponent>,
    pub total_score: Option<i32>,
    pub selected: bool,
    pub selection_reason: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Evaluation {
    pub eligible: bool,
    pub checks: Vec<ConstraintCheck>,
}

impl Evaluation {
    /// The first failed requirement, for a person to read.
    pub fn rejection(&self) -> Option<String> {
        self.checks
            .iter()
            .find(|check| !check.passed)
            .map(|check| format!("{}: {}", check.name, check.detail))
    }
}

/// Load this run added on top of the database's own seven-day window.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RunLoad {
    pub shifts: i64,
    pub minutes: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Slot {
    pub id: String,
    pub shift_id: String,
    pub opportunity_id: String,
    pub shift_title: String,
    pub role: String,
    pub cause: String,
    pub day_key: String,
    pub starts_at: DateTime<FixedOffset>,
    pub ends_at: DateTime<FixedOffset>,
    pub required_skill: Option<String>,
    pub required_credential: Option<String>,
    pub minimum_age: Option<i64>,
    pub mandatory: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScoreBreakdown {
    pub skill: i32,
    pub availability: i32,
    pub interest: i32,
    pub preference: i32,
    pub fairness: i32,
    pub reliability: i32,
    pub total: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlannedAssignment {
    pub shift_id: String,
    pub opportunity_id: String,
    pub shift_title: String,
    pub role: String,
    pub candidate_id: String,
    pub candidate_name: String,
    pub candidate_initials: String,
    pub starts_at: String,
    pub score: i32,
    pub breakdown: ScoreBreakdown,
    pub reasons: Vec<String>,
    pub promote_waitlist: bool,
    pub eligible_roles: Vec<String>,
    pub explanation: MatchExplanation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UnfilledSlot {
    pub shift_id: String,
    pub role: String,
    pub reason: String,
    pub required_skill: Option<String>,
    pub required_credential: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RosterPlan {
    pub assignments: Vec<PlannedAssignment>,
    pub unfilled: Vec<UnfilledSlot>,
    pub total_score: i32,
    pub slots_considered: usize,
    pub candidates_considered: usize,
    pub deterministic_seed: u64,
    pub policy_version: i64,
    #[serde(default)]
    pub generated_at: String,
    /// Applying a plan against a moved revision would overwrite a newer decision.
    #[serde(default)]
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvaluatedSlot {
    pub slot_id: String,
    pub shift_id: String,
    pub shift_title: String,
    pub role: String,
    pub starts_at: String,
    pub ends_at: String,
    pub eligible: bool,
    pub selected: bool,
    pub score: Option<i32>,
    pub checks: Vec<ConstraintCheck>,
    pub components: Vec<ScoreComponent>,
    pub selection_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CandidateEvaluation {
    pub candidate_id: String,
    pub candidate_name: String,
    pub candidate_initials: String,
    pub eligible_roles: Vec<String>,
    pub best_score: Option<i32>,
    pub availability: String,
    pub conflict: Option<String>,
    pub weekly_shifts: i64,
    pub weekly_minutes: i64,
    pub waitlisted_shift_ids: Vec<String>,
    pub slots: Vec<EvaluatedSlot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RosterEvaluation {
    pub generated_at: String,
    pub policy_version: i64,
    pub revision: i64,
    pub plan: RosterPlan,
    pub candidates: Vec<CandidateEvaluation>,
}

/// `unknown`: not stated; `partial`: free that day, not in this half of it.
pub fn availability_state(candidate: &Candidate, slot: &Slot) -> String {
    let key = format!("{}:{}", slot.day_key, period_for(slot.starts_at));
    if candidate.availability.is_empty() {
        return "unknown".into();
    }
    if candidate.availability.contains(&key) {
        return "available".into();
    }
    let day_prefix = format!("{}:", slot.day_key);
    if candidate
        .availability
        .iter()
        .any(|entry| entry.starts_with(&day_prefix))
    {
        return "partial".into();
    }
    "unavailable".into()
}

/// The single read model behind AutoRoster: the plan plus every evaluation.
pub fn evaluate_roster(
    candidates: &[Candidate],
    slots: &[Slot],
    policy: &RosterPolicy,
    options: &RosterOptions,
) -> RosterEvaluation {
    let plan = plan(candidates, slots, policy, options);
    let selected: std::collections::HashSet<(String, String)> = plan
        .assignments
        .iter()
        .map(|assignment| {
            (
                assignment.candidate_id.clone(),
                assignment.explanation.slot_id.clone(),
            )
        })
        .collect();

    let mut ordered_candidates: Vec<&Candidate> = candidates.iter().collect();
    ordered_candidates.sort_by(|a, b| a.id.cmp(&b.id));
    let mut ordered_slots: Vec<&Slot> = slots.iter().collect();
    ordered_slots.sort_by(|a, b| {
        a.starts_at
            .cmp(&b.starts_at)
            .then_with(|| a.shift_id.cmp(&b.shift_id))
            .then_with(|| a.id.cmp(&b.id))
    });

    let rows = ordered_candidates
        .into_iter()
        .map(|candidate| {
            let mut evaluations = Vec::new();
            for slot in &ordered_slots {
                let is_selected = selected.contains(&(candidate.id.clone(), slot.id.clone()));
                // A chosen seat reuses the plan's own explanation, which includes
                // the load this run assigned. Everything else is evaluated on the
                // database state alone.
                let explanation = if is_selected {
                    plan.assignments
                        .iter()
                        .find(|assignment| {
                            assignment.candidate_id == candidate.id
                                && assignment.explanation.slot_id == slot.id
                        })
                        .map(|assignment| assignment.explanation.clone())
                        .unwrap_or_else(|| {
                            explain_selection(candidate, slot, policy, options, true)
                        })
                } else {
                    explain_selection(candidate, slot, policy, options, false)
                };
                evaluations.push(EvaluatedSlot {
                    slot_id: slot.id.clone(),
                    shift_id: slot.shift_id.clone(),
                    shift_title: slot.shift_title.clone(),
                    role: slot.role.clone(),
                    starts_at: slot.starts_at.to_rfc3339(),
                    ends_at: slot.ends_at.to_rfc3339(),
                    eligible: explanation.eligible,
                    selected: is_selected,
                    score: explanation.total_score,
                    checks: explanation.checks.clone(),
                    components: explanation.components.clone(),
                    selection_reason: explanation.selection_reason.clone(),
                });
            }

            let mut eligible_roles: Vec<String> = evaluations
                .iter()
                .filter(|slot| slot.eligible)
                .map(|slot| slot.role.clone())
                .collect();
            eligible_roles.sort();
            eligible_roles.dedup();
            let best_score = evaluations
                .iter()
                .filter(|slot| slot.eligible)
                .filter_map(|slot| slot.score)
                .max();
            // A seat the candidate can actually take is the one whose
            // availability answers the question. Falling back to the first seat
            // would label someone unavailable because of a role they cannot do.
            let availability = evaluations
                .iter()
                .position(|slot| slot.eligible)
                .and_then(|index| ordered_slots.get(index))
                .or_else(|| ordered_slots.first())
                .map(|slot| availability_state(candidate, slot))
                .unwrap_or_else(|| "unknown".into());
            let conflict = evaluations.iter().find_map(|slot| {
                slot.checks
                    .iter()
                    .find(|check| check.name == "No overlapping shift" && !check.passed)
                    .map(|check| check.detail.clone())
            });
            let mut waitlisted: Vec<String> =
                candidate.waitlisted_shift_ids.iter().cloned().collect();
            waitlisted.sort();

            CandidateEvaluation {
                candidate_id: candidate.id.clone(),
                candidate_name: candidate.name.clone(),
                candidate_initials: candidate.initials.clone(),
                eligible_roles,
                best_score,
                availability,
                conflict,
                weekly_shifts: candidate.weekly_load,
                weekly_minutes: candidate.weekly_minutes,
                waitlisted_shift_ids: waitlisted,
                slots: evaluations,
            }
        })
        .collect();

    RosterEvaluation {
        generated_at: String::new(),
        policy_version: policy.version,
        revision: 0,
        plan,
        candidates: rows,
    }
}

fn period_for(starts_at: DateTime<FixedOffset>) -> &'static str {
    let hour = starts_at.hour();
    if hour < 12 {
        "morning"
    } else if hour < 17 {
        "afternoon"
    } else {
        "evening"
    }
}

pub fn day_key(date: NaiveDate) -> String {
    date.format("%a").to_string().to_lowercase()
}

pub fn age_on(birthdate: NaiveDate, on: NaiveDate) -> i64 {
    let mut age = on.year() as i64 - birthdate.year() as i64;
    if (on.month(), on.day()) < (birthdate.month(), birthdate.day()) {
        age -= 1;
    }
    age
}

fn has_skill(candidate: &Candidate, skill: &str) -> bool {
    candidate
        .skills
        .iter()
        .any(|value| value.eq_ignore_ascii_case(skill))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CredentialState {
    Current,
    Expired,
    Missing,
}

fn credential_state(candidate: &Candidate, credential: &str, on: NaiveDate) -> CredentialState {
    let mut expired = false;
    for value in &candidate.credentials {
        if !value.name.eq_ignore_ascii_case(credential) {
            continue;
        }
        if value.valid_on(on) {
            return CredentialState::Current;
        }
        expired = true;
    }
    if expired {
        CredentialState::Expired
    } else {
        CredentialState::Missing
    }
}

fn check(name: &str, passed: bool, detail: String) -> ConstraintCheck {
    ConstraintCheck {
        name: name.to_string(),
        passed,
        detail,
    }
}

fn minutes_between(starts_at: DateTime<FixedOffset>, ends_at: DateTime<FixedOffset>) -> i64 {
    (ends_at - starts_at).num_minutes().max(0)
}

fn block_label(block: &TimeBlock) -> String {
    format!(
        "{} to {}",
        block.starts_at.format("%a %-I:%M %p"),
        block.ends_at.format("%-I:%M %p")
    )
}

/// `committed` is the database's blocks plus this run's, so both passes share it.
fn evaluate(
    candidate: &Candidate,
    slot: &Slot,
    committed: &[TimeBlock],
    load: RunLoad,
    policy: &RosterPolicy,
    options: &RosterOptions,
) -> Evaluation {
    let mut checks = Vec::new();

    let same_shift = candidate.assigned_shift_ids.contains(&slot.shift_id);
    checks.push(check(
        "Already on this shift",
        !same_shift,
        if same_shift {
            "This volunteer is already registered for the shift".into()
        } else {
            "Not registered yet".into()
        },
    ));

    if options.block_conflicts {
        let conflicting = committed
            .iter()
            .find(|block| overlaps(block.starts_at, block.ends_at, slot.starts_at, slot.ends_at));
        checks.push(check(
            "No overlapping shift",
            conflicting.is_none(),
            match conflicting {
                Some(block) => format!("Already booked {}", block_label(block)),
                None => "No shift overlaps this time".into(),
            },
        ));

        let narrow_gap = committed.iter().find(|block| {
            !overlaps(block.starts_at, block.ends_at, slot.starts_at, slot.ends_at)
                && gap_minutes(block, slot) < policy.minimum_gap_minutes
        });

        checks.push(check(
            "Rest between shifts",
            narrow_gap.is_none(),
            match narrow_gap {
                Some(block) => format!(
                    "Only {} minutes after {}",
                    gap_minutes(block, slot),
                    block_label(block)
                ),
                None if policy.minimum_gap_minutes > 0 => {
                    format!(
                        "At least {} minutes either side",
                        policy.minimum_gap_minutes
                    )
                }
                None => "No minimum gap set".into(),
            },
        ));
    }

    // Caps apply even when conflict blocking is off.
    if policy.max_shifts_per_day.is_some() || policy.max_minutes_per_day.is_some() {
        let same_day = committed
            .iter()
            .filter(|block| block.starts_at.date_naive() == slot.starts_at.date_naive())
            .count() as i64;
        let day_limit = policy.max_shifts_per_day();
        checks.push(check(
            "Daily shift limit",
            same_day < day_limit,
            format!(
                "{} of {} that day",
                same_day + 1,
                if day_limit == crate::policy::NO_LIMIT {
                    "unlimited".to_string()
                } else {
                    day_limit.to_string()
                }
            ),
        ));

        let day_minutes: i64 = committed
            .iter()
            .filter(|block| block.starts_at.date_naive() == slot.starts_at.date_naive())
            .map(|block| minutes_between(block.starts_at, block.ends_at))
            .sum();
        let minute_limit = policy.max_minutes_per_day();
        checks.push(check(
            "Daily minute limit",
            day_minutes + minutes_between(slot.starts_at, slot.ends_at) <= minute_limit,
            format!(
                "{} of {} minutes that day",
                day_minutes + minutes_between(slot.starts_at, slot.ends_at),
                if minute_limit == crate::policy::NO_LIMIT {
                    "unlimited".to_string()
                } else {
                    minute_limit.to_string()
                }
            ),
        ));
    }

    // The week cap runs when either the coordinator asked for it or the policy
    // names a number, so a stored limit is never silently ignored.
    if options.cap_weekly
        || policy.max_shifts_per_week.is_some()
        || policy.max_minutes_per_week.is_some()
    {
        let shifts = candidate.weekly_load + load.shifts + 1;
        let limit = if options.cap_weekly {
            policy.max_shifts_per_week().min(2)
        } else {
            policy.max_shifts_per_week()
        };
        checks.push(check(
            "Weekly shift limit",
            shifts <= limit,
            format!(
                "{shifts} of {} this week",
                if limit == crate::policy::NO_LIMIT {
                    "unlimited".to_string()
                } else {
                    limit.to_string()
                }
            ),
        ));

        let minutes =
            candidate.weekly_minutes + load.minutes + minutes_between(slot.starts_at, slot.ends_at);
        let limit = policy.max_minutes_per_week();
        checks.push(check(
            "Weekly minute limit",
            minutes <= limit,
            format!(
                "{minutes} of {} minutes this week",
                if limit == crate::policy::NO_LIMIT {
                    "unlimited".to_string()
                } else {
                    limit.to_string()
                }
            ),
        ));
    }

    let availability_key = format!("{}:{}", slot.day_key, period_for(slot.starts_at));
    if candidate.availability.is_empty() {
        checks.push(check(
            "Availability",
            false,
            "No availability on record".into(),
        ));
    } else {
        let available = candidate.availability.contains(&availability_key);
        checks.push(check(
            "Availability",
            available,
            if available {
                format!(
                    "Available {} {}",
                    slot.day_key.to_uppercase(),
                    period_for(slot.starts_at)
                )
            } else {
                format!(
                    "Not available {} {}",
                    slot.day_key.to_uppercase(),
                    period_for(slot.starts_at)
                )
            },
        ));
    }

    if let Some(required) = &slot.required_skill {
        let matched = has_skill(candidate, required);
        checks.push(check(
            "Required skill",
            matched,
            if matched {
                format!("{required} on the profile")
            } else {
                format!("Needs {required}")
            },
        ));
    }

    if let Some(required) = &slot.required_credential {
        let state = credential_state(candidate, required, slot.starts_at.date_naive());
        let (passed, detail) = match state {
            CredentialState::Current => (true, format!("{required} current")),
            CredentialState::Expired => (
                false,
                format!("{required} expired, unverified, or not yet valid"),
            ),
            CredentialState::Missing => (false, format!("No {required} on record")),
        };
        // An explicit policy may allow a missing record, never a known invalid one.
        let allowed = state == CredentialState::Missing
            && policy.unknown_credential_behavior
                == crate::policy::MissingRequirementBehavior::Allow;
        checks.push(check(
            "Required credential",
            passed || allowed,
            if passed {
                detail
            } else if allowed {
                format!("{detail}; the policy allows this")
            } else {
                detail
            },
        ));
    }

    if let Some(minimum_age) = slot.minimum_age {
        let shift_date = slot.starts_at.date_naive();
        let (passed, detail) = match candidate.birthdate {
            Some(birthdate) => {
                let age = age_on(birthdate, shift_date);
                (
                    age >= minimum_age,
                    if age >= minimum_age {
                        format!("{age} on the shift date")
                    } else {
                        format!("{age} on the shift date, needs {minimum_age}")
                    },
                )
            }
            None => (
                policy.unknown_age_behavior == crate::policy::MissingRequirementBehavior::Allow,
                if policy.unknown_age_behavior == crate::policy::MissingRequirementBehavior::Allow {
                    "No birthdate on record; the policy allows this".to_string()
                } else {
                    "No birthdate on record".to_string()
                },
            ),
        };
        checks.push(check("Minimum age", passed, detail));
    }

    let eligible = checks.iter().all(|check| check.passed);
    Evaluation { eligible, checks }
}

fn gap_minutes(block: &TimeBlock, slot: &Slot) -> i64 {
    if block.ends_at <= slot.starts_at {
        (slot.starts_at - block.ends_at).num_minutes()
    } else {
        (block.starts_at - slot.ends_at).num_minutes()
    }
}

pub fn explain_selection(
    candidate: &Candidate,
    slot: &Slot,
    policy: &RosterPolicy,
    options: &RosterOptions,
    selected: bool,
) -> MatchExplanation {
    explain(
        candidate,
        slot,
        &candidate.assigned_blocks,
        RunLoad::default(),
        policy,
        options,
        selected,
    )
}

/// True when every hard requirement for this seat is met, using only what the
/// database already knows about the candidate's commitments.
pub fn is_eligible_explained(
    candidate: &Candidate,
    slot: &Slot,
    policy: &RosterPolicy,
    options: &RosterOptions,
) -> bool {
    evaluate(
        candidate,
        slot,
        &candidate.assigned_blocks,
        RunLoad::default(),
        policy,
        options,
    )
    .eligible
}

/// The verdict alone, with the rejection reason.
fn is_eligible(
    candidate: &Candidate,
    slot: &Slot,
    policy: &RosterPolicy,
    options: &RosterOptions,
) -> Result<(), String> {
    let evaluation = evaluate(
        candidate,
        slot,
        &candidate.assigned_blocks,
        RunLoad::default(),
        policy,
        options,
    );
    if evaluation.eligible {
        Ok(())
    } else {
        Err(evaluation
            .rejection()
            .unwrap_or_else(|| "Not eligible".into()))
    }
}

fn speaks_spanish(candidate: &Candidate) -> bool {
    candidate.languages.iter().any(|value| value == "Spanish") || has_skill(candidate, "Spanish")
}

fn share(weight: i32, numerator: i32, denominator: i32) -> i32 {
    (weight * numerator) / denominator
}

fn score_candidate(
    candidate: &Candidate,
    slot: &Slot,
    policy: &RosterPolicy,
    options: &RosterOptions,
) -> (ScoreBreakdown, Vec<ScoreComponent>) {
    let skill = match &slot.required_skill {
        Some(required) if has_skill(candidate, required) => policy.skill_weight,
        Some(_) => 0,
        // No requirement: a slightly smaller share than a matched skill.
        None => share(policy.skill_weight, 6, 7),
    };
    let availability = AVAILABILITY_POINTS;
    let interested = candidate.causes.iter().any(|cause| cause == &slot.cause);
    let interest = if interested {
        policy.interest_weight
    } else {
        0
    };
    let role_lower = slot.role.to_lowercase();
    let spanish = speaks_spanish(candidate);
    let preference = if role_lower.contains("spanish") && spanish {
        policy.language_weight
    } else if options.prefer_spanish && spanish {
        share(policy.language_weight, 8, 10)
    } else {
        share(policy.language_weight, 6, 10)
    };
    let fairness = share(
        policy.fairness_weight,
        10 - (candidate.weekly_load.min(4) * 2) as i32,
        10,
    );
    let reliability = if candidate.events_completed == 0 {
        share(policy.reliability_weight, 3, 5)
    } else {
        ((candidate.attendance_rate as f64 / 100.0) * policy.reliability_weight as f64).round()
            as i32
    };
    let total =
        (skill + availability + interest + preference + fairness + reliability).clamp(0, MAX_SCORE);
    (
        ScoreBreakdown {
            skill,
            availability,
            interest,
            preference,
            fairness,
            reliability,
            total,
        },
        vec![
            ScoreComponent {
                label: "Skill".into(),
                awarded: skill,
                maximum: policy.skill_weight,
            },
            ScoreComponent {
                label: "Availability".into(),
                awarded: availability,
                maximum: AVAILABILITY_POINTS,
            },
            ScoreComponent {
                label: "Interest".into(),
                awarded: interest,
                maximum: policy.interest_weight,
            },
            ScoreComponent {
                label: "Language".into(),
                awarded: preference,
                maximum: policy.language_weight,
            },
            ScoreComponent {
                label: "Fairness".into(),
                awarded: fairness,
                maximum: policy.fairness_weight,
            },
            ScoreComponent {
                label: "Reliability".into(),
                awarded: reliability,
                maximum: policy.reliability_weight,
            },
        ],
    )
}

/// The sentence a coordinator reads first: why this person, or why not.
fn selection_reason(
    candidate: &Candidate,
    slot: &Slot,
    evaluation: &Evaluation,
    score: Option<&ScoreBreakdown>,
) -> String {
    let Some(failed) = evaluation.checks.iter().find(|check| !check.passed) else {
        let mut parts = Vec::new();
        if let Some(required) = &slot.required_skill {
            if has_skill(candidate, required) {
                parts.push(format!("matches the required {required} skill"));
            }
        } else {
            parts.push("passes every requirement".to_string());
        }
        if candidate.causes.iter().any(|cause| cause == &slot.cause) {
            parts.push(format!("is interested in {}", slot.cause));
        }
        if let Some(score) = score {
            if score.reliability >= 4 {
                parts.push(format!("has {}% attendance", candidate.attendance_rate));
            }
        }
        return format!("{} {}", candidate.name, parts.join(", "));
    };
    format!(
        "{} failed one requirement — {}",
        candidate.name,
        failed.name.to_lowercase() + ": " + &failed.detail
    )
}

/// The full answer for one candidate and one slot.
#[allow(clippy::too_many_arguments)]
fn explain(
    candidate: &Candidate,
    slot: &Slot,
    committed: &[TimeBlock],
    load: RunLoad,
    policy: &RosterPolicy,
    options: &RosterOptions,
    selected: bool,
) -> MatchExplanation {
    let evaluation = evaluate(candidate, slot, committed, load, policy, options);
    let (breakdown, components) = score_candidate(candidate, slot, policy, options);
    let total_score = evaluation.eligible.then_some(breakdown.total);
    MatchExplanation {
        candidate_id: candidate.id.clone(),
        candidate_name: candidate.name.clone(),
        candidate_initials: candidate.initials.clone(),
        slot_id: slot.id.clone(),
        shift_id: slot.shift_id.clone(),
        role: slot.role.clone(),
        eligible: evaluation.eligible,
        checks: evaluation.checks.clone(),
        components,
        total_score,
        selected,
        selection_reason: selection_reason(candidate, slot, &evaluation, Some(&breakdown)),
    }
}

fn reasons(candidate: &Candidate, slot: &Slot, score: &ScoreBreakdown) -> Vec<String> {
    let mut result = Vec::new();
    if let Some(required) = &slot.required_skill {
        if has_skill(candidate, required) {
            result.push(format!("{required} skill matched"));
        }
    } else {
        result.push(format!(
            "{} skill fit",
            candidate
                .skills
                .first()
                .map(String::as_str)
                .unwrap_or("General")
        ));
    }
    result.push(format!(
        "Available {} {}",
        slot.day_key.to_uppercase(),
        period_for(slot.starts_at)
    ));
    if candidate.causes.iter().any(|cause| cause == &slot.cause) {
        result.push(format!("Interested in {}", slot.cause));
    }
    if score.reliability >= 4 {
        result.push(format!("{}% attendance", candidate.attendance_rate));
    }
    result.truncate(3);
    result
}

/// Shared by both passes so either source reports the same explanation.
#[allow(clippy::too_many_arguments)]
fn assignment_for(
    candidate: &Candidate,
    slot: &Slot,
    committed: &[TimeBlock],
    load: RunLoad,
    policy: &RosterPolicy,
    options: &RosterOptions,
    slots: &[&Slot],
) -> PlannedAssignment {
    let (score, _) = score_candidate(candidate, slot, policy, options);
    PlannedAssignment {
        shift_id: slot.shift_id.clone(),
        opportunity_id: slot.opportunity_id.clone(),
        shift_title: slot.shift_title.clone(),
        role: slot.role.clone(),
        candidate_id: candidate.id.clone(),
        candidate_name: candidate.name.clone(),
        candidate_initials: candidate.initials.clone(),
        starts_at: slot.starts_at.to_rfc3339(),
        score: score.total,
        breakdown: score.clone(),
        reasons: reasons(candidate, slot, &score),
        promote_waitlist: candidate.waitlisted_shift_ids.contains(&slot.shift_id),
        eligible_roles: slots
            .iter()
            .filter(|other| other.shift_id == slot.shift_id)
            .filter(|other| is_eligible(candidate, other, policy, options).is_ok())
            .map(|other| other.role.clone())
            .collect(),
        explanation: explain(candidate, slot, committed, load, policy, options, true),
    }
}

// Solver orchestration lives in planner; public APIs are re-exported.

#[cfg(test)]
mod tests;
