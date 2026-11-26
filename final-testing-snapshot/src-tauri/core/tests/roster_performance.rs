//! Reproducible AutoRoster performance and behavioral equivalence harness.
//! Run with: cargo test --test roster_performance -- --ignored --nocapture
//! Timings are observations, not flaky CI thresholds or claims about production.
use std::collections::HashSet;
use std::time::Instant;

use chrono::{DateTime, Duration, NaiveDate};
use civicflow_core::matching::{
    day_key, is_eligible_explained, plan, Candidate, RosterOptions, Slot,
};
use civicflow_core::policy::RosterPolicy;

fn fixture(people: usize, seats: usize) -> (Vec<Candidate>, Vec<Slot>) {
    let weekdays = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];
    let available: HashSet<String> = weekdays
        .iter()
        .flat_map(|day| ["morning", "afternoon"].map(|part| format!("{day}:{part}")))
        .collect();
    let candidates: Vec<Candidate> = (0..people)
        .map(|index| Candidate {
            id: format!("candidate-{index:04}"),
            name: format!("Volunteer {index}"),
            initials: "VT".into(),
            skills: if index % 2 == 0 {
                vec!["Food Safety".into()]
            } else {
                vec![]
            },
            languages: vec!["English".into()],
            causes: vec!["food".into()],
            availability: available.clone(),
            birthdate: Some(NaiveDate::from_ymd_opt(1995, 1, 1).unwrap()),
            attendance_rate: 85 + (index % 15) as i64,
            events_completed: 3,
            credentials: vec![],
            assigned_blocks: vec![],
            assigned_shift_ids: HashSet::new(),
            waitlisted_shift_ids: HashSet::new(),
            weekly_load: (index % 3) as i64,
            weekly_minutes: (index % 3 * 60) as i64,
        })
        .collect();

    let first = DateTime::parse_from_rfc3339("2026-10-17T09:00:00-04:00").unwrap();
    let slots: Vec<Slot> = (0..seats)
        .map(|index| {
            let start = first
                + Duration::days((index % 7) as i64)
                + Duration::hours(if index % 2 == 0 { 0 } else { 4 });
            let mandatory = index % 3 == 0;
            Slot {
                id: format!("seat-{index:04}"),
                shift_id: format!("shift-{index:04}"),
                opportunity_id: format!("opportunity-{:02}", index % 8),
                shift_title: "Community food service".into(),
                role: if mandatory { "Food Safety" } else { "Support" }.into(),
                cause: "food".into(),
                day_key: day_key(start.date_naive()),
                starts_at: start,
                ends_at: start + Duration::hours(2),
                required_skill: mandatory.then(|| "Food Safety".into()),
                required_credential: None,
                minimum_age: Some(18),
                mandatory,
            }
        })
        .collect();
    (candidates, slots)
}

fn verify_equivalent(people: usize, seats: usize) {
    let (candidates, slots) = fixture(people, seats);
    let policy = RosterPolicy::default();
    let options = RosterOptions::default();
    let began = Instant::now();
    let first = plan(&candidates, &slots, &policy, &options);
    let first_elapsed = began.elapsed();

    let began = Instant::now();
    let second = plan(&candidates, &slots, &policy, &options);
    let second_elapsed = began.elapsed();
    assert_eq!(
        first, second,
        "same inputs must yield identical plans and explanations"
    );
    assert_eq!(first.slots_considered, seats);
    assert_eq!(first.candidates_considered, people);
    assert_eq!(first.assignments.len() + first.unfilled.len(), seats);

    let mut seat_ids = HashSet::new();
    for assignment in &first.assignments {
        assert!(seat_ids.insert((&assignment.shift_id, &assignment.role)));
        assert!(assignment.explanation.eligible);
        assert!(assignment.explanation.selected);
        assert!(assignment.score <= 100);
    }
    eprintln!(
        "AutoRoster fixture: candidates={people}, seats={seats}, filled={}, score={}, run1_ms={:.2}, run2_ms={:.2}",
        first.assignments.len(),
        first.total_score,
        first_elapsed.as_secs_f64() * 1000.0,
        second_elapsed.as_secs_f64() * 1000.0,
    );
}

#[test]
fn small_roster_has_repeatable_explanations_and_unique_assignments() {
    verify_equivalent(24, 12);
}

#[test]
#[ignore = "run manually or in the dedicated CI benchmark step"]
fn medium_roster_performance() {
    verify_equivalent(120, 35);
}

#[test]
#[ignore = "run manually or in the dedicated CI benchmark step"]
fn large_roster_performance() {
    verify_equivalent(300, 80);
}

/// Transparent greedy baseline: oldest slot first, then first eligible
/// candidate, with one seat per candidate-day. This does not maximize scores.
fn first_eligible_baseline(
    candidates: &[Candidate],
    slots: &[Slot],
    policy: &RosterPolicy,
    options: &RosterOptions,
) -> usize {
    let mut taken = HashSet::new();
    let mut ordered: Vec<&Slot> = slots.iter().collect();
    ordered.sort_by(|a, b| a.starts_at.cmp(&b.starts_at).then_with(|| a.id.cmp(&b.id)));
    let mut filled = 0;
    for slot in ordered {
        if let Some(candidate) = candidates.iter().find(|candidate| {
            !taken.contains(&(candidate.id.clone(), slot.day_key.clone()))
                && is_eligible_explained(candidate, slot, policy, options)
        }) {
            taken.insert((candidate.id.clone(), slot.day_key.clone()));
            filled += 1;
        }
    }
    filled
}

/// A specialist scarcity fixture in which naive first-fit strands the only
/// Food Safety volunteer in a general role. Both seats overlap on one day.
#[test]
fn optimizer_preserves_a_specialist_for_the_role_only_they_can_fill() {
    let (candidates, mut slots) = fixture(2, 2);
    let start = slots[0].starts_at;
    for slot in &mut slots {
        slot.starts_at = start;
        slot.ends_at = start + Duration::hours(2);
        slot.day_key = day_key(start.date_naive());
        slot.minimum_age = None;
    }
    slots[0].role = "General Support".into();
    slots[0].required_skill = None;
    slots[0].mandatory = false;
    slots[1].role = "Food Safety".into();
    slots[1].required_skill = Some("Food Safety".into());
    slots[1].mandatory = true;

    let policy = RosterPolicy::default();
    let options = RosterOptions::default();
    let greedy = first_eligible_baseline(&candidates, &slots, &policy, &options);
    let optimized = plan(&candidates, &slots, &policy, &options);
    assert_eq!(
        greedy, 1,
        "the first-fit reference uses the scarce specialist first"
    );
    assert_eq!(
        optimized.assignments.len(),
        2,
        "both overlapping seats have feasible volunteers"
    );
    assert_eq!(
        optimized.assignments.len() + optimized.unfilled.len(),
        slots.len()
    );
    assert!(optimized
        .assignments
        .iter()
        .all(|a| a.explanation.eligible && a.explanation.selected));
}

#[test]
#[ignore = "large exploratory fixture; run manually with hardware recorded"]
fn thousand_volunteer_capacity_and_repeatability() {
    verify_equivalent(1_000, 250);
}

#[test]
#[ignore = "manual benchmark; report CPU, Rust profile, fixtures, scores and timings"]
fn compare_optimized_and_first_eligible_baseline() {
    for (people, seats) in [(24, 12), (120, 35), (300, 80)] {
        let (candidates, slots) = fixture(people, seats);
        let policy = RosterPolicy::default();
        let options = RosterOptions::default();
        let began = Instant::now();
        let greedy_filled = first_eligible_baseline(&candidates, &slots, &policy, &options);
        let greedy_ms = began.elapsed().as_secs_f64() * 1000.0;
        let began = Instant::now();
        let optimized = plan(&candidates, &slots, &policy, &options);
        let optimized_ms = began.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(optimized, plan(&candidates, &slots, &policy, &options));
        eprintln!(
            "AutoRoster comparison: candidates={people} seats={seats} greedy_filled={greedy_filled} optimized_filled={} optimized_score={} greedy_ms={greedy_ms:.3} optimized_ms={optimized_ms:.3}",
            optimized.assignments.len(),
            optimized.total_score
        );
    }
}
