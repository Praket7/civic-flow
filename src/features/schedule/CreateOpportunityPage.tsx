import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, ImagePlus } from "lucide-react";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Page,
  PageHeader,
  SelectField,
  TextField,
  TextareaField,
} from "../../components/ui";
import { useAuth } from "../../lib/auth/session";
import { currentOrganizationFor, recordOrganizationUpdate } from "../../lib/organizations/store";
import { useWorkspace } from "../../lib/workspace/session";
import { CAUSE_LABELS } from "../../lib/workspace/selectors";
import type { Cause, Opportunity } from "../../types/domain";
import { validateOpportunityDraft, type OpportunityDraft, type OpportunityDraftField } from "../../lib/workspace/opportunityValidation";
import { SeriesScheduleCard } from "./SeriesScheduleCard";
import styles from "./Schedule.module.css";
import { messageOf } from "../../lib/errors";

const CAUSE_IMAGE: Record<Cause, string> = {
  food: "/media/opp-food-distribution.jpg",
  education: "/media/opp-library-tutoring.jpg",
  environment: "/media/opp-community-garden.jpg",
  health: "/media/opp-senior-meals.jpg",
  community: "/media/opp-community-event.jpg",
  animals: "/media/opp-animal-shelter.jpg",
};

const STEPS = ["Brief", "Details", "Review"];

export function CreateOpportunityPage() {
  const { workspace, actions } = useWorkspace();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [planner, setPlanner] = useState("");
  const [planNote, setPlanNote] = useState("");
  const [title, setTitle] = useState("");
  const [cause, setCause] = useState<Cause>("food");
  const [description, setDescription] = useState("");
  // Start from this organization's own location, never another workspace's.
  const [address, setAddress] = useState(() => {
    const org = workspace.organization;
    const cityState = [org.city, org.state].filter(Boolean).join(", ");
    if (!org.address) return cityState;
    if (org.city && org.address.toLowerCase().includes(org.city.toLowerCase())) return org.address;
    return [org.address, cityState].filter(Boolean).join(", ");
  });
  const [capacity, setCapacity] = useState("12");
  const [duration, setDuration] = useState("2 hours");
  const [requirements, setRequirements] = useState("Reliable arrival, Water bottle");
  const [error, setError] = useState("");
  const [invalidField, setInvalidField] = useState<OpportunityDraftField | null>(null);
  const [created, setCreated] = useState<Opportunity | null>(null);

  function generatePlan() {
    if (planner.trim().length < 12) {
      setError("Describe the service in a sentence or two, then generate a plan.");
      return;
    }
    const lower = planner.toLowerCase();
    const nextCause: Cause =
      lower.includes("tutor") || lower.includes("read")
        ? "education"
        : lower.includes("garden") || lower.includes("tree") || lower.includes("park")
          ? "environment"
          : lower.includes("senior") || lower.includes("meal delivery")
            ? "health"
            : lower.includes("animal") || lower.includes("shelter")
              ? "animals"
              : lower.includes("mural") || lower.includes("neighbor")
                ? "community"
                : "food";
    const suggestedTitle =
      nextCause === "food"
        ? "Weekend Pantry Restock"
        : nextCause === "education"
          ? "After-School Reading Lab"
          : nextCause === "environment"
            ? "Neighborhood Garden Workday"
            : nextCause === "health"
              ? "Senior Meal Route"
              : nextCause === "animals"
                ? "Shelter Enrichment Hour"
                : "Block Mural Workshop";
    const needs: string[] = ["Reliable arrival", "Closed-toe shoes"];
    if (lower.includes("spanish")) needs.push("Spanish");
    if (lower.includes("driver") || lower.includes("delivery")) needs.push("Driver");
    if (lower.includes("food") || lower.includes("pantry")) needs.push("Food handling");
    setTitle(suggestedTitle);
    setCause(nextCause);
    setDescription(planner.trim());
    setRequirements(needs.join(", "));
    setCapacity(lower.includes("large") ? "20" : "12");
    setPlanNote(
      `Drafted ${suggestedTitle}. We chose ${CAUSE_LABELS[nextCause].toLowerCase()} as the cause and ${needs.length} requirements. Confirm every field before saving.`,
    );
    setError("");
  }

  function draft(): OpportunityDraft {
    return { title, cause, description, address, capacity, duration, requirements };
  }

  function next() {
    if (step === 0) {
      if (title.trim().length < 3 || title.trim().length > 100) {
        setError("Use an opportunity name between 3 and 100 characters.");
        setInvalidField("title");
        return;
      }
    }
    if (step === 1) {
      const validation = validateOpportunityDraft(draft());
      if (!validation.valid) {
        setError(validation.message);
        setInvalidField(validation.field);
        if (validation.field === "title" || validation.field === "cause") setStep(0);
        return;
      }
    }
    setError("");
    setInvalidField(null);
    setStep((current) => Math.min(2, current + 1));
  }

  async function save() {
    // The same checks run again at commit time; passing an earlier wizard
    // step is not permission to persist an invalid or stale draft.
    const validation = validateOpportunityDraft(draft());
    if (!validation.valid) {
      setError(validation.message);
      setInvalidField(validation.field);
      setStep(validation.field === "title" || validation.field === "cause" ? 0 : 1);
      return;
    }
    const input = validation.input;
    setInvalidField(null);
    try {
      const opportunity = await actions.createOpportunity(input);
      const organization = user ? currentOrganizationFor(user.email) : null;
      if (organization) {
        recordOrganizationUpdate({
          organizationId: organization.id,
          kind: "event",
          title: `New event: ${opportunity.title}`,
          body: `${organization.name} published ${opportunity.title} for ${opportunity.duration}. ${opportunity.address}.`,
          href: "/volunteer/discover",
          author: user?.name ?? "Coordinator",
        });
      }
      setCreated(opportunity);
      setError("");
    } catch (caught) {
      setError(messageOf(caught, "The program could not be saved."));
    }
  }

  if (created) {
    return (
      <Page width="narrow">
        <Card>
          <div className={styles.success}>
            <span
              style={{
                display: "grid",
                placeItems: "center",
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "var(--tone-green-soft)",
                color: "var(--tone-green-ink)",
              }}
            >
              <Check size={22} />
            </span>
            <h1 className={styles.successTitle}>{created.title} is ready.</h1>
            <p className={styles.successCopy}>
              The program is saved to this workspace. Add shifts before you publish it to
              volunteers, and invite the roles it needs.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <ButtonLink to="/coordinator/opportunities" variant="primary">
                Back to opportunities
              </ButtonLink>
              <ButtonLink to={`/coordinator/opportunities/${created.id}`} variant="secondary">
                Open program page
              </ButtonLink>
              <Button
                variant="ghost"
                onClick={() => {
                  setCreated(null);
                  setStep(0);
                  setPlanner("");
                  setTitle("");
                  setDescription("");
                  setPlanNote("");
                }}
              >
                Create another
              </Button>
            </div>
          </div>
        </Card>
        <SeriesScheduleCard opportunity={created} />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        eyebrow="New program"
        title="Create an opportunity"
        description="Describe the service in plain language, then confirm the details volunteers will see."
        backTo="/coordinator/opportunities"
        backLabel="Opportunities"
        actions={<Badge tone="neutral">Draft</Badge>}
      />

      <div className={styles.steps} aria-label="Create opportunity steps">
        {STEPS.map((label, index) => (
          <div
            key={label}
            className={`${styles.step} ${index === step ? styles.stepActive : ""}`}
            aria-current={index === step ? "step" : undefined}
          >
            <span className={styles.stepNumber}>{index + 1}</span>
            {label}
          </div>
        ))}
      </div>

      <div className={styles.wizard}>
        <Card className={styles.formCard}>
          {step === 0 ? (
            <>
              <h2 className={styles.formTitle}>Tell us what you need</h2>
              <p className={styles.formSub}>
                Describe the opportunity in plain language. The planner proposes a draft; you
                confirm every field.
              </p>
              <div className={styles.planBox} style={{ marginTop: 16 }}>
                <div className={styles.planTitle}>Quick plan</div>
                <p className={styles.planHint}>
                  Example: “We need six volunteers Saturday morning to restock the pantry, load
                  boxes, and drive two deliveries. Spanish speakers welcome.”
                </p>
                <div className={styles.planRow}>
                  <textarea
                    className={styles.planInput}
                    value={planner}
                    onChange={(event) => {
                      setPlanner(event.target.value);
                      setError("");
                    }}
                    placeholder="What does the community need?"
                    aria-label="Describe the service"
                  />
                  <Button variant="primary" onClick={generatePlan} type="button">
                    Generate plan
                  </Button>
                </div>
                {planNote ? (
                  <p
                    style={{
                      marginTop: 8,
                      fontSize: 12.5,
                      color: "var(--tone-green-ink)",
                      lineHeight: 1.5,
                    }}
                  >
                    {planNote}
                  </p>
                ) : null}
              </div>

              <div className={styles.formGrid}>
                <TextField
                  label="Opportunity name"
                  aria-invalid={Boolean(error && invalidField === "title")}
                  aria-describedby={error && invalidField === "title" ? "opportunity-form-error" : undefined}
                  placeholder="Community Food Distribution"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setError("");
                  }}
                />
                <SelectField
                  label="Cause"
                  value={cause}
                  onChange={(event) => setCause(event.target.value as Cause)}
                >
                  {Object.entries(CAUSE_LABELS).map(([id, label]) => (
                    <option value={id} key={id}>
                      {label}
                    </option>
                  ))}
                </SelectField>
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <h2 className={styles.formTitle}>Program details</h2>
              <p className={styles.formSub}>
                These fields become the public listing. Write for a first-time volunteer.
              </p>
              <div className={styles.formGrid}>
                <div className={styles.full}>
                  <TextareaField
                    label="What volunteers will do"
                  aria-invalid={Boolean(error && invalidField === "description")}
                  aria-describedby={error && invalidField === "description" ? "opportunity-form-error" : undefined}
                    hint="At least one sentence. Mention the pace, the team, and the impact."
                    value={description}
                    onChange={(event) => {
                      setDescription(event.target.value);
                      setError("");
                    }}
                  />
                </div>
                <div className={styles.full}>
                  <TextField
                    label="Where to arrive"
                  aria-invalid={Boolean(error && invalidField === "address")}
                  aria-describedby={error && invalidField === "address" ? "opportunity-form-error" : undefined}
                    value={address}
                    onChange={(event) => {
                      setAddress(event.target.value);
                      setError("");
                    }}
                  />
                </div>
                <TextField
                  label="Volunteer capacity"
                  aria-invalid={Boolean(error && invalidField === "capacity")}
                  aria-describedby={error && invalidField === "capacity" ? "opportunity-form-error" : undefined}
                  type="number"
                  min={1}
                  max={200}
                  step={1}
                  inputMode="numeric"
                  value={capacity}
                  onChange={(event) => setCapacity(event.target.value)}
                />
                <TextField
                  label="Typical shift length"
                  aria-invalid={Boolean(error && invalidField === "duration")}
                  aria-describedby={error && invalidField === "duration" ? "opportunity-form-error" : undefined}
                  value={duration}
                  onChange={(event) => setDuration(event.target.value)}
                />
                <div className={styles.full}>
                  <TextField
                    label="Requirements"
                  aria-invalid={Boolean(error && invalidField === "requirements")}
                  aria-describedby={error && invalidField === "requirements" ? "opportunity-form-error" : undefined}
                    hint="Comma separated. Keep it to what actually matters on site."
                    value={requirements}
                    onChange={(event) => setRequirements(event.target.value)}
                  />
                </div>
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <h2 className={styles.formTitle}>Review and publish</h2>
              <p className={styles.formSub}>
                This is the listing volunteers will see. You can add shifts after publishing.
              </p>
              <dl className={styles.reviewRows}>
                <div className={styles.reviewRow}>
                  <dt>Name</dt>
                  <dd>{title || "—"}</dd>
                </div>
                <div className={styles.reviewRow}>
                  <dt>Cause</dt>
                  <dd>{CAUSE_LABELS[cause]}</dd>
                </div>
                <div className={styles.reviewRow}>
                  <dt>What volunteers do</dt>
                  <dd>{description || "—"}</dd>
                </div>
                <div className={styles.reviewRow}>
                  <dt>Location</dt>
                  <dd>{address || "—"}</dd>
                </div>
                <div className={styles.reviewRow}>
                  <dt>Capacity</dt>
                  <dd>{capacity} volunteers per shift</dd>
                </div>
                <div className={styles.reviewRow}>
                  <dt>Shift length</dt>
                  <dd>{duration}</dd>
                </div>
                <div className={styles.reviewRow}>
                  <dt>Requirements</dt>
                  <dd>{requirements || "None"}</dd>
                </div>
              </dl>
            </>
          ) : null}

          {error ? (
            <p id="opportunity-form-error" style={{ marginTop: 12, fontSize: 13, color: "var(--tone-red-ink)" }} role="alert">
              {error}
            </p>
          ) : null}

          <div className={styles.formActions}>
            {step === 0 ? (
              <ButtonLink to="/coordinator/opportunities" variant="ghost">
                Cancel
              </ButtonLink>
            ) : (
              <Button
                variant="ghost"
                icon={<ArrowLeft size={13} />}
                onClick={() => {
                  setStep((current) => Math.max(0, current - 1));
                  setError("");
                }}
              >
                Back
              </Button>
            )}
            {step < 2 ? (
              <Button variant="primary" icon={<ArrowRight size={13} />} onClick={next}>
                Continue
              </Button>
            ) : (
              <Button variant="primary" icon={<Check size={13} />} onClick={save}>
                Save opportunity
              </Button>
            )}
          </div>
        </Card>

        <Card className={styles.previewCard}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 className={styles.sideTitle} style={{ margin: 0 }}>
              Live preview
            </h2>
            <Badge tone="cobalt">Draft</Badge>
          </div>
          <img
            className={styles.previewImage}
            src={CAUSE_IMAGE[cause]}
            alt=""
            style={{ marginTop: 12 }}
          />
          <p className={styles.previewTitle}>{title || "Your opportunity name"}</p>
          <p className={styles.previewMeta}>
            {CAUSE_LABELS[cause]} · {duration} · {capacity || 0} volunteers
          </p>
          <p
            style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: "var(--text-secondary)" }}
          >
            {description || "Your description will appear here as volunteers will read it."}
          </p>
          <div className={styles.previewFacts}>
            <span>📍 {address || "Add a location"}</span>
            <span>🙋 {requirements || "No special requirements yet"}</span>
            <span>🎯 Impact tracked after the first shift</span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: 13,
              paddingTop: 11,
              borderTop: "1px solid var(--border-soft)",
              fontSize: 12,
              color: "var(--text-muted)",
            }}
          >
            <ImagePlus size={12} aria-hidden="true" /> Photography matches the selected cause. You
            can replace it after publishing.
          </div>
        </Card>
      </div>
    </Page>
  );
}
