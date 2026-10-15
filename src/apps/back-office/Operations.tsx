import { useEffect, useState, type FormEvent } from 'react';
import { api } from './lib/api';
import { Empty, Field, Title } from './components/Fields';
import type { Reference } from './types';
import { WorkspaceLoadingOverlay } from './WorkspaceLoadingOverlay';

type Run = (action: () => Promise<void>) => Promise<void>;
type Credential = {
  id: string; provider_id: string; location_id: string | null; credential_type: string;
  credential_number: string; jurisdiction: string; issued_on: string; expires_on: string;
  alert_lead_days: number; required: boolean; state: 'valid' | 'expiring' | 'expired';
};
type OperationsState =
  | { type: 'loading' }
  | { type: 'error'; message: string }
  | { type: 'ready'; credentials: Credential[]; alerts: Credential[] };

function isoDate(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

export function Operations({ reference, permissions, run, busy }: {
  reference: Reference; permissions: string[]; run: Run; busy: boolean;
}) {
  const [state, setState] = useState<OperationsState>({ type: 'loading' });
  const canConfigureCredentials = permissions.includes('settings');

  async function load() {
    try {
      const [credentials, alerts] = await Promise.all([
        api<Credential[]>('/operations/credentials'), api<Credential[]>('/operations/credential-alerts'),
      ]);
      setState({ type: 'ready', credentials, alerts });
    } catch (reason) {
      setState({ type: 'error', message: reason instanceof Error ? reason.message : 'Operations data failed' });
    }
  }

  async function createCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    await run(async () => {
      await api('/operations/credentials', {
        provider_id: form.get('provider'), location_id: form.get('location') || null,
        credential_type: form.get('type'), credential_number: form.get('number'), jurisdiction: form.get('jurisdiction'),
        issued_on: form.get('issued'), expires_on: form.get('expires'), alert_lead_days: Number(form.get('lead')),
        required: form.get('required') === 'on',
      });
      await load(); formElement.reset();
    });
  }

  useEffect(() => { void load(); }, []);

  return <>
    <Title title="Practice operations" description="Provider credential status and location-specific hours, operatories, branding, and scheduling policy." />
    {state.type === 'loading' && <WorkspaceLoadingOverlay label="Loading operations" />}
    {state.type === 'error' && <p className="panel" role="alert">{state.message}</p>}
    {state.type === 'ready' && <>
      {state.alerts.length > 0 && <section className="mb-5 rounded-xl border border-[var(--danger)] bg-[var(--danger-tint)] p-4"><h2 className="font-semibold">Credential attention required</h2><p className="text-sm">{state.alerts.length} credential{state.alerts.length === 1 ? '' : 's'} are expiring or expired. Required expired credentials block scheduling and prescribing.</p></section>}
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <section className="panel overflow-auto"><h2 className="mb-3 font-semibold">Credential register</h2><table><thead><tr><th>Provider</th><th>Credential</th><th>Jurisdiction</th><th>Expiry</th><th>State</th></tr></thead><tbody>{state.credentials.map((item) => <tr key={item.id}><td>{reference.providers.find((provider) => provider.id === item.provider_id)?.name || item.provider_id}</td><td><strong>{item.credential_type}</strong><p className="muted text-xs">{item.credential_number}</p></td><td>{item.jurisdiction}</td><td>{new Date(`${item.expires_on}T00:00:00`).toLocaleDateString()}</td><td><span className="badge">{item.state}</span>{item.required && <p className="muted text-xs">Required</p>}</td></tr>)}</tbody></table>{!state.credentials.length && <Empty>No credentials recorded.</Empty>}</section>
        {canConfigureCredentials ? <form className="panel space-y-3" onSubmit={createCredential}><h2 className="font-semibold">Add provider credential</h2><Field label="Provider"><select className="field" name="provider">{reference.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></Field><Field label="Location scope"><select className="field" name="location"><option value="">All locations</option>{reference.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><div className="grid grid-cols-2 gap-3"><Field label="Credential type"><input className="field" name="type" required /></Field><Field label="Number"><input className="field" name="number" required /></Field><Field label="Jurisdiction"><input className="field" name="jurisdiction" defaultValue="BC" required /></Field><Field label="Alert lead (days)"><input className="field" name="lead" type="number" min="1" max="365" defaultValue="60" /></Field><Field label="Issued"><input className="field" name="issued" type="date" defaultValue={isoDate()} required /></Field><Field label="Expires"><input className="field" name="expires" type="date" defaultValue={isoDate(365)} required /></Field></div><label className="text-sm"><input type="checkbox" name="required" defaultChecked /> Required for clinical work</label><button className="btn w-full" disabled={busy}>Save credential</button></form> : <p className="panel">Credential administration requires settings access.</p>}
      </div>
    </>}

  </>;
}
