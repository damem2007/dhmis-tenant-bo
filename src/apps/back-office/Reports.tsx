import { useEffect, useState, type FormEvent } from 'react';
import { api, money } from '../../shared/api';
import { Empty, Field, Title } from '../../shared/Fields';
import type { Reference } from '../../shared/types';

type ReportRow = {
  location_id: string;
  location_name: string;
  provider_id: string | null;
  provider_name: string;
  production_cents: number;
  collections_cents: number;
  appointment_minutes: number;
  completed_encounters: number;
  chair_utilization_pct: number;
};

type PerformanceReport = {
  start: string;
  end: string;
  production_cents: number;
  collections_cents: number;
  appointment_minutes: number;
  completed_encounters: number;
  breakdown: ReportRow[];
};

type ReportState =
  | { type: 'loading' }
  | { type: 'error'; message: string }
  | { type: 'ready'; report: PerformanceReport };

function dateValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function Reports({ reference }: { reference: Reference }) {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [state, setState] = useState<ReportState>({ type: 'loading' });
  const [filters, setFilters] = useState({
    start: dateValue(monthStart),
    end: dateValue(today),
    locationId: '',
    providerId: '',
  });

  async function load(next = filters) {
    setState({ type: 'loading' });
    const query = new URLSearchParams({ start: next.start, end: next.end });
    if (next.locationId) query.set('location_id', next.locationId);
    if (next.providerId) query.set('provider_id', next.providerId);
    try {
      setState({ type: 'ready', report: await api<PerformanceReport>(`/reports/performance?${query}`) });
    } catch (reason) {
      setState({ type: 'error', message: reason instanceof Error ? reason.message : 'Report failed' });
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load();
  }

  useEffect(() => { void load(); }, []);

  return (
    <>
      <Title title="Performance reporting" description="Production, collections, completed care, and chair use calculated from persisted practice activity." />
      <form className="panel mb-5 grid gap-3 md:grid-cols-5" onSubmit={handleSubmit}>
        <Field label="From"><input className="field" type="date" value={filters.start} onChange={(event) => setFilters({ ...filters, start: event.target.value })} required /></Field>
        <Field label="To"><input className="field" type="date" value={filters.end} onChange={(event) => setFilters({ ...filters, end: event.target.value })} required /></Field>
        <Field label="Location">
          <select className="field" value={filters.locationId} onChange={(event) => setFilters({ ...filters, locationId: event.target.value })}>
            <option value="">All visible locations</option>
            {reference.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </Field>
        <Field label="Provider">
          <select className="field" value={filters.providerId} onChange={(event) => setFilters({ ...filters, providerId: event.target.value })}>
            <option value="">All providers</option>
            {reference.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
          </select>
        </Field>
        <button className="btn self-end">Run report</button>
      </form>

      {state.type === 'loading' && <p className="panel">Calculating report…</p>}
      {state.type === 'error' && <p className="panel" role="alert">{state.message}</p>}
      {state.type === 'ready' && (
        <>
          <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <article className="panel"><p className="muted text-xs">Production</p><strong className="text-2xl">{money(state.report.production_cents)}</strong></article>
            <article className="panel"><p className="muted text-xs">Collections</p><strong className="text-2xl">{money(state.report.collections_cents)}</strong></article>
            <article className="panel"><p className="muted text-xs">Scheduled hours</p><strong className="text-2xl">{(state.report.appointment_minutes / 60).toFixed(1)}</strong></article>
            <article className="panel"><p className="muted text-xs">Completed encounters</p><strong className="text-2xl">{state.report.completed_encounters}</strong></article>
          </section>
          <section className="panel overflow-auto">
            <table>
              <thead><tr><th>Location / provider</th><th>Production</th><th>Collections</th><th>Hours</th><th>Completed</th><th>Chair use</th></tr></thead>
              <tbody>{state.report.breakdown.map((row) => (
                <tr key={`${row.location_id}-${row.provider_id || 'none'}`}>
                  <td><strong>{row.location_name}</strong><p className="muted text-xs">{row.provider_name}</p></td>
                  <td>{money(row.production_cents)}</td><td>{money(row.collections_cents)}</td>
                  <td>{(row.appointment_minutes / 60).toFixed(1)}</td><td>{row.completed_encounters}</td><td>{row.chair_utilization_pct}%</td>
                </tr>
              ))}</tbody>
            </table>
            {!state.report.breakdown.length && <Empty>No activity matches this report window.</Empty>}
          </section>
        </>
      )}
    </>
  );
}
