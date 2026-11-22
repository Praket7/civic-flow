import { ArrowRight, LogIn } from "lucide-react";
import { Link } from "react-router-dom";
import { t } from "../../lib/i18n";
import { demoWorkspace } from "../../lib/workspace/dataset";
import { isTauri } from "../../lib/platform";
import styles from "./LaunchPage.module.css";

// The launch screen is public, so it reads the bundled seed rather than the
// signed-in workspace. No volunteer record reaches this page before sign-in.
export function LaunchPage() {
  const workspace = demoWorkspace;
  const demoOnly = import.meta.env.PROD && !isTauri();

  const features = [
    {
      title: t("Plan schedules and open shifts"),
      detail: t("Keep volunteer roles, assignments, and availability together."),
    },
    {
      title: t("Review attendance and hours"),
      detail: t("Record check-ins and review service before approving hours."),
    },
    {
      title: t("Fill gaps with AutoRoster"),
      detail: t("Compare eligible volunteers before assigning open roles."),
    },
  ];

  return (
    <div className={styles.launch}>
      <header className={styles.masthead}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" focusable="false">
              <path
                d="M4.2 8.6c4.6-4.9 11.2-4.9 15.8-.9-4.7 4.6-11.2 4.8-15.8.9Z"
                fill="currentColor"
              />
              <path
                d="M4.4 15.1c4.4-4.3 10.6-4.4 15.2-.7-4.6 4.4-10.8 4.6-15.2.7Z"
                fill="currentColor"
                opacity="0.6"
              />
            </svg>
          </span>
          <span className={styles.wordmark}>CivicFlow</span>
        </div>
        <span className={styles.mastheadMeta}>Local workspace · v0.1.2</span>
      </header>

      <main className={styles.stage}>
        <section className={styles.copy} aria-labelledby="launch-title">
          <p className={styles.kicker}>
            Sample workspace · {workspace.organization.city},{" "}
            {workspace.organization.state}
          </p>
          <h1 className={styles.headline} id="launch-title">
            The volunteer desk is open.
          </h1>
          <p className={styles.lede}>
            Coordinate opportunities, shifts, check-ins, and service hours in one place. Desktop
            workspaces run offline; shared workspaces synchronize when connected.
          </p>

          <div className={styles.actions}>
            <Link className={styles.primaryAction} to="/welcome">
              {demoOnly ? "Explore the demo" : "Open workspace"}
              <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
            </Link>
            {demoOnly ? null : (
              <>
                <Link className={styles.secondaryAction} to="/sign-in">
                  <LogIn size={14} strokeWidth={1.9} aria-hidden="true" />
                  Sign in
                </Link>
                <Link className={styles.tertiaryAction} to="/create-account">
                  Create account
                </Link>
              </>
            )}
          </div>

          <p className={styles.reassurance}>
            {demoOnly
              ? "The browser demo uses sample data and does not save changes to a real organization."
              : "Local records stay on this device. Shared records sync through Supabase when connected."}
          </p>
        </section>

        <aside className={styles.statusCard} aria-label="What CivicFlow supports">
          <div className={styles.statusHead}>
            <span className={styles.statusKicker}>What you can do</span>
            <span className={styles.statusCount}>At a glance</span>
          </div>
          <ul className={styles.checks}>
            {features.map((feature) => (
              <li key={feature.title} className={styles.check}>
                <span className={styles.checkTop}>
                  <ArrowRight size={13} strokeWidth={2} aria-hidden="true" />
                  {feature.title}
                </span>
                <span className={styles.checkDetail}>{feature.detail}</span>
              </li>
            ))}
          </ul>
          <p className={styles.statusFoot}>
            Previewed with sample records · not a live database health check
          </p>
        </aside>
      </main>

      <figure className={styles.cityStrip}>
        <img
          className={styles.cityImage}
          src="/media/buffalo-skyline.jpg"
          alt="Buffalo, New York, seen from across the water"
        />
        <span className={styles.cityScrim} aria-hidden="true" />
        <figcaption className={styles.cityCaption}>
          <span>Buffalo, New York</span>
          <span>Peter S / Wikimedia Commons · CC BY-SA 4.0</span>
        </figcaption>
      </figure>

      <footer className={styles.footer}>
        <span>v0.1.2 · Local-first desktop build</span>
        <span>
          {workspace.organization.city}, {workspace.organization.state} ·{" "}
          {workspace.organization.timezone}
        </span>
      </footer>
    </div>
  );
}
