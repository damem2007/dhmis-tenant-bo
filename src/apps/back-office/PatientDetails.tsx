import { useEffect, useState, type FormEvent } from "react";
import { api, money } from "../../shared/api";
import { Field } from "../../shared/Fields";
import type { Patient, Reference, InsurancePlan } from "../../shared/types";
export function PatientDetails({
  patient,
  patients,
  reference,
  permissions,
  run,
  busy,
  refresh,
}: {
  patient: Patient;
  patients: Patient[];
  reference: Reference;
  permissions: string[];
  run: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  refresh: () => Promise<void>;
}) {
  type FamilyLink = { id: string; guardian_id: string; dependent_id: string; relationship: string };
  type PatientPanelState = {
    family: FamilyLink[];
    plans: InsurancePlan[];
    eligibility: string;
    error: string;
  };
  const [state, setState] = useState<PatientPanelState>({
    family: [],
    plans: [],
    eligibility: "",
    error: "",
  });
  const patchState = (next: Partial<PatientPanelState>) =>
    setState((current) => ({ ...current, ...next }));
  const load = async () => {
    const [family, plans] = await Promise.all([
      api<FamilyLink[]>(`/patients/${patient.id}/family`),
      api<InsurancePlan[]>(`/claims/plans/${patient.id}`),
    ]);
    patchState({ family, plans });
  };
  useEffect(() => {
    void load().catch((reason) => patchState({ error: reason.message }));
  }, [patient.id]);

  async function handlePatientUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api(`/patients/${patient.id}`, {
        first_name: form.get("first"),
        last_name: form.get("last"),
        birth_date: form.get("dob"),
        email: form.get("email"),
        phone: form.get("phone"),
        location_id: form.get("location"),
        medical_history: form.get("medical"),
        dental_history: form.get("dental"),
        allergies: String(form.get("allergies")).split(",").map((item) => item.trim()).filter(Boolean),
        alerts: String(form.get("alerts")).split(",").map((item) => item.trim()).filter(Boolean),
      }, "PUT");
      await refresh();
    });
  }

  async function handleGuardianLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api("/patients/guardian-links", {
        guardian_id: form.get("guardian"),
        dependent_id: patient.id,
        relationship: form.get("relationship"),
      });
      await load();
    });
  }

  async function checkEligibility(plan: InsurancePlan) {
    await run(async () => {
      const result = await api<{ eligible: boolean; coverage_pct: number; remaining_cents: number }>(
        `/claims/plans/${plan.id}/eligibility`,
        {},
      );
      patchState({
        eligibility: `${plan.payer_name}: ${result.eligible ? "Eligible" : "Waiting period"} · ${result.coverage_pct}% · ${money(result.remaining_cents)} remaining (sandbox estimate)`,
      });
    });
  }

  async function handleCoverage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api("/claims/plans", {
        patient_id: patient.id,
        payer_name: form.get("payer"),
        member_id: form.get("member"),
        priority: Number(form.get("priority")),
        coverage_pct: Number(form.get("coverage")),
        maximum_cents: Math.round(Number(form.get("maximum")) * 100),
      });
      await load();
    });
  }
  return (
    <details open className="panel mt-5">
      <summary className="text-lg font-semibold">
        {patient.first_name} {patient.last_name} · Patient details
      </summary>
      {state.error && <p role="alert">{state.error}</p>}
      <div className="mt-4 grid gap-5 xl:grid-cols-2">
        <form className="space-y-3" onSubmit={handlePatientUpdate}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="First name">
              <input
                className="field"
                name="first"
                defaultValue={patient.first_name}
                required
              />
            </Field>
            <Field label="Last name">
              <input
                className="field"
                name="last"
                defaultValue={patient.last_name}
                required
              />
            </Field>
            <Field label="Date of birth">
              <input
                className="field"
                name="dob"
                type="date"
                defaultValue={patient.birth_date}
                required
              />
            </Field>
            <Field label="Email">
              <input
                className="field"
                name="email"
                type="email"
                defaultValue={patient.email}
              />
            </Field>
            <Field label="Phone">
              <input
                className="field"
                name="phone"
                defaultValue={patient.phone}
              />
            </Field>
            <Field label="Home location">
              <select
                className="field"
                name="location"
                defaultValue={patient.location_id}
              >
                {reference.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Allergies (comma-separated)">
            <input
              className="field"
              name="allergies"
              defaultValue={patient.allergies.join(", ")}
            />
          </Field>
          <Field label="Alerts (comma-separated)">
            <input
              className="field"
              name="alerts"
              defaultValue={patient.alerts?.join(", ")}
            />
          </Field>
          <Field label="Medical history">
            <textarea
              className="field"
              name="medical"
              maxLength={5000}
              defaultValue={patient.medical_history}
            />
          </Field>
          <Field label="Dental history">
            <textarea
              className="field"
              name="dental"
              maxLength={5000}
              defaultValue={patient.dental_history}
            />
          </Field>
          <button className="btn" disabled={busy}>
            Update patient record
          </button>
        </form>
        <div>
          <form className="space-y-3" onSubmit={handleGuardianLink}>
            <h3 className="font-semibold">Guardians & dependents</h3>
            <Field label="Guardian">
              <select className="field" name="guardian" required>
                {patients
                  .filter((p) => p.id !== patient.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.first_name} {p.last_name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Relationship">
              <input
                className="field"
                name="relationship"
                required
                placeholder="Parent, legal guardian…"
              />
            </Field>
            <button
              className="btn-secondary"
              disabled={busy || patients.length < 2}
            >
              Link guardian
            </button>
            {state.family.map((f) => (
              <p key={f.id} className="text-sm">
                {patients.find((p) => p.id === f.guardian_id)?.first_name ||
                  "Guardian"}{" "}
                →{" "}
                {patients.find((p) => p.id === f.dependent_id)?.first_name ||
                  "Dependent"}{" "}
                · {f.relationship}
              </p>
            ))}
          </form>
          <h3 className="mb-3 mt-6 font-semibold">Insurance coverage</h3>
          {state.plans.map((p) => (
            <div
              className="mb-3 rounded-lg border border-[var(--border)] p-3 text-sm"
              key={p.id}
            >
              <strong>
                {p.priority === 1 ? "Primary" : "Secondary"} · {p.payer_name}
              </strong>
              <p>
                {p.coverage_pct}% · {money(p.maximum_cents - p.used_cents)}{" "}
                remaining
              </p>
              <button
                className="btn-secondary mt-2"
                disabled={busy}
                onClick={() => void checkEligibility(p)}
              >
                Check eligibility
              </button>
            </div>
          ))}
          {state.eligibility && (
            <p role="status" className="text-sm">
              {state.eligibility}
            </p>
          )}
          {permissions.includes("claims") && (
            <form className="mt-3 space-y-3" onSubmit={handleCoverage}>
              <Field label="Payer name">
                <input className="field" name="payer" required />
              </Field>
              <Field label="Member ID">
                <input className="field" name="member" required />
              </Field>
              <div className="grid gap-3 grid-cols-3">
                <Field label="Priority">
                  <select name="priority" className="field">
                    <option value="1">Primary</option>
                    <option value="2">Secondary</option>
                  </select>
                </Field>
                <Field label="Coverage %">
                  <input
                    name="coverage"
                    className="field"
                    type="number"
                    min="0"
                    max="100"
                    required
                  />
                </Field>
                <Field label="Maximum CAD">
                  <input
                    name="maximum"
                    className="field"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                  />
                </Field>
              </div>
              <button className="btn-secondary" disabled={busy}>
                Save coverage
              </button>
            </form>
          )}
        </div>
      </div>
    </details>
  );
}
