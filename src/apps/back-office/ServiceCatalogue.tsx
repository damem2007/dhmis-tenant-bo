import { useState, type FormEvent } from 'react';
import { api, money } from './lib/api';
import type { Service } from './types';
import { Field } from './components/Fields';

type Props = {
  services: Service[];
  run: (action: () => Promise<void>, successMessage?: string) => Promise<void>;
  refresh: () => Promise<void>;
};

export function ServiceCatalogue({ services, run, refresh }: Props) {
  const [editing, setEditing] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>, identifier?: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api(identifier ? `/billing/services/${identifier}` : '/billing/services', {
        code: String(form.get('code') || '').trim(),
        name: String(form.get('name') || '').trim(),
        description: String(form.get('description') || '').trim(),
        fee_cents: Math.round(Number(form.get('fee') || 0) * 100),
      }, identifier ? 'PUT' : undefined);
      setEditing(null);
      await refresh();
    }, identifier ? 'Service updated.' : 'Service added.');
  }

  async function remove(identifier: string) {
    if (!window.confirm('Delete this service from the clinic catalogue?')) return;
    await run(async () => {
      await api(`/billing/services/${identifier}`, {}, 'DELETE');
      await refresh();
    }, 'Service deleted.');
  }

  return <>
    <section className="panel space-y-4">
      <div><h2 className="font-semibold">Clinic service catalogue</h2><p className="muted">Services &amp; fees is the source for billing, provider procedures, and the public site. The site editor inherits these records and only controls presentation.</p></div>
      <form className="grid gap-3 rounded-lg border border-[var(--border)] p-4 md:grid-cols-4" onSubmit={(event) => void save(event)}>
        <Field label="Code"><input className="field" name="code" placeholder="EXAM" required maxLength={30} /></Field>
        <Field label="Service name"><input className="field" name="name" placeholder="Comprehensive exam" required maxLength={180} /></Field>
        <Field label="Price (CAD)"><input className="field" name="fee" type="number" min="0" step="0.01" required /></Field>
        <Field label="Description"><input className="field" name="description" placeholder="Short description" maxLength={1000} /></Field>
        <button className="btn md:col-span-4">Add service</button>
      </form>
      <div className="space-y-3">
        {services.map((service) => editing === service.id ? <form key={service.id} className="grid gap-3 rounded-lg border border-[var(--border)] p-4 md:grid-cols-5" onSubmit={(event) => void save(event, service.id)}>
          <Field label="Code"><input className="field" name="code" defaultValue={service.code} required maxLength={30} /></Field>
          <Field label="Service name"><input className="field" name="name" defaultValue={service.name} required maxLength={180} /></Field>
          <Field label="Price (CAD)"><input className="field" name="fee" type="number" min="0" step="0.01" defaultValue={service.fee_cents / 100} required /></Field>
          <Field label="Description"><input className="field" name="description" defaultValue={service.description} maxLength={1000} /></Field>
          <div className="flex items-end gap-2"><button className="btn">Save</button><button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button></div>
        </form> : <article key={service.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] p-4">
          <div><h3 className="font-semibold">{service.name}</h3><p className="muted">{service.code} · {service.description || 'No description'}</p></div>
          <div className="flex items-center gap-3"><strong>{money(service.fee_cents)}</strong><button type="button" className="btn-secondary" onClick={() => setEditing(service.id)}>Edit</button><button type="button" className="btn-secondary" onClick={() => void remove(service.id)}>Delete</button></div>
        </article>)}
        {!services.length && <p className="muted rounded-lg border border-dashed border-[var(--border)] p-4">No services configured yet.</p>}
      </div>
    </section>
  </>;
}
