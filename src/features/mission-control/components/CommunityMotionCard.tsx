import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { ImpactSummary } from "../../../types/domain";
import { formatNumber } from "../../../lib/workspace/selectors";
import styles from "../MissionControl.module.css";

interface CommunityMotionCardProps {
  impact: ImpactSummary;
  photos: string[];
}

export function CommunityMotionCard({ impact, photos }: CommunityMotionCardProps) {
  return (
    <section className={`${styles.card} ${styles.motionCard}`} aria-labelledby="mc-motion">
      <div className={styles.cardHead}>
        <h2 id="mc-motion" className={styles.sectionTitle}>
          Community impact
        </h2>
      </div>

      <div className={styles.motionBody}>
        {photos[0] ? (
          <img
            className={styles.motionPhoto}
            src={photos[0]}
            alt=""
            aria-hidden="true"
            loading="lazy"
          />
        ) : null}
        <div className={styles.motionStat}>
          <p className={styles.motionNumber}>
            {formatNumber(impact.familiesServedThisMonth)}
            <span> families served</span>
          </p>
          <p className={styles.motionSub}>this month</p>
        </div>
      </div>

      <div className={styles.motionFooter}>
        <p className={styles.motionMeta}>
          {formatNumber(impact.mealsPacked)} meals packed · {formatNumber(impact.tutoringSessions)}{" "}
          tutoring sessions
        </p>
        <Link className={styles.textLink} to="/coordinator/impact">
          See the impact
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
