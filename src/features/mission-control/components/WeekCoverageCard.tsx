import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { CoverageDay } from "../../../types/domain";
import { t } from "../../../lib/i18n";
import styles from "../MissionControl.module.css";

interface WeekCoverageCardProps {
  days: CoverageDay[];
}

function toneFor(percent: number) {
  if (percent >= 90) return "good";
  if (percent >= 75) return "watch";
  return "risk";
}

export function WeekCoverageCard({ days }: WeekCoverageCardProps) {
  // Weight the headline by actual seats, not by the average of daily percentages.
  const capacity = days.reduce((total, day) => total + day.capacity, 0);
  const confirmed = days.reduce((total, day) => total + Math.min(day.confirmed, day.capacity), 0);
  const seatsOpen = Math.max(0, capacity - confirmed);
  const daysWithOpenings = days.filter((day) => day.capacity > day.confirmed).length;
  const weeklyFill = capacity > 0 ? `${Math.round((confirmed / capacity) * 100)}%` : "—";

  return (
    <section className={`${styles.card} ${styles.weekCard}`} aria-labelledby="mc-week">
      <div className={styles.cardHead}>
        <div>
          <h2 id="mc-week" className={styles.sectionTitle}>
            This week&rsquo;s shifts
          </h2>
          <p className={styles.cardKicker}>Seats filled, day by day</p>
        </div>
        <Link className={styles.textLink} to="/coordinator/schedule">
          Open the week
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>

      <ul className={styles.bars} aria-label="Seat fill by day">
        {days.map((day) => {
          const dayName = t(day.key.charAt(0).toUpperCase() + day.key.slice(1));
          const dayNumber = day.label.match(/(\S+)$/)?.[1] ?? day.label;
          const label = `${dayName} ${dayNumber}`;
          return (
            <li
              key={day.key}
              className={styles.barColumn}
              aria-label={`${label}: ${day.percent}%, ${day.confirmed} ${t("of")} ${day.capacity} ${t("seats filled")}`}
            >
              <span className={styles.barDayName}>{dayName}</span>
              <span className={styles.barDay}>{dayNumber}</span>
              <span
                className={styles.barPercent}
                data-tone={toneFor(day.percent)}
                aria-hidden="true"
              >
                {day.capacity > 0 ? `${day.percent}%` : "—"}
              </span>
              <span className={styles.barTrack} aria-hidden="true">
                <span
                  className={styles.barFill}
                  data-tone={toneFor(day.percent)}
                  style={{
                    height: `${day.capacity > 0 ? Math.max(0, Math.min(100, day.percent)) : 0}%`,
                  }}
                />
              </span>
            </li>
          );
        })}
      </ul>

      <div className={styles.coverageSummary} role="group" aria-label="Weekly staffing summary">
        <div className={styles.coverageStat}>
          <strong className={styles.coverageValue}>{weeklyFill}</strong>
          <span className={styles.coverageLabel}>Weekly fill</span>
        </div>
        <div className={styles.coverageStat}>
          <strong className={styles.coverageValue}>{seatsOpen}</strong>
          <span className={styles.coverageLabel}>Seats still open</span>
        </div>
        <div className={styles.coverageStat}>
          <strong className={styles.coverageValue}>{daysWithOpenings}</strong>
          <span className={styles.coverageLabel}>Days with openings</span>
        </div>
      </div>

      <table className="visually-hidden">
        <caption>Seat fill by day this week</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Filled seats</th>
            <th scope="col">Capacity</th>
            <th scope="col">Percent</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.key}>
              <th scope="row">
                {t(day.key.charAt(0).toUpperCase() + day.key.slice(1))}{" "}
                {day.label.match(/(\S+)$/)?.[1] ?? day.label}
              </th>
              <td>{day.confirmed}</td>
              <td>{day.capacity}</td>
              <td>{day.capacity > 0 ? `${day.percent}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
