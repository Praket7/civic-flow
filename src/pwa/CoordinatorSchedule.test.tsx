import { describe, expect, it } from "vitest";
import { availableSeats, type HostedShift } from "./CoordinatorSchedule";

const makeShift = (confirmed: number, capacity: number): HostedShift => ({
  id: "shift",
  opportunity_id: "opportunity",
  starts_at: "2026-12-01T10:00:00.000Z",
  ends_at: "2026-12-01T12:00:00.000Z",
  status: "scheduled",
  capacity,
  confirmed,
});

describe("live coordinator schedule presentation", () => {
  it("shows the correct remaining capacity", () => {
    expect(availableSeats(makeShift(2, 5))).toBe(3);
  });

  it("never displays a negative number of seats", () => {
    expect(availableSeats(makeShift(8, 5))).toBe(0);
  });
});
