import { useEffect, useState, type FormEvent } from "react";
import { api, money } from "./lib/api";
import { Field } from "./components/Fields";
import type { Appointment, Invoice, Patient, Reference, InsurancePlan } from "./types";

export type PatientRecordTab = "details" | "clinical" | "insurance" | "guardians" | "billing";

type FamilyLink = { id: string; guardian_id: string; dependent_id: string; relationship: string };
type PatientPanelState = { family: FamilyLink[]; plans: InsurancePlan[]; eligibility: string; error: string };

export function PatientDetails({
  patient, patients, appointments, invoices, reference, permissions, run, busy, refresh, activeTab, onTabChange, onBack,
}: {
  patient: Patient;
  patients: Patient[];
  appointments: Appointment[];
  invoices: Invoice[];
  reference: Reference;
  permissions: string[];
  run: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  refresh: () => Promise<void>;
  activeTab: PatientRecordTab;
  onTabChange: (tab: PatientRecordTab) => void;
  onBack: () => void;
}) {
  const [state, setState] = useState<PatientPanelState>({ family: [], plans: [], eligibility: "", error: "" });
  const patchState = (next: Partial<PatientPanelState>) => setState((current) => ({ ...current, ...next }));

  async function load() {
    const [family, plans] = await Promise.all([
      api<FamilyLink[]>(`/patients/${patient.id}/family`),
      api<InsurancePlan[]>(`/claims/plans/${patient.id}`),
    ]);
    patchState({ family, plans, error: "" });
  }

  useEffect(() => { setState((current) => ({ ...current, error: "" })); void load().catch((reason) => patchState({ error: reason.message })); }, [patient.id]);

  async function handlePatientUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api(`/patients/${patient.id}`, {
        first_name: form.get("first"), last_name: form.get("last"), birth_date: form.get("dob"),
        email: form.get("email"), phone: form.get("phone"), location_id: form.get("location"),
        medical_history: form.get("medical"), dental_history: form.get("dental"),
        allergies: String(form.get("allergies") || "").split(",").map((item) => item.trim()).filter(Boolean),
        alerts: String(form.get("alerts") || "").split(",").map((item) => item.trim()).filter(Boolean),
      }, "PUT");
      await refresh();
    });
  }

  async function handleGuardianLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api("/patients/guardian-links", { guardian_id: form.get("guardian"), dependent_id: patient.id, relationship: form.get("relationship") });
      await load();
    });
  }

  async function checkEligibility(plan: InsurancePlan) {
    await run(async () => {
      const result = await api<{ eligible: boolean; coverage_pct: number; remaining_cents: number }>(`/claims/plans/${plan.id}/eligibility`, {});
      patchState({ eligibility: `${plan.payer_name}: ${result.eligible ? "Eligible" : "Waiting period"} · ${result.coverage_pct}% · ${money(result.remaining_cents)} remaining (sandbox estimate)` });
    });
  }

  async function handleCoverage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await run(async () => {
      await api("/claims/plans", {
        patient_id: patient.id, payer_name: form.get("payer"), member_id: form.get("member"),
        priority: Number(form.get("priority")), coverage_pct: Number(form.get("coverage")),
        maximum_cents: Math.round(Number(form.get("maximum")) * 100),
      });
      await load();
      formElement.reset();
    });
  }

  const location = reference.locations.find((item) => item.id === patient.location_id);
  const patientAppointments = appointments.filter((appointment) => appointment.patient_id === patient.id).sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
  const now = Date.now();
  const nextVisit = patientAppointments.find((appointment) => new Date(appointment.starts_at).getTime() >= now);
  const initials = `${patient.first_name[0] || ""}${patient.last_name[0] || ""}`.toUpperCase();
  const tabs: { id: PatientRecordTab; label: string }[] = [
    { id: "details", label: "Details" }, { id: "clinical", label: "Clinical chart" },
    { id: "insurance", label: "Insurance" }, { id: "guardians", label: "Guardians & dependents" }, { id: "billing", label: "Billing" },
  ];

  function openSchedule() {
    const target = window.location.pathname.replace(/\/admin\/patients(?:\/.*)?$/, "/admin/schedule");
    window.history.pushState({}, "", `${target}?patient=${encodeURIComponent(patient.id)}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  function openBilling() {
    const target = window.location.pathname.replace(/\/admin\/patients(?:\/.*)?$/, "/admin/billing");
    window.history.pushState({}, "", `${target}?patient=${encodeURIComponent(patient.id)}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  return (
    <section className="patients-record">
      <button className="patients-back-link" type="button" onClick={onBack}>← Patients</button>
      <header className="patients-record-header">
        <div className="patients-record-identity">
          <div className="patients-avatar" aria-hidden="true">{initials}</div>
          <div><p className="patients-breadcrumb">Patients / {patient.first_name} {patient.last_name}</p><h1>{patient.first_name} {patient.last_name} <span className="patients-status"><span aria-hidden="true">●</span> Active</span></h1><p className="muted">{ageFor(patient.birth_date)} · Born {patient.birth_date || "—"} · {location?.name || "No location"} · {patient.email || "No email"}</p></div>
        </div>
        <div className="patients-record-actions"><button className="btn-secondary" type="button" onClick={openSchedule}>Book appointment</button><button className="btn" type="button" onClick={() => onTabChange("clinical")} disabled={!permissions.includes("clinical")}>View clinical chart</button></div>
      </header>

      <div className="patients-summary">
        <article><span>Allergies</span><strong>{patient.allergies.length ? patient.allergies.join(", ") : "None recorded"}</strong></article>
        <article><span>Alerts</span><strong>{patient.alerts.length ? patient.alerts.join(", ") : "None recorded"}</strong></article>
        <article><span>Next visit</span><strong>{nextVisit ? new Date(nextVisit.starts_at).toLocaleDateString() : "—"}</strong></article>
        <article><span>Balance</span><strong>—</strong></article>
      </div>

      <nav className="patients-tabs" aria-label="Patient record sections">{tabs.map((tab) => <button key={tab.id} type="button" className={activeTab === tab.id ? "is-active" : ""} aria-current={activeTab === tab.id ? "page" : undefined} onClick={() => onTabChange(tab.id)}>{tab.label}</button>)}</nav>
      {state.error && <p className="patients-error" role="alert">{state.error}</p>}

      {activeTab === "details" && <div className="patients-record-grid">
        <form className="patients-card patients-details-form" onSubmit={handlePatientUpdate}>
          <h2>Personal details</h2>
          <div className="patients-form-grid"><Field label="First name"><input className="field" name="first" defaultValue={patient.first_name} required /></Field><Field label="Last name"><input className="field" name="last" defaultValue={patient.last_name} required /></Field><Field label="Date of birth"><input className="field" name="dob" type="date" defaultValue={patient.birth_date} required /></Field><Field label="Email"><input className="field" name="email" type="email" defaultValue={patient.email} /></Field><Field label="Phone"><input className="field" name="phone" defaultValue={patient.phone} /></Field><Field label="Home location"><select className="field" name="location" defaultValue={patient.location_id}>{reference.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field></div>
          <h2 className="patients-card-subtitle">Medical and dental</h2><Field label="Allergies (separate with commas)"><input className="field" name="allergies" defaultValue={patient.allergies.join(", ")} /></Field><Field label="Alerts (separate with commas)"><input className="field" name="alerts" defaultValue={patient.alerts.join(", ")} /></Field><Field label="Medical history"><textarea className="field" name="medical" maxLength={5000} defaultValue={patient.medical_history} /></Field><Field label="Dental history"><textarea className="field" name="dental" maxLength={5000} defaultValue={patient.dental_history} /></Field>
          <div className="patients-sticky-footer"><span className="muted">Changes are saved to the patient record.</span><button className="btn-secondary" type="reset">Discard</button><button className="btn" disabled={busy}>Update patient record</button></div>
        </form>
        <div className="patients-record-side"><InsuranceCard plans={state.plans} eligibility={state.eligibility} busy={busy} permissions={permissions} onCheck={checkEligibility} onCoverage={handleCoverage} /><GuardianCard patientId={patient.id} patients={patients} family={state.family} busy={busy} onSubmit={handleGuardianLink} /></div>
      </div>}

      {activeTab === "insurance" && <div className="patients-card"><InsuranceCard plans={state.plans} eligibility={state.eligibility} busy={busy} permissions={permissions} onCheck={checkEligibility} onCoverage={handleCoverage} /></div>}
      {activeTab === "guardians" && <div className="patients-card"><GuardianCard patientId={patient.id} patients={patients} family={state.family} busy={busy} onSubmit={handleGuardianLink} /></div>}
      {activeTab === "billing" && <div className="patients-card patients-billing-summary"><div className="patients-card-title"><div><h2>Billing</h2><p className="muted">Invoices and balances for this patient.</p></div><button className="btn-secondary" type="button" onClick={openBilling}>Open billing</button></div>{invoices.filter((invoice) => invoice.patient_id === patient.id).length ? <div className="patients-billing-list">{invoices.filter((invoice) => invoice.patient_id === patient.id).slice(0, 5).map((invoice) => <div key={invoice.id}><strong>Invoice {invoice.id.slice(0, 8)}</strong><span>{money(invoice.total_cents)} · {invoice.status}</span></div>)}</div> : <p className="muted">No invoices recorded for this patient.</p>}</div>}
      {activeTab === "clinical" && !permissions.includes("clinical") && <div className="patients-card patients-empty-tab"><h2>Clinical chart</h2><p className="muted">You do not have permission to view clinical records.</p></div>}
    </section>
  );
}

function ageFor(birthDate: string) {
  const birth = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return "—";
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

function InsuranceCard({ plans, eligibility, busy, permissions, onCheck, onCoverage }: { plans: InsurancePlan[]; eligibility: string; busy: boolean; permissions: string[]; onCheck: (plan: InsurancePlan) => Promise<void>; onCoverage: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  return <section className="patients-card-inner"><div className="patients-card-title"><h2>Insurance</h2>{permissions.includes("claims") && <button className="btn-secondary" type="button" onClick={() => document.getElementById("patient-coverage-form")?.scrollIntoView({ behavior: "smooth" })}>Edit</button>}</div>{plans.map((plan) => <div className="patients-insurance" key={plan.id}><strong>{plan.payer_name}</strong><span>{plan.priority === 1 ? "Primary" : "Secondary"} · {plan.member_id}</span><p>{plan.coverage_pct}% coverage · {money(plan.maximum_cents - plan.used_cents)} remaining</p><button className="btn-secondary" type="button" disabled={busy} onClick={() => void onCheck(plan)}>Check eligibility</button></div>)}{!plans.length && <p className="muted">No insurance plan recorded.</p>}{eligibility && <p className="patients-success" role="status">{eligibility}</p>}{permissions.includes("claims") && <form id="patient-coverage-form" className="patients-coverage-form" onSubmit={(event) => void onCoverage(event)}><h3>Add coverage</h3><div className="patients-form-grid"><Field label="Payer name"><input className="field" name="payer" required /></Field><Field label="Member ID"><input className="field" name="member" required /></Field><Field label="Priority"><select className="field" name="priority"><option value="1">Primary</option><option value="2">Secondary</option></select></Field><Field label="Coverage %"><input className="field" name="coverage" type="number" min="0" max="100" required /></Field><Field label="Maximum CAD"><input className="field" name="maximum" type="number" min="0" step="0.01" required /></Field></div><button className="btn-secondary" disabled={busy}>Save coverage</button></form>}</section>;
}

function GuardianCard({ patientId, patients, family, busy, onSubmit }: { patientId: string; patients: Patient[]; family: FamilyLink[]; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  const guardianOptions = patients.filter((item) => item.id !== patientId);
  return <section className="patients-card-inner"><div className="patients-card-title"><h2>Guardians & dependents</h2><button className="btn-secondary" type="button" onClick={() => document.getElementById("patient-guardian-form")?.scrollIntoView({ behavior: "smooth" })}>Link guardian</button></div>{family.length ? family.map((link) => <p key={link.id}>{patients.find((item) => item.id === link.guardian_id)?.first_name || "Guardian"} → {patients.find((item) => item.id === link.dependent_id)?.first_name || "Dependent"} · {link.relationship}</p>) : <p className="muted">No guardian or dependents linked.</p>}<form id="patient-guardian-form" className="patients-guardian-form" onSubmit={(event) => void onSubmit(event)}><Field label="Guardian"><select className="field" name="guardian" required>{guardianOptions.length ? guardianOptions.map((item) => <option key={item.id} value={item.id}>{item.first_name} {item.last_name}</option>) : <option value="">Add another patient before linking a guardian</option>}</select></Field><Field label="Relationship"><input className="field" name="relationship" placeholder="Parent, legal guardian…" required /></Field><button className="btn-secondary" disabled={busy}>Link guardian</button>{!guardianOptions.length && <p className="muted text-xs">A guardian must be another patient record.</p>}</form></section>;
}
