import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, money } from './lib/api';
import { Empty, Field, Title } from './components/Fields';
import type { Reference } from './types';
import { LocationAutocomplete, type LocationSuggestion } from './LocationAutocomplete';

type Run = (action: () => Promise<void>, successMessage?: string) => Promise<void>;
type Entitlement = { enabled?: boolean; unlimited?: boolean; value?: number | null; name?: string };
type LocationRecord = Reference['locations'][number] & { active?: boolean };
type LocationRoute = { kind: 'list' } | { kind: 'add' } | { kind: 'edit'; id: string };

const TIME_OPTIONS = Array.from({ length: 25 }, (_, index) => `${String(index).padStart(2, '0')}:00`);
const COMMON_TIMEZONES = ['America/Vancouver', 'America/Edmonton', 'America/Winnipeg', 'America/Toronto', 'America/Halifax', 'America/St_Johns', 'UTC'];
const formatHour = (value: number) => `${String(value).padStart(2, '0')}:00`;
const hoursPerDay = (opening: number, closing: number) => Math.max(0, closing - opening);

function readLocationRoute(pathname = window.location.pathname): LocationRoute {
  const marker = '/admin/locations';
  const suffix = pathname.split(marker)[1]?.replace(/^\/+|\/+$/g, '') || '';
  if (suffix === 'new') return { kind: 'add' };
  const editMatch = suffix.match(/^([^/]+)\/edit$/);
  if (editMatch) return { kind: 'edit', id: editMatch[1] };
  return { kind: 'list' };
}

function locationRoutePath(route: LocationRoute) {
  const marker = '/admin/locations';
  const base = window.location.pathname.includes(marker) ? window.location.pathname.split(marker)[0] + marker : marker;
  if (route.kind === 'add') return `${base}/new`;
  if (route.kind === 'edit') return `${base}/${route.id}/edit`;
  return base;
}

function locationPayload(form: FormData, location?: LocationRecord) {
  return {
    name: String(form.get('name') || '').trim(), address: String(form.get('address') || '').trim(), phone: String(form.get('phone') || '').trim(),
    latitude: form.get('latitude') ? Number(form.get('latitude')) : (location?.latitude ?? null),
    longitude: form.get('longitude') ? Number(form.get('longitude')) : (location?.longitude ?? null),
    osm_place_id: String(form.get('osm_place_id') || location?.osm_place_id || ''), timezone: String(form.get('timezone') || '').trim(),
    chairs: String(form.get('chairs') || '').split(',').map((item) => item.trim()).filter(Boolean),
    opening_hour: Number(String(form.get('opening_hour') || '').split(':')[0]), closing_hour: Number(String(form.get('closing_hour') || '').split(':')[0]),
    branding: location?.branding || {}, policy: {
      buffer_minutes: Number(form.get('buffer_minutes') || 0), reminder_hours: Number(form.get('reminder_hours') || 24),
      cancellation_notice_hours: Number(form.get('cancellation_notice_hours') || 24), cancellation_fee_cents: Math.round(Number(form.get('cancellation_fee') || 0) * 100),
    },
  };
}

export function Locations({ reference, entitlements, permissions, run, busy, refreshReference }: { reference: Reference; entitlements: Record<string, Entitlement>; permissions: string[]; run: Run; busy: boolean; refreshReference: () => Promise<void> }) {
  const canConfigure = permissions.includes('settings') || permissions.includes('operations');
  const limit = entitlements['limit.locations'];
  const finiteLimit = Boolean(limit?.enabled && !limit.unlimited && limit.value != null);
  const [locations, setLocations] = useState<LocationRecord[]>(reference.locations as LocationRecord[]);
  const [loading, setLoading] = useState(canConfigure);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [route, setRoute] = useState<LocationRoute>(() => readLocationRoute());
  useEffect(() => {
    const onPopState = () => setRoute(readLocationRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  function openRoute(next: LocationRoute) {
    const target = locationRoutePath(next);
    if (window.location.pathname !== target) window.history.pushState({}, '', target);
    setRoute(next);
  }
  async function loadLocations() {
    if (!canConfigure) { setLocations(reference.locations as LocationRecord[]); return; }
    setLoading(true); setLoadError('');
    try { setLocations(await api<LocationRecord[]>('/operations/locations')); }
    catch (error) { setLoadError(error instanceof Error ? error.message : 'Locations could not be loaded.'); setLocations(reference.locations as LocationRecord[]); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadLocations(); }, [reference.locations, canConfigure]);
  const activeCount = locations.filter((item) => item.active !== false).length;
  const atLimit = Boolean(finiteLimit && activeCount >= Number(limit?.value));
  const filtered = useMemo(() => { const term = query.trim().toLowerCase(); return term ? locations.filter((item) => [item.name, item.address, item.timezone].some((value) => String(value || '').toLowerCase().includes(term))) : locations; }, [locations, query]);
  async function afterMutation() { await refreshReference(); await loadLocations(); }
  if (route.kind === 'add') {
    return <AddLocationDrawer page reference={reference} locations={locations} atLimit={atLimit || !limit?.enabled} busy={busy} onClose={() => openRoute({ kind: 'list' })} onSaved={async () => { await afterMutation(); openRoute({ kind: 'list' }); }} run={run} />;
  }
  if (route.kind === 'edit') {
    return <EditLocationDrawer page location={locations.find((item) => item.id === route.id)} reference={reference} busy={busy} onClose={() => openRoute({ kind: 'list' })} onSaved={async () => { await afterMutation(); openRoute({ kind: 'list' }); }} run={run} />;
  }
  return <>
    <Title title="Locations" description="Manage clinic locations, hours, operatories, and scheduling policy." actions={canConfigure && (atLimit || !limit?.enabled ? <a className="btn" href="../billing">Upgrade plan</a> : <button className="btn" type="button" onClick={() => openRoute({ kind: 'add' })}>Add location</button>)} />
    <section className="locations-page">
      <div className={`locations-usage ${atLimit ? 'is-limit' : ''}`}><div><strong>{finiteLimit ? `${activeCount} of ${limit?.value}` : `${activeCount} location${activeCount === 1 ? '' : 's'}`}</strong><span>{limit?.unlimited ? ` · unlimited on ${limit.name || 'this plan'}` : finiteLimit ? ` · ${Math.max(0, Number(limit?.value) - activeCount)} remaining` : ' · plan limit unavailable'}</span></div>{finiteLimit && <div className="locations-meter" aria-label={`${activeCount} of ${limit?.value} locations used`}><span style={{ width: `${Math.min(100, (activeCount / Number(limit?.value)) * 100)}%` }} /></div>}<a href="../billing">Compare plans</a></div>
      {(atLimit || !limit?.enabled) && canConfigure && <p className="locations-limit-note">{!limit?.enabled ? 'An active plan is required before a location can be added.' : 'Your plan limit has been reached. Upgrade the plan to add another location.'}</p>}
      {!canConfigure && <p className="locations-readonly-note">You have read-only access to locations.</p>}
      <section className="panel locations-table-panel" aria-labelledby="locations-list-title"><div className="locations-table-toolbar"><div><h3 id="locations-list-title">All locations</h3><p className="muted text-sm">Active and inactive locations in this clinic.</p></div><input className="field locations-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search locations…" aria-label="Search locations" /></div>{loading ? <div className="locations-state">Loading locations…</div> : loadError && locations.length === 0 ? <div className="locations-state locations-error">{loadError}</div> : filtered.length === 0 ? <Empty>{query ? 'No locations match your search.' : 'No locations configured.'}</Empty> : <div className="locations-table-scroll"><table className="locations-table"><thead><tr><th>Location</th><th>Address</th><th>Timezone</th><th>Hours</th><th>Operatories</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{item.address || '—'}</td><td>{item.timezone}</td><td>{formatHour(item.opening_hour)}–{formatHour(item.closing_hour)}</td><td>{item.chairs.length}</td><td><span className={`locations-status ${item.active === false ? 'is-inactive' : ''}`}>{item.active === false ? 'Inactive' : 'Open'}</span></td><td>{canConfigure && <button className="btn-secondary" type="button" onClick={() => openRoute({ kind: 'edit', id: item.id })}>Edit</button>}</td></tr>)}</tbody></table></div>}</section>
    </section>
  </>;
}

function DrawerShell({ title, description, children, onClose, page = false }: { title: string; description: string; children: ReactNode; onClose: () => void; page?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('input,select,button')?.focus(); const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [onClose]);
  if (page) return <section ref={ref} className="locations-form-page" aria-label={title}><button className="locations-page-back" type="button" onClick={onClose}>← Back to locations</button><header className="locations-form-page-head"><div><h1>{title}</h1><p className="muted">{description}</p></div></header>{children}</section>;
  return <aside ref={ref} className="locations-drawer" aria-label={title}><div className="locations-drawer-head"><div><h2>{title}</h2><p className="muted">{description}</p></div><button className="locations-drawer-close" type="button" onClick={onClose} aria-label={`Close ${title}`}>×</button></div>{children}</aside>;
}

function LocationMap({ name, latitude, longitude }: { name: string; latitude?: number | null; longitude?: number | null }) {
  if (latitude == null || longitude == null) return <p className="locations-map-empty muted">Select an address to preview its map.</p>;
  const delta = 0.01;
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${longitude - delta}%2C${latitude - delta}%2C${longitude + delta}%2C${latitude + delta}&layer=mapnik&marker=${latitude}%2C${longitude}`;
  return <div className="locations-map"><iframe title={`Map of ${name || 'selected location'}`} src={mapUrl} loading="lazy" /></div>;
}

function TimeFields({ opening, closing, disabled = false }: { opening: number; closing: number; disabled?: boolean }) {
  const [open, setOpen] = useState(opening); const [close, setClose] = useState(closing);
  return <div className="locations-hours-grid"><Field label="Opens"><select className="field" name="opening_hour" value={formatHour(open)} onChange={(event) => setOpen(Number(event.target.value.split(':')[0]))} disabled={disabled}>{TIME_OPTIONS.slice(0, 24).map((time) => <option key={time}>{time}</option>)}</select></Field><Field label="Closes"><select className="field" name="closing_hour" value={formatHour(close)} onChange={(event) => setClose(Number(event.target.value.split(':')[0]))} disabled={disabled}>{TIME_OPTIONS.slice(1).map((time) => <option key={time}>{time}</option>)}</select></Field><p className={`locations-hours-total ${close <= open ? 'locations-form-error' : 'muted'}`}>{close <= open ? 'Closing time must follow opening time.' : `${hoursPerDay(open, close)} hours per day`}</p></div>;
}

function OperatoryEditor({ chairs, disabled = false }: { chairs: string[]; disabled?: boolean }) {
  const [items, setItems] = useState(chairs); const [newChair, setNewChair] = useState('');
  function addChair() { const value = newChair.trim(); if (value && !items.some((item) => item.toLowerCase() === value.toLowerCase())) { setItems([...items, value]); setNewChair(''); } }
  return <div className="locations-operatories"><input type="hidden" name="chairs" value={items.join(',')} readOnly /><div className="locations-chips">{items.map((chair) => <span className="locations-chip" key={chair}>{chair}{!disabled && <button type="button" onClick={() => setItems(items.filter((item) => item !== chair))} aria-label={`Remove ${chair}`}>×</button>}</span>)}</div>{!disabled && <div className="locations-add-operatory"><input className="field" value={newChair} onChange={(event) => setNewChair(event.target.value)} placeholder="Operatory name" /><button className="btn-secondary" type="button" onClick={addChair}>Add operatory</button></div>}<p className="muted text-xs">Names must be unique within this location.</p></div>;
}

function TimezoneField({ timezone, derived, onChange, disabled = false }: { timezone: string; derived: string; onChange: (value: string) => void; disabled?: boolean }) {
  const [editing, setEditing] = useState(false); const changed = timezone !== derived;
  return <div><label className="label">Timezone{editing ? <select className="field" name="timezone" value={timezone} onChange={(event) => onChange(event.target.value)} disabled={disabled}>{Array.from(new Set([timezone, derived, ...COMMON_TIMEZONES])).map((item) => <option key={item}>{item}</option>)}</select> : <input className="field" name="timezone" value={timezone} readOnly />}</label>{!disabled && <button className="locations-inline-link" type="button" onClick={() => { if (editing) onChange(derived); setEditing(!editing); }}>{editing ? 'Use derived timezone' : 'Change'}</button>}{changed && editing && <label className="locations-confirm-timezone"><input type="checkbox" name="timezone_override_confirmed" required /> I confirm this manual timezone override.</label>}</div>;
}

function PolicyFields({ policy = {} }: { policy?: Record<string, number> }) { return <div className="locations-policy-grid"><Field label="Buffer (minutes)"><input className="field" name="buffer_minutes" type="number" min="0" defaultValue={policy.buffer_minutes ?? 0} /></Field><Field label="Reminder lead (hours)"><input className="field" name="reminder_hours" type="number" min="0" defaultValue={policy.reminder_hours ?? 24} /></Field><Field label="Cancellation notice (hours)"><input className="field" name="cancellation_notice_hours" type="number" min="0" defaultValue={policy.cancellation_notice_hours ?? 24} /></Field><Field label="Cancellation fee (CAD)"><input className="field" name="cancellation_fee" type="number" min="0" step="0.01" defaultValue={(policy.cancellation_fee_cents ?? 0) / 100} /></Field></div>; }

function AddLocationDrawer({ reference, locations, atLimit, busy, onClose, onSaved, run, page = false }: { reference: Reference; locations: LocationRecord[]; atLimit: boolean; busy: boolean; onClose: () => void; onSaved: () => Promise<void>; run: Run; page?: boolean }) {
  const first = locations.find((item) => item.active !== false); const defaultTimezone = (reference.region || 'CA') === 'CA' ? 'America/Toronto' : 'UTC';
  const [selected, setSelected] = useState<LocationSuggestion | null>(null); const [locationName, setLocationName] = useState(''); const [timezone, setTimezone] = useState(defaultTimezone); const [derivedTimezone, setDerivedTimezone] = useState(defaultTimezone); const [copyMode, setCopyMode] = useState(first ? 'copy' : 'defaults'); const [error, setError] = useState(''); const [reviewPolicy, setReviewPolicy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(''); const form = new FormData(event.currentTarget); const name = String(form.get('name') || '').trim(); if (!selected || !name) { setError(!selected ? 'Select an address before adding the location.' : 'Enter a location name before adding the location.'); return; } await run(async () => { try { const payload = locationPayload(form); await api('/operations/locations', { ...payload, ...(copyMode === 'copy' && first ? { chairs: first.chairs, opening_hour: first.opening_hour, closing_hour: first.closing_hour, policy: first.policy } : {}) }); await onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Location could not be added.'); throw reason; } }, 'Location added.'); }
  return <DrawerShell page={page} title="Add location" description="Start with an address so the timezone can be derived automatically." onClose={onClose}><form className="locations-drawer-form" onSubmit={submit}><Field label="Address"><LocationAutocomplete region={reference.region || 'CA'} inputName="address" required onSelectionChange={(result) => { setSelected(result); const zone = result?.timezone || defaultTimezone; setDerivedTimezone(zone); setTimezone(zone); }} /></Field><LocationMap name={selected?.display_name || ''} latitude={selected?.latitude} longitude={selected?.longitude} /><TimezoneField timezone={timezone} derived={derivedTimezone} onChange={setTimezone} /><Field label="Location name"><input className="field" name="name" value={locationName} onChange={(event) => setLocationName(event.target.value)} required placeholder="e.g. Downtown clinic" /></Field><Field label="Phone"><input className="field" name="phone" type="tel" placeholder="e.g. (604) 555-0142" /></Field><fieldset><legend>Starting settings</legend><label><input type="radio" checked={copyMode === 'copy'} onChange={() => setCopyMode('copy')} disabled={!first} /> Copy hours, operatories, and policy from {first?.name || 'an existing location'}</label><label><input type="radio" checked={copyMode === 'defaults'} onChange={() => setCopyMode('defaults')} /> Use clinic defaults</label></fieldset><div className="locations-section"><h3>Hours</h3><TimeFields opening={first?.opening_hour ?? 8} closing={first?.closing_hour ?? 18} /></div><div className="locations-section"><h3>Operatories</h3><OperatoryEditor chairs={first?.chairs ?? ['Op 1', 'Op 2']} /></div><div className="locations-section"><button className="locations-policy-toggle" type="button" onClick={() => setReviewPolicy(!reviewPolicy)}>Scheduling policy <span>{reviewPolicy ? 'Hide' : 'Review'}</span></button>{reviewPolicy && <PolicyFields policy={first?.policy} />}</div>{error && <p className="locations-form-error" role="alert">{error}</p>}<div className="locations-drawer-footer">{atLimit ? <a className="btn" href="../billing">Upgrade plan</a> : <button className="btn" type="submit" disabled={busy || !selected || !locationName.trim()}>Add location</button>}</div></form></DrawerShell>;
}

function EditLocationDrawer({ location, reference, busy, onClose, onSaved, run, page = false }: { location?: LocationRecord; reference: Reference; busy: boolean; onClose: () => void; onSaved: () => Promise<void>; run: Run; page?: boolean }) {
  const [error, setError] = useState(''); const [dirty, setDirty] = useState(false); const [confirmClose, setConfirmClose] = useState(false); const [lifecycleConfirm, setLifecycleConfirm] = useState(false); const [timezone, setTimezone] = useState(location?.timezone || 'UTC'); const [derivedTimezone, setDerivedTimezone] = useState(location?.timezone || 'UTC');
  const [mapPoint, setMapPoint] = useState({ latitude: location?.latitude ?? null, longitude: location?.longitude ?? null });
  if (!location) return null;
  const current = location;
  const requestClose = () => { if (dirty) setConfirmClose(true); else onClose(); };
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(''); await run(async () => { try { await api(`/operations/locations/${current.id}`, locationPayload(new FormData(event.currentTarget), current), 'PUT'); await onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Location could not be saved.'); throw reason; } }, 'Location saved.'); }
  async function lifecycle(action: 'deactivate' | 'reactivate') { setError(''); await run(async () => { try { await api(`/operations/locations/${current.id}/${action}`, {}); await onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : `Location could not be ${action}d.`); throw reason; } }, action === 'deactivate' ? 'Location deactivated.' : 'Location reactivated.'); }
  return <DrawerShell page={page} title={location.active === false ? 'Edit inactive location' : 'Edit location'} description="Changes are shared across scheduling, patient access, billing, and the public site." onClose={requestClose}><form className="locations-drawer-form" onChange={() => setDirty(true)} onSubmit={submit}><div className="locations-section"><h3>Details</h3><Field label="Location name"><input className="field" name="name" defaultValue={location.name} required /></Field><Field label="Phone"><input className="field" name="phone" type="tel" defaultValue={location.phone || ""} /></Field><Field label="Address"><LocationAutocomplete region={reference.region || 'CA'} inputName="address" initialValue={location.address || ''} initialLatitude={location.latitude} initialLongitude={location.longitude} initialPlaceId={location.osm_place_id} required onSelectionChange={(result) => { setDirty(true); setMapPoint({ latitude: result?.latitude ?? null, longitude: result?.longitude ?? null }); setDerivedTimezone(result?.timezone || location.timezone); if (result?.timezone) setTimezone(result.timezone); }} /></Field><LocationMap name={location.name} latitude={mapPoint.latitude} longitude={mapPoint.longitude} /><TimezoneField timezone={timezone} derived={derivedTimezone} onChange={(value) => { setTimezone(value); setDirty(true); }} /></div><div className="locations-section"><h3>Hours</h3><TimeFields opening={location.opening_hour} closing={location.closing_hour} /></div><div className="locations-section"><h3>Operatories</h3><OperatoryEditor chairs={location.chairs} /></div><div className="locations-section"><h3>Scheduling policy</h3><PolicyFields policy={location.policy} /><p className="muted text-xs">Cancellation fee: {money(location.policy?.cancellation_fee_cents || 0)}</p></div>{error && <p className="locations-form-error" role="alert">{error}</p>}{lifecycleConfirm && <div className="locations-inline-confirm"><strong>{location.active === false ? 'Reactivate this location?' : 'Deactivate this location?'}</strong><p className="muted">{location.active === false ? 'It will become available to scheduling and patient-facing surfaces again.' : 'It will be hidden from scheduling, patient access, and the public site. Existing data is retained.'}</p><div><button className="btn-secondary" type="button" onClick={() => setLifecycleConfirm(false)}>Keep editing</button><button className="btn-danger" type="button" onClick={() => void lifecycle(location.active === false ? 'reactivate' : 'deactivate')}>{location.active === false ? 'Reactivate' : 'Deactivate'}</button></div></div>}{confirmClose && <div className="locations-inline-confirm"><strong>Discard unsaved changes?</strong><p className="muted">Your edits have not been saved.</p><div><button className="btn-secondary" type="button" onClick={() => setConfirmClose(false)}>Keep editing</button><button className="btn-danger" type="button" onClick={onClose}>Discard changes</button></div></div>}<div className="locations-drawer-footer"><button className="btn-secondary" type="button" onClick={requestClose}>Cancel</button><button className="btn" type="submit" disabled={busy}>Save changes</button><button className="btn-danger" type="button" onClick={() => setLifecycleConfirm(true)}>{location.active === false ? 'Reactivate location' : 'Deactivate location'}</button></div></form></DrawerShell>;
}
