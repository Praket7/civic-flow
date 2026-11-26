/**
 * Normalize errors crossing Tauri, hosted Supabase and browser preview boundaries.
 * Rust's AppError exposes code/message/field/action; thrown JS values may be
 * strings or Error instances. Callers never need to inspect provider internals.
 */
export type ErrorCategory =
  | "validation"
  | "conflict"
  | "permission"
  | "authentication"
  | "not_found"
  | "offline"
  | "storage"
  | "internal"
  | "unknown";

export interface RecoveryError {
  category: ErrorCategory;
  code: string;
  message: string;
  action?: string;
  field?: string;
  retryable: boolean;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Preserve provider SQLSTATE/status at the hosted transport boundary. */
export function providerError(value: unknown): Error & { code?: string; status?: number } {
  const record = recordOf(value);
  const error = new Error(
    textOf(record?.message) ?? textOf(record?.error_description) ?? "The service request failed.",
  ) as Error & { code?: string; status?: number };
  if (textOf(record?.code)) error.code = textOf(record?.code);
  const status = record?.status ?? record?.statusCode;
  if (typeof status === "number" && Number.isInteger(status)) error.status = status;
  return error;
}

/** Keep SQL statements, paths and server tracebacks out of user-facing errors. */
function publicMessage(message: string | undefined): string | undefined {
  if (
    message &&
    /SELECT\s+\*|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|SQLSTATE|stack trace|postgres|sqlite|pg_catalog|\/(?:private|Users|home|var)\/|relation "[^"]+"/i.test(
      message,
    )
  )
    return undefined;
  return message;
}

/** Classify failures by recoverable behavior, never by a screen's catch block. */
export function classifyError(error: unknown): RecoveryError {
  const record = recordOf(error);
  const message =
    (error instanceof Error ? textOf(error.message) : undefined) ??
    textOf(record?.message) ??
    textOf(record?.error_description) ??
    textOf(error);
  const status = record?.status ?? record?.statusCode;
  const code =
    textOf(record?.code)?.toUpperCase() ??
    (typeof status === "number" && Number.isInteger(status) ? String(status) : "UNKNOWN");
  const safe = publicMessage(message);
  const action = textOf(record?.action);
  const field = textOf(record?.field);

  if (
    /NETWORK|OFFLINE|FETCH|ECONN|TIMEOUT|TIMED_OUT/.test(code) ||
    /failed to fetch|network request failed|\boffline\b|network error|timed out/i.test(
      message ?? "",
    )
  ) {
    return {
      category: "offline",
      code,
      message: "The connection was interrupted before this action could finish.",
      action: "Check your connection, then retry. Offline desktop records remain local.",
      retryable: true,
    };
  }
  if (
    /AUTH|UNAUTHORIZED|401|PGRST30[12]/.test(code) ||
    /session (?:expired|invalid)/i.test(message ?? "")
  ) {
    return {
      category: "authentication",
      code,
      message: "Your session needs to be renewed.",
      action: "Sign in again and retry the action.",
      retryable: true,
    };
  }
  if (/PERMISSION|FORBIDDEN|403|42501/.test(code)) {
    return {
      category: "permission",
      code,
      message: "You don't have permission to make this change.",
      action: "Ask your organization coordinator to check your access.",
      retryable: false,
    };
  }
  if (code === "23505") {
    return {
      category: "conflict",
      code,
      message: "A record with these details already exists.",
      action: "Review the existing record before retrying.",
      retryable: false,
    };
  }
  if (/^(?:23502|23503|23514|22P02)$/.test(code)) {
    return {
      category: "validation",
      code,
      message: "These details do not satisfy workspace rules.",
      action: "Review the required fields and eligibility, then retry.",
      retryable: false,
    };
  }
  if (/CONFLICT|STALE|REVISION|409/.test(code)) {
    return {
      category: "conflict",
      code,
      message: safe ?? "This record changed on another device.",
      action: action ?? "Refresh the workspace, review the changes and retry.",
      field,
      retryable: true,
    };
  }
  if (/VALIDATION|INVALID|INPUT/.test(code)) {
    return {
      category: "validation",
      code,
      message: safe ?? "Check the information entered.",
      action,
      field,
      retryable: false,
    };
  }
  if (/NOT_FOUND|404/.test(code)) {
    return {
      category: "not_found",
      code,
      message: safe ?? "The requested record could not be found.",
      action: action ?? "Return to the list and refresh.",
      retryable: false,
    };
  }
  if (/DATABASE|STORAGE|SQLITE|DISK/.test(code)) {
    return {
      category: "storage",
      code,
      message: "The workspace couldn't finish the data operation.",
      action: "Review your storage access and try again. Do not reset the workspace.",
      retryable: true,
    };
  }
  if (/INTERNAL|PANIC|500|^5\d\d$/.test(code)) {
    return {
      category: "internal",
      code,
      message: "Something went wrong while processing that request.",
      action: "Retry once. If it continues, contact the CivicFlow maintainer.",
      retryable: true,
    };
  }
  return {
    category: "unknown",
    code,
    message: safe ?? "The request couldn't be completed.",
    action,
    field,
    retryable: false,
  };
}

/** For existing toast/form callers. Use classifyError for code, field or recovery UI. */
export function messageOf(error: unknown, fallback?: string): string {
  const normalized = classifyError(error);
  if (fallback && normalized.category === "unknown" && normalized.code === "UNKNOWN") {
    return normalized.message === "The request couldn't be completed."
      ? fallback
      : normalized.message;
  }
  return normalized.message;
}
