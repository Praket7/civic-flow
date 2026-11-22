/**
 * Keep screenshot/demo fixtures internally consistent with their fixed clock.
 * This catches misleading timelines without changing production workflows.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const demo = JSON.parse(await readFile(new URL("../shared/demo-workspace.json", import.meta.url)));
const demoTime = Date.parse(demo.now);

assert.ok(Number.isFinite(demoTime), "The demo clock must be a valid date");

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
