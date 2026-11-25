//! The same eligibility and score scenarios run in the browser test suite.
use chrono::{DateTime, NaiveDate};
use civicflow_core::matching::{
    explain_selection, plan, Candidate, Credential, RosterOptions, Slot, TimeBlock,
};
use civicflow_core::policy::RosterPolicy;
use serde::de::DeserializeOwned;
use serde_json::Value;

fn date(raw: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(raw, "%Y-%m-%d").ok()
}

fn setting<'a>(value: &'a Value, field: &str, fallback: &'a str) -> &'a str {
    value[field].as_str().unwrap_or(fallback)
}

fn with_overrides<T: DeserializeOwned + serde::Serialize>(defaults: T, patch: &Value) -> T {
    let mut value = serde_json::to_value(defaults).unwrap();
    if let Some(fields) = patch.as_object() {
        for (key, field) in fields {
            value[key] = field.clone();
        }
    }
    serde_json::from_value(value).unwrap()
}

#[test]
fn shared_native_browser_roster_policy_cases() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../../shared/roster-policy-cases.json")).unwrap();
    for sample in fixture["cases"].as_array().unwrap() {
        let name = sample["name"].as_str().unwrap();
        let credential_name = setting(sample, "credential", "current");
        let credential = &fixture["credentials"][credential_name];
        let credentials = if credential_name == "missing" {
            Vec::new()
        } else {
            vec![Credential {
                name: "Safe driver clearance".into(),
                valid_from: date(credential["validFrom"].as_str().unwrap()),
                valid_through: date(credential["validThrough"].as_str().unwrap()),
                verified: !credential["verifiedAt"].as_str().unwrap().trim().is_empty(),
            }]
        };
        let mut blocks = Vec::new();
        let mut assigned = std::collections::HashSet::new();
        if let Some(booking) = sample["booking"].as_str() {
            for row in fixture["bookings"][booking].as_array().unwrap() {
                blocks.push(TimeBlock {
                    starts_at: DateTime::parse_from_rfc3339(row["startsAt"].as_str().unwrap())
                        .unwrap(),
                    ends_at: DateTime::parse_from_rfc3339(row["endsAt"].as_str().unwrap()).unwrap(),
                });
                assigned.insert(row["shiftId"].as_str().unwrap().to_string());
            }
        }
        let availability = match sample["availability"].as_str() {
            Some("none") => Vec::new(),
            Some("partial") => vec!["sat:afternoon".into()],
            _ => vec!["sat:morning".into()],
        };
        let candidate = Candidate {
            id: "policy-person".into(),
            name: "Policy volunteer".into(),
            initials: "PV".into(),
            skills: sample["skills"]
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .map(|item| item.as_str().unwrap().to_string())
                        .collect()
                })
                .unwrap_or_else(|| vec!["Driver".into()]),
            languages: vec!["English".into()],
            causes: vec!["food".into()],
            availability: availability.into_iter().collect(),
            birthdate: date(setting(sample, "birthdate", "1990-01-01")),
            attendance_rate: 100,
            events_completed: 4,
            credentials,
            weekly_load: blocks.len() as i64,
            weekly_minutes: blocks
                .iter()
                .map(|block| (block.ends_at - block.starts_at).num_minutes())
                .sum(),
            assigned_blocks: blocks,
            assigned_shift_ids: assigned,
            waitlisted_shift_ids: Default::default(),
        };
        let slot = Slot {
            id: "policy-shift-Driver-1".into(),
            shift_id: "policy-shift".into(),
            opportunity_id: "opp-food".into(),
            shift_title: "Policy shift".into(),
            role: "Driver".into(),
            cause: "food".into(),
            day_key: "sat".into(),
            starts_at: DateTime::parse_from_rfc3339("2026-10-17T09:00:00-04:00").unwrap(),
            ends_at: DateTime::parse_from_rfc3339("2026-10-17T12:00:00-04:00").unwrap(),
            required_skill: Some("Driver".into()),
            required_credential: Some("Safe driver clearance".into()),
            minimum_age: Some(18),
            mandatory: true,
        };
        let policy = with_overrides(RosterPolicy::default(), &sample["policy"]);
        let options = with_overrides(RosterOptions::default(), &sample["options"]);
        let expected = sample["score"].as_i64().map(|score| score as i32);
        let explanation = explain_selection(&candidate, &slot, &policy, &options, false);
        assert_eq!(explanation.eligible, expected.is_some(), "{name}");
        assert_eq!(explanation.total_score, expected, "{name}");
        assert_eq!(
            plan(&[candidate], &[slot], &policy, &options)
                .assignments
                .len(),
            usize::from(expected.is_some()),
            "{name}"
        );
    }
}
