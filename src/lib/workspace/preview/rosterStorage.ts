import type { Volunteer, RosterVolunteer } from "../../../types/domain";

/** Preview-only roster storage; reads the active scope at operation time. */
export function createPreviewRosterStorage(
  scoped: (key: string) => string,
  getVolunteers: () => Volunteer[],
) {
  const IMPORTED_VOLUNTEERS_KEY = "civicflow.imported-volunteers.v1";

  /** The heads the importer reads, mirroring the desktop column list. */
  function readImportedRoster(): RosterVolunteer[] {
    try {
      const raw = localStorage.getItem(scoped(IMPORTED_VOLUNTEERS_KEY));
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as RosterVolunteer[]) : [];
    } catch {
      return [];
    }
  }

  function writeImportedRoster(records: RosterVolunteer[]): void {
    try {
      localStorage.setItem(scoped(IMPORTED_VOLUNTEERS_KEY), JSON.stringify(records));
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

  /**
   * The same check the desktop importer runs, so the browser preview refuses the
   * same files rather than accepting what SQLite would reject.
   */
  /** Keep the browser preview's existing scoped roster as the duplicate-email oracle. */

  return { readImportedRoster, writeImportedRoster, workspaceRoster };
}
