import { useEffect, useMemo, useState } from "react";
import { Download, FileDown, Filter, Save } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AreaChart,
  Badge,
  Button,
  Card,
  DataTable,
  DonutChart,
  Page,
  PageHeader,
  SelectField,
  Tabs,
} from "../../components/ui";
import type { Column } from "../../components/ui";
import { currentDay, reportRange, type ReportPeriod } from "../../lib/workspace/dates";
import { useWorkspace } from "../../lib/workspace/session";
import { WorkAreaTabs } from "../../components/navigation/WorkAreaTabs";
import { reportTabs } from "../../app/workAreas";
import { getWorkspaceRepository } from "../../lib/workspace/repository";
import {
  CAUSE_LABELS,
  formatDate,
  formatMinutes,
  REPORT_TEMPLATES,
} from "../../lib/workspace/selectors";
import type { HourRow } from "../../lib/workspace/selectors";
import type { ReportDocument, ReportRequest } from "../../types/domain";
import styles from "./Reports.module.css";
import { messageOf } from "../../lib/errors";

const FIELD_OPTIONS = [
  { id: "volunteer", label: "Volunteer name" },
  { id: "program", label: "Program" },
  { id: "date", label: "Service date" },
  { id: "hours", label: "Approved minutes" },
  { id: "requested", label: "Requested minutes" },
  { id: "status", label: "Approval status" },
  { id: "verification", label: "Verification ID" },
  { id: "recordId", label: "Source record ID" },
  { id: "cause", label: "Cause" },
  { id: "role", label: "Role" },
];

const DEFAULT_FIELDS = ["volunteer", "program", "date", "hours", "status", "recordId"];
type PeriodSelection = ReportPeriod | "custom" | "upcoming";
type ReportRow = { id: string; cells: string[] };

/** Historical compatibility helper: chart values always mean approved service. */
export function buildTrendPoints(rows: HourRow[]): { label: string; value: number }[] {
  const points = new Map<string, number>();
  for (const row of rows) {
    if (row.status !== "verified") continue;
    const minutes = Math.max(0, row.approvedMinutes ?? 0);
    points.set(row.date, (points.get(row.date) ?? 0) + minutes);
  }
  return [...points.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-10)
    .map(([date, value]) => ({ label: formatDate(date), value }));
}

export function buildCausePoints(rows: HourRow[]): { label: string; value: number; color: string }[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.status !== "verified") continue;
    const cause = row.opportunity.cause;
    totals.set(cause, (totals.get(cause) ?? 0) + Math.max(0, row.approvedMinutes ?? 0));
  }
  return [...totals.entries()]
    .filter(([, minutes]) => minutes > 0)
    .map(([cause, value]) => ({
      label: CAUSE_LABELS[cause as keyof typeof CAUSE_LABELS] ?? cause,
      value,
      color: "var(--color-cobalt)",
    }));
}

/** Charts are derived from the same authoritative report rows as the table/export. */
export function chartPoints(report: ReportDocument | null) {
  if (!report) return { trend: [] as { label: string; value: number }[], causes: [] as { label: string; value: number; color: string }[] };
  const date = report.headers.indexOf("Service date");
  const hours = report.headers.indexOf("Approved minutes");
  const cause = report.headers.indexOf("Cause");
  const trend = new Map<string, number>();
  const causes = new Map<string, number>();
  if (hours >= 0) {
    for (const cells of report.rows) {
      const minutes = Number(cells[hours]);
      if (!Number.isFinite(minutes) || minutes <= 0) continue;
      if (date >= 0) trend.set(cells[date], (trend.get(cells[date]) ?? 0) + minutes);
      if (cause >= 0) causes.set(cells[cause], (causes.get(cells[cause]) ?? 0) + minutes);
    }
  }
  return {
    trend: [...trend.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-10).map(([day, value]) => ({ label: formatDate(day), value })),
    causes: [...causes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, value]) => ({
      label: CAUSE_LABELS[id as keyof typeof CAUSE_LABELS] ?? id,
      value,
      color: "var(--color-cobalt)",
    })),
  };
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function CustomReportPage() {
  const { workspace, session, actions } = useWorkspace();
  const [params] = useSearchParams();
  const template = REPORT_TEMPLATES.find((item) => item.id === params.get("template"));
  const templateId = template?.id.replace(/^report-/, "") ?? "custom";
  const supportsActivityFilters = !["retention", "credentials", "skills"].includes(templateId);
  const [fields, setFields] = useState<string[]>(DEFAULT_FIELDS);
  const [cause, setCause] = useState("all");
  const [programId, setProgramId] = useState("all");
  const [range, setRange] = useState<PeriodSelection>(templateId === "coverage" ? "upcoming" : "year");
  const [customStart, setCustomStart] = useState(currentDay(workspace.now).slice(0, 4) + "-01-01");
  const [customEnd, setCustomEnd] = useState(currentDay(workspace.now));
  const [grouping, setGrouping] = useState<ReportRequest["groupBy"]>("none");
  const [chart, setChart] = useState("table");
  const [report, setReport] = useState<ReportDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [previewError, setPreviewError] = useState("");

  const savedView = session.savedViews?.find((view) => view.id === params.get("view"));
  useEffect(() => {
    if (!savedView) return;
    try {
      const filters = JSON.parse(savedView.filtersJson) as Record<string, unknown>;
      const validFields = Array.isArray(filters.fields)
        ? filters.fields.filter((field): field is string =>
            typeof field === "string" && FIELD_OPTIONS.some((option) => option.id === field),
          )
        : [];
      if (validFields.length) setFields(validFields);
      if (typeof filters.cause === "string") setCause(filters.cause);
      if (typeof filters.programId === "string") setProgramId(filters.programId);
      if (["week", "month", "year", "all", "custom", "upcoming"].includes(String(filters.range))) {
        setRange(filters.range as PeriodSelection);
      }
      if (typeof filters.customStart === "string") setCustomStart(filters.customStart);
      if (typeof filters.customEnd === "string") setCustomEnd(filters.customEnd);
      if (["none", "cause", "program"].includes(String(filters.grouping))) {
        setGrouping(filters.grouping as ReportRequest["groupBy"]);
      }
    } catch {
      setPreviewError("This saved view has invalid settings. Default filters are shown.");
    }
  }, [savedView?.id]);

  const period = useMemo(() => {
    if (range === "upcoming") return null;
    if (range === "custom") return { start: customStart, end: customEnd };
    if (range === "all") return { start: "1900-01-01", end: "9999-12-31" };
    return reportRange(workspace.now, range);
  }, [workspace.now, range, customStart, customEnd]);

  const invalidPeriod = Boolean(
    supportsActivityFilters && period &&
    (!validIsoDate(period.start) || !validIsoDate(period.end) || period.start > period.end),
  );
  const request = useMemo<ReportRequest>(() => ({
    template: templateId,
    fields,
    dateStart: supportsActivityFilters ? period?.start ?? null : null,
    dateEnd: supportsActivityFilters ? period?.end ?? null : null,
    cause: supportsActivityFilters && cause !== "all" ? cause : null,
    programId: supportsActivityFilters && programId !== "all" ? programId : null,
    groupBy: grouping,
  }), [templateId, fields, supportsActivityFilters, period, cause, programId, grouping]);

  const programs = useMemo(() => {
    const byId = new Map<string, { id: string; title: string; cause: string }>();
    for (const opportunity of [...workspace.opportunities, ...(session.createdOpportunities ?? [])]) {
      byId.set(opportunity.id, {
        id: opportunity.id,
        title: opportunity.title,
        cause: opportunity.cause,
      });
    }
    return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [workspace.opportunities, session.createdOpportunities]);

  useEffect(() => {
    if (invalidPeriod) {
      setReport(null);
      setLoading(false);
      setPreviewError("Choose real dates with a start date on or before the end date.");
      return;
    }
    let current = true;
    setLoading(true);
    setPreviewError("");
    void getWorkspaceRepository().generateReport(request)
      .then((generated) => { if (current) { setReport(generated); setLoading(false); } })
      .catch((caught) => { if (current) { setPreviewError(messageOf(caught)); setReport(null); setLoading(false); } });
    return () => { current = false; };
  }, [request, invalidPeriod, session]);

  const rows = useMemo<ReportRow[]>(
    () => (report?.rows ?? []).map((cells, index) => ({ id: String(index), cells })),
    [report],
  );
  const columns = useMemo<Column<ReportRow>[]>(
    () => (report?.headers ?? []).map((header, index) => ({
      key: "column-" + index,
      header,
      render: (row: ReportRow) => row.cells[index] ?? "",
    })),
    [report],
  );
  const points = useMemo(() => chartPoints(report), [report]);
  const canExport = !invalidPeriod && !loading && Boolean(report);

  async function exportReport(format: "csv" | "pdf") {
    if (!canExport) return;
    setError("");
    setSaved("");
    try {
      // Uses precisely the same request and source as generateReport above.
      const receipt = await getWorkspaceRepository().exportReport(request, format);
      if (!receipt) {
        setSaved("Export canceled. Nothing was written.");
        return;
      }
      setSaved(
        format === "pdf" && receipt.path === "print-dialog"
          ? "Printable report opened. Choose Save as PDF in the print dialog."
          : "Exported " + receipt.title + " (" + receipt.format.toUpperCase() + ") to " + receipt.path + ".",
      );
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  async function saveView() {
    try {
      const name = template?.title ?? "Custom view";
      await actions.saveReportView(name, "reports", JSON.stringify({
        template: template?.id ?? null, fields, cause, programId, range,
        customStart, customEnd, grouping,
      }));
      setSaved("Saved " + name + " with " + fields.length + " fields and the current filters.");
      setError("");
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  return (
    <Page>
      <WorkAreaTabs label="Reports" items={reportTabs} />
      <PageHeader
        eyebrow="Reporting"
        title={template?.title ?? "Custom report builder"}
        description="Filter actual source records, inspect the result, and export the same rows. Pending and rejected hours never count as approved service."
        backTo="/coordinator/reports"
        backLabel="Reports"
        actions={
          <>
            <Button variant="secondary" icon={<FileDown size={14} />}
              disabled={!canExport} onClick={() => void exportReport("pdf")}>
              Export PDF
            </Button>
            <Button variant="primary" icon={<Download size={14} />}
              disabled={!canExport} onClick={() => void exportReport("csv")}>
              Export CSV
            </Button>
          </>
        }
      />
      <div className={styles.builder}>
        <Card className={styles.builderRail}>
          <h2 className={styles.railTitle}>Fields</h2>
          {templateId === "custom" || templateId === "participation" ? (
            <>
              <div className={styles.fieldList}>
                {FIELD_OPTIONS.map((field) => (
                  <label className={styles.fieldOption} key={field.id}>
                    <input
                      type="checkbox" checked={fields.includes(field.id)}
                      onChange={(event) => setFields((current) =>
                        event.target.checked
                          ? [...current, field.id]
                          : current.filter((id) => id !== field.id),
                      )}
                    />
                    {field.label}
                  </label>
                ))}
              </div>
              <SelectField label="Group rows by" value={grouping}
                onChange={(event) => setGrouping(event.target.value as ReportRequest["groupBy"])}>
                <option value="none">Date order</option>
                <option value="cause">Cause</option>
                <option value="program">Program</option>
              </SelectField>
            </>
          ) : (
            <p className={styles.tableNote}>This report uses a fixed set of fields specific to {template?.title.toLowerCase()}.</p>
          )}
          <p className={styles.tableNote}>Source record IDs let you verify individual entries against the service ledger.</p>
        </Card>

        <Card className={styles.canvas}>
          <div className={styles.paper}>
            <div className={styles.paperHeader}>
              <div>
                <h2 className={styles.paperTitle}>{report?.title ?? "Report preview"}</h2>
                <p className={styles.paperMeta}>
                  {report?.organization ?? workspace.organization.name} · {report?.period ?? "Preparing report"}
                </p>
              </div>
              <Badge tone="cobalt">Source-backed</Badge>
            </div>
            {loading ? <p role="status">Calculating report from source records…</p> : null}
            {previewError ? <p role="alert" style={{ color: "var(--tone-red-ink)" }}>{previewError}</p> : null}
            {report ? (
              <>
                <div style={{ marginTop: 14, display: "flex", gap: 18, flexWrap: "wrap" }}>
                  {report.summary.map((item) => (
                    <div key={item.label}>
                      <strong style={{ display: "block" }}>{item.value}</strong>
                      <span className={styles.tableNote}>{item.label}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 14 }}>
                  <Tabs
                    items={[
                      { id: "table", label: "Table" },
                      { id: "trend", label: "Approved hours trend" },
                      { id: "cause", label: "By cause" },
                    ]}
                    value={chart} onChange={setChart} label="Report visualization"
                  />
                </div>
                <div style={{ marginTop: 14 }}>
                  {chart === "trend" ? (
                    points.trend.length ? (
                      <AreaChart data={points.trend} height={176}
                        label="Approved service time by date from current report rows"
                        formatValue={formatMinutes} />
                    ) : <p className={styles.tableNote}>To chart approved hours, include Service date and Approved minutes in a participation report.</p>
                  ) : null}
                  {chart === "cause" ? (
                    points.causes.length ? (
                      <DonutChart data={points.causes}
                        centerValue={formatMinutes(points.causes.reduce((sum, point) => sum + point.value, 0))}
                        centerLabel="approved time" label="Approved time by cause"
                        valueFormatter={formatMinutes} />
                    ) : <p className={styles.tableNote}>To analyze causes, include Cause and Approved minutes in a participation report.</p>
                  ) : null}
                  <DataTable columns={columns} rows={rows} caption="Report source records"
                    empty="No records match these filters. The empty report is valid." />
                </div>
                <p className={styles.tableNote}>
                  {rows.length} source rows · Generated {report.generatedAt.slice(0, 10)} ·
                  Summaries and exports are calculated from the same report request.
                </p>
              </>
            ) : null}
          </div>
        </Card>

        <Card className={styles.builderRail}>
          <h2 className={styles.railTitle}>
            <Filter size={14} aria-hidden="true" style={{ marginRight: 5 }} />
            Filters
          </h2>
          {supportsActivityFilters ? (
            <div className={styles.filters}>
              <SelectField label="Date range" value={range}
                onChange={(event) => setRange(event.target.value as PeriodSelection)}>
                <option value="week">Last 7 days</option>
                <option value="month">This month</option>
                <option value="year">Year to date</option>
                <option value="all">All available dates</option>
                <option value="custom">Custom dates</option>
                {templateId === "coverage" ? <option value="upcoming">Upcoming shifts</option> : null}
              </SelectField>
              {range === "custom" ? (
                <>
                  <label className={styles.tableNote}>
                    Start date
                    <input aria-label="Report start date" type="date" value={customStart}
                      onChange={(event) => setCustomStart(event.target.value)} />
                  </label>
                  <label className={styles.tableNote}>
                    End date
                    <input aria-label="Report end date" type="date" value={customEnd}
                      onChange={(event) => setCustomEnd(event.target.value)} />
                  </label>
                </>
              ) : null}
              <SelectField label="Cause" value={cause}
                onChange={(event) => { setCause(event.target.value); setProgramId("all"); }}>
                <option value="all">All causes</option>
                {Object.entries(CAUSE_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </SelectField>
              <SelectField label="Program" value={programId}
                onChange={(event) => setProgramId(event.target.value)}>
                <option value="all">All programs</option>
                {programs.filter((program) => cause === "all" || program.cause === cause)
                  .map((program) => <option key={program.id} value={program.id}>{program.title}</option>)}
              </SelectField>
            </div>
          ) : (
            <p className={styles.tableNote}>
              Cohort and credential inventory reports are snapshots. Program, cause and service-date filters do not apply.
            </p>
          )}
          <div style={{ marginTop: 16 }}>
            <Button variant="secondary" size="small" icon={<Save size={12} />}
              onClick={() => void saveView()}>Save this view</Button>
          </div>
          <Link to="/coordinator/reports" style={{ display: "block", marginTop: 12, fontSize: 12.5 }}>
            Back to templates
          </Link>
          {error ? <p role="alert" style={{ color: "var(--tone-red-ink)" }}>{error}</p> : null}
          {saved ? <p role="status" style={{ color: "var(--tone-green-ink)" }}>{saved}</p> : null}
        </Card>
      </div>
    </Page>
  );
}
