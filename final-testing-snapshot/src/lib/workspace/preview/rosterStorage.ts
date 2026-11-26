import type { Volunteer, RosterVolunteer } from "../../../types/domain";

/** Preview-only roster storage; reads the active scope at operation time. */
export function createPreviewRosterStorage(
  scoped: (key: string) => string,
  getVolunteers: () => Volunteer[],
) {
  const IMPORTED_VOLUNTEERS_KEY = "civicflow.imported-volunteers.v1";

  /** Reject invalid persisted rows without discarding valid legacy imports. */
  function isRosterRecord(value: unknown): value is RosterVolunteer {
    if (typeof value !== "object" || value === null) return false;
    const row = value as Record<string, unknown>;
    return (
      typeof row.id === "string" &&
      row.id.trim().length > 0 &&
      typeof row.name === "string" &&
      row.name.trim().length > 0 &&
      typeof row.email === "string" &&
      [row.skills, row.availability, row.causes].every(
        (items) => Array.isArray(items) && items.every((item) => typeof item === "string"),
      )
    );
  }

  /** The heads the importer reads, mirroring the desktop column list. */
  function readImportedRoster(): RosterVolunteer[] {
    try {
      const raw = localStorage.getItem(scoped(IMPORTED_VOLUNTEERS_KEY));
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(isRosterRecord) : [];
    } catch {
      return [];
    }
  }

  function writeImportedRoster(records: RosterVolunteer[]): void {
    try {
      localStorage.setItem(
        scoped(IMPORTED_VOLUNTEERS_KEY),
        JSON.stringify(records.filter(isRosterRecord)),
      );
    } catch {
      // Storage can be unavailable in hardened webviews; the session still works.
    }
  }

  function rosterRecord(volunteer: Volunteer): RosterVolunteer {
    return {
      id: volunteer.id,
      name: volunteer.name,
      email: volunteer.email,
      phone: volunteer.phone,
      status: volunteer.status,
      joinedAt: volunteer.joinedAt,
      skills: volunteer.skills,
      availability: volunteer.availability.map((slot) => `${slot.day}:${slot.period}`),
      causes: volunteer.causes,
    };
  }

  /**
   * What the roster holds: the seeded people plus the ones this device imported,
   * which is the same thing the desktop snapshot reports from SQLite.
   */
  function workspaceRoster(): RosterVolunteer[] {
    const records = [...getVolunteers().map(rosterRecord), ...readImportedRoster()];
    const seen = new Set<string>();
    return records.filter((record) => {
      if (seen.has(record.id)) return false;
      seen.add(record.id);
      return true;
    });
  }

  return { readImportedRoster, writeImportedRoster, workspaceRoster };
}
