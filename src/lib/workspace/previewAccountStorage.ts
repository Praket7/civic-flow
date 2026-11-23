import type { Account } from "../../types/domain";

/**
 * Browser-only evaluation account storage. This is NOT an authentication
 * service and must never be used for real nonprofit accounts or passwords.
 * The production PWA authenticates against Supabase instead.
 */
export const PREVIEW_ACCOUNT_KEY = "civicflow.auth.passwords";
export const PREVIEW_ACCOUNTS_KEY = "civicflow.auth.accounts";

export function storedPreviewAccounts(
  storage: Pick<Storage, "getItem"> = localStorage,
): Account[] {
  try {
    const raw = storage.getItem(PREVIEW_ACCOUNTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value): Account[] => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const row = value as Partial<Account>;
      if (
        typeof row.id !== "string" ||
        !row.id ||
        typeof row.name !== "string" ||
        typeof row.email !== "string" ||
        (row.role !== "coordinator" && row.role !== "volunteer" && row.role !== "none")
      ) {
        return [];
      }
      return [{
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        volunteerId: typeof row.volunteerId === "string" ? row.volunteerId : null,
      }];
    });
  } catch {
    // Evaluation mode still opens with seeded accounts if storage is blocked.
    return [];
  }
}

export function previewPasswords(
  storage: Pick<Storage, "getItem"> = localStorage,
): Record<string, string> {
  try {
    const raw = storage.getItem(PREVIEW_ACCOUNT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([id, value]) => id !== "__proto__" && id !== "constructor" && typeof value === "string",
      ),
    );
  } catch {
    return {};
  }
}
