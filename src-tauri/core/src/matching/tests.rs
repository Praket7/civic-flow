//! Existing matching tests preserved during modularization.
use super::*;

fn date(value: &str) -> DateTime<FixedOffset> {
    DateTime::parse_from_rfc3339(value).unwrap()
}

fn policy() -> RosterPolicy {
    RosterPolicy::default()
}

fn options() -> RosterOptions {
    RosterOptions::default()
}

fn candidate(id: &str, skills: &[&str], availability: &[&str]) -> Candidate {
    Candidate {
        id: id.into(),
        name: id.into(),
        initials: id.chars().take(2).collect::<String>().to_uppercase(),
        skills: skills.iter().map(|value| value.to_string()).collect(),
        languages: vec!["English".into()],
        causes: vec!["food".into()],
        availability: availability.iter().map(|value| value.to_string()).collect(),
        birthdate: Some(NaiveDate::from_ymd_opt(1995, 1, 1).unwrap()),
        attendance_rate: 95,
        events_completed: 5,
        credentials: Vec::new(),
        assigned_blocks: Vec::new(),
        assigned_shift_ids: HashSet::new(),
        waitlisted_shift_ids: HashSet::new(),
        weekly_load: 0,
        weekly_minutes: 0,
    }
}

fn slot(id: &str, role: &str, skill: Option<&str>, starts_at: &str) -> Slot {
    let starts_at = date(starts_at);
    Slot {
        id: id.into(),
        shift_id: id.into(),
        opportunity_id: "opp-1".into(),
        shift_title: "Food distribution".into(),
        role: role.into(),
        cause: "food".into(),
        day_key: day_key(starts_at.date_naive()),
        starts_at,
        ends_at: starts_at + chrono::Duration::hours(3),
        required_skill: skill.map(|value| value.to_string()),
        required_credential: None,
        minimum_age: None,
        mandatory: skill.is_some(),
    }
}

#[test]
fn fills_more_slots_than_a_greedy_first_pick() {
    let candidates = vec![
        candidate("a", &["Spanish"], &["sat:morning"]),
        candidate("b", &["Driver"], &["sat:morning"]),
    ];
    let slots = vec![
        slot(
            "s1",
            "Spanish Support",
            Some("Spanish"),
            "2026-10-17T09:00:00-04:00",
        ),
        slot("s2", "Driver", Some("Driver"), "2026-10-17T09:00:00-04:00"),
    ];
    let plan = plan(&candidates, &slots, &policy(), &options());
    assert_eq!(plan.assignments.len(), 2);
    assert!(plan.total_score >= 180);
    assert!(plan.unfilled.is_empty());
}

#[test]
fn rejects_candidates_without_the_mandatory_skill() {
    let candidates = vec![candidate("a", &["Tutoring"], &["sat:morning"])];
    let slots = vec![slot(
        "s1",
        "Spanish Support",
        Some("Spanish"),
        "2026-10-17T09:00:00-04:00",
    )];
    let plan = plan(&candidates, &slots, &policy(), &options());
    assert!(plan.assignments.is_empty());
    assert_eq!(plan.unfilled.len(), 1);
    assert_eq!(plan.unfilled[0].required_skill.as_deref(), Some("Spanish"));
}

#[test]
fn overlapping_shifts_cannot_share_a_volunteer() {
    let candidates = vec![candidate("a", &["Driver"], &["sat:morning"])];
    let slots = vec![
        slot("s1", "Driver", Some("Driver"), "2026-10-17T09:00:00-04:00"),
        slot("s2", "Driver", Some("Driver"), "2026-10-17T11:00:00-04:00"),
    ];
    let plan = plan(&candidates, &slots, &policy(), &options());
    assert_eq!(plan.assignments.len(), 1);
    assert_eq!(plan.unfilled.len(), 1);
}

#[test]
fn two_shifts_on_one_day_fill_when_they_do_not_overlap() {
    let candidates = vec![candidate(
        "a",
        &["Driver"],
        &["sat:morning", "sat:afternoon"],
    )];
    let slots = vec![
        slot("s1", "Driver", Some("Driver"), "2026-10-17T09:00:00-04:00"),
        slot("s2", "Driver", Some("Driver"), "2026-10-17T14:00:00-04:00"),
    ];
    let plan = plan(&candidates, &slots, &policy(), &options());
    assert_eq!(plan.assignments.len(), 2);
    assert!(plan.unfilled.is_empty());
    assert!(plan
        .assignments
        .iter()
        .all(|assignment| assignment.candidate_id == "a"));
}

#[test]
fn a_shift_that_starts_when_another_ends_is_not_a_conflict() {
    let candidates = vec![candidate(
        "a",
        &["Driver"],
        &["sat:morning", "sat:afternoon"],
    )];
    let slots = vec![
        slot("s1", "Driver", Some("Driver"), "2026-10-17T09:00:00-04:00"),
        slot("s2", "Driver", Some("Driver"), "2026-10-17T12:00:00-04:00"),
    ];
    let plan = plan(&candidates, &slots, &policy(), &options());
    assert_eq!(plan.assignments.len(), 2);
}

#[test]
fn a_committed_shift_only_blocks_the_time_it_covers() {
    let mut busy = candidate("a", &["Driver"], &["sat:morning", "sat:afternoon"]);
    busy.assigned_blocks = vec![TimeBlock {
        starts_at: date("2026-10-17T09:00:00-04:00"),
        ends_at: date("2026-10-17T12:00:00-04:00"),
    }];

    let overlapping = vec![slot(
        "s1",
        "Driver",
        Some("Driver"),
        "2026-10-17T11:00:00-04:00",
    )];
    assert!(plan(
        std::slice::from_ref(&busy),
        &overlapping,
        &policy(),
        &options()
    )
    .assignments
    .is_empty());

    let later = vec![slot(
        "s2",
        "Driver",
        Some("Driver"),
        "2026-10-17T14:00:00-04:00",
    )];
    assert_eq!(
        plan(std::slice::from_ref(&busy), &later, &policy(), &options())
            .assignments
            .len(),
        1
    );
}

#[test]
fn a_role_with_a_minimum_age_rejects_an_unknown_birthdate() {
    let mut unknown = candidate("a", &["Driver"], &["sat:morning"]);
    unknown.birthdate = None;
    let mut restricted = slot("s1", "Driver", Some("Driver"), "2026-10-17T09:00:00-04:00");
    restricted.minimum_age = Some(18);

    let reason = is_eligible(&unknown, &restricted, &policy(), &options()).unwrap_err();
    assert!(reason.contains("Minimum age"), "{reason}");
    assert!(reason.contains("No birthdate on record"), "{reason}");
    let plan = plan(&[unknown], &[restricted], &policy(), &options());
    assert!(plan.assignments.is_empty());
    assert_eq!(plan.unfilled.len(), 1);
}

#[test]
fn the_age_boundary_is_the_shift_date() {
    let shift_date = NaiveDate::from_ymd_opt(2026, 10, 17).unwrap();
    let mut exact = candidate("a", &["Driver"], &["sat:morning"]);
    exact.birthdate = NaiveDate::from_ymd_opt(2008, 10, 17);
    let mut a_day_short = candidate("b", &["Driver"], &["sat:morning"]);
    a_day_short.birthdate = NaiveDate::from_ymd_opt(2008, 10, 18);
    let mut restricted = slot("s1", "Driver", Some("Driver"), "2026-10-17T09:00:00-04:00");
    restricted.minimum_age = Some(18);
    let options = RosterOptions::default();

    assert_eq!(age_on(exact.birthdate.unwrap(), shift_date), 18);
    assert_eq!(age_on(a_day_short.birthdate.unwrap(), shift_date), 17);
    assert!(is_eligible(&exact, &restricted, &policy(), &options).is_ok());
    assert!(is_eligible(&a_day_short, &restricted, &policy(), &options).is_err());
}

#[test]
fn a_leap_day_birthday_ages_on_the_first_of_march() {
    let born = NaiveDate::from_ymd_opt(2008, 2, 29).unwrap();
    assert_eq!(
        age_on(born, NaiveDate::from_ymd_opt(2026, 2, 28).unwrap()),
        17
    );
    assert_eq!(
        age_on(born, NaiveDate::from_ymd_opt(2026, 3, 1).unwrap()),
        18
    );
}

#[test]
fn a_required_credential_must_be_current() {
    let shift_date = NaiveDate::from_ymd_opt(2026, 10, 17).unwrap();
    let mut restricted = slot("s1", "Driver", Some("Driver"), "2026-10-17T09:00:00-04:00");
    restricted.required_credential = Some("Safe driver clearance".into());
    let options = RosterOptions::default();

    let unverified = candidate("a", &["Driver"], &["sat:morning"]);
    let missing = is_eligible(&unverified, &restricted, &policy(), &options).unwrap_err();
    assert!(missing.contains("Required credential"), "{missing}");
    assert!(missing.contains("No Safe driver clearance"), "{missing}");

    let mut expired = candidate("b", &["Driver"], &["sat:morning"]);
    expired.credentials = vec![Credential {
        name: "Safe driver clearance".into(),
        valid_from: Some(NaiveDate::MIN),
        valid_through: Some(shift_date - chrono::Duration::days(1)),
        verified: true,
    }];
    let lapsed = is_eligible(&expired, &restricted, &policy(), &options).unwrap_err();
    assert!(lapsed.contains("Required credential"), "{lapsed}");
    assert!(lapsed.contains("expired"), "{lapsed}");

    let mut current = candidate("c", &["Driver"], &["sat:morning"]);
    current.credentials = vec![Credential {
        name: "Safe driver clearance".into(),
        valid_from: Some(NaiveDate::MIN),
        valid_through: Some(shift_date),
        verified: true,
    }];
    assert!(is_eligible(&current, &restricted, &policy(), &options).is_ok());

    let mut future = current.clone();
    future.credentials[0].valid_from = Some(shift_date + chrono::Duration::days(1));
    let mut pending = current.clone();
    pending.credentials[0].verified = false;
    for candidate in [&future, &pending] {
        assert!(is_eligible(candidate, &restricted, &policy(), &options).is_err());
    }

    let plan = plan(&[unverified, expired, future, pending], &[restricted], &policy(), &options);
    assert!(plan.assignments.is_empty());
}

#[test]
fn match_quality_still_decides_between_mandatory_slots() {
    let candidates = vec![candidate("a", &["Spanish"], &["sat:morning"])];
    let mut general = slot("s2", "General", None, "2026-10-17T09:00:00-04:00");
    general.mandatory = true;
    let slots = vec![
        slot(
            "s1",
            "Spanish Support",
            Some("Spanish"),
            "2026-10-17T09:00:00-04:00",
        ),
        general,
    ];
    let plan = plan(&candidates, &slots, &policy(), &options());
    assert_eq!(plan.assignments.len(), 1);
    assert_eq!(plan.assignments[0].role, "Spanish Support");
}

#[test]
fn required_roles_fill_before_optional_roles() {
    let candidates = vec![candidate("a", &["Driver"], &["sat:morning"])];
    let mut optional = slot("s2", "General", None, "2026-10-17T09:00:00-04:00");
    optional.mandatory = false;
    let slots = vec![
        slot("s1", "Driver", Some("Driver"), "2026-10-17T09:00:00-04:00"),
        optional,
    ];
    let plan = plan(&candidates, &slots, &policy(), &options());
    assert_eq!(plan.assignments.len(), 1);
    assert_eq!(plan.assignments[0].role, "Driver");
}

struct BruteForce<'a> {
    candidates: &'a [Candidate],
    slots: &'a [Slot],
    options: &'a RosterOptions,
    used_slots: Vec<bool>,
    used_days: HashSet<(String, String)>,
    best: (usize, i32),
}

impl BruteForce<'_> {
    fn walk(&mut self, index: usize, count: usize, score: i32) {
        if index == self.candidates.len() {
            if count > self.best.0 || (count == self.best.0 && score > self.best.1) {
                self.best = (count, score);
            }
            return;
        }
        self.walk(index + 1, count, score);
        let candidate = &self.candidates[index];
        for (slot_index, slot) in self.slots.iter().enumerate() {
            if self.used_slots[slot_index] {
                continue;
            }
            let day = (candidate.id.clone(), slot.day_key.clone());
            if self.used_days.contains(&day) {
                continue;
            }
            if is_eligible(candidate, slot, &policy(), self.options).is_err() {
                continue;
            }
            let points = score_candidate(candidate, slot, &policy(), self.options)
                .0
                .total;
            self.used_slots[slot_index] = true;
            self.used_days.insert(day.clone());
            self.walk(index + 1, count + 1, score + points);
            self.used_days.remove(&day);
            self.used_slots[slot_index] = false;
        }
    }
}

fn brute_force(candidates: &[Candidate], slots: &[Slot], options: &RosterOptions) -> (usize, i32) {
    let mut search = BruteForce {
        candidates,
        slots,
        options,
        used_slots: vec![false; slots.len()],
        used_days: HashSet::new(),
        best: (0, 0),
    };
    search.walk(0, 0, 0);
    search.best
}

#[test]
fn matches_the_brute_force_optimum_on_a_known_case() {
    let candidates = vec![
        candidate("a", &["Spanish", "Driver"], &["sat:morning"]),
        candidate("b", &["Spanish"], &["sat:morning"]),
        candidate("c", &["Driver"], &["sat:morning"]),
    ];
    let slots = vec![
        slot(
            "s1",
            "Spanish Support",
            Some("Spanish"),
            "2026-10-17T09:00:00-04:00",
        ),
        slot("s2", "Driver", Some("Driver"), "2026-10-17T13:00:00-04:00"),
        slot("s3", "General", None, "2026-10-17T13:00:00-04:00"),
    ];
    let options = RosterOptions::default();
    let plan = plan(&candidates, &slots, &policy(), &options);
    let oracle = brute_force(&candidates, &slots, &options);
    assert_eq!(plan.assignments.len(), oracle.0);
    assert_eq!(plan.total_score, oracle.1);
}

/// Exhaustively compare small, simultaneous volunteer-skill instances
/// against an independent combinatorial oracle. Required skills remain hard
/// constraints; all seats have equal priority so objective scores are comparable.
#[test]
fn matches_brute_force_across_skill_scarcity_cases() {
    for mask in 0u8..64 {
        let mut candidates = vec![
            candidate("a", &["Food Safety"], &["sat:morning"]),
            candidate("b", &["Food Safety"], &["sat:morning"]),
            candidate("c", &["Food Safety"], &["sat:morning"]),
        ];
        for (index, candidate) in candidates.iter_mut().enumerate() {
            if mask & (1 << index) == 0 {
                candidate.skills.clear();
            }
        }
        let starts_at = "2026-10-17T09:00:00-04:00";
        let mut slots = vec![
            slot("s1", "Role 1", None, starts_at),
            slot("s2", "Role 2", None, starts_at),
            slot("s3", "Role 3", None, starts_at),
        ];
        for (index, slot) in slots.iter_mut().enumerate() {
            if mask & (1 << (index + 3)) != 0 {
                slot.required_skill = Some("Food Safety".into());
            }
            slot.mandatory = false;
        }

        let actual = plan(&candidates, &slots, &policy(), &options());
        let expected = brute_force(&candidates, &slots, &options());
        assert_eq!(
            actual.assignments.len(),
            expected.0,
            "fill differs for skill mask {mask}"
        );
        assert_eq!(
            actual.total_score, expected.1,
            "score differs for skill mask {mask}"
        );
        assert_eq!(
            actual.assignments.len() + actual.unfilled.len(),
            slots.len()
        );
        assert!(actual
            .assignments
            .iter()
            .all(|a| a.explanation.eligible && a.explanation.selected));
    }
}

#[test]
fn plan_is_deterministic_for_identical_inputs() {
    let candidates = vec![
        candidate("b", &["Spanish"], &["sat:morning"]),
        candidate("a", &["Spanish"], &["sat:morning"]),
    ];
    let slots = vec![slot(
        "s1",
        "Spanish Support",
        Some("Spanish"),
        "2026-10-17T09:00:00-04:00",
    )];
    let first = plan(&candidates, &slots, &policy(), &options());
    let second = plan(&candidates, &slots, &policy(), &options());
    assert_eq!(first, second);
    assert_eq!(first.assignments[0].candidate_id, "a");
}

fn policy_with(change: impl FnOnce(&mut RosterPolicy)) -> RosterPolicy {
    let mut policy = RosterPolicy::default();
    change(&mut policy);
    policy
}

#[test]
fn a_daily_shift_cap_stops_a_second_shift_on_the_same_day() {
    let candidates = vec![candidate(
        "a",
        &["Driver"],
        &["sat:morning", "sat:afternoon"],
    )];
    let slots = vec![
        slot("s1", "Driver", Some("Driver"), "2026-10-17T09:00:00-04:00"),
        slot("s2", "Driver", Some("Driver"), "2026-10-17T14:00:00-04:00"),
    ];

    let one = policy_with(|policy| policy.max_shifts_per_day = Some(1));
    let capped = plan(&candidates, &slots, &one, &options());
    assert_eq!(capped.assignments.len(), 1);
    assert_eq!(capped.unfilled.len(), 1);

    let two = policy_with(|policy| policy.max_shifts_per_day = Some(2));
    let generous = plan(&candidates, &slots, &two, &options());
    assert_eq!(generous.assignments.len(), 2);
    assert!(generous.unfilled.is_empty());
}

#[test]
fn a_daily_minute_cap_counts_time_rather_than_shifts() {
    let candidates = vec![candidate(
        "a",
        &["Driver"],
        &["sat:morning", "sat:afternoon"],
    )];
    let slots = vec![
        slot("s1", "Driver", Some("Driver"), "2026-10-17T09:00:00-04:00"),
        slot("s2", "Driver", Some("Driver"), "2026-10-17T14:00:00-04:00"),
    ];

    // Two three-hour shifts do not fit inside four hours.
    let four_hours = policy_with(|policy| policy.max_minutes_per_day = Some(240));
    assert_eq!(
        plan(&candidates, &slots, &four_hours, &options())
            .assignments
            .len(),
        1
    );

    let roomy = policy_with(|policy| policy.max_minutes_per_day = Some(960));
    assert_eq!(
        plan(&candidates, &slots, &roomy, &options())
            .assignments
            .len(),
        2
    );
}

#[test]
fn a_weekly_shift_cap_counts_the_shifts_already_committed() {
    let mut loaded = candidate("a", &["Driver"], &["sat:morning"]);
    loaded.weekly_load = 2;
    let mut almost = candidate("b", &["Driver"], &["sat:morning"]);
    almost.weekly_load = 1;

    let slots = vec![slot(
        "s1",
        "Driver",
        Some("Driver"),
        "2026-10-17T09:00:00-04:00",
    )];
    let two = policy_with(|policy| policy.max_shifts_per_week = Some(2));
    let plan = plan(&[loaded, almost], &slots, &two, &options());
    assert_eq!(plan.assignments.len(), 1);
    assert_eq!(plan.assignments[0].candidate_id, "b");
}

#[test]
fn a_weekly_minute_cap_counts_the_minutes_already_committed() {
    let mut loaded = candidate("a", &["Driver"], &["sat:morning"]);
    loaded.weekly_minutes = 540;
    let slots = vec![slot(
        "s1",
        "Driver",
        Some("Driver"),
        "2026-10-17T09:00:00-04:00",
    )];
    let ten_hours = policy_with(|policy| policy.max_minutes_per_week = Some(600));
    assert!(plan(&[loaded], &slots, &ten_hours, &options())
        .assignments
        .is_empty());
}

#[test]
fn a_minimum_gap_keeps_a_shift_from_following_too_closely() {
    let mut rested = candidate("a", &["Driver"], &["sat:morning", "sat:afternoon"]);
    rested.assigned_blocks = vec![TimeBlock {
        starts_at: date("2026-10-17T09:00:00-04:00"),
        ends_at: date("2026-10-17T12:00:00-04:00"),
    }];
    let two_hours = policy_with(|policy| policy.minimum_gap_minutes = 120);

    let soon = vec![slot(
        "s1",
        "Driver",
        Some("Driver"),
        "2026-10-17T13:00:00-04:00",
    )];
    assert!(
        plan(std::slice::from_ref(&rested), &soon, &two_hours, &options())
            .assignments
            .is_empty()
    );

    let later = vec![slot(
        "s2",
        "Driver",
        Some("Driver"),
        "2026-10-17T15:00:00-04:00",
    )];
    assert_eq!(
        plan(
            std::slice::from_ref(&rested),
            &later,
            &two_hours,
            &options()
        )
        .assignments
        .len(),
        1
    );
}

#[test]
fn an_unknown_age_may_be_allowed_by_policy() {
    let mut unknown = candidate("a", &["Driver"], &["sat:morning"]);
    unknown.birthdate = None;
    let mut restricted = slot("s1", "Driver", Some("Driver"), "2026-10-17T09:00:00-04:00");
    restricted.minimum_age = Some(18);

    assert!(is_eligible(&unknown, &restricted, &policy(), &options()).is_err());

    let permissive = policy_with(|policy| {
        policy.unknown_age_behavior = crate::policy::MissingRequirementBehavior::Allow
    });
    assert!(is_eligible(&unknown, &restricted, &permissive, &options()).is_ok());
}

#[test]
fn a_missing_credential_may_be_allowed_by_policy_but_a_lapsed_one_never_is() {
    let mut required = slot("s1", "Driver", Some("Driver"), "2026-10-17T09:00:00-04:00");
    required.required_credential = Some("Safe driver clearance".into());
    let permissive = policy_with(|policy| {
        policy.unknown_credential_behavior = crate::policy::MissingRequirementBehavior::Allow
    });

    let missing = candidate("a", &["Driver"], &["sat:morning"]);
    assert!(is_eligible(&missing, &required, &permissive, &options()).is_ok());

    let mut expired = candidate("b", &["Driver"], &["sat:morning"]);
    expired.credentials = vec![Credential {
        name: "Safe driver clearance".into(),
        valid_from: Some(NaiveDate::MIN),
        valid_through: Some(NaiveDate::from_ymd_opt(2026, 10, 16).unwrap()),
        verified: true,
    }];
    assert!(is_eligible(&expired, &required, &permissive, &options()).is_err());
}

#[test]
fn a_plan_names_the_policy_version_it_followed() {
    let policy = policy_with(|policy| policy.version = 9);
    let candidates = vec![candidate("a", &["Driver"], &["sat:morning"])];
    let slots = vec![slot(
        "s1",
        "Driver",
        Some("Driver"),
        "2026-10-17T09:00:00-04:00",
    )];
    let plan = plan(&candidates, &slots, &policy, &options());
    assert_eq!(plan.policy_version, 9);
}

#[test]
fn a_policy_weight_moves_the_score_without_moving_the_rules() {
    let candidates = vec![candidate("a", &["Driver"], &["sat:morning"])];
    let slots = vec![slot(
        "s1",
        "Driver",
        Some("Driver"),
        "2026-10-17T09:00:00-04:00",
    )];

    let shipped = plan(&candidates, &slots, &policy(), &options());
    assert_eq!(shipped.assignments[0].breakdown.skill, 35);

    let lowered = policy_with(|policy| policy.skill_weight = 15);
    let lowered_plan = plan(&candidates, &slots, &lowered, &options());
    assert_eq!(lowered_plan.assignments[0].breakdown.skill, 15);
    assert!(lowered_plan.assignments[0].score < shipped.assignments[0].score);
    assert_eq!(lowered_plan.assignments.len(), 1);
}

#[test]
fn every_assignment_carries_the_checks_and_components_behind_it() {
    let mut required = slot("s1", "Driver", Some("Driver"), "2026-10-17T09:00:00-04:00");
    required.required_credential = Some("Safe driver clearance".into());
    let mut qualified = candidate("a", &["Driver"], &["sat:morning"]);
    qualified.credentials = vec![Credential {
        name: "Safe driver clearance".into(),
        valid_from: Some(NaiveDate::MIN),
        valid_through: Some(NaiveDate::from_ymd_opt(2027, 1, 1).unwrap()),
        verified: true,
    }];

    let plan = plan(&[qualified], &[required], &policy(), &options());
    assert_eq!(plan.assignments.len(), 1);
    let explanation = &plan.assignments[0].explanation;
    assert!(explanation.eligible);
    assert!(explanation.selected);
    assert_eq!(explanation.total_score, Some(plan.assignments[0].score));
    assert!(explanation.checks.iter().all(|check| check.passed));
    assert!(explanation
        .checks
        .iter()
        .any(|check| check.name == "Required credential" && check.detail.contains("current")));
    let awarded: i32 = explanation.components.iter().map(|row| row.awarded).sum();
    assert_eq!(awarded, explanation.total_score.unwrap());
    assert!(explanation
        .selection_reason
        .contains("matches the required Driver skill"));
}

use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(48))]

    #[test]
    fn random_small_cases_match_the_oracle(
        candidate_count in 1usize..=5,
        slot_count in 1usize..=5,
        flags in proptest::collection::vec(0u8..2, 10),
    ) {
        let mut candidates = Vec::new();
        for (index, flag) in flags.iter().take(candidate_count).enumerate() {
            let skill = if *flag == 0 { "Spanish" } else { "Driver" };
            candidates.push(candidate(
                &format!("c{index}"),
                &[skill],
                &["sat:morning"],
            ));
        }
        let mut slots = Vec::new();
        for (index, flag) in flags
            .iter()
            .skip(candidate_count)
            .take(slot_count)
            .enumerate()
        {
            let skill = if *flag == 0 {
                "Spanish"
            } else {
                "Driver"
            };
            slots.push(slot(
                &format!("s{index}"),
                if skill == "Spanish" { "Spanish Support" } else { "Driver" },
                Some(skill),
                "2026-10-17T09:00:00-04:00",
            ));
        }
        let options = RosterOptions::default();
        let plan = plan(&candidates, &slots, &policy(), &options);
        let oracle = brute_force(&candidates, &slots, &options);
        prop_assert_eq!(plan.assignments.len(), oracle.0);
        prop_assert_eq!(plan.total_score, oracle.1);
        prop_assert!(plan
            .assignments
            .iter()
            .enumerate()
            .all(|(index, assignment)| plan.assignments[index + 1..]
                .iter()
                .all(|other| other.candidate_id != assignment.candidate_id)));
    }
}

#[test]
fn performance_500_candidates_and_100_slots() {
    let mut candidates = Vec::new();
    for index in 0..500 {
        let mut candidate = candidate(
            &format!("vol-{index:03}"),
            if index % 2 == 0 {
                &["Spanish"]
            } else {
                &["Driver"]
            },
            &["sat:morning"],
        );
        candidate.attendance_rate = 80 + (index % 20) as i64;
        candidates.push(candidate);
    }
    let mut slots = Vec::new();
    for index in 0..100 {
        let mut slot = slot(
            &format!("slot-{index:03}"),
            if index % 2 == 0 {
                "Spanish Support"
            } else {
                "Driver"
            },
            Some(if index % 2 == 0 { "Spanish" } else { "Driver" }),
            "2026-10-17T09:00:00-04:00",
        );
        slot.shift_id = format!("shift-{}", index / 5);
        slots.push(slot);
    }
    let started = std::time::Instant::now();
    let plan = plan(&candidates, &slots, &policy(), &options());
    let elapsed = started.elapsed();
    assert_eq!(plan.assignments.len(), 100);
    assert!(elapsed.as_secs_f64() < 5.0, "planner took {elapsed:?}");
}
/// Reproducible local performance harness. Ignored in normal unit CI;
/// run explicitly with --ignored --nocapture. Times are diagnostics, not
/// a service-level guarantee, and include the explainable eligibility pass.
#[test]
#[ignore = "manual AutoRoster scale benchmark"]
fn benchmark_realistic_volunteer_and_shift_counts() {
    use std::time::Instant;
    for (volunteer_count, slot_count) in [(50, 12), (120, 30), (200, 50)] {
        let candidates: Vec<Candidate> = (0..volunteer_count)
            .map(|i| candidate(&format!("benchmark-v-{i:03}"), &[], &["sat:morning"]))
            .collect();
        let slots: Vec<Slot> = (0..slot_count)
            .map(|i| {
                slot(
                    &format!("benchmark-slot-{i:03}"),
                    "General",
                    None,
                    "2026-10-17T09:00:00-04:00",
                )
            })
            .collect();
        let mut timings_ms: Vec<f64> = Vec::new();
        let baseline = plan(&candidates, &slots, &policy(), &options());
        assert_eq!(baseline.assignments.len(), slot_count);
        for _ in 0..5 {
            let begin = Instant::now();
            let again = plan(&candidates, &slots, &policy(), &options());
            timings_ms.push(begin.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(
                again.assignments, baseline.assignments,
                "Optimizer changed its answer"
            );
        }
        timings_ms.sort_by(|a, b| a.total_cmp(b));
        println!(
            "AutoRoster volunteers={} slots={} median_ms={:.2} max_ms={:.2}",
            volunteer_count, slot_count, timings_ms[2], timings_ms[4]
        );
    }
}

#[test]
fn cross_day_caps_and_explanations_hold_for_the_whole_plan() {
    let people = vec![candidate("a", &["Driver"], &["sat:morning", "sun:morning"])];
    let slots = vec![
        slot("s1", "Driver", Some("Driver"), "2026-10-17T09:00:00-04:00"),
        slot("s2", "Driver", Some("Driver"), "2026-10-18T09:00:00-04:00"),
        slot("s3", "Driver", Some("Driver"), "2026-10-24T09:00:00-04:00"),
    ];
    let limit = policy_with(|p| p.max_shifts_per_week = Some(1));
    let result = plan(&people, &slots, &limit, &options());
    assert_eq!(result.assignments.len(), 1);
    assert!(result.assignments[0].explanation.eligible);
    let mut capped = options();
    capped.cap_weekly = true;
    assert_eq!(
        plan(&people, &slots, &policy(), &capped).assignments.len(),
        2
    );
}

#[test]
fn one_volunteer_cannot_hold_two_roles_of_the_same_shift_even_without_overlap_gate() {
    let people = vec![candidate("a", &["Driver"], &["sat:morning"])];
    let first = slot("s1", "Driver", Some("Driver"), "2026-10-17T09:00:00-04:00");
    let mut second = first.clone();
    second.id = "s2".into();
    second.role = "Helper".into();
    let mut unrestricted = options();
    unrestricted.block_conflicts = false;
    let result = plan(&people, &[first, second], &policy(), &unrestricted);
    assert_eq!(result.assignments.len(), 1);
    assert!(result.assignments[0].explanation.eligible);
}
