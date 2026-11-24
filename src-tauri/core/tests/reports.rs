use civicflow_core::reports::{export, generate, to_csv, ExportFormat, ReportRequest};
use civicflow_core::Database;

fn seeded() -> Database {
    let mut database = Database::in_memory().expect("in-memory database");
    assert!(database.seed_demo_if_empty().expect("seed"));
    database
}

fn request(template: &str) -> ReportRequest {
    ReportRequest {
        template: template.into(),
        fields: vec![],
        date_start: Some("2026-01-01".into()),
        date_end: Some("2026-10-13".into()),
        cause: None,
        program_id: None,
        group_by: "none".into(),
    }
}

#[test]
fn participation_report_uses_approved_rows_and_totals() {
    let database = seeded();
    let report = generate(database.connection(), &request("participation")).expect("report");
    assert_eq!(report.title, "Volunteer participation");
    assert_eq!(report.organization, "Rivergate Kitchen");
    assert!(!report.rows.is_empty());
    assert_eq!(report.headers.len(), report.rows[0].len());
    assert!(report
        .summary
        .iter()
        .any(|item| item.label == "Verified" && item.value != "0h 00m"));
    let csv = to_csv(&report);
    assert!(csv.starts_with('\u{feff}'));
    assert!(csv.lines().count() >= report.rows.len());
}

#[test]
fn custom_fields_are_limited_to_the_allow_list() {
    let database = seeded();
    let mut custom = request("custom");
    custom.fields = vec!["volunteer".into(), "not_a_column".into(), "program".into()];
    let report = generate(database.connection(), &custom).expect("report");
    assert_eq!(report.headers, vec!["Volunteer", "Program"]);
    assert!(report.rows.iter().all(|row| row.len() == 2));
}

#[test]
fn coverage_and_retention_reports_are_computed_from_records() {
    let database = seeded();
    let mut upcoming = request("coverage");
    upcoming.date_start = None;
    upcoming.date_end = None;
    let coverage = generate(database.connection(), &upcoming).expect("coverage");
    assert!(!coverage.rows.is_empty());
    assert!(coverage.rows.iter().any(|row| row[5] != "0"));
    let retention = generate(database.connection(), &request("retention")).expect("retention");
    assert_eq!(retention.rows.len(), 6);
    let eligible: i64 = retention
        .rows
        .iter()
        .map(|row| row[1].parse::<i64>().unwrap())
        .sum();
    assert!(eligible > 0);
}

#[test]
fn empty_reports_still_have_headers_and_export_files() {
    let database = seeded();
    let mut empty = request("custom");
    empty.date_start = Some("2030-01-01".into());
    empty.date_end = Some("2030-01-31".into());
    let report = generate(database.connection(), &empty).expect("empty report");
    assert!(report.rows.is_empty());
    assert!(!report.headers.is_empty());

    let directory = tempfile::tempdir().expect("temp dir");
    let csv_path = directory.path().join("report.csv");
    export(&report, ExportFormat::Csv, &csv_path).expect("csv export");
    let csv = std::fs::read_to_string(&csv_path).expect("csv read");
    assert!(csv.contains("Volunteer"));
    let pdf_path = directory.path().join("report.pdf");
    export(&report, ExportFormat::Pdf, &pdf_path).expect("pdf export");
    let bytes = std::fs::read(&pdf_path).expect("pdf read");
    assert!(bytes.starts_with(b"%PDF-1.4"));
    assert!(bytes.len() > 900);
}

#[test]
fn unknown_templates_and_bad_dates_are_refused() {
    let database = seeded();
    let mut bad = request("nope");
    assert!(generate(database.connection(), &bad).is_err());
    bad = request("custom");
    bad.date_start = Some("yesterday".into());
    assert!(generate(database.connection(), &bad).is_err());
    bad.date_start = Some("2026-10-14".into());
    bad.date_end = Some("2026-10-13".into());
    assert!(generate(database.connection(), &bad).is_err());
}

#[test]
fn all_participation_summaries_reconcile_to_approved_rows() {
    let database = seeded();
    let mut filters = request("custom");
    filters.fields = vec![
        "recordId".into(),
        "status".into(),
        "hours".into(),
        "requested".into(),
    ];
    let report = generate(database.connection(), &filters).expect("custom report");
    assert_eq!(
        report.headers,
        vec![
            "Record ID",
            "Status",
            "Approved minutes",
            "Requested minutes"
        ]
    );
    let mut approved = 0_i64;
    for row in &report.rows {
        assert!(
            !row[0].is_empty(),
            "every export row has its source record ID"
        );
        if row[1] == "verified" {
            approved += row[2].parse::<i64>().expect("verified amount");
        } else {
            assert_eq!(
                row[2], "",
                "unapproved rows cannot display approved minutes"
            );
        }
    }
    let expected = format!("{}h {:02}m", approved / 60, approved % 60);
    assert!(report
        .summary
        .iter()
        .any(|item| item.label == "Verified" && item.value == expected));
    let csv = to_csv(&report);
    assert!(csv.contains("Record ID"));
    assert_eq!(csv.lines().count(), report.rows.len() + 1);
}

#[test]
fn historical_coverage_filters_really_limit_rows() {
    let database = seeded();
    let mut historical = request("coverage");
    historical.date_start = Some("1999-01-01".into());
    historical.date_end = Some("1999-01-31".into());
    let report = generate(database.connection(), &historical).expect("empty historic period");
    assert!(report.rows.is_empty());
    assert!(report
        .summary
        .iter()
        .any(|item| item.label == "Role coverage" && item.value == "N/A"));
}

#[test]
fn report_program_id_uses_stable_ids_and_restricts_source_rows() {
    let database = seeded();
    let id: String = database
        .connection()
        .query_row(
            "SELECT id FROM opportunities ORDER BY id LIMIT 1",
            [],
            |row| row.get(0),
        )
        .expect("seeded opportunity");
    let mut filtered = request("custom");
    filtered.program_id = Some(id.clone());
    filtered.fields = vec!["program".into(), "recordId".into()];
    let report = generate(database.connection(), &filtered).expect("program report");
    let other = generate(database.connection(), &request("custom")).expect("unfiltered report");
    assert!(report.rows.len() <= other.rows.len());
    assert!(report.rows.iter().all(|row| row.len() == 2));
    let csv = to_csv(&report);
    assert!(csv.contains("Record ID"));
}

#[test]
fn native_csv_guards_whitespace_and_fullwidth_formula_prefixes() {
    let database = seeded();
    let mut report = generate(database.connection(), &request("custom")).expect("report");
    report.headers = vec!["Value".into()];
    report.rows = [" =1+1", "\ttext", "\rtext", "\ntext", "＝1+1", "＠SUM(A1)"]
        .into_iter()
        .map(|value| vec![value.into()])
        .collect();
    let csv = to_csv(&report);
    for row in &report.rows {
        assert!(csv.contains(&format!("\"'{}\"", row[0])));
    }
}

#[test]
fn native_dates_reject_noncanonical_and_unicode_without_panicking() {
    let database = seeded();
    let mut query = request("custom");
    query.date_start = None;
    for invalid in ["abcé", "2026-2-1", "2026-02-30"] {
        query.date_end = Some(invalid.into());
        assert!(generate(database.connection(), &query).is_err());
    }
}

#[test]
fn credential_inventory_does_not_cross_multiply_skills() {
    let database = seeded();
    let report = generate(database.connection(), &request("skills")).expect("inventory");
    let credential_count: usize = database
        .connection()
        .query_row("SELECT count(*) FROM volunteer_credentials", [], |row| {
            row.get(0)
        })
        .expect("credential count");
    assert_eq!(
        report.rows.iter().filter(|row| row[1] == "—").count(),
        credential_count
    );
    assert!(report.rows.iter().all(|row| row[1] == "—" || row[2] == "—"));
}
