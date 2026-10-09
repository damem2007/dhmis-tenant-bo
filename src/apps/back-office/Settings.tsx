import { useEffect, useState, type FormEvent } from 'react';
import { api, download } from '../../shared/api';
import { Field, Title } from '../../shared/Fields';
import { RolesAccess } from '../../shared/RolesAccess';
import type { Audit, Reference, User } from '../../shared/types';

interface SettingsData {
  visibility: 'organization' | 'location';
  branding: Record<string, string>;
  policy: {
    cancellation_notice_hours: number;
    cancellation_fee_cents: number;
    buffer_minutes: number;
    reminder_hours: number;
  };
  effective_adapters: Record<string, string>;
  jurisdiction_policy: Record<string, unknown>;
  jurisdiction: Record<string, unknown>;
  public_content: { contact_phone: string; contact_email: string; address: string };
  booking_widget: {
    accent_color: string;
    default_location_id: string;
    allowed_location_ids: string[];
    allowed_service_ids: string[];
    allowed_provider_ids: string[];
    allowed_origins: string[];
  };
}

interface Staff {
  id: string;
  name: string;
  email: string;
  role: string;
  mfa_enabled: boolean;
  active: boolean;
  location_ids: string[];
  photo_url?: string;
  external_identity?: boolean;
  assignments: AccessAssignment[];
}

interface Invitation {
  id: string;
  name: string;
  email: string;
  role: string;
  location_ids: string[];
  status: string;
  resend_count: number;
  expires: number;
  created_at: string;
  assignments: AccessAssignment[];
}

interface PatientInvitation {
  id: string;
  patient_id: string;
  recipient_name: string;
  email: string;
  created_at: string;
  expires: number;
  status: string;
}

interface AccessAssignment {
  id?: string;
  scope: 'location' | 'organization';
  location_id: string | null;
  role: string;
}

interface RoleOption {
  id: string;
  name: string;
  locked: boolean;
  scopes: string[];
}

interface Page<T> {
  page: number;
  page_size: number;
  total: number;
  items: T[];
}

interface AccessFilters {
  search: string;
  status: string;
  role: string;
  location_id: string;
}

interface AuditFilters {
  patient_id: string;
  actor_id: string;
  start: string;
  end: string;
  action: string;
  resource: string;
  location_id: string;
  outcome: string;
}

interface CommunicationTemplate {
  name: string;
  channel: 'email' | 'sms';
  subject: string;
  body: string;
  active: boolean;
}

interface Message {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  created_at: string;
}

interface ProviderOptions {
  effective: Record<string, string>;
  available: Record<string, string[]>;
  managed_by: string;
}

interface IntegrationRequest {
  id: string;
  capability: string;
  provider_name: string;
  reason: string;
  status: string;
  created_at: string;
  decision_reason: string;
}

type Props = {
  user: User;
  reference: Reference;
  audit: Audit[];
  patients: { id: string; first_name: string; last_name: string }[];
  run: (action: () => Promise<void>) => Promise<void>;
  busy: boolean;
  refreshAudit: (patientId?: string) => Promise<void>;
  basePath: string;
  onSectionChange?: (section: SettingsSection) => void;
};

type SettingsView =
  | { type: 'loading' }
  | { type: 'error'; message: string }
  | {
      type: 'ready';
      settings: SettingsData;
      staff: Staff[];
      invitations: Invitation[];
      templates: Record<string, CommunicationTemplate>;
      messages: Message[];
      providerOptions: ProviderOptions;
      integrationRequests: IntegrationRequest[];
      roles: RoleOption[];
      invitationToken: string;
    };

const brandTokens = ['--sage', '--sage-deep', '--paper', '--surface', '--ink'];
const emptyAccessFilters: AccessFilters = { search: '', status: '', role: '', location_id: '' };
const emptyAuditFilters: AuditFilters = { patient_id: '', actor_id: '', start: '', end: '', action: '', resource: '', location_id: '', outcome: '' };
const settingsSections = ['practice', 'integrations', 'staff', 'templates', 'audit', 'roles', 'delivery'] as const;
export type SettingsSection = (typeof settingsSections)[number];
const settingsSectionTitles: Record<SettingsSection, string> = { practice: 'Practice policy', integrations: 'Integrations', staff: 'Staff & invitations', templates: 'Message templates', audit: 'Audit trail', roles: 'Roles & access', delivery: 'Notification delivery' };
const templateVariables = ['clinic_name', 'clinic_phone', 'patient_first_name', 'provider_name', 'appointment_date', 'appointment_time', 'installment_amount', 'due_date', 'plan_balance'] as const;
const templateSamples: Record<(typeof templateVariables)[number], string> = {
  clinic_name: 'Harbour Dental', clinic_phone: '(604) 555-0182', patient_first_name: 'Avery', provider_name: 'Dr. Jordan Lee', appointment_date: 'October 24', appointment_time: '1:00 PM', installment_amount: '$60.00', due_date: 'September 30', plan_balance: '$120.00',
};

function renderTemplateSample(value: string) {
  return Object.entries(templateSamples).reduce((result, [variable, sample]) => result.replaceAll(`{{${variable}}}`, sample), value);
}

function AccessPager({ page, busy, label, onPage, onPageSize }: {
  page: { page: number; page_size: number; total: number };
  busy: boolean;
  label: string;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
}) {
  const first = page.total === 0 ? 0 : (page.page - 1) * page.page_size + 1;
  const last = Math.min(page.total, page.page * page.page_size);
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
      <span>{first}–{last} of {page.total} {label}</span>
      <div className="flex items-center gap-2">
        <label>Rows <select className="field inline-block w-auto" aria-label={`${label} rows per page`} value={page.page_size} onChange={(event) => onPageSize(Number(event.target.value))}>{[10, 25, 50, 100].map((size) => <option key={size}>{size}</option>)}</select></label>
        <button type="button" className="btn-secondary" disabled={busy || page.page <= 1} onClick={() => onPage(page.page - 1)}>Previous</button>
        <span>Page {page.page}</span>
        <button type="button" className="btn-secondary" disabled={busy || last >= page.total} onClick={() => onPage(page.page + 1)}>Next</button>
      </div>
    </div>
  );
}

function TemplateEditor({ templateKey, template, busy, onSave, onTest }: {
  templateKey: string;
  template: CommunicationTemplate;
  busy: boolean;
  onSave: (template: CommunicationTemplate) => Promise<void>;
  onTest: () => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(template);
  const [delivery, setDelivery] = useState('');
  useEffect(() => setDraft(template), [template]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDelivery('');
    await onSave(draft);
  }
  async function sendTest() {
    setDelivery('Queueing test message…');
    const queued = await onTest();
    setDelivery(queued ? 'Queued for delivery through the configured provider.' : 'The test message was not queued.');
  }
  return (
    <form className="space-y-3 rounded-lg border border-[var(--border)] p-4" onSubmit={submit}>
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-medium">{draft.name}</h3><code className="muted text-xs">{templateKey}</code></div><span className="badge">{draft.channel.toUpperCase()}</span></div>
      <Field label="Name"><input className="field" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /></Field>
      <Field label="Channel"><select className="field" value={draft.channel} onChange={(event) => setDraft({ ...draft, channel: event.target.value as CommunicationTemplate['channel'] })}><option value="email">Email</option><option value="sms">SMS</option></select></Field>
      <Field label="Subject"><input className="field" value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} disabled={draft.channel === 'sms'} /></Field>
      <Field label="Message"><textarea className="field min-h-28" value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} required maxLength={4000} /></Field>
      <div><p className="mb-2 text-xs font-medium">Insert a supported variable into the message</p><div className="flex flex-wrap gap-1.5">{templateVariables.map((variable) => <button key={variable} type="button" className="rounded-md border border-[var(--border)] px-2 py-1 text-xs" onClick={() => setDraft({ ...draft, body: `${draft.body}${draft.body.endsWith(' ') || !draft.body ? '' : ' '}{{${variable}}}` })}>{`{{${variable}}}`}</button>)}</div></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> Active</label>
      <div className="rounded-lg bg-[var(--paper)] p-3" aria-live="polite"><p className="muted mb-1 text-xs font-medium uppercase tracking-wide">Live preview</p>{draft.channel === 'email' && <strong className="block text-sm">{renderTemplateSample(draft.subject) || '(No subject)'}</strong>}<p className="mt-1 whitespace-pre-wrap text-sm">{renderTemplateSample(draft.body)}</p></div>
      <div className="flex flex-wrap items-center gap-2"><button className="btn-secondary" disabled={busy}>Save template</button><button type="button" className="btn-secondary" disabled={busy || !draft.active} onClick={() => void sendTest()}>Send test</button>{delivery && <span className="muted text-xs" role="status">{delivery}</span>}</div>
    </form>
  );
}

function PatientInvitations() {
  const [page, setPage] = useState<Page<PatientInvitation>>({ page: 1, page_size: 25, total: 0, items: [] });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function load(nextPage = 1) {
    setBusy(true);
    try {
      const query = new URLSearchParams({ page: String(nextPage), page_size: String(page.page_size) });
      if (search) query.set('search', search);
      if (status) query.set('status', status);
      setPage(await api<Page<PatientInvitation>>(`/portal/invites/query?${query}`));
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Patient invitations could not be loaded');
    } finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  async function action(identifier: string, operation: 'resend' | 'revoke') {
    setBusy(true);
    try {
      const result = await api<{ token?: string }>(`/portal/invites/${identifier}/${operation}`, {});
      setMessage(result.token ? `Replacement one-time token: ${result.token}` : 'Invitation revoked.');
      await load(page.page);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Invitation update failed');
      setBusy(false);
    }
  }
  return <div className="mt-6 border-t border-[var(--border)] pt-5"><div className="prototype-section-head"><div><h3 className="font-medium">Patient invitations</h3><p>Client Portal invitations issued by this organization.</p></div></div>{message && <p className="prototype-callout" role="status">{message}</p>}<form className="mb-3 grid gap-2 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); void load(); }}><Field label="Find patient invitation"><input className="field" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or email" /></Field><Field label="Status"><select className="field" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All</option><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="expired">Expired</option></select></Field><button className="btn-secondary self-end" disabled={busy}>Apply filters</button></form><div className="overflow-auto"><table><thead><tr><th>Patient</th><th>Recipient</th><th>Created</th><th>Expires</th><th>Status</th><th>Actions</th></tr></thead><tbody>{page.items.map((invitation) => <tr key={invitation.id}><td><strong>{invitation.recipient_name}</strong><p className="muted text-xs">{invitation.patient_id}</p></td><td>{invitation.email}</td><td>{new Date(invitation.created_at).toLocaleString()}</td><td>{new Date(invitation.expires * 1000).toLocaleString()}</td><td>{invitation.status}</td><td>{['pending', 'expired'].includes(invitation.status) && <button type="button" className="btn-secondary" disabled={busy} onClick={() => void action(invitation.id, 'resend')}>Resend</button>} {invitation.status === 'pending' && <button type="button" className="btn-secondary" disabled={busy} onClick={() => void action(invitation.id, 'revoke')}>Revoke</button>}</td></tr>)}</tbody></table>{!page.items.length && <p className="muted p-4">No patient invitations match these filters.</p>}</div><AccessPager page={page} busy={busy} label="patient invitations" onPage={(next) => void load(next)} onPageSize={(size) => { setPage((current) => ({ ...current, page_size: size })); void load(1); }} /></div>;
}

export function Settings({ user, reference, audit, patients, run, busy, refreshAudit, basePath, onSectionChange }: Props) {
  const [view, setView] = useState<SettingsView>({ type: 'loading' });
  const [auditPage, setAuditPage] = useState({ page: 1, page_size: 25, total: audit.length, items: audit });
  const [auditFilters, setAuditFilters] = useState<AuditFilters>(emptyAuditFilters);
  const [staffPage, setStaffPage] = useState<Page<Staff>>({ page: 1, page_size: 25, total: 0, items: [] });
  const [invitationPage, setInvitationPage] = useState<Page<Invitation>>({ page: 1, page_size: 25, total: 0, items: [] });
  const [staffFilters, setStaffFilters] = useState<AccessFilters>(emptyAccessFilters);
  const [invitationFilters, setInvitationFilters] = useState<AccessFilters>(emptyAccessFilters);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState('appointment-reminder');
  const [activeSection, setActiveSection] = useState<SettingsSection>(() => {
    const section = window.location.pathname.startsWith(basePath) ? window.location.pathname.slice(basePath.length).split('/').filter(Boolean)[0] : '';
    return settingsSections.includes(section as SettingsSection) ? section as SettingsSection : 'practice';
  });

  function accessQuery(kind: 'staff' | 'invitation', page: number, pageSize: number, filters: AccessFilters) {
    const query = new URLSearchParams({ kind, page: String(page), page_size: String(pageSize) });
    Object.entries(filters).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    return `/organization/access/query?${query}`;
  }

  async function load(invitationToken = view.type === 'ready' ? view.invitationToken : '') {
    const [settings, staffAccess, invitationAccess, templates, messages, providerOptions, integrationRequests, roles] = await Promise.all([
      api<SettingsData>('/organization/settings'),
      api<Page<Staff>>(accessQuery('staff', staffPage.page, staffPage.page_size, staffFilters)),
      api<Page<Invitation>>(accessQuery('invitation', invitationPage.page, invitationPage.page_size, invitationFilters)),
      api<Record<string, CommunicationTemplate>>('/organization/communication-templates'),
      api<Message[]>('/notifications'),
      api<ProviderOptions>('/organization/provider-options'),
      api<IntegrationRequest[]>('/organization/integration-requests'),
      api<RoleOption[]>('/organization/access/roles'),
    ]);
    setStaffPage(staffAccess);
    setInvitationPage(invitationAccess);
    setView({ type: 'ready', settings, staff: staffAccess.items, invitations: invitationAccess.items, templates, messages, providerOptions, integrationRequests, roles, invitationToken });
  }

  async function loadAccess(kind: 'staff' | 'invitation', page: number, pageSize: number, filters: AccessFilters) {
    const result = await api<Page<Staff | Invitation>>(accessQuery(kind, page, pageSize, filters));
    setView((current) => {
      if (current.type !== 'ready') return current;
      return kind === 'staff'
        ? { ...current, staff: result.items as Staff[] }
        : { ...current, invitations: result.items as Invitation[] };
    });
    if (kind === 'staff') setStaffPage(result as Page<Staff>);
    else setInvitationPage(result as Page<Invitation>);
  }

  function updateSettings(change: (draft: SettingsData) => void) {
    setView((current) => {
      if (current.type !== 'ready') return current;
      const settings = structuredClone(current.settings);
      change(settings);
      return { ...current, settings };
    });
  }

  async function handleSaveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (view.type !== 'ready') return;
    await run(async () => {
      await api('/organization/settings', view.settings, 'PUT');
      Object.entries(view.settings.branding).forEach(([token, value]) => {
        document.documentElement.style.setProperty(token, value);
      });
      await load();
    });
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const assignments: AccessAssignment[] = form.getAll('assignment_location').map((value) => ({
      scope: 'location',
      location_id: String(value),
      role: String(form.get(`assignment_role:${value}`)),
    }));
    if (form.get('organization_scope') === 'on') {
      assignments.push({ scope: 'organization', location_id: null, role: String(form.get('organization_role')) });
    }
    await run(async () => {
      const result = await api<{ token: string }>('/organization/invites', {
        name: form.get('name'),
        email: form.get('email'),
        assignments,
      });
      await load(result.token);
    });
  }

  async function requestIntegration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api('/organization/integration-requests', {
        capability: form.get('capability'),
        provider_name: form.get('provider_name'),
        reason: form.get('reason'),
      });
      event.currentTarget.reset();
      await load();
    });
  }

  async function updateStaff(person: Staff, change: { active?: boolean; assignments?: AccessAssignment[] }) {
    await run(async () => {
      await api(
        `/organization/staff/${person.id}`,
        {
          active: change.active ?? person.active,
          assignments: change.assignments ?? person.assignments,
        },
        'PUT',
      );
      await load();
    });
  }

  async function dispatchNotifications() {
    await run(async () => {
      await api('/notifications/dispatch', {});
      await load();
    });
  }

  async function retryNotification(identifier: string) {
    await run(async () => {
      await api(`/notifications/${identifier}/retry`, {});
      await load();
    });
  }

  async function resendInvitation(identifier: string) {
    await run(async () => {
      const result = await api<{ token: string }>(`/organization/invites/${identifier}/resend`, {});
      await load(result.token);
    });
  }

  async function revokeInvitation(identifier: string) {
    await run(async () => {
      await api(`/organization/invites/${identifier}/revoke`, {});
      await load();
    });
  }

  async function resetPassword(person: Staff) {
    await run(async () => {
      await api(`/organization/staff/${person.id}/password-reset`, {
        reason: `Organization administrator reset requested for ${person.email}`,
      });
      await load();
    });
  }

  async function saveTemplate(key: string, template: CommunicationTemplate) {
    await run(async () => {
      await api(`/organization/communication-templates/${key}`, template, 'PUT');
      await load();
    });
  }

  async function testTemplate(key: string): Promise<boolean> {
    let queued = false;
    await run(async () => {
      const result = await api<{ status: string }>(`/organization/communication-templates/${key}/test`, {});
      queued = result.status === 'queued';
      await load();
    });
    return queued;
  }

  async function exportAudit() {
    const query = new URLSearchParams();
    Object.entries(auditFilters).forEach(([key, value]) => { if (value) query.set(key, value); });
    await run(() => download(`/organization/audit/export${query.size ? `?${query}` : ''}`, 'dhmis-audit.csv'));
  }

  async function loadAudit(page = 1, filters = auditFilters, pageSize = auditPage.page_size) {
    const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
    setAuditPage(await api<{ page: number; page_size: number; total: number; items: Audit[] }>(`/organization/audit/query?${query}`));
  }

  useEffect(() => {
    void load().catch((reason) => setView({ type: 'error', message: reason.message }));
    void loadAudit().catch(() => undefined);
  }, []);

  useEffect(() => {
    const restoreSection = () => {
      const section = window.location.pathname.startsWith(basePath) ? window.location.pathname.slice(basePath.length).split('/').filter(Boolean)[0] : '';
      setActiveSection(settingsSections.includes(section as SettingsSection) ? section as SettingsSection : 'practice');
    };
    restoreSection();
    window.addEventListener('popstate', restoreSection);
    return () => window.removeEventListener('popstate', restoreSection);
  }, [basePath]);

  function openSettingsSection(section: SettingsSection) {
    const target = `${basePath}/${section}`;
    if (window.location.pathname !== target) window.history.pushState({}, '', target);
    setActiveSection(section);
    onSectionChange?.(section);
  }

  if (view.type === 'loading') return <p className="panel">Loading settings…</p>;
  if (view.type === 'error') return <p className="panel" role="alert">{view.message}</p>;

  const { settings, staff, invitations, templates, messages, providerOptions, integrationRequests, roles, invitationToken } = view;
  const organizationRoles = roles.filter((role) => role.scopes.includes('organization'));
  const locationRoles = roles.filter((role) => role.scopes.includes('location'));
  const effectiveTemplateKey = templates[selectedTemplateKey] ? selectedTemplateKey : Object.keys(templates)[0];

  return (
    <>
      <Title
        title={settingsSectionTitles[activeSection]}
        description="Configure tenant-owned policy, staff access, communications, provider requests, and auditable operations."
      />
      <nav className="panel mb-5 flex flex-wrap gap-2 text-sm" aria-label="Settings sections">
        {settingsSections.map((section) => <a key={section} aria-current={activeSection === section ? 'page' : undefined} className={`btn-secondary ${activeSection === section ? 'border-[var(--sage)] text-[var(--sage-deep)]' : ''}`} href={`${basePath}/${section}`} onClick={(event) => { event.preventDefault(); openSettingsSection(section); }}>{settingsSectionTitles[section]}</a>)}
      </nav>
      {activeSection === 'practice' && <form id="settings-practice" className="panel mb-5 space-y-4" onSubmit={handleSaveSettings}>
        <h2 className="font-semibold">Practice policy</h2>
        <div className="grid gap-3 md:grid-cols-5">
          <Field label="Patient visibility">
            <select
              className="field"
              value={settings.visibility}
              onChange={(event) => updateSettings((draft) => { draft.visibility = event.target.value as SettingsData['visibility']; })}
            >
              <option value="organization">Across organization</option>
              <option value="location">Assigned locations</option>
            </select>
          </Field>
          <Field label="Cancellation notice (hours)">
            <input className="field" type="number" min="0" max="168" value={settings.policy.cancellation_notice_hours} onChange={(event) => updateSettings((draft) => { draft.policy.cancellation_notice_hours = Number(event.target.value); })} />
          </Field>
          <Field label="Late fee (CAD)">
            <input className="field" type="number" min="0" step="0.01" value={settings.policy.cancellation_fee_cents / 100} onChange={(event) => updateSettings((draft) => { draft.policy.cancellation_fee_cents = Math.round(Number(event.target.value) * 100); })} />
          </Field>
          <Field label="Schedule buffer (minutes)">
            <input className="field" type="number" min="0" max="120" value={settings.policy.buffer_minutes} onChange={(event) => updateSettings((draft) => { draft.policy.buffer_minutes = Number(event.target.value); })} />
          </Field>
          <Field label="Reminder lead (hours)">
            <input className="field" type="number" min="1" max="168" value={settings.policy.reminder_hours} onChange={(event) => updateSettings((draft) => { draft.policy.reminder_hours = Number(event.target.value); })} />
          </Field>
        </div>

        <details>
          <summary className="font-medium">Brand tokens</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {brandTokens.map((token) => (
              <Field key={token} label={token}>
                <input
                  className="field"
                  value={settings.branding[token] || ''}
                  placeholder="Use global default"
                  onChange={(event) => updateSettings((draft) => { draft.branding[token] = event.target.value; })}
                />
              </Field>
            ))}
          </div>
        </details>
        <details>
          <summary className="font-medium">Public contact and booking widget</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Field label="Clinic phone"><input className="field" value={settings.public_content.contact_phone} onChange={(event) => updateSettings((draft) => { draft.public_content.contact_phone = event.target.value; })} /></Field>
            <Field label="Clinic email"><input className="field" type="email" value={settings.public_content.contact_email} onChange={(event) => updateSettings((draft) => { draft.public_content.contact_email = event.target.value; })} /></Field>
            <Field label="Address"><input className="field" value={settings.public_content.address} onChange={(event) => updateSettings((draft) => { draft.public_content.address = event.target.value; })} /></Field>
            <Field label="Widget accent"><input className="field" type="color" value={settings.booking_widget.accent_color} onChange={(event) => updateSettings((draft) => { draft.booking_widget.accent_color = event.target.value; })} /></Field>
            <Field label="Default widget location"><select className="field" value={settings.booking_widget.default_location_id} onChange={(event) => updateSettings((draft) => { draft.booking_widget.default_location_id = event.target.value; })}><option value="">No default</option>{reference.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
            <Field label="Allowed embed origins"><textarea className="field" value={settings.booking_widget.allowed_origins.join('\n')} placeholder="https://www.example.com" onChange={(event) => updateSettings((draft) => { draft.booking_widget.allowed_origins = event.target.value.split('\n').map((value) => value.trim()).filter(Boolean); })} /></Field>
          </div>
          <p className="muted mt-2 text-xs">The public manifest is tenant-bound at /v1/tenants/&lt;slug&gt;/widget-config. Provider adapters remain controlled by the platform registry.</p>
        </details>
        <button className="btn" disabled={busy}>Save organization settings</button>
      </form>}

      {activeSection === 'integrations' && <section id="settings-integrations" className="panel mb-5">
        <h2 className="font-semibold">Integration registry</h2>
        <p className="muted mb-3 text-sm">Provider assignments inherit DHMIS platform defaults. Submit a customization request for Platform Administration review.</p>
        <div className="mb-4 grid gap-2 md:grid-cols-3">
          {Object.entries(providerOptions.effective).map(([capability, provider]) => (
            <div key={capability} className="rounded-md border border-[var(--border)] p-3">
              <p className="muted text-xs">{capability.replaceAll('_', ' ')}</p>
              <strong>{provider}</strong>
            </div>
          ))}
        </div>
        <form className="grid gap-3 md:grid-cols-[1fr_1fr_2fr_auto]" onSubmit={requestIntegration}>
          <Field label="Capability">
            <select className="field" name="capability" required>{Object.keys(providerOptions.available).map((capability) => <option key={capability}>{capability}</option>)}</select>
          </Field>
          <Field label="Requested provider"><input className="field" name="provider_name" list="provider-names" required /></Field>
          <datalist id="provider-names">{[...new Set(Object.values(providerOptions.available).flat())].map((provider) => <option key={provider} value={provider} />)}</datalist>
          <Field label="Business reason"><input className="field" name="reason" minLength={10} required /></Field>
          <button className="btn-secondary self-end" disabled={busy}>Request review</button>
        </form>
        {integrationRequests.length > 0 && <div className="mt-4 overflow-auto"><table><thead><tr><th>Requested</th><th>Capability</th><th>Provider</th><th>Status</th><th>Decision</th></tr></thead><tbody>{integrationRequests.map((request) => <tr key={request.id}><td>{new Date(request.created_at).toLocaleDateString()}</td><td>{request.capability}</td><td>{request.provider_name}</td><td>{request.status}</td><td>{request.decision_reason || '—'}</td></tr>)}</tbody></table></div>}
      </section>}

      {(activeSection === 'staff' || activeSection === 'delivery') && <div className="grid gap-5">
        {activeSection === 'staff' && <section id="settings-access" className="panel">
          <h2 className="mb-3 font-semibold">Staff access</h2>
          <form className="space-y-3" onSubmit={handleInvite}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name"><input className="field" name="name" required /></Field>
              <Field label="Email"><input className="field" name="email" type="email" required /></Field>
              <fieldset className="space-y-2 md:col-span-2">
                <legend className="text-sm font-medium">Role assignments</legend>
                <p className="muted text-xs">Choose one effective role for each location. Roles are evaluated for the active location and are never combined.</p>
                {reference.locations.map((location) => (
                  <div key={location.id} className="grid items-center gap-2 sm:grid-cols-[1fr_1fr]">
                    <label className="text-sm"><input name="assignment_location" type="checkbox" value={location.id} /> {location.name}</label>
                    <select className="field" name={`assignment_role:${location.id}`} aria-label={`${location.name} invitation role`} defaultValue={locationRoles[0]?.name}>
                      {locationRoles.map((role) => <option key={role.id} value={role.name}>{role.name}</option>)}
                    </select>
                  </div>
                ))}
                <div className="grid items-center gap-2 border-t border-[var(--border)] pt-2 sm:grid-cols-[1fr_1fr]">
                  <label className="text-sm"><input name="organization_scope" type="checkbox" /> Organization-wide access</label>
                  <select className="field" name="organization_role" aria-label="Organization-wide invitation role" defaultValue={organizationRoles[0]?.name}>
                    {organizationRoles.map((role) => <option key={role.id} value={role.name}>{role.name}</option>)}
                  </select>
                </div>
              </fieldset>
            </div>
            <button className="btn-secondary" disabled={busy}>Create invitation</button>
            {invitationToken && <p className="mt-2 break-all text-sm"><strong>One-time invitation token:</strong> {invitationToken}</p>}
          </form>
          <form className="mt-5 grid gap-2 md:grid-cols-4" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const filters = { search: String(form.get('search') || ''), status: String(form.get('status') || ''), role: String(form.get('role') || ''), location_id: String(form.get('location_id') || '') };
            setStaffFilters(filters);
            void loadAccess('staff', 1, staffPage.page_size, filters);
          }}>
            <Field label="Find staff"><input className="field" name="search" defaultValue={staffFilters.search} placeholder="Name or email" /></Field>
            <Field label="Status"><select className="field" name="status" defaultValue={staffFilters.status}><option value="">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>
            <Field label="Role"><select className="field" name="role" defaultValue={staffFilters.role}><option value="">All</option>{roles.map((role) => <option key={role.id} value={role.name}>{role.name}</option>)}</select></Field>
            <Field label="Location"><select className="field" name="location_id" defaultValue={staffFilters.location_id}><option value="">All</option>{reference.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
            <button className="btn-secondary md:col-span-4" disabled={busy}>Apply staff filters</button>
          </form>
          <div className="mt-5 overflow-auto">
            <table>
              <thead><tr><th>Staff</th><th>Effective roles / MFA</th><th>Active</th></tr></thead>
              <tbody>
                {staff.map((person) => (
                  <tr key={person.id}>
                    <td>{person.name}<p className="muted text-xs">{person.email}</p></td>
                    <td>
                      <div className="space-y-2">
                        {person.assignments.map((assignment) => (
                          <label key={assignment.id || `${assignment.scope}:${assignment.location_id}`} className="block text-xs">
                            <span>{assignment.scope === 'organization' ? 'Organization-wide' : reference.locations.find((location) => location.id === assignment.location_id)?.name || 'Location'}</span>
                            <select
                              aria-label={`${person.name} ${assignment.scope === 'organization' ? 'organization' : assignment.location_id} role`}
                              className="field mt-1"
                              value={assignment.role}
                              disabled={person.id === user.id}
                              onChange={(event) => void updateStaff(person, {
                                assignments: person.assignments.map((item) => item === assignment ? { ...item, role: event.target.value } : item),
                              })}
                            >
                              {(assignment.scope === 'organization' ? organizationRoles : locationRoles).map((role) => <option key={role.id} value={role.name}>{role.name}</option>)}
                            </select>
                          </label>
                        ))}
                      </div>
                      <span className="text-xs">{person.mfa_enabled ? 'MFA enrolled' : 'MFA pending'}</span>
                      {person.external_identity && <span className="ml-2 text-xs">External identity</span>}
                    </td>
                    <td>
                      <input aria-label={`${person.name} active`} type="checkbox" checked={person.active} disabled={person.id === user.id} onChange={(event) => void updateStaff(person, { active: event.target.checked })} />
                      {person.id !== user.id && !person.external_identity && <button type="button" className="btn-secondary ml-2" disabled={busy} onClick={() => void resetPassword(person)}>Reset password</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AccessPager page={staffPage} busy={busy} label="staff" onPage={(page) => void loadAccess('staff', page, staffPage.page_size, staffFilters)} onPageSize={(pageSize) => void loadAccess('staff', 1, pageSize, staffFilters)} />
          <h3 className="mb-2 mt-5 font-medium">Invitations</h3>
          <form className="mb-3 grid gap-2 md:grid-cols-4" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const filters = { search: String(form.get('search') || ''), status: String(form.get('status') || ''), role: String(form.get('role') || ''), location_id: String(form.get('location_id') || '') };
            setInvitationFilters(filters);
            void loadAccess('invitation', 1, invitationPage.page_size, filters);
          }}>
            <Field label="Find invitation"><input className="field" name="search" defaultValue={invitationFilters.search} placeholder="Name or email" /></Field>
            <Field label="Status"><select className="field" name="status" defaultValue={invitationFilters.status}><option value="">All</option>{['pending', 'accepted', 'expired', 'revoked'].map((status) => <option key={status}>{status}</option>)}</select></Field>
            <Field label="Role"><select className="field" name="role" defaultValue={invitationFilters.role}><option value="">All</option>{roles.map((role) => <option key={role.id} value={role.name}>{role.name}</option>)}</select></Field>
            <Field label="Location"><select className="field" name="location_id" defaultValue={invitationFilters.location_id}><option value="">All</option>{reference.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
            <button className="btn-secondary md:col-span-4" disabled={busy}>Apply invitation filters</button>
          </form>
          <div className="overflow-auto"><table><thead><tr><th>Invitee</th><th>Role assignments</th><th>Status</th><th>Actions</th></tr></thead><tbody>{invitations.map((invitation) => <tr key={invitation.id}><td>{invitation.name}<p className="muted text-xs">{invitation.email}</p></td><td>{invitation.assignments.map((assignment) => <p key={assignment.id || `${assignment.scope}:${assignment.location_id}`} className="text-xs"><strong>{assignment.role}</strong> · {assignment.scope === 'organization' ? 'Organization-wide' : reference.locations.find((location) => location.id === assignment.location_id)?.name || 'Location'}</p>)}</td><td>{invitation.status} · sent {invitation.resend_count + 1} time(s)</td><td>{['pending', 'expired'].includes(invitation.status) && <button type="button" className="btn-secondary" disabled={busy} onClick={() => void resendInvitation(invitation.id)}>Resend</button>} {invitation.status === 'pending' && <button type="button" className="btn-secondary" disabled={busy} onClick={() => void revokeInvitation(invitation.id)}>Revoke</button>}</td></tr>)}</tbody></table></div>
          <AccessPager page={invitationPage} busy={busy} label="invitations" onPage={(page) => void loadAccess('invitation', page, invitationPage.page_size, invitationFilters)} onPageSize={(pageSize) => void loadAccess('invitation', 1, pageSize, invitationFilters)} />
          <PatientInvitations />
        </section>}

        {activeSection === 'delivery' && <section id="settings-delivery" className="panel">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Notification delivery</h2>
            <button className="btn-secondary" disabled={busy} onClick={() => void dispatchNotifications()}>Run due jobs</button>
          </div>
          <table>
            <thead><tr><th>Created</th><th>Type</th><th>Status</th></tr></thead>
            <tbody>
              {messages.slice(0, 30).map((message) => (
                <tr key={message.id}>
                  <td>{new Date(message.created_at).toLocaleString()}</td>
                  <td>{message.kind}</td>
                  <td>
                    {message.status} · {message.attempts} attempts{' '}
                    {['failed', 'retry'].includes(message.status) && (
                      <button className="btn-secondary ml-2" onClick={() => void retryNotification(message.id)}>Retry</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>}
      </div>}

      {activeSection === 'templates' && <section id="settings-templates" className="panel">
        <h2 className="font-semibold">Communication templates</h2>
        <p className="muted mb-3 text-sm">Supported variables are validated by the server. Test messages use the configured email adapter and delivery outbox.</p>
        <div className="grid gap-4 md:grid-cols-[230px_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-lg border border-[var(--border)]" aria-label="Template catalogue">{Object.entries(templates).map(([key, template]) => <button key={key} type="button" aria-current={key === effectiveTemplateKey ? 'true' : undefined} className={`block w-full border-b border-[var(--border)] p-3 text-left last:border-b-0 ${key === effectiveTemplateKey ? 'bg-[var(--sage-tint)] text-[var(--sage-deep)]' : 'bg-[var(--surface)]'}`} onClick={() => setSelectedTemplateKey(key)}><strong className="block text-sm">{template.name}</strong><span className="muted text-xs">{template.channel.toUpperCase()} · {template.active ? 'Active' : 'Inactive'}</span></button>)}</div>
          {effectiveTemplateKey && <TemplateEditor key={effectiveTemplateKey} templateKey={effectiveTemplateKey} template={templates[effectiveTemplateKey]} busy={busy} onSave={(draft) => saveTemplate(effectiveTemplateKey, draft)} onTest={() => testTemplate(effectiveTemplateKey)} />}
        </div>
      </section>}

      {activeSection === 'audit' && <section id="settings-audit" className="panel">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold">Audit trail</h2><p className="muted text-sm">Filter the immutable log. CSV export uses the same active filters.</p></div>{user.permissions.includes('audit_export') && <button type="button" className="btn-secondary" onClick={() => void exportAudit()}>Export filtered CSV</button>}</div>
        <form className="mt-3 grid gap-2 md:grid-cols-4" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const filters = Object.fromEntries(Object.keys(emptyAuditFilters).map((key) => [key, String(form.get(key) || '')])) as unknown as AuditFilters;
          setAuditFilters(filters);
          void refreshAudit(filters.patient_id);
          void loadAudit(1, filters);
        }}>
          <Field label="Patient"><select className="field" name="patient_id" defaultValue={auditFilters.patient_id}><option value="">All patients</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.first_name} {patient.last_name}</option>)}</select></Field>
          <Field label="Actor ID"><input className="field" name="actor_id" defaultValue={auditFilters.actor_id} /></Field>
          <Field label="Action"><input className="field" name="action" defaultValue={auditFilters.action} /></Field>
          <Field label="Resource"><input className="field" name="resource" defaultValue={auditFilters.resource} /></Field>
          <Field label="Location"><select className="field" name="location_id" defaultValue={auditFilters.location_id}><option value="">All locations</option>{reference.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
          <Field label="Outcome"><select className="field" name="outcome" defaultValue={auditFilters.outcome}><option value="">All outcomes</option><option value="success">Success</option><option value="denied">Denied</option></select></Field>
          <Field label="From"><input className="field" name="start" type="date" defaultValue={auditFilters.start} /></Field>
          <Field label="To"><input className="field" name="end" type="date" defaultValue={auditFilters.end} /></Field>
          <button className="btn-secondary md:col-span-4" disabled={busy}>Apply audit filters</button>
        </form>
        <div className="mt-3 overflow-auto">
          <table>
            <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Resource</th></tr></thead>
            <tbody>
              {auditPage.items.map((event) => (
                <tr key={event.id}>
                  <td>{new Date(event.created_at).toLocaleString()}</td><td>{event.created_by}</td><td>{event.action}</td><td>{event.resource}</td>
                </tr>
              ))}
              {auditPage.items.length === 0 && <tr><td colSpan={4} className="muted">No audit events match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <AccessPager page={auditPage} busy={busy} label="events" onPage={(page) => void loadAudit(page)} onPageSize={(pageSize) => void loadAudit(1, auditFilters, pageSize)} />
      </section>}

      {activeSection === 'roles' && <RolesAccess domain="tenant" />}
    </>
  );
}
