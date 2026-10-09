import { useEffect, useState } from 'react';
import { api, download, money } from '../../shared/api';
import type { Reference, User } from '../../shared/types';
import type { ScheduleItem } from './ClinicalDashboard';
import type { ApprovalNotificationFeed } from '../../shared/ApprovalBell';

type Metric = {
  key: string; label: string; definition: string; unit: string; value: number | null;
  available: boolean; drilldown: string; version: string;
};
type ActionItem = {
  id: string; title: string; detail: string; severity: string; status: string;
  category: string; target: Record<string, string>;
};
type Dashboard = {
  role_profile: string; period: string; start: string; end: string;
  scope: { location_ids: string[]; provider_id: string | null; can_export: boolean };
  freshness: { last_updated: string; mode: string; catalogue_version: string };
  metrics: Metric[]; actions: ActionItem[];
};
type OrganizationSummary = {
  locations: { id: string; name: string; visits: number; production_cents: number; chair_utilization: number; case_acceptance: number }[];
  providers: { id: string; name: string; location: string; production_cents: number; visits: number; no_show_rate: number }[];
};
type Worklist = { metric_key: string; page: number; page_size: number; total: number; items: Record<string, unknown>[] };

const periods = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month'],
  ['quarter', 'This quarter'], ['ytd', 'Year to date'], ['custom', 'Custom'],
];
function metricValue(metric: Metric) {
  if (!metric.available || metric.value === null) return 'Unavailable';
  if (metric.unit === 'currency') return money(metric.value);
  if (metric.unit === 'percent') return `${metric.value}%`;
  return metric.value.toLocaleString();
}

function display(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleString();
  return String(value);
}

function titleCase(value: string) {
  return value.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function MetricCards({ dashboard, onOpen }: { dashboard: Dashboard; onOpen: (metric: Metric) => void }) {
  return (
    <section className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Dashboard metrics">
      {dashboard.metrics.slice(0, 4).map((metric) => (
        <button key={metric.key} className="panel text-left hover:border-[var(--sage)]" title={metric.definition} onClick={() => onOpen(metric)}>
          <div className="flex justify-between gap-2"><span className="muted text-sm">{metric.label}</span><span className="muted" aria-label={`Definition: ${metric.definition}`}>ⓘ</span></div>
          <strong className="my-2 block text-3xl">{metricValue(metric)}</strong>
          <span className="text-sm font-semibold text-[var(--sage-deep)]">View breakdown</span>
        </button>
      ))}
    </section>
  );
}

function ActionCentre({ dashboard, approvals, approvalsHref, busy, onUpdate }: { dashboard: Dashboard; approvals: ApprovalNotificationFeed; approvalsHref: string; busy: boolean; onUpdate: (item: ActionItem, status: string) => void }) {
  const approvalItems = approvals.items.filter((item) => item.kind === 'action');
  return (
    <section className="panel p-0">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3"><h2 className="font-semibold">Action centre</h2><span className="muted text-sm">{dashboard.actions.length + approvalItems.length} open</span></div>
      {dashboard.actions.length === 0 && approvalItems.length === 0 ? <p className="muted p-6 text-center text-sm">No open actions in your authorized scope.</p> : <div className="divide-y divide-[var(--border)]">{approvalItems.map((item) => <article key={item.request_id} className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_auto]"><div><div className="flex flex-wrap items-center gap-2"><strong>{item.title}</strong><span className="rounded-full bg-[var(--amber-tint)] px-2 py-0.5 text-xs font-semibold text-[#7b4a00]">Approval</span></div><p className="muted mt-1 text-sm">{item.detail}</p></div><a className="btn self-center" href={approvalsHref}>Review</a></article>)}{dashboard.actions.map((item) => <article key={item.id} className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_auto]"><div><div className="flex flex-wrap items-center gap-2"><strong>{item.title}</strong><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${item.severity === 'urgent' ? 'bg-[var(--danger-tint)] text-[var(--danger)]' : item.severity === 'watch' ? 'bg-[var(--amber-tint)] text-[#7b4a00]' : 'bg-[var(--paper)]'}`}>{titleCase(item.severity)}</span></div><p className="muted mt-1 text-sm">{item.detail}</p><span className="mt-2 inline-flex rounded-full bg-[var(--blue-tint)] px-2 py-0.5 text-xs font-semibold text-[var(--blue)]">{titleCase(item.status)}</span></div><div className="flex items-center gap-2"><button className="btn-secondary" disabled={busy} onClick={() => onUpdate(item, 'in_progress')}>Start</button><button className="btn" disabled={busy} onClick={() => onUpdate(item, 'resolved')}>Resolve</button></div></article>)}</div>}
    </section>
  );
}

function TodaySchedule({ schedule }: { schedule: ScheduleItem[] }) {
  return (
    <section className="panel p-0">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3"><h2 className="font-semibold">Today’s schedule</h2><span className="text-sm font-semibold text-[var(--sage-deep)]">Live clinic schedule</span></div>
      {schedule.length === 0 ? <div className="p-9 text-center"><strong>No appointments scheduled today</strong><p className="muted mt-1 text-sm">The schedule is currently clear.</p></div> : <ul className="divide-y divide-[var(--border)]">{schedule.map((item, index) => <li className="grid grid-cols-[54px_1fr_auto] gap-3 px-4 py-3 text-sm" key={`${item.time}-${item.patient}-${index}`}><span className="muted">{item.time}</span><span><strong className="block">{item.patient}</strong><small className="muted">{item.procedure} · {item.provider} · {item.chair}</small></span><span className="badge">{titleCase(item.status)}</span></li>)}</ul>}
    </section>
  );
}

export function RoleDashboard({ user, reference, schedule = [], approvalsHref }: { user: User; reference: Reference; schedule?: ScheduleItem[]; approvalsHref: string }) {
  const organizationView = user.assignments?.some((assignment) => assignment.scope === 'organization') ?? false;
  const [period, setPeriod] = useState(organizationView ? 'month' : 'today');
  const [custom, setCustom] = useState({ start: '', end: '' });
  const [locationId, setLocationId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [summary, setSummary] = useState<OrganizationSummary | null>(null);
  const [worklist, setWorklist] = useState<Worklist | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [approvals, setApprovals] = useState<ApprovalNotificationFeed>({ items: [], unread_count: 0 });

  function query(page?: number, pageSize?: number, includeProvider = true) {
    const params = new URLSearchParams({ period });
    if (period === 'custom') { params.set('start', custom.start); params.set('end', custom.end); }
    if (locationId) params.set('location_id', locationId);
    if (providerId && includeProvider) params.set('provider_id', providerId);
    if (page) params.set('page', String(page));
    if (pageSize) params.set('page_size', String(pageSize));
    return params;
  }

  async function load() {
    if (period === 'custom' && (!custom.start || !custom.end)) return;
    setBusy(true); setError(''); setWorklist(null);
    try {
      const [nextDashboard, nextSummary, nextApprovals] = await Promise.all([
        api<Dashboard>(`/analytics/dashboard?${query()}`),
        organizationView ? api<OrganizationSummary>(`/analytics/organization-summary?${query(undefined, undefined, false)}`) : Promise.resolve(null),
        api<ApprovalNotificationFeed>('/rbac/notifications').catch(() => ({ items: [], unread_count: 0 })),
      ]);
      setDashboard(nextDashboard); setSummary(nextSummary); setApprovals(nextApprovals);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Dashboard failed'); }
    finally { setBusy(false); }
  }

  async function openMetric(metric: Metric, page = 1, pageSize = 25) {
    setBusy(true); setError('');
    try { setWorklist(await api<Worklist>(`${metric.drilldown}?${query(page, pageSize)}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Drill-down failed'); }
    finally { setBusy(false); }
  }

  async function updateAction(item: ActionItem, status: string) {
    setBusy(true); setError('');
    try { await api(`/analytics/actions/${item.id}`, { status, note: `Updated from ${dashboard?.role_profile} dashboard` }, 'PUT'); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Action update failed'); setBusy(false); }
  }

  useEffect(() => { void load(); }, [period, locationId, providerId]);

  if (!dashboard && busy) return <p className="panel">Loading role dashboard…</p>;
  return <div className="role-dashboard">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
      <div>{organizationView ? <><h1 className="text-2xl font-bold">{user.organization_name}</h1><p className="muted">{reference.locations.length} location{reference.locations.length === 1 ? '' : 's'} · {reference.providers.length} clinical provider{reference.providers.length === 1 ? '' : 's'}</p></> : <><h1 className="text-2xl font-bold">Good morning, {user.name}</h1><p className="muted">{new Intl.DateTimeFormat('en-CA', { dateStyle: 'full' }).format(new Date())}</p></>}</div>
      <div className="flex flex-wrap items-end gap-2">
        {organizationView && <label className="text-xs text-[var(--ink-muted)]">Location<select className="field mt-1 block" value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">All locations</option>{reference.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
        <label className="text-xs text-[var(--ink-muted)]">Date range<select className="field mt-1 block" value={period} onChange={(event) => setPeriod(event.target.value)}>{periods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {period === 'custom' && <><label className="text-xs text-[var(--ink-muted)]">From<input className="field mt-1 block" type="date" value={custom.start} onChange={(event) => setCustom({ ...custom, start: event.target.value })} /></label><label className="text-xs text-[var(--ink-muted)]">To<input className="field mt-1 block" type="date" value={custom.end} onChange={(event) => setCustom({ ...custom, end: event.target.value })} /></label><button className="btn-secondary" disabled={busy} onClick={() => void load()}>Apply</button></>}
      </div>
    </div>
    {error && <p className="mb-3 rounded-md bg-[var(--danger-tint)] p-3 text-sm text-[var(--danger)]" role="alert">{error}</p>}
    {dashboard && <>
      <div className="muted mb-4 flex flex-wrap gap-x-4 text-sm"><span>Range: <strong>{dashboard.start} to {dashboard.end}</strong></span><span>Updated {new Date(dashboard.freshness.last_updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
      <MetricCards dashboard={dashboard} onOpen={(metric) => void openMetric(metric)} />
      {organizationView ? <>
        <div className="mb-5 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
          <section className="panel overflow-auto p-0"><div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3"><h2 className="font-semibold">Locations</h2><span className="muted text-sm">Select a location to filter this dashboard</span></div><table><thead><tr><th>Location</th><th>Visits</th><th>Production</th><th>Chair use</th><th>Acceptance</th></tr></thead><tbody>{summary?.locations.map((row) => <tr key={row.id}><td><button className="font-semibold text-[var(--sage-deep)]" onClick={() => setLocationId(row.id)}>{row.name}</button></td><td>{row.visits}</td><td>{money(row.production_cents)}</td><td><span className="mr-2 inline-block h-2 w-20 overflow-hidden rounded-full bg-[var(--paper)]"><span className="block h-full bg-[var(--sage)]" style={{ width: `${Math.min(row.chair_utilization, 100)}%` }} /></span>{row.chair_utilization}%</td><td>{row.case_acceptance}%</td></tr>)}</tbody></table>{summary?.locations.length === 0 && <p className="muted p-5 text-center">No authorized locations.</p>}</section>
          <ActionCentre dashboard={dashboard} approvals={approvals} approvalsHref={approvalsHref} busy={busy} onUpdate={(item, status) => void updateAction(item, status)} />
        </div>
        <section className="panel mb-5 overflow-auto p-0"><div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3"><h2 className="font-semibold">Provider performance</h2><span className="muted text-sm">Visible to authorized owners and administrators</span></div><table><thead><tr><th>Provider</th><th>Primary location</th><th>Production</th><th>Visits</th><th>No-show</th></tr></thead><tbody>{summary?.providers.map((row) => <tr key={row.id}><td><button className="font-semibold text-[var(--sage-deep)]" onClick={() => setProviderId(row.id)}>{row.name}</button></td><td>{row.location}</td><td>{money(row.production_cents)}</td><td>{row.visits}</td><td>{row.no_show_rate}%</td></tr>)}</tbody></table></section>
      </> : <div className="mb-5 grid gap-4 xl:grid-cols-[1.3fr_1fr]"><ActionCentre dashboard={dashboard} approvals={approvals} approvalsHref={approvalsHref} busy={busy} onUpdate={(item, status) => void updateAction(item, status)} /><TodaySchedule schedule={schedule} /></div>}
      {worklist && <section className="panel overflow-auto"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">{titleCase(worklist.metric_key)} breakdown</h2><p className="muted text-xs">{worklist.total.toLocaleString()} records in the retained filter context.</p></div><div className="flex gap-2">{dashboard.scope.can_export && <button className="btn-secondary" onClick={() => download(`/analytics/worklists/${worklist.metric_key}/export?${query()}`, `dhmis-${worklist.metric_key}.csv`)}>Export CSV</button>}<button className="btn-secondary" onClick={() => setWorklist(null)}>Close</button></div></div>{worklist.items.length > 0 ? <table><thead><tr>{Object.keys(worklist.items[0]).slice(0, 8).map((key) => <th key={key}>{key.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{worklist.items.map((item, index) => <tr key={String(item.id || index)}>{Object.keys(worklist.items[0]).slice(0, 8).map((key) => <td key={key}>{display(item[key])}</td>)}</tr>)}</tbody></table> : <p className="muted py-6 text-center">No records match this range.</p>}<div className="mt-3 flex items-center justify-between"><span className="text-xs">Page {worklist.page}</span><div className="flex gap-2"><button className="btn-secondary" disabled={worklist.page <= 1 || busy} onClick={() => void openMetric(dashboard.metrics.find((metric) => metric.key === worklist.metric_key) || dashboard.metrics[0], worklist.page - 1, worklist.page_size)}>Previous</button><button className="btn-secondary" disabled={worklist.page * worklist.page_size >= worklist.total || busy} onClick={() => void openMetric(dashboard.metrics.find((metric) => metric.key === worklist.metric_key) || dashboard.metrics[0], worklist.page + 1, worklist.page_size)}>Next</button></div></div></section>}
    </>}
  </div>;
}
