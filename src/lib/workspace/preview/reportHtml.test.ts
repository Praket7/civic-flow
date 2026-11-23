import { describe, expect, it } from "vitest";
import type { ReportDocument } from "../../../types/domain";
import { renderPrintableReport } from "./reportHtml";

const report: ReportDocument = {
  template: "custom",
  title: "Volunteer service",
  organization: "Community Partners",
  period: "2026-11-01 – 2026-11-30",
  generatedAt: "2026-11-22T12:00:00-05:00",
  headers: ["Volunteer", "Program"],
  rows: [["Maya Chen", "Weekend Pantry"]],
  summary: [{ label: "Records", value: "1" }],
};

describe("printable report HTML", () => {
  it("keeps ordinary reports readable and uses proper table headings", () => {
    const html = renderPrintableReport(report);
    expect(html).toContain("<title>Volunteer service</title>");
    expect(html).toContain("<th scope=\"col\">Volunteer</th>");
    expect(html).toContain("<td>Weekend Pantry</td>");
    expect(html).toContain("<p>Records: 1</p>");
  });

  it("escapes every user-controlled report field and does not execute embedded markup", () => {
    const attack = '<img src=x onerror="alert(1)"> & \'test\'';
    const html = renderPrintableReport({
      ...report,
      title: attack,
      organization: attack,
      period: attack,
      headers: [attack],
      rows: [[attack]],
      summary: [{ label: attack, value: attack }],
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror=\"alert(1)\"");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;test&#39;");
    expect((html.match(/&lt;img/g) ?? [])).toHaveLength(7);
  });

  it("does not alter the report object passed in", () => {
    const before = JSON.stringify(report);
    renderPrintableReport(report);
    expect(JSON.stringify(report)).toBe(before);
  });
});
