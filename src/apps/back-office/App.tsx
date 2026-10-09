import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Calendar, ShieldCheck, Users, Wallet } from 'lucide-react';
import ClinicalDashboard from './ClinicalDashboard';
import { NAV_PATHS, navFromPath, settingsSectionFromPath, type NavKey, type TenantSettingsSection } from './navigation';
import { Patients } from './Patients';
import { Schedule } from './Schedule';
import { Billing } from './Billing';
import { Auth } from './Auth';
import { Settings } from './Settings';
import { Phase3Care } from './Phase3Care';
import { Reports } from './Reports';
import { Operations } from './Operations';
import { RoleDashboard } from './RoleDashboard';
import { Account } from './Account';
import { SiteEditor } from './SiteEditor';
import { Phase2Support } from './Phase2Support';
import { api, money, setActiveLocation, setToken } from '../../shared/api';
import { isSandboxEnvironment } from '../../shared/environment';
import type { TenantContext } from '../../shared/tenant';
import type {
  Appointment,
  Audit,
  Claim,
  Dashboard,
  Invoice,
  Patient,
  Reference,
  Service,
  User,
} from '../../shared/types';

type WorkspaceData = {
  patients: Patient[];
  appointments: Appointment[];
  invoices: Invoice[];
  services: Service[];
  claims: Claim[];
  dashboard: Dashboard;
  reference: Reference;
};

type UiState = {
  nav: NavKey;
  query: string;
  error: string;
  notice: string;
  busy: boolean;
  audit: Audit[];
  dark: boolean;
  settingsSection: TenantSettingsSection;
};

const initialUi: UiState = {
  nav: 'dashboard',
  query: '',
  error: '',
  notice: '',
  busy: false,
  audit: [],
  dark: false,
  settingsSection: 'practice',
};

export default function App({ tenant }: { tenant: TenantContext }) {
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [ui, setUi] = useState<UiState>(() => ({ ...initialUi, nav: navFromPath(tenant.slug), settingsSection: settingsSectionFromPath(tenant.slug) }));

  const patchUi = useCallback((next: Partial<UiState>) => {
    setUi((current) => ({ ...current, ...next }));
  }, []);

  const applyBranding = useCallback((branding: Record<string, string>) => {
    Object.entries(branding).forEach(([token, value]) => {
      document.documentElement.style.setProperty(token, value);
    });
  }, []);

  const logout = useCallback(() => {
    setToken('');
    setActiveLocation('');
    setUser(null);
    setData(null);
    setUi(initialUi);
  }, []);

  const refresh = useCallback(
    async (current: User | null = user) => {
      const [patients, appointments, invoices, services, claims, dashboard, reference] =
        await Promise.all([
          current?.permissions.includes('patients') ? api<Patient[]>('/patients') : Promise.resolve([]),
          current?.permissions.includes('scheduling')
            ? api<Appointment[]>('/appointments')
            : Promise.resolve([]),
          current?.permissions.includes('billing')
            ? api<Invoice[]>('/billing/invoices')
            : Promise.resolve([]),
          api<Service[]>('/billing/catalog'),
          current?.permissions.includes('claims') ? api<Claim[]>('/claims') : Promise.resolve([]),
          api<Dashboard>('/dashboard'),
          api<Reference>('/organization/reference'),
        ]);
      setData({ patients, appointments, invoices, services, claims, dashboard, reference });
    },
    [user],
  );

  const run = useCallback(
    async (action: () => Promise<void>) => {
      patchUi({ busy: true, error: '', notice: '' });
      try {
        await action();
        patchUi({ notice: 'Saved to the database.' });
      } catch (reason) {
        patchUi({ error: reason instanceof Error ? reason.message : 'Request failed' });
      } finally {
        patchUi({ busy: false });
      }
    },
    [patchUi],
  );

  const refreshAudit = useCallback(
    async (patientId = '') => {
      const suffix = patientId ? `?patient_id=${encodeURIComponent(patientId)}` : '';
      patchUi({ audit: await api<Audit[]>(`/organization/audit${suffix}`) });
    },
    [patchUi],
  );

  async function handleAuthenticated() {
    const current = await api<User>('/auth/me');
    setActiveLocation(current.selected_location_id || '');
    applyBranding(current.branding);
    await refresh(current);
    setUser(current);
  }

  async function handleSignOut() {
    await run(async () => {
      await api('/auth/logout', {});
      logout();
    });
  }

  async function switchLocation(locationId: string) {
    const previous = user?.selected_location_id || '';
    await run(async () => {
      setActiveLocation(locationId);
      try {
        const current = await api<User>('/auth/me');
        applyBranding(current.branding);
        await refresh(current);
        setUser(current);
        navigate('dashboard');
      } catch (error) {
        setActiveLocation(previous);
        throw error;
      }
    });
  }

  function navigate(nav: NavKey, historyMode: 'push' | 'replace' | 'none' = 'push') {
    const suffix = NAV_PATHS[nav];
    const target = `/${tenant.slug}/admin${suffix ? `/${suffix}` : ''}`;
    if (historyMode !== 'none' && window.location.pathname !== target) window.history[historyMode === 'replace' ? 'replaceState' : 'pushState']({}, '', target);
    patchUi({ nav });
  }

  function navigateSettings(section: TenantSettingsSection) {
    const target = `/${tenant.slug}/admin/settings/${section}`;
    if (window.location.pathname !== target) window.history.pushState({}, '', target);
    patchUi({ nav: 'settings', settingsSection: section });
  }

  function openAccount(section: 'profile' | 'password' | 'security') {
    navigate('account');
    window.setTimeout(() => document.getElementById(`account-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  function handleSearch(query: string) {
    patchUi({ query });
    navigate('patients');
  }

  useEffect(() => {
    const unauthorized = () => {
      logout();
      patchUi({ error: 'Session expired. Please sign in again.' });
    };
    window.addEventListener('dhmis:unauthorized', unauthorized);
    return () => window.removeEventListener('dhmis:unauthorized', unauthorized);
  }, [logout, patchUi]);

  useEffect(() => {
    const restoreRoute = () => patchUi({ nav: navFromPath(tenant.slug), settingsSection: settingsSectionFromPath(tenant.slug) });
    window.addEventListener('popstate', restoreRoute);
    return () => window.removeEventListener('popstate', restoreRoute);
  }, [tenant.slug]);

  useEffect(() => {
    document.documentElement.dataset.theme = ui.dark ? 'dark' : 'light';
  }, [ui.dark]);

  useEffect(() => {
    if (ui.nav === 'settings' && user) {
      void refreshAudit().catch((reason) => patchUi({ error: reason.message }));
    }
  }, [ui.nav, user, refreshAudit, patchUi]);

  if (!user) return <Auth tenant={tenant} onAuthenticated={handleAuthenticated} />;
  if (!data) return <p className="p-8">Loading workspace…</p>;
  const currentUser = user;
  const workspace = data;
  const assignedLocations = (currentUser.assignments || []).filter((assignment) => assignment.scope === 'location');

  const shared = {
    ...workspace,
    refresh: () => refresh(),
    run,
    busy: ui.busy,
    permissions: currentUser.permissions,
  };

  function renderWorkspace(): ReactNode {
    switch (ui.nav) {
      case 'patients':
        return <Patients {...shared} query={ui.query} />;
      case 'schedule':
        return <Schedule {...shared} />;
      case 'care':
        return <><Phase3Care patients={workspace.patients} reference={workspace.reference} permissions={currentUser.permissions} run={run} busy={ui.busy} /><Phase2Support patients={workspace.patients} run={run} busy={ui.busy} /></>;
      case 'billing':
        return <Billing {...shared} claimsOnly={false} />;
      case 'claims':
        return <Billing {...shared} claimsOnly />;
      case 'reports':
        return <Reports reference={workspace.reference} />;
      case 'operations':
        return <Operations reference={workspace.reference} permissions={currentUser.permissions} run={run} busy={ui.busy} refreshReference={() => refresh()} />;
      case 'site':
        return <SiteEditor tenant={tenant} user={currentUser} reference={workspace.reference} />;
      case 'settings':
        return (
          <Settings
            user={currentUser}
            reference={workspace.reference}
            audit={ui.audit}
            patients={workspace.patients}
            run={run}
            busy={ui.busy}
            refreshAudit={refreshAudit}
            basePath={`/${tenant.slug}/admin/settings`}
            onSectionChange={(section) => patchUi({ settingsSection: section })}
          />
        );
      case 'account':
        return <Account user={currentUser} busy={ui.busy} run={run} onProfileUpdated={async () => { const refreshed = await api<User>('/auth/me'); setUser(refreshed); }} onSignedOut={logout} />;
      case 'dashboard':
        return currentUser.permissions.includes('analytics')
          ? <RoleDashboard user={currentUser} reference={workspace.reference} schedule={workspace.dashboard.schedule} approvalsHref={`/${tenant.slug}/admin/settings/roles?tab=approvals`} />
          : undefined;
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--amber-tint)] px-4 py-2 text-xs text-[var(--ink)]">
        {isSandboxEnvironment && <><strong>Development sandbox</strong><span>Synthetic records · no live payments, claims, or signatures</span></>}
        <div className="ml-auto flex gap-3">
          {assignedLocations.length > 1 && (
            <label>
              <span className="sr-only">Active location</span>
              <select className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1" value={currentUser.selected_location_id || ''} disabled={ui.busy} onChange={(event) => void switchLocation(event.target.value)}>
                {assignedLocations.map((assignment) => <option key={assignment.id} value={assignment.location_id || ''}>{workspace.reference.locations.find((location) => location.id === assignment.location_id)?.name || 'Assigned location'} · {assignment.role}</option>)}
              </select>
            </label>
          )}
          {tenant.features.front_office && <a className="underline" href={`/${tenant.slug}`}>Front Office</a>}
          {tenant.features.patient_portal && <a className="underline" href={`/${tenant.slug}/portal`}>Client Portal</a>}
          <button onClick={() => patchUi({ dark: !ui.dark })}>
            {ui.dark ? 'Light theme' : 'Dark theme'}
          </button>
          <button disabled={ui.busy} onClick={() => void run(() => refresh())}>Refresh</button>
          <button onClick={() => void handleSignOut()}>Sign out</button>
        </div>
      </div>
      {ui.error && (
        <div role="alert" className="border-b border-[var(--danger)] bg-[var(--danger-tint)] px-6 py-3 text-sm">
          {ui.error}
        </div>
      )}
      {ui.notice && <div role="status" className="bg-[var(--sage-tint)] px-6 py-2 text-sm">{ui.notice}</div>}
      <ClinicalDashboard
        providerName={currentUser.name}
        role={currentUser.role}
        locationName={workspace.dashboard.location_name}
        dateLabel={workspace.dashboard.date_label}
        activeNav={ui.nav}
        onNavigate={navigate}
        activeSettingsSection={ui.settingsSection}
        onSettingsSection={navigateSettings}
        permissions={currentUser.permissions}
        onSearch={handleSearch}
        onNewAppointment={() => navigate('schedule')}
        onAccountSection={openAccount}
        onSignOut={() => void handleSignOut()}
        approvalsHref={`/${tenant.slug}/admin/settings/roles?tab=approvals`}
        schedule={workspace.dashboard.schedule}
        alerts={[]}
        metrics={[
          { label: "Today's visits", value: String(workspace.dashboard.schedule.length), deltaPct: 0, icon: Calendar, hue: 'blue' },
          { label: 'Patients', value: String(workspace.dashboard.patient_count), deltaPct: 0, icon: Users, hue: 'sage' },
          { label: 'Claims pending', value: String(workspace.dashboard.pending_claims ?? '—'), deltaPct: 0, icon: ShieldCheck, hue: 'amber' },
          { label: 'Outstanding balance', value: workspace.dashboard.balance_cents === null ? '—' : money(workspace.dashboard.balance_cents), deltaPct: 0, icon: Wallet, hue: 'violet' },
        ]}
      >
        {renderWorkspace()}
      </ClinicalDashboard>
    </>
  );
}
