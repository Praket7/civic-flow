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
            assig¶»§q«^