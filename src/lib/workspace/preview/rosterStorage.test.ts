import { beforeEach, describe, expect, it } from "vitest";
import type { Volunteer, RosterVolunteer } from "../../../types/domain";
import { createPreviewRosterStorage } from "./rosterStorage";

const volunteer = {
  id: "seed-01",
  name: "Seed Volunteer",
  email: "seed@example.org",
  skills: ["Tutoring"],
  causes: ["education"],
  availability: [{ day: "mon", period: "morning" }],
} as Volunteer;
const imported = {
  id: "import-01",
  name: "Imported",
  email: "import@example.org",
  skills: ["Food safety"],
  availability: ["tue:morning"],
  causes: ["food"],
} as RosterVolunteer;

describe("preview imported roster is isolated by organization", () => {
  let org = "A";
  const repo = createPreviewRosterStorage(
    (key) => org + ":" + key,
    () => [volunteer],
  );
  beforeEach(() => {
    localStorage.clear();
    org = "A";
  });

  it("deduplicates volunteers while keeping seeded rows first", () => {
    repo.writeImportedRoster([imported, { ...imported, id: volunteer.id }]);
    expect(repo.workspaceRoster().map((item) => item.id)).toEqual(["seed-01", "import-01"]);
  });
  it("never exposes imported records across organization changes", () => {
    repo.writeImportedRoster([imported]);
    org = "B";
    expect(repo.readImportedRoster()).toEqual([]);
    org = "A";
    expect(repo.readImportedRoster()).toEqual([imported]);
  });
  it("handles corrupt local storage without crashing", () => {
    localStorage.setItem("A:civicflow.imported-volunteers.v1", "{");
    expect(repo.readImportedRoster()).toEqual([]);
  });
});
