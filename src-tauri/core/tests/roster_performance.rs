//! Reproducible AutoRoster performance and behavioral equivalence harness.
//! Run with: cargo test --test roster_performance -- --ignored --nocapture
//! Timings are observations, not flaky CI thresholds or claims about production.
use std::collections::HashSet;
use std::time::Instant;

use chrono::{DateTime, Duration, FixedOffset, NaiveDate};
use civicflow_core::matching::{day_key, plan, Candidate, RosterOptions, Slot};
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
            skills: if index % 2 == 0 { vec!["Food Safety".into()] } else { vec![] },
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
    assert_eq!(first, second, "same inputs must yield identical plans and explanations");
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
