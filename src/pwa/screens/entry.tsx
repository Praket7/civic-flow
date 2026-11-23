import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, ArrowLeft, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { signUpWithPassword } from "../../lib/sync/auth";
import { messageOf } from "../../lib/errors";
import { Button, Field, Input } from "../ui";
import styles from "../pwa.module.css";

/** Public PWA entry: first visits must never be blocked by a password form. */
export function WelcomeScreen() {
  return (
    <main className={styles.welcomePage}>
      <section className={styles.welcomePhoto} aria-label="Volunteers at work">
        <img src="/media/welcome-volunteer.jpg" alt="Volunteer packing food at a community distribution" />
        <div className={styles.welcomePhotoCopy}>
          <p className={styles.welcomeEyebrow}>CivicFlow · People and purpose</p>
          <h2>Keep the roster close. Keep the team in sync.</h2>
          <p>Organize opportunities, fill shifts and keep service hours accountable.</p>
        </div>
      </section>
      <section className={styles.welcomePanel} aria-labelledby="pwa-welcome-title">
        <p className={styles.welcomeEyebrow}>Volunteer and coordinator workspace</p>
        <h1 id="pwa-welcome-title" className={styles.welcomeTitle}>Service, organized.</h1>
        <p className={styles.welcomeLead}>Plan with confidence, serve your community and keep every hour accounted for. Start a real account, return to your organization, or explore the sample without signing in.</p>
        <div className={styles.welcomeActions}>
          <Link to="/create-account" className={styles.welcomePrimary}>
            Create an account <ArrowRight size={17} aria-hidden />
          </Link>
          <Link to="/sign-in" className={styles.welcomeSecondary}>Sign in</Link>
          <a href="/judge/demo/#/welcome" className={styles.welcomeSecondary}>Explore the demo — no account required</a>
        </div>
        <p className={styles.authSwitch}>Real shared records require an invitation from an organization. The interactive demo uses sample data only.</p>
      </section>
    </main>
  );
}

/** Supabase credentials are created by the provider, never stored by CivicFlow. */
export function CreateAccountScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    if (name.trim().length < 2) return setProblem("Enter your full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setProblem("Enter a valid email address.");
    if (password.length < 8) return setProblem("Use at least eight characters in your password.");
    if (password !== confirm) return setProblem("The passwords do not match.");
    setBusy(true);
    try {
      await signUpWithPassword(name.trim(), email.trim(), password);
      setSubmitted(true);
    } catch (caught) {
      setProblem(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.authPage}>
      <section className={styles.authPanel} aria-labelledby="pwa-signup-title">
        <Link to="/welcome" className={styles.authTextLink}><ArrowLeft size={15} aria-hidden /> Back to welcome</Link>
        <div className={styles.brand}><span className={styles.brandMark} aria-hidden>CF</span>
          <div><p className={styles.brandName}>CivicFlow</p><p className={styles.brandSub}>Create your account</p></div>
        </div>
        <h1 id="pwa-signup-title" className={styles.brandName}>Get started with CivicFlow</h1>
        <p className={styles.authSwitch}>Your email account is separate from organization permissions.</p>
        {submitted ? (
          <div className={styles.signupNotice} role="status">
            <ShieldCheck size={20} aria-hidden />
            <p>Account request received. Check your email for a confirmation link if verification is required.</p>
            <p>Once confirmed, sign in. To use a real organization workspace, ask its coordinator for an invitation.</p>
            <Link to="/sign-in" className={styles.authTextLink}>Continue to sign in <ArrowRight size={15} aria-hidden /></Link>
            <a className={styles.authTextLink} href="/judge/demo/#/welcome">Explore the demo without an account</a>
          </div>
        ) : (
          <form className={styles.form} onSubmit={(event) => void submit(event)}>
            <Field label="Full name"><Input required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Email"><Input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Password"><Input required type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Field label="Confirm password"><Input required type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
            {problem ? <p className={styles.error} role="alert">{problem}</p> : null}
            <Button type="submit" loading={busy}>Create account <ArrowRight size={17} aria-hidden /></Button>
          </form>
        )}
        <p className={styles.authSwitch}>Already registered? <Link to="/sign-in">Sign in</Link></p>
      </section>
    </main>
  );
}
