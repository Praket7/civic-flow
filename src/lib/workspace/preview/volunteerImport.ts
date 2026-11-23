/**
 * The preview CSV parser and semantic validator, independent of account,
 * storage, and UI state. Desktop import rules remain authoritative in Rust.
 */
import { csvText } from "../../csv";
import type { Cause, DayKey, PeriodKey, VolunteerImportPreview } from "../../../types/domain";

const IMPORT_COLUMNS: [string, string][] = [
  ["name", "Name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["status", "Status"],
  ["skills", "Skills"],
  ["availability", "Availability"],
  ["interests", "Interests"],
  ["causes", "Causes"],
];

const IMPORT_DAYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const IMPORT_PERIODS: PeriodKey[] = ["morning", "afternoon", "evening"];
const IMPORT_STATUSES = ["active", "onboarding", "inactive"];
const IMPORT_CAUSES: Cause[] = [
  "food",
  "education",
  "environment",
  "health",
  "community",
  "animals",
];
const IMPORT_EXAMPLE = [
  "Maya Chen",
  "maya.chen@example.org",
  "(716) 555-0142",
  "onboarding",
  "Food handling; Tutoring",
  "mon:morning; wed:evening",
  "Weekend pantry shifts, school tutoring",
  "food; education",
];

/** Splits a cell that holds several values, matching what the importer accepts. */
function splitCell(value: string, comma: boolean): string[] {
  return value
    .split(comma ? /[;|,]/ : /[;|]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** A minimal RFC 4180 reader: quoted cells may hold commas and newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const characters = [...text.replace(/^\ufeff/, "")];
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === '"') {
      if (quoted && characters[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && characters[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell.trim().length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  if (quoted) throw new Error("The CSV contains an unfinished quoted cell.");
  return rows.filter((cells) => cells.some((value) => value.trim().length > 0));
}

function importTemplate(): string {
  return `${csvText([IMPORT_COLUMNS.map(([, label]) => label), IMPORT_EXAMPLE])}\r\n`;
}

function importEmailProblem(raw: string): { email: string; problem: string } {
  const email = raw.trim().toLowerCase();
  const parts = email.split("@");
  const domain = parts[1] ?? "";
  const valid =
    parts.length === 2 &&
    (parts[0] ?? "").length > 0 &&
    domain.includes(".") &&
    !domain.startsWith(".") &&
    !domain.endsWith(".") &&
    !/\s/.test(email) &&
    email.length <= 160;
  return { email, problem: valid ? "" : "Use an email address like name@example.org." };
}

export function previewVolunteerCsv(text: string, existingEmails: readonly string[]): VolunteerImportPreview {
  const preview: VolunteerImportPreview = {
    columns: [],
    required: ["Name", "Email"],
    template: importTemplate(),
    total: 0,
    valid: 0,
    invalid: 0,
    problems: [],
    rows: [],
  };
  let rows: string[][];
  try {
    rows = parseCsv(text);
  } catch (error) {
    preview.problems.push(error instanceof Error ? error.message : "The CSV could not be read.");
    return preview;
  }
  const header = rows.shift();
  if (!header) {
    preview.problems.push("Choose a CSV file or paste its rows first.");
    return preview;
  }

  const indexes = new Map<string, number>();
  for (const [position, value] of header.entries()) {
    const cleaned = value.trim().toLowerCase();
    if (!cleaned) continue;
    preview.columns.push(value.trim());
    const column = IMPORT_COLUMNS.find(
      ([key, label]) => key === cleaned || label.toLowerCase() === cleaned,
    );
    if (column && !indexes.has(column[0])) indexes.set(column[0], position);
  }
  const missing = ["name", "email"].filter((key) => !indexes.has(key));
  if (missing.length > 0) {
    const labels = missing.map((key) => IMPORT_COLUMNS.find(([id]) => id === key)?.[1] ?? key);
    preview.problems.push(
      `The first row must name these columns: ${labels.join(", ")}. No rows were read.`,
    );
    return preview;
  }

  const read = (cells: string[], key: string) => {
    const position = indexes.get(key);
    return position === undefined ? "" : (cells[position] ?? "").trim();
  };
  const known = new Set(existingEmails.map((email) => email.toLowerCase()));
  const seen = new Set<string>();

  for (const [offset, cells] of rows.entries()) {
    const problems: string[] = [];
    const notes: string[] = [];
    const name = read(cells, "name").split(/\s+/).filter(Boolean).join(" ");
    if (name.length < 2) problems.push("Enter the name to show on this account.");
    if (name.length > 80) problems.push("Keep the name under 80 characters.");

    const { email, problem } = importEmailProblem(read(cells, "email"));
    if (problem) problems.push(problem);
    else if (seen.has(email)) problems.push(`Two rows use ${email}.`);
    else {
      seen.add(email);
      if (known.has(email)) problems.push(`${email} is already on this roster.`);
    }

    const statusCell = read(cells, "status").toLowerCase();
    let status = "onboarding";
    if (statusCell) {
      if (IMPORT_STATUSES.includes(statusCell)) status = statusCell;
      else problems.push(`"${statusCell}" is not a status. Use active, onboarding or inactive.`);
    }

    const skills = splitCell(read(cells, "skills"), false);
    if (skills.length === 0) notes.push("No skills listed yet.");

    const availability: string[] = [];
    for (const token of splitCell(read(cells, "availability"), false)) {
      const [day, period = ""] = token.toLowerCase().split(":");
      if (IMPORT_DAYS.includes(day as DayKey) && IMPORT_PERIODS.includes(period as PeriodKey)) {
        availability.push(`${day}:${period}`);
      } else {
        problems.push(`"${token}" needs a day and a period, like mon:morning.`);
      }
    }
    if (availability.length === 0 && !problems.some((entry) => entry.includes("mon:morning"))) {
      notes.push("No availability windows listed yet.");
    }

    const causes: string[] = [];
    for (const token of splitCell(read(cells, "causes"), true)) {
      const cause = token.toLowerCase();
      if (IMPORT_CAUSES.includes(cause as Cause)) causes.push(cause);
      else {
        problems.push(
          `"${cause}" is not a cause. Use food, education, environment, health, community or animals.`,
        );
      }
    }

    preview.rows.push({
      line: offset + 2,
      name,
      email,
      phone: read(cells, "phone"),
      status,
      skills,
      availability,
      interests: read(cells, "interests"),
      causes,
      outcome: problems.length === 0 ? "create" : "invalid",
      problems,
      notes,
    });
    preview.total += 1;
    if (problems.length === 0) preview.valid += 1;
    else preview.invalid += 1;
  }

  if (preview.total === 0) {
    preview.problems.push("The file has a header but no volunteer rows yet.");
  }
  return preview;
}
