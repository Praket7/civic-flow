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
        shift_id: "shift-1".into(),
        opportunity_id: "opp-1".into(),
        shift_title: "Food distribution".into(),
        role: role.into(),
        cause: "food".into(),
        day_key: day_key(starts_at.date_naive()),
        starts_at,¶»§q«^