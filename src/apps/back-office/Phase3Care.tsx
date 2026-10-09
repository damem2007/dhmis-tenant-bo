import { useEffect, useState, type FormEvent } from 'react';
import { api, authenticatedBlobUrl } from '../../shared/api';
import { Empty, Field, Title } from '../../shared/Fields';
import type { Chart, Patient, Reference } from '../../shared/types';

type Run = (action: () => Promise<void>) => Promise<void>;
type CareTab = 'prescriptions' | 'labs' | 'referrals' | 'surgery';
type Prescription = {
  id: string; medication: string; dosage: string; route: string; frequency: string;
  duration_days: number; status: string; issued_at: string; controlled_substance: boolean;
  safety_flags: { message?: string; severity?: string }[];
};
type LabCase = { id: string; case_type: string; laboratory: string; due_at: string; status: string; overdue: boolean; notes: string };
type Referral = { id: string; direction: string; specialty: string; organization_name: string; due_at: string; status: string; overdue: boolean; reason: string };
type Admission = {
  id: string; encounter_id: string; procedure_name: string; status: string;
  preop_checklist: Record<string, boolean>; anesthesia_records: unknown[];
  recovery_notes: string; discharge_summary: string;
};
type CareRecord = { prescriptions: Prescription[]; labs: LabCase[]; referrals: Referral[]; admissions: Admission[]; chart: Chart };
type CareState =
  | { type: 'empty' }
  | { type: 'loading'; patientId: string }
  | { type: 'error'; patientId: string; message: string }
  | { type: 'ready'; patientId: string; record: CareRecord };

const labNext: Record<string, string | undefined> = { created: 'in_progress', in_progress: 'received', received: 'completed' };
const referralNext: Record<string, string | undefined> = { created: 'in_progress', in_progress: 'completed' };
const preopItems = [
  'identity_confirmed', 'consent_verified', 'medical_history_reviewed',
  'allergies_reviewed', 'fasting_confirmed', 'escort_confirmed',
];

function datetimeDefault(days = 7) {
  const value = new Date(Date.now() + days * 86400000);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
}

export function Phase3Care({ patients, reference, permissions, run, busy }: {
  patients: Patient[]; reference: Reference; permissions: string[]; run: Run; busy: boolean;
}) {
  const [tab, setTab] = useState<CareTab>('prescriptions');
  const [selectedPatient, setSelectedPatient] = useState(patients[0]?.id || '');
  const [state, setState] = useState<CareState>(patients.length ? { type: 'loading', patientId: patients[0].id } : { type: 'empty' });
  const canPrescribe = permissions.includes('prescriptions');
  const canOperate = permissions.includes('surgery');

  async function load(patientId = selectedPatient) {
    if (!patientId) return setState({ type: 'empty' });
    setState({ type: 'loading', patientId });
    try {
      const [timeline, chart, prescriptions, admissions] = await Promise.all([
        api<{ lab_cases: LabCase[]; referrals: Referral[] }>(`/care-coordination/timeline/${patientId}`),
        api<Chart>(`/clinical/${patientId}`),
        canPrescribe ? api<Prescription[]>(`/prescriptions/patient/${patientId}`) : Promise.resolve([]),
        canOperate ? api<Admission[]>(`/day-surgery/patient/${patientId}`) : Promise.resolve([]),
      ]);
      setState({ type: 'ready', patientId, record: { prescriptions, labs: timeline.lab_cases, referrals: timeline.referrals, admissions, chart } });
    } catch (reason) {
      setState({ type: 'error', patientId, message: reason instanceof Error ? reason.message : 'Care record failed' });
    }
  }

  function selectPatient(patientId: string) {
    setSelectedPatient(patientId);
    void load(patientId);
  }

  async function submitPrescription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await run(async () => {
      await api('/prescriptions', {
        patient_id: selectedPatient, prescriber_id: form.get('provider'), medication: form.get('medication'),
        dosage: form.get('dosage'), route: form.get('route'), frequency: form.get('frequency'),
        duration_days: Number(form.get('duration')), instructions: form.get('instructions'),
        controlled_substance: form.get('controlled') === 'on', override_reason: form.get('override'),
      });
      await load(); formElement.reset();
    });
  }

  async function submitLab(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    await run(async () => {
      await api('/care-coordination/labs', { patient_id: selectedPatient, provider_id: form.get('provider'), case_type: form.get('type'), laboratory: form.get('laboratory'), due_at: new Date(String(form.get('due'))).toISOString(), notes: form.get('notes') });
      await load(); formElement.reset();
    });
  }

  async function submitReferral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    await run(async () => {
      await api('/care-coordination/referrals', { patient_id: selectedPatient, provider_id: form.get('provider'), direction: form.get('direction'), specialty: form.get('specialty'), organization_name: form.get('organization'), due_at: new Date(String(form.get('due'))).toISOString(), reason: form.get('reason') });
      await load(); formElement.reset();
    });
  }

  async function transition(kind: 'labs' | 'referrals', id: string, status: string) {
    await run(async () => { await api(`/care-coordination/${kind}/${id}/transition`, { status, note: 'Status updated from care workspace' }); await load(); });
  }

  async function admit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    await run(async () => { await api('/day-surgery/admissions', { encounter_id: form.get('encounter'), procedure_name: form.get('procedure') }); await load(); formElement.reset(); });
  }

  async function printPrescription(identifier: string) {
    const url = await authenticatedBlobUrl(`/prescriptions/${identifier}/print`);
    window.open(url, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function surgeryAction(path: string, body: unknown = {}) {
    await run(async () => { await api(path, body, path.includes('/preop') || path.includes('/recovery') ? 'PUT' : 'POST'); await load(); });
  }

  useEffect(() => { if (selectedPatient) void load(selectedPatient); }, []);

  const record = state.type === 'ready' ? state.record : null;
  const selected = patients.find((patient) => patient.id === selectedPatient);
  const tabs: CareTab[] = ['prescriptions', 'labs', 'referrals', 'surgery'];

  function renderContent() {
    if (state.type === 'empty') return <Empty>Add a patient before starting a care workflow.</Empty>;
    if (state.type === 'loading') return <p className="panel">Loading care record…</p>;
    if (state.type === 'error') return <p className="panel" role="alert">{state.message}</p>;
    if (!record) return null;

    switch (tab) {
      case 'prescriptions':
        return <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
          <section className="panel overflow-auto"><h2 className="mb-3 font-semibold">Medication history</h2><table><thead><tr><th>Issued</th><th>Medication</th><th>Status</th><th>Safety</th><th /></tr></thead><tbody>{record.prescriptions.map((item) => <tr key={item.id}><td>{new Date(item.issued_at).toLocaleDateString()}</td><td><strong>{item.medication} {item.dosage}</strong><p className="muted text-xs">{item.route} · {item.frequency} · {item.duration_days} days</p></td><td><span className="badge">{item.status}</span></td><td>{item.safety_flags.length ? item.safety_flags.map((flag) => flag.message).join('; ') : 'Clear'}</td><td><button className="btn-secondary" onClick={() => void printPrescription(item.id)}>Print</button>{item.status === 'issued' && <button className="btn-secondary ml-2" disabled={busy} onClick={() => void surgeryAction(`/prescriptions/${item.id}/cancel`)}>Cancel</button>}</td></tr>)}</tbody></table>{!record.prescriptions.length && <Empty>No prescriptions recorded.</Empty>}</section>
          {canPrescribe ? <form className="panel space-y-3" onSubmit={submitPrescription}><h2 className="font-semibold">Issue prescription</h2><Field label="Prescriber"><select className="field" name="provider">{reference.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></Field><div className="grid grid-cols-2 gap-3"><Field label="Medication"><input className="field" name="medication" required /></Field><Field label="Dosage"><input className="field" name="dosage" required /></Field><Field label="Route"><input className="field" name="route" defaultValue="oral" required /></Field><Field label="Frequency"><input className="field" name="frequency" placeholder="Twice daily" required /></Field><Field label="Duration (days)"><input className="field" name="duration" type="number" min="1" max="365" defaultValue="7" required /></Field><label className="self-end pb-2 text-sm"><input type="checkbox" name="controlled" /> Controlled substance</label></div><Field label="Instructions"><textarea className="field" name="instructions" /></Field><Field label="Safety override reason (required when a rule flags the medication)"><textarea className="field" name="override" minLength={10} /></Field><button className="btn" disabled={busy}>Issue prescription</button></form> : <p className="panel">Your role can review this care record but cannot prescribe.</p>}
        </div>;
      case 'labs':
        return <div className="grid gap-5 xl:grid-cols-[1fr_360px]"><CaseTable rows={record.labs} kind="labs" next={labNext} transition={transition} busy={busy} /><form className="panel space-y-3" onSubmit={submitLab}><h2 className="font-semibold">New lab order</h2><ProviderSelect reference={reference} /><Field label="Case type"><input className="field" name="type" required /></Field><Field label="Laboratory"><input className="field" name="laboratory" required /></Field><Field label="Due"><input className="field" name="due" type="datetime-local" defaultValue={datetimeDefault()} required /></Field><Field label="Notes"><textarea className="field" name="notes" /></Field><button className="btn" disabled={busy}>Create lab order</button></form></div>;
      case 'referrals':
        return <div className="grid gap-5 xl:grid-cols-[1fr_360px]"><CaseTable rows={record.referrals} kind="referrals" next={referralNext} transition={transition} busy={busy} /><form className="panel space-y-3" onSubmit={submitReferral}><h2 className="font-semibold">New referral</h2><ProviderSelect reference={reference} /><Field label="Direction"><select className="field" name="direction"><option value="outbound">Outbound</option><option value="inbound">Inbound</option></select></Field><Field label="Specialty"><input className="field" name="specialty" required /></Field><Field label="Organization"><input className="field" name="organization" required /></Field><Field label="Due"><input className="field" name="due" type="datetime-local" defaultValue={datetimeDefault(14)} required /></Field><Field label="Reason"><textarea className="field" name="reason" required minLength={3} /></Field><button className="btn" disabled={busy}>Create referral</button></form></div>;
      case 'surgery':
        if (!canOperate) return <p className="panel">Day-surgery access is not assigned to your role.</p>;
        return <div className="space-y-5"><form className="panel grid gap-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={admit}><Field label="Open checked-in encounter"><select className="field" name="encounter" required>{record.chart.encounters.filter((encounter) => encounter.status === 'open').map((encounter) => <option key={encounter.id} value={encounter.id}>{encounter.id.slice(0, 8)} · {encounter.care_setting || 'outpatient'}</option>)}</select></Field><Field label="Procedure"><input className="field" name="procedure" required minLength={3} /></Field><button className="btn self-end" disabled={busy || !record.chart.encounters.some((encounter) => encounter.status === 'open')}>Admit</button></form>{!record.chart.encounters.some((encounter) => encounter.status === 'open') && <p className="muted text-sm">Check in a scheduled appointment first to open an encounter.</p>}{record.admissions.map((admission) => <SurgeryCard key={admission.id} admission={admission} busy={busy} action={surgeryAction} />)}{!record.admissions.length && <Empty>No day-surgery admissions for this patient.</Empty>}</div>;
    }
  }

  return <><Title title="Care workflows" description="Medication safety, lab and referral follow-up, and day-surgery documentation in one patient timeline." /><section className="panel mb-5 flex flex-wrap items-end gap-3"><Field label="Patient"><select className="field min-w-64" value={selectedPatient} onChange={(event) => selectPatient(event.target.value)}>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.first_name} {patient.last_name}</option>)}</select></Field><div><p className="text-sm font-medium">{selected?.first_name} {selected?.last_name}</p><p className="muted text-xs">Allergies: {selected?.allergies.join(', ') || 'None recorded'}</p></div></section><div className="mb-5 flex flex-wrap gap-2">{tabs.map((item) => <button key={item} className={tab === item ? 'btn' : 'btn-secondary'} onClick={() => setTab(item)}>{item === 'surgery' ? 'Day surgery' : item[0].toUpperCase() + item.slice(1)}</button>)}</div>{renderContent()}</>;
}

function ProviderSelect({ reference }: { reference: Reference }) {
  return <Field label="Provider"><select className="field" name="provider">{reference.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></Field>;
}

function CaseTable({ rows, kind, next, transition, busy }: { rows: (LabCase | Referral)[]; kind: 'labs' | 'referrals'; next: Record<string, string | undefined>; transition: (kind: 'labs' | 'referrals', id: string, status: string) => Promise<void>; busy: boolean }) {
  return <section className="panel overflow-auto"><h2 className="mb-3 font-semibold">{kind === 'labs' ? 'Lab orders' : 'Referral register'}</h2><table><thead><tr><th>Due</th><th>Case</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map((row) => { const target = next[row.status]; const title = 'case_type' in row ? `${row.case_type} · ${row.laboratory}` : `${row.direction} · ${row.specialty} · ${row.organization_name}`; return <tr key={row.id}><td className={row.overdue ? 'text-[var(--danger)]' : ''}>{new Date(row.due_at).toLocaleString()}{row.overdue && <p className="text-xs">Overdue</p>}</td><td><strong>{title}</strong><p className="muted text-xs">{'notes' in row ? row.notes : row.reason}</p></td><td><span className="badge">{row.status.replace('_', ' ')}</span></td><td>{target && <button className="btn-secondary" disabled={busy} onClick={() => void transition(kind, row.id, target)}>Move to {target.replace('_', ' ')}</button>}</td></tr>; })}</tbody></table>{!rows.length && <Empty>No cases recorded.</Empty>}</section>;
}

function SurgeryCard({ admission, busy, action }: { admission: Admission; busy: boolean; action: (path: string, body?: unknown) => Promise<void> }) {
  const base = `/day-surgery/admissions/${admission.id}`;
  function handleText(path: string, key: string) { return (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); void action(path, { [key]: form.get(key) }); }; }
  function handleAnesthesia(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); void action(`${base}/anesthesia`, { agent: form.get('agent'), dose: form.get('dose'), route: form.get('route'), vitals: {}, note: form.get('note') }); }
  return <article className="panel space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">{admission.procedure_name}</h2><p className="muted text-xs">Encounter {admission.encounter_id.slice(0, 8)}</p></div><span className="badge">{admission.status.replace('_', ' ')}</span></div>{admission.status === 'admitted' && <button className="btn" disabled={busy} onClick={() => void action(`${base}/preop`, { checklist: Object.fromEntries(preopItems.map((item) => [item, true])) })}>Confirm all six pre-op checks</button>}{admission.status === 'preop_complete' && <button className="btn" disabled={busy} onClick={() => void action(`${base}/start`)}>Start procedure</button>}{admission.status === 'in_procedure' && <form className="grid gap-3 md:grid-cols-5" onSubmit={handleAnesthesia}><Field label="Agent"><input className="field" name="agent" required /></Field><Field label="Dose"><input className="field" name="dose" required /></Field><Field label="Route"><input className="field" name="route" required /></Field><Field label="Note"><input className="field" name="note" /></Field><button className="btn self-end" disabled={busy}>Record anesthesia</button></form>}{admission.status === 'in_procedure' && admission.anesthesia_records.length > 0 && <form className="flex gap-3" onSubmit={handleText(`${base}/recovery`, 'recovery_notes')}><Field label="Recovery notes"><textarea className="field min-w-80" name="recovery_notes" required minLength={10} /></Field><button className="btn self-end" disabled={busy}>Move to recovery</button></form>}{admission.status === 'recovery' && <form className="flex gap-3" onSubmit={handleText(`${base}/discharge`, 'discharge_summary')}><Field label="Discharge summary"><textarea className="field min-w-80" name="discharge_summary" required minLength={10} /></Field><button className="btn self-end" disabled={busy}>Discharge and close encounter</button></form>}{admission.status === 'discharged' && <p className="text-sm">Discharged: {admission.discharge_summary}</p>}</article>;
}
