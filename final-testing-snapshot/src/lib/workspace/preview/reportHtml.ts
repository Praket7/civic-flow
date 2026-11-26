import type { ReportDocument } from "../../../types/domain";

/**
 * Report values can include volunteer-entered names and descriptions. Printing
 * writes a fresh HTML document, so every data value must be treated as text,
 * never as markup or executable content.
 */
function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

/** Pure, escaped markup so print output can be tested without a browser popup. */
export function renderPrintableReport(report: ReportDocument): string {
  const headers = report.headers
    .map((header) => '<th scope="col">' + escapeHtml(header) + "</th>")
    .join("");
  const rows = report.rows
    .map(
      (row) => "<tr>" + row.map((cell) => "<td>" + escapeHtml(cell) + "</td>").join("") + "</tr>",
    )
    .join("");
  const summary = report.summary
    .map((item) => escapeHtml(item.label) + ": " + escapeHtml(item.value))
    .join(" · ");

  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    "<title>",
    escapeHtml(report.title),
    "</title>",
    "<style>",
    "body{font:12px system-ui;padding:32px;color:#111}",
    "h1{font-size:20px}h2{font-size:14px;font-weight:500}",
    "table{border-collapse:collapse;width:100%;margin-top:16px}",
    "th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left;font-size:10px}",
    "th{background:#f2f2f2}",
    "@media print{thead{display:table-header-group}tr{break-inside:avoid}}",
    "</style></head><body><h1>",
    escapeHtml(report.organization),
    "</h1>",
    "<h2>",
    escapeHtml(report.title),
    " · ",
    escapeHtml(report.period),
    "</h2>",
    "<p>",
    summary,
    "</p>",
    "<table><thead><tr>",
    headers,
    "</tr></thead><tbody>",
    rows,
    "</tbody></table></body></html>",
  ].join("");
}
