import { useEffect, useState, type FormEvent } from 'react';
import { api, money } from '../../shared/api';
import { Empty, Field } from '../../shared/Fields';
import type {
  Chart,
  Consent,
  Encounter,
  Patient,
  PerioSite,
  Reference,
  Service,
  TreatmentOption,
} from '../../shared/types';

type Run = (action: () => Promise<void>) => Promise<void>;
type ClinicalTab = 'chart' | 'periodontal' | 'encounters' | 'treatment';

type Props = {
  patient: Patient;
  services: Service[];
  reference: Reference;
  run: Run;
  busy: boolean;
  refresh: () => Promise<void>;
};

type RecordState =
  | { type: 'loading' }
  | { type: 'error'; message: string }
  | { type: 'ready'; chart: Chart; consents: Consent[] };

type ClinicalView = {
  tab: ClinicalTab;
  tooth: string;
  dentition: 'adult' | 'primary';
  encounterId: string;
};

export function ClinicalWorkspace({ patient, services, reference, run, busy, refresh }: Props) {
  const [record, setRecord] = useState<RecordState>({ type: 'loading' });
  const [view, setView] = useState<ClinicalView>({
    tab: 'chart',
    tooth: '14',
    dentition: 'adult',
    encounterId: '',
  });

  async function load() {
    const [chart, consents] = await Promise.all([
      api<Chart>(`/clinical/${patient.id}`),
      api<Consent[]>(`/consents/${patient.id}`),
    ]);
    setRecord({ type: 'ready', chart, consents });
  }

  function patchView(next: Partial<ClinicalView>) {
    setView((current) => ({ ...current, ...next }));
  }

  function selectDentition(dentition: ClinicalView['dentition']) {
    patchView({ dentition, tooth: dentition === 'adult' ? '14' : 'A' });
  }

  async function handleChartEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api('/clinical/entries', {
        patient_id: patient.id,
        encounter_id: view.encounterId || null,
        tooth: view.tooth,
        surface: form.get('surface'),
        condition: form.get('condition'),
        notes: form.get('notes'),
      });
      await load();
    });
  }

  async function requestConsent() {
    await run(async () => {
      await api('/consents', { patient_id: patient.id, title: 'Treatment consent' });
      await load();
    });
  }

  async function simulateSignature(consentId: string) {
    await run(async () => {
      await api(`/consents/${consentId}/simulate-signature`, {});
      await load();
    });
  }

  useEffect(() => {
    setRecord({ type: 'loading' });
    void load().catch((reason) => setRecord({ type: 'error', message: reason.message }));
  }, [patient.id]);

  if (record.type === 'loading') return <div className="panel mt-5">Loading clinical record…</div>;
  if (record.type === 'error') return <div className="panel mt-5">{record.message}</div>;

  const { chart, consents } = record;
  const teeth =
    view.dentition === 'adult'
      ? Array.from({ length: 32 }, (_, index) => String(index + 1))
      : 'ABCDEFGHIJKLMNOPQRST'.split('');

  function renderTab() {
    switch (view.tab) {
      case 'chart':
        return (
          <>
            <div className="mb-4 flex gap-3">
              <button className="btn-secondary" onClick={() => selectDentition('adult')}>Adult 1–32</button>
              <button className="btn-secondary" onClick={() => selectDentition('primary')}>Primary A–T</button>
            </div>
            <div className="grid grid-cols-8 gap-2">
              {teeth.map((tooth) => (
                <button
                  key={tooth}
                  aria-label={`Tooth ${tooth}`}
                  aria-pressed={view.tooth === tooth}
                  onClick={() => patchView({ tooth })}
                  className={`rounded-lg border p-2 ${
                    view.tooth === tooth
                      ? 'border-[var(--sage)] bg-[var(--sage-tint)]'
                      : 'border-[var(--border)]'
                  }`}
                >
                  <svg viewBox="0 0 30 38" width="24" height="30" className="mx-auto" aria-hidden="true">
                    <path
                      d="M5 4 Q0 9 4 20 L8 34 Q10 37 13 23 Q15 19 17 23 Q20 37 22 34 L27 16 Q29 3 21 3 Q15 6 10 3 Z"
                      fill={chart.entries.some((entry) => String(entry.tooth) === tooth) ? 'var(--amber-tint)' : 'var(--surface)'}
                      stroke="var(--sage-deep)"
                    />
                  </svg>
                  {tooth}
                </button>
              ))}
            </div>
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <form className="space-y-3" onSubmit={handleChartEntry}>
                <h3 className="font-semibold">Record finding · tooth {view.tooth}</h3>
                <Field label="Surface">
                  <select className="field" name="surface">
                    {['whole', 'mesial', 'distal', 'buccal', 'lingual', 'occlusal'].map((surface) => (
                      <option key={surface}>{surface}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Condition"><input className="field" name="condition" required maxLength={100} /></Field>
                <Field label="Clinical note"><textarea className="field" name="notes" maxLength={4000} /></Field>
                <button className="btn" disabled={busy}>Save chart entry</button>
              </form>
              <div>
                <h3 className="font-semibold">Tooth {view.tooth} history</h3>
                {chart.entries
                  .filter((entry) => String(entry.tooth) === view.tooth)
                  .map((entry) => (
                    <article key={entry.id} className="border-b border-[var(--border)] py-3 text-sm">
                      <strong>{entry.condition} · {entry.surface}</strong>
                      <p>{entry.notes}</p>
                      <p className="muted">{new Date(entry.created_at).toLocaleString()}</p>
                    </article>
                  ))}
                {!chart.entries.some((entry) => String(entry.tooth) === view.tooth) && <Empty>No findings on this tooth.</Empty>}
              </div>
            </div>
          </>
        );
      case 'periodontal':
        return <Perio patient={patient} chart={chart} encounterId={view.encounterId} run={run} busy={busy} load={load} />;
      case 'encounters':
        return (
          <div className="space-y-4">
            {chart.encounters.map((encounter) => (
              <EncounterEditor
                key={`${encounter.id}-${encounter.status}`}
                encounter={encounter}
                services={services}
                run={run}
                busy={busy}
                load={async () => { await load(); await refresh(); }}
              />
            ))}
            {!chart.encounters.length && <Empty>Check in an appointment from Schedule to open an encounter.</Empty>}
          </div>
        );
      case 'treatment':
        return <Treatment patient={patient} chart={chart} services={services} reference={reference} run={run} busy={busy} load={load} />;
    }
  }

  return (
    <section className="panel mt-5">
      <h2 className="text-xl font-semibold">{patient.first_name} {patient.last_name} · Clinical chart</h2>
      <div className="my-4 flex flex-wrap gap-2">
        {(['chart', 'periodontal', 'encounters', 'treatment'] as ClinicalTab[]).map((tab) => (
          <button key={tab} onClick={() => patchView({ tab })} className={view.tab === tab ? 'btn' : 'btn-secondary'}>
            {tab === 'chart' ? 'Odontogram' : tab === 'periodontal' ? 'Periodontal exams' : tab === 'encounters' ? 'Encounters & SOAP' : 'Treatment plans'}
          </button>
        ))}
      </div>
      <Field label="Link new entries to encounter">
        <select className="field mb-4" value={view.encounterId} onChange={(event) => patchView({ encounterId: event.target.value })}>
          <option value="">Historical record / no open encounter</option>
          {chart.encounters.filter((encounter) => encounter.status === 'open').map((encounter) => (
            <option key={encounter.id} value={encounter.id}>{encounter.id.slice(0, 8)} · open</option>
          ))}
        </select>
      </Field>
      {renderTab()}
      <details className="mt-6 border-t border-[var(--border)] pt-4" open={view.tab === 'treatment'}>
        <summary className="font-semibold">Consent & treatment acceptance</summary>
        <button className="btn-secondary my-3" disabled={busy} onClick={() => void requestConsent()}>Request consent</button>
        {consents.map((consent) => (
          <div key={consent.id} className="my-3 flex flex-wrap items-center gap-3 text-sm">
            <span>{consent.title} · {consent.status}</span>
            {consent.status === 'requested' && (
              <button className="btn-secondary" disabled={busy} onClick={() => void simulateSignature(consent.id)}>Simulate signature</button>
            )}
          </div>
        ))}
        <p className="muted text-xs">Sandbox certificates do not constitute signed clinical consents.</p>
      </details>
    </section>
  );
}

type PerioProps = {
  patient: Patient;
  chart: Chart;
  encounterId: string;
  run: Run;
  busy: boolean;
  load: () => Promise<void>;
};

function Perio({ patient, chart, encounterId, run, busy, load }: PerioProps) {
  const [present, setPresent] = useState(Array.from({ length: 32 }, (_, index) => String(index + 1)).join(','));
  const teeth = present.split(',').map((item) => item.trim()).filter(Boolean);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement;
    await run(async () => {
      const measurements: Record<string, PerioSite> = {};
      for (const tooth of teeth) {
        measurements[tooth] = {
          depths: Array.from({ length: 6 }, (_, index) => Number(form.get(`${tooth}-d${index}`))),
          bleeding: Array.from({ length: 6 }, (_, index) => form.get(`${tooth}-b${index}`) === 'on'),
          recession: Array.from({ length: 6 }, (_, index) => Number(form.get(`${tooth}-r${index}`))),
          furcation: Number(form.get(`${tooth}-f`)),
          mobility: Number(form.get(`${tooth}-m`)),
        };
      }
      await api('/clinical/perio', {
        patient_id: patient.id,
        encounter_id: encounterId || null,
        dentition: teeth,
        measurements,
        status: submitter.value,
      });
      await load();
    });
  }

  return (
    <>
      <p className="muted mb-3 text-sm">
        List every present tooth. Complete exams require six sites, bleeding, recession, furcation, and mobility for each. Site order: MB, B, DB, ML, L, DL.
      </p>
      <Field label="Present teeth (comma-separated; adult 1–32, primary A–T)">
        <input className="field" value={present} onChange={(event) => setPresent(event.target.value)} />
      </Field>
      <form className="mt-4" onSubmit={handleSubmit}>
        <div className="max-h-[500px] overflow-auto">
          <table>
            <thead>
              <tr>
                <th>Tooth</th>
                {['MB', 'B', 'DB', 'ML', 'L', 'DL'].map((site) => <th key={site}>{site}: depth / recession / bleeding</th>)}
                <th>Furcation</th><th>Mobility</th>
              </tr>
            </thead>
            <tbody>
              {teeth.map((tooth) => (
                <tr key={tooth}>
                  <td>{tooth}</td>
                  {Array.from({ length: 6 }, (_, index) => (
                    <td key={index}>
                      <input aria-label={`Tooth ${tooth} site ${index + 1} depth`} className="field min-w-16" name={`${tooth}-d${index}`} type="number" min="0" max="20" required />
                      <input aria-label={`Tooth ${tooth} site ${index + 1} recession`} className="field mt-1 min-w-16" name={`${tooth}-r${index}`} type="number" min="-10" max="20" required />
                      <label className="text-xs"><input name={`${tooth}-b${index}`} type="checkbox" /> Bleeding</label>
                    </td>
                  ))}
                  {(['f', 'm'] as const).map((measurement) => (
                    <td key={measurement}>
                      <select aria-label={`Tooth ${tooth} ${measurement === 'f' ? 'furcation' : 'mobility'}`} name={`${tooth}-${measurement}`} className="field" required defaultValue="">
                        <option value="">Select</option>
                        {[0, 1, 2, 3].map((value) => <option key={value}>{value}</option>)}
                      </select>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="my-4 flex gap-3">
          <button className="btn-secondary" value="draft" disabled={busy}>Save as draft</button>
          <button className="btn" value="complete" disabled={busy}>Complete exam</button>
        </div>
      </form>
      <h3 className="font-semibold">Exam history & comparison</h3>
      {chart.perio_exams.map((exam) => (
        <details key={exam.id} className="my-3">
          <summary>{new Date(exam.created_at).toLocaleString()} · {exam.status} · {exam.dentition?.length || Object.keys(exam.measurements).length} teeth</summary>
          <div className="overflow-auto">
            <table><tbody>
              {Object.entries(exam.measurements).map(([tooth, measurement]) => {
                const depths = Array.isArray(measurement) ? measurement : measurement.depths;
                return (
                  <tr key={tooth}>
                    <td>Tooth {tooth}</td><td>{depths.join(' / ')} mm</td>
                    <td>{chart.perio_comparison[tooth]?.map((difference, index) => (
                      <span key={index} className={`mr-2 ${difference > 0 ? 'text-[var(--danger)]' : difference < 0 ? 'text-[var(--success)]' : 'muted'}`}>
                        {difference > 0 ? '+' : ''}{difference}
                      </span>
                    ))}</td>
                  </tr>
                );
              })}
            </tbody></table>
          </div>
        </details>
      ))}
    </>
  );
}

type EncounterProps = {
  encounter: Encounter;
  services: Service[];
  run: Run;
  busy: boolean;
  load: () => Promise<void>;
};

function EncounterEditor({ encounter, services, run, busy, load }: EncounterProps) {
  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const soap = Object.fromEntries(
        ['subjective', 'objective', 'assessment', 'plan'].map((key) => [key, String(form.get(key))]),
      );
      const procedures = form.getAll('service').map((identifier) => ({
        service_id: identifier,
        quantity: Number(form.get(`quantity-${identifier}`)),
        tooth: String(form.get(`tooth-${identifier}`)) || null,
      }));
      await api(`/clinical/encounters/${encounter.id}`, { soap, procedures }, 'PUT');
      await load();
    });
  }

  async function handleComplete() {
    await run(async () => {
      await api(`/clinical/encounters/${encounter.id}/complete`, {});
      await load();
    });
  }

  return (
    <form className="panel space-y-3" onSubmit={handleSave}>
      <h3 className="font-semibold">Encounter {encounter.id.slice(0, 8)} · {encounter.status}</h3>
      <div className="grid gap-3 md:grid-cols-2">
        {['subjective', 'objective', 'assessment', 'plan'].map((key) => (
          <Field key={key} label={key}>
            <textarea className="field" name={key} defaultValue={encounter.soap[key]} disabled={encounter.status !== 'open'} maxLength={8000} />
          </Field>
        ))}
      </div>
      <fieldset disabled={encounter.status !== 'open'}>
        <legend className="font-medium">Procedures performed</legend>
        {services.map((service) => {
          const saved = encounter.procedures.find((procedure) => procedure.service_id === service.id);
          return (
            <div className="my-2 flex flex-wrap items-center gap-2 text-sm" key={service.id}>
              <label><input type="checkbox" name="service" value={service.id} defaultChecked={Boolean(saved)} /> {service.name}</label>
              <input aria-label={`${service.name} quantity`} className="field w-20" type="number" min="1" max="32" name={`quantity-${service.id}`} defaultValue={saved?.quantity || 1} />
              <input aria-label={`${service.name} tooth`} className="field w-24" name={`tooth-${service.id}`} placeholder="Tooth" defaultValue={saved?.tooth || ''} />
            </div>
          );
        })}
      </fieldset>
      {encounter.status === 'open' ? (
        <div className="flex gap-3">
          <button className="btn-secondary" disabled={busy}>Save SOAP & procedures</button>
          <button className="btn" type="button" disabled={busy} onClick={() => void handleComplete()}>Complete saved encounter & invoice</button>
        </div>
      ) : (
        <p className="muted text-sm">Closed record. Invoice: {encounter.invoice_id || 'No billable procedures'}</p>
      )}
    </form>
  );
}

type TreatmentProps = {
  patient: Patient;
  chart: Chart;
  services: Service[];
  reference: Reference;
  run: Run;
  busy: boolean;
  load: () => Promise<void>;
};

function newOption(index: number): TreatmentOption {
  return { name: `Option ${index}`, phases: [{ name: 'Phase 1', procedures: [] }] };
}

function Treatment({ patient, chart, services, reference, run, busy, load }: TreatmentProps) {
  const [options, setOptions] = useState<TreatmentOption[]>([newOption(1)]);

  function updateOptions(change: (draft: TreatmentOption[]) => void) {
    const draft = structuredClone(options);
    change(draft);
    setOptions(draft);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api('/clinical/treatment-plans', {
        patient_id: patient.id,
        provider_id: form.get('provider'),
        title: form.get('title'),
        options,
      });
      await load();
    });
  }

  async function acceptOption(planId: string, option: number) {
    await run(async () => {
      await api(`/clinical/treatment-plans/${planId}/accept`, { option });
      await load();
    });
  }

  return (
    <>
      <form className="space-y-3" onSubmit={handleSubmit}>
        <Field label="Treatment plan title"><input className="field" name="title" required maxLength={200} /></Field>
        <Field label="Provider for fee estimates">
          <select className="field" name="provider">
            {reference.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
          </select>
        </Field>
        {options.map((option, optionIndex) => (
          <div key={optionIndex} className="panel">
            <Field label="Alternative name">
              <input className="field" value={option.name} required onChange={(event) => updateOptions((draft) => { draft[optionIndex].name = event.target.value; })} />
            </Field>
            {option.phases.map((phase, phaseIndex) => (
              <div key={phaseIndex} className="my-4 border-l-2 border-[var(--sage)] pl-3">
                <Field label="Phase name">
                  <input className="field" value={phase.name} required onChange={(event) => updateOptions((draft) => { draft[optionIndex].phases[phaseIndex].name = event.target.value; })} />
                </Field>
                {phase.procedures.map((procedure, procedureIndex) => (
                  <div key={procedureIndex} className="my-2 flex gap-2">
                    <select aria-label="Planned procedure" className="field" value={procedure.service_id} onChange={(event) => updateOptions((draft) => { draft[optionIndex].phases[phaseIndex].procedures[procedureIndex].service_id = event.target.value; })}>
                      {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                    </select>
                    <input aria-label="Planned quantity" className="field w-24" type="number" min="1" max="32" value={procedure.quantity} onChange={(event) => updateOptions((draft) => { draft[optionIndex].phases[phaseIndex].procedures[procedureIndex].quantity = Number(event.target.value); })} />
                    <button type="button" className="btn-secondary" onClick={() => updateOptions((draft) => { draft[optionIndex].phases[phaseIndex].procedures.splice(procedureIndex, 1); })}>Remove</button>
                  </div>
                ))}
                <button type="button" className="btn-secondary mt-2" disabled={!services.length} onClick={() => updateOptions((draft) => { draft[optionIndex].phases[phaseIndex].procedures.push({ service_id: services[0].id, quantity: 1 }); })}>Add procedure</button>
              </div>
            ))}
            <button type="button" className="btn-secondary" onClick={() => updateOptions((draft) => { draft[optionIndex].phases.push({ name: `Phase ${draft[optionIndex].phases.length + 1}`, procedures: [] }); })}>Add phase</button>
          </div>
        ))}
        <div className="flex gap-3">
          <button type="button" className="btn-secondary" onClick={() => setOptions([...options, newOption(options.length + 1)])}>Add treatment alternative</button>
          <button className="btn" disabled={busy}>Save plan & calculate estimates</button>
        </div>
      </form>
      <div className="mt-6 space-y-4">
        {chart.treatment_plans.map((plan) => (
          <article key={plan.id} className="panel">
            <h3 className="font-semibold">{plan.title} · {plan.status}</h3>
            {plan.options.map((option, index) => (
              <div className="mt-3 flex flex-wrap items-center gap-4" key={index}>
                <strong>{option.name}</strong>
                <span>Total {money(option.total_cents || 0)} · Estimated patient {money(option.estimated_patient_cents || 0)}</span>
                {plan.status === 'proposed' && (
                  <button className="btn-secondary" disabled={busy} onClick={() => void acceptOption(plan.id, index)}>Select & request signature</button>
                )}
              </div>
            ))}
            <p className="muted mt-2 text-xs">Insurance estimates use saved plan coverage and remaining limits. Final adjudication can differ.</p>
          </article>
        ))}
      </div>
    </>
  );
}
