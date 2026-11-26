/**
 * Keep screenshot/demo fixtures internally consistent with their fixed clock.
 * This catches misleading timelines without changing production workflows.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const demo = JSON.parse(await readFile(new URL("../shared/demo-workspace.json", import.meta.url)));
const demoTime = Date.parse(demo.now);

assert.ok(Number.isFinite(demoTime), "The demo clock must be a valid date");

// A reproducible judging run must never expose an impossible shift, overfill a
// role, or silently point a schedule at a deleted opportunity.
const opportunityIds = new Set(demo.opportunities.map((opportunity) => opportunity.id));
const shiftIds = new Set();
for (const shift of demo.shifts) {
  assert.ok(!shiftIds.has(shift.id), `Duplicate shift id: ${shift.id}`);
  shiftIds.add(shift.id);
  assert.ok(opportunityIds.has(shift.opportunityId), `Unknown opportunity: ${shift.id}`);
  const starts = Date.parse(shift.startsAt);
  const ends = Date.parse(shift.endsAt);
  assert.ok(Number.isFinite(starts), `Invalid shift start: ${shift.id}`);
  assert.ok(Number.isFinite(ends), `Invalid shift end: ${shift.id}`);
  assert.ok(ends > starts, `Nonpositive shift duration: ${shift.id}`);
  for (const role of shift.roles) {
    assert.ok(role.required >= 0, `Negative role requirement: ${shift.id}`);
    assert.ok(role.filled >= 0, `Negative role fill: ${shift.id}`);
    assert.ok(role.filled <= role.required, `Overfilled role: ${shift.id}`);
  }
}

for (const activity of demo.recentActivity) {
  const at = Date.parse(activity.at);
  assert.ok(Number.isFinite(at), `Invalid activity timestamp: ${activity.id}`);
  assert.ok(at <= demoTime, `Future activity in demo feed: ${activity.id}`);

  if (activity.action !== "Checked in") continue;
  const matchingOpportunity = demo.opportunities.find((item) => item.title === activity.detail);
  assert.ok(matchingOpportunity, `Check-in names an unknown opportunity: ${activity.detail}`);
  const matchingShift = demo.shifts.find(
    (shift) =>
      shift.opportunityId === matchingOpportunity.id &&
      Date.parse(shift.startsAt) - 30 * 60_000 <= at &&
      at <= Date.parse(shift.startsAt) + 15 * 60_000,
  );
  assert.ok(matchingShift, `Check-in has no matching active shift: ${activity.id}`);
}

for (const notification of demo.notifications) {
  const created = Date.parse(notification.createdAt);
  assert.ok(Number.isFinite(created), `Invalid notification timestamp: ${notification.id}`);
  assert.ok(created <= demoTime, `Future notification in demo feed: ${notification.id}`);
}

const saturdayFoodShift = demo.shifts.find((shift) => {
  const opportunity = demo.opportunities.find((item) => item.id === shift.opportunityId);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: demo.organization.timezone,
    weekday: "long",
  }).format(new Date(shift.startsAt));
  return day === "Saturday" && opportunity?.title === "Community Food Distribution";
});
assert.ok(saturdayFoodShift, "Saturday food-distribution alert has no corresponding shift");
assert.ok(
  saturdayFoodShift.roles.some((role) => role.name === "Driver" && role.filled < role.required),
  "Saturday driver-coverage alert does not match the staffing data",
);

console.log("Demo timelines, check-ins, and Saturday coverage are consistent.");
