import { parseISO } from "date-fns";

/**
 * Where "this month" and "last week" begin. Screens format dates but never
 * decide the period.
 */

/** Strict calendar validation shared by filters and report engines. */
export function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export type ReportPeriod = "week" | "month" | "year" | "all";

export interface DateRange {
  /** Inclusive first day, `YYYY-MM-DD`. */
  start: string;
  /** Inclusive last day, `YYYY-MM-DD`. */
  end: string;
}

/** The clock's own calendar day, independent of the system timezone. */
function calendar(now: string): Date {
  const match = now.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return parseISO(now);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function day(value: Date): string {
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

/** The calendar day the workspace clock is on. */
export function currentDay(now: string): string {
  return day(calendar(now));
}

/** The month containing the workspace clock. */
export function currentMonth(now: string): DateRange {
  const at = calendar(now);
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  return {
    start: day(new Date(Date.UTC(year, month, 1))),
    end: day(new Date(Date.UTC(year, month + 1, 0))),
  };
}

/** The week containing the workspace clock, respecting the organization's week start. */
export function currentWeek(now: string, weekStartsOn: 0 | 1 = 1): DateRange {
  const at = calendar(now);
  const start = new Date(at);
  start.setUTCDate(start.getUTCDate() - ((at.getUTCDay() - weekStartsOn + 7) % 7));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: day(start), end: day(end) };
}

/** January 1 through the workspace clock. */
export function yearToDate(now: string): DateRange {
  const at = calendar(now);
  return { start: `${at.getUTCFullYear()}-01-01`, end: day(at) };
}

/** The `dayCount` days ending on the workspace clock. */
export function lastNDays(now: string, dayCount: number): DateRange {
  const end = calendar(now);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (Math.max(1, dayCount) - 1));
  return { start: day(start), end: day(end) };
}

/**
 * `week` is the "Last 7 days" control: a trailing window ending today, not the
 * calendar week. `all` has no bound.
 */
export function reportRange(now: string, period: ReportPeriod): DateRange | null {
  if (period === "week") return lastNDays(now, 7);
  if (period === "month") return currentMonth(now);
  if (period === "year") return yearToDate(now);
  return null;
}

export function inRange(date: string, range: DateRange | null): boolean {
  if (!range) return true;
  return date >= range.start && date <= range.end;
}

/** Resolve an organization wall-clock time without assuming the device timezone.
 * Refuse nonexistent or ambiguous times instead of silently moving a shift. */
export function zonedShiftStart(date: string, time: string, timeZone: string): string {
  if (!validIsoDate(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error("Choose a valid date and start time.");
  }
  const desired = Date.parse(date + "T" + time + ":00Z");
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const wall = (instant: number): number => {
    const p = Object.fromEntries(
      formatter.formatToParts(instant).map(({ type, value }) => [type, value]),
    );
    return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
  };
  const candidates = new Set<number>();
  for (const probe of [desired - 86400000, desired, desired + 86400000]) {
    const instant = desired - (wall(probe) - probe);
    if (wall(instant) === desired) candidates.add(instant);
  }
  if (candidates.size !== 1) throw new Error("That local time is ambiguous or does not exist.");
  return new Date([...candidates][0]).toISOString();
}

export function previewDayKey(startsAt: string): string {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
    new Date(startsAt.slice(0, 10) + "T00:00:00Z").getUTCDay()
  ];
}

export function previewPeriod(startsAt: string): string {
  const hour = Number(startsAt.slice(11, 13));
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
