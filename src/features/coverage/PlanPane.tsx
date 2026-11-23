import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Wand2 } from "lucide-react";
import { Avatar, Button, Toggle } from "../../components/ui";
import { t } from "../../lib/i18n";
import { formatDate, timeRange } from "../../lib/workspace/selectors";
import styles from "./AutoRosterPage.module.css";
import { PlanEvidence } from "./PlanEvidence";
import type { AutoRosterModel } from "./useAutoRoster";

export function PlanPane({
  scope,
  planning,
  applied,
  appliedCount,
  plan,
  planAudit,
  activePlan,
  afterRolePercent,
  beforeRolePercent,
  beforeSeatPercent,
  afterSeatPercent,
  coverageGain,
  excludedCount,
  error,
  stale,
  answerError,
  generatePlan,
  answer,
  asking,
  alternativesFor,
  askWhyNot,
  applyPlan,
  applying,
  distinctPeople,
  unfilledCount,
  conflictCount,
  credentialCount,
  planGroups,
  options,
  updateOption,
  weightRows,
  weights,
}: AutoRosterModel) {
  return (
    <section className={`${styles.pane} ${styles.plan}`} aria-label="Proposed roster">
      <div className={styles.paneHead}>
        <div>
          <h2 className={styles.paneTitle}>{scope === "week" ? "The weekly plan" : "The plan"}</h2>
          <p className={styles.paneSub}>
            {planning
              ? "Reading availability, clashes, and recent attendance."
              : applied
                ? `Applied ${appliedCount} assignment${appliedCount === 1 ? "" : "s"} to the live roster.`
                : plan
                  ? a¶»§q«^