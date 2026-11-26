import { describe, expect, it } from "vitest";
import { previewVolunteerCsv } from "./volunteerImport";

describe("browser volunteer CSV importer", () => {
  it("returns a template and clear instructions for missing headers", () => {
    const result = previewVolunteerCsv("Phone,Status\n555-1234,active", []);
    expect(result.template).toContain("Name,Email");
    expect(result.total).toBe(0);
    expect(result.problems.join(" ")).toContain("Name, Email");
  });

  it("handles quoted commas, newlines and valid semantic fields", () => {
    const result = previewVolunteerCsv(
      'Name,Email,Availability,Skills,Causes,Status\n"Pat, Lee",pat@example.org,mon:morning,"First aid; Tutoring",food,active\n',
      [],
    );
    expect(result.valid).toBe(1);
    expect(result.invalid).toBe(0);
    expect(result.rows[0]).toMatchObject({
      name: "Pat, Lee",
      email: "pat@example.org",
      status: "active",
      availability: ["mon:morning"],
      skills: ["First aid", "Tutoring"],
      causes: ["food"],
      outcome: "create",
    });
  });

  it("rejects existing addresses, repeated addresses and invalid availability", () => {
    const result = previewVolunteerCsv(
      "Name,Email,Availability\nPerson One,EXISTING@example.org,tue:morning\nPerson Two,new@example.org,mo:never\nPerson Three,new@example.org,wed:evening",
      ["existing@example.org"],
    );
    expect(result.total).toBe(3);
    expect(result.valid).toBe(0);
    expect(result.invalid).toBe(3);
    expect(result.rows[0].problems.join(" ")).toContain("already on this roster");
    expect(result.rows[1].problems.join(" ")).toContain("mon:morning");
    expect(result.rows[2].problems.join(" ")).toContain("Two rows use");
  });

  it("accepts escaped quotes and embedded line breaks in quoted CSV fields", () => {
    const result = previewVolunteerCsv(
      'Name,Email,Skills\r\n"Pat ""Buddy"" Lee",pat@example.org,"First aid;\n Tutoring"\r\n',
      [],
    );
    expect(result.problems).toEqual([]);
    expect(result.valid).toBe(1);
    expect(result.rows[0]).toMatchObject({
      name: 'Pat "Buddy" Lee',
      skills: ["First aid", "Tutoring"],
    });
  });

  it.each([
    ['Name,Email\nPat "Buddy" Lee,pat@example.org', "quote inside an unquoted cell"],
    ['Name,Email\n"Pat"oops,pat@example.org', "text after a closing quote"],
    ['Name,Email\nPat,pat"oops"@example.org', "quote inside an unquoted cell"],
  ])("rejects malformed quoting before importing any rows", (source, problem) => {
    const result = previewVolunteerCsv(source, []);
    expect(result.total).toBe(0);
    expect(result.valid).toBe(0);
    expect(result.problems.join(" ")).toContain(problem);
  });

  it("returns a helpful, noncrashing error for unclosed quoted cells", () => {
    const result = previewVolunteerCsv('Name,Email\n"broken,b@example.org', []);
    expect(result.rows).toHaveLength(0);
    expect(result.problems).toEqual(["The CSV contains an unfinished quoted cell."]);
  });
});
