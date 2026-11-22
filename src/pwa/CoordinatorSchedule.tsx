import { useEffect, useState } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";
import { supabase } from "../lib/sync/auth";
import { messageOf } from "../lib/errors";
import { Button, Card, Pill } from "./ui";
import styles from "./pwa.module.css";

export interface HostedOpportunity {
  id: string;
  title: string;
  cause: string | null;
}

export interface HostedShift {
  id: string;
  opportunity_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  capacity: number;
  confirmed: number;
}

interface ScheduleSnapshot {
  opportunities: HostedOpportunity[];
  shifts: HostedShift[];
}

export function availableSeats(shift: HostedShift): number {
  return Math.max(0, shift.capacity - shift.confirmed);
}

/**
 * Server-backed coordinator schedule preview.
 *
 * RLS, not a client-side role flag, authorizes both SELECT queries. There is
 * deliberately no localStorage fallback or public demo schedule here.
 */
export function CoordinatorSchedule({
  organizationId,
  timezone,
}: {
  organizationId: string;
  timezone: string;
}) {
  const [data, setData] = useState<ScheduleSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    setLoading(true);

    void (async () => {
      try {
        const [opportunities, shifts] = await Promise.all([
          supabase()
            .from("opportunities")
            .select("id,title,cause")
            .eq("organization_id", organizationId)
            .order("title", { ascending: true })
            .limit(100),
          supabase()
            .from("shifts")
            .select("id,opportunity_id,starts_at,ends_at,status,capacity,confirmed")
            .eq("organization_id", organizationId)
            .gte("ends_at", new Date().toISOString())
            .order("starts_at", { ascending: true })
            .limit(20),
        ]);
        if (!active) return;
        if (opportunities.error) throw new Error(opportunities.error.message);
        if (shifts.error) throw new Error(shifts.error.message);
        setData({
          opportunities: (opportunities.data ?? []) as HostedOpportunity[],
          shifts: (shifts.data ?? []) as HostedShift[],
        });
        setError(null);
      } catch (caught) {
        if (active) {
          setData(null);
          setError(messageOf(caught));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [organizationId, version]);

  const titles = new Map(data?.opportunities.map((item) => [item.id, item.title]) ?? []);
  const formatStart = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date unavailable";
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: timezone,
      }).format(date);
    } catch {
      return date.toLocaleString();
    }
  };

  return (
    <Card>
      <div className={styles.rowActions}>
        <h2 className={styles.cardTitle}>
          <CalendarDays aria-hidden size={18} /> Upcoming shifts
        </h2>
        <Button
          variant="secondary"
          loading={loading}
          onClick={() => setVersion((current) => current + 1)}
        >
          <RefreshCw aria-hidden size={16} /> Refresh schedule
        </Button>
      </div>
      <p className={styles.muted}>
        Live organization records, not the sample schedule. Showing up to 20 upcoming shifts.
        Use CivicFlow desktop to edit staffing and publish new opportunities.
      </p>
      {loading ? <p className={styles.body} role="status">Reading the shared schedule…</p> : null}
      {error ? (
        <p className={styles.cautionBody} role="alert">
          The schedule could not be loaded: {error}
        </p>
      ) : null}
      {data && data.shifts.length === 0 ? (
        <p className={styles.body}>No upcoming shifts were returned for this organization.</p>
      ) : null}
      {data && data.shifts.length > 0 ? (
        <ul className={styles.healthList}>
          {data.shifts.map((shift) => (
            <li key={shift.id} className={styles.healthRow}>
              <div>
                <p className={styles.prefTitle}>
                  {titles.get(shift.opportunity_id) ?? "Untitled opportunity"}
                </p>
                <p className={styles.muted}>{formatStart(shift.starts_at)}</p>
                <p className={styles.fieldHint}>{shift.status}</p>
              </div>
              <Pill tone={availableSeats(shift) > 0 ? "good" : "warn"}>
                {shift.confirmed} of {shift.capacity} filled
              </Pill>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
