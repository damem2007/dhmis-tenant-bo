import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Calendar, ShieldCheck, Users, Wallet } from 'lucide-react';
import ClinicalDashboard from './ClinicalDashboard';
import { NAV_PATHS, navFromPath, settingsSectionFromPath, type NavKey, type TenantSettingsSection } from './navigation';
import { Patients } from './Patients';
import { PatientInvitations } from './PatientInvitations';
import { Schedule } from './Schedule';
import { Billing } from './Billing';
import { Auth } from './Auth';
import { Settings } from './Settings';
import { Phase3Care } from './Phase3Care';
import { Reports } from './Reports';
import { Operations } from './Operations';
import { RoleDashboard } from './RoleDashboard';
import { Account } from './Account';
import { WorkspaceLoadingOverlay } from './WorkspaceLoadingOverlay';
import { SiteEditor } from './SiteEditor';
import { ServiceCatalogue } from './ServiceCatalogue';
import { Phase2Support } from './Phase2Support';
import type { ApprovalNotification } from './components/ApprovalBell';
import { api, hasToken, money, setActiveLocation, setToken } from './lib/api';
import { isSandboxEnvironment } from './lib/environment';
import type { TenantContext } from './lib/tenant';
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
} from './types';

type WorkspaceData = {
  patients: Patient[];
  appointments: Appointment[];
  invoices: Invoice[];
  services: Service[];
  claims: Claim[];
  dashboard: Dashboard;
  reference: Reference;
};

function tenantWebOrigin() {
  const configured = (import.meta.env.VITE_TENANT_WEB_ORIGIN || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const url = new URL(window.location.href);
  const hostname = url.hostname.replace(/^admin\./, '');
  return `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ''}`;
}

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
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [sessionRestoring, setSessionRestoring] = useState(() => hasToken());
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
    async (action: () => Promise<void>, successMessage = 'Saved to the database.') => {
      patchUi({ busy: true, error: '', notice: '' });
      try {
        await action();
        patchUi({ notice: successMessage });
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
    setWorkspaceLoading(true);
    try {
      const current = await api<User>('/auth/me');
      setActiveLocation(current.selected_location_id || '');
      applyBranding(current.branding);
      await refresh(current);
      setUser(current);
    } finally {
      setWorkspaceLoading(false);
    }
  }

  useEffect(() => {
    if (!hasToken()) {
      setSessionRestoring(false);
      return;
    }
    let active = true;
    void handleAuthenticated()
      .catch(() => {
        setToken('');
        if (active) setUi((current) => ({ ...current, error: '' }));
      })
      .finally(() => {
        if (active) setSessionRestoring(false);
      });
    return () => {
      active = false;
    };
  }, [tenant.slug]);

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

  function openNotification(item: ApprovalNotification) {
    if (!item.thread_id) return;
    navigate('care');
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('dhmis:open-message', { detail: { threadId: item.thread_id } })), 0);
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

  if (!user) return <>{!sessionRestoring && <Auth tenant={tenant} onAuthenticated={handleAuthenticated} />}{(sessionRestoring || workspaceLoading) && <WorkspaceLoadingOverlay />}</>;
  if (!data) return <WorkspaceLoadingOverlay />;
  const currentUser = user;
  const workspace = data;
  const assignedLocations = (currentUser.assignments || []).filter((assignment) => assignment.scope === 'location');
  const tenantWebBase = tenantWebOrigin();

  const workspaceProps = {
    ...workspace,
    refresh: () => refresh(),
    run,
    busy: ui.busy,
    permissions: currentUser.permissions,
  };

  function renderWorkspace(): ReactNode {
    switch (ui.nav) {
      case 'patients':
        return <Patients {...workspaceProps} query={ui.query} />;
      case 'patient-invitations':
        return <PatientInvitations />;
      case 'schedule':
        return <Schedule {...workspaceProps} />;
      case 'care':
        return <><Phase3Care patients={workspace.patients} reference={workspace.reference} permissions={currentUser.permissions} run={run} busy={ui.busy} /><Phase2Support patients={workspace.patients} run={run} busy={ui.busy} /></>;
      case 'billing':
        return <Billing {...workspaceProps} claimsOnly={false} />;
      case 'claims':
        return <Billing {...workspaceProps} claimsOnly />;
      case 'reports':
        return <Reports reference={workspace.reference} />;
      case 'operations':
        return <Operations reference={workspace.reference} permissions={currentUser.permissions} run={run} busy={ui.busy} refreshReference={() => refresh()} />;
      case 'site':
        return <SiteEditor tenant={tenant} user={currentUser} reference={workspace.reference} />;
      case 'services':
        return <ServiceCatalogue services={workspace.services} run={run} refresh={workspaceProps.refresh} />;
      case 'settings':
      case 'staff':
        return <Settings
            user={currentUser}
            reference={workspace.reference}
            audit={ui.audit}
            patients={workspace.patients}
            refresh={workspaceProps.refresh}
            run={run}
            busy={ui.busy}
            refreshAudit={refreshAudit}
            basePath={`/${tenant.slug}/admin/settings`}
            activeSection={ui.nav === 'staff' ? 'staff' : ui.settingsSection}
            onSectionChange={(section) => patchUi({ settingsSection: section })}
          />;
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
      {(isSandboxEnvironment || ui.error || ui.notice || assignedLocations.length > 1) && <div className="staff-sandbox">
        <div className="staff-sandbox-main">
          {isSandboxEnvironment && <><strong>Development sandbox</strong><span> · Synthetic records · no live payments, claims, or signatures</span></>}
          {ui.error && <span className="staff-sandbox-response is-error" role="alert">{ui.error}</span>}
          {ui.notice && <span className="staff-sandbox-response" role="status">{ui.notice}</span>}
        </div>
        <div className="staff-sandbox-actions">
          {assignedLocations.length > 1 && (
            <label>
              <span className="sr-only">Active location</span>
              <select className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1" value={currentUser.selected_location_id || ''} disabled={ui.busy} onChange={(event) => void switchLocation(event.target.value)}>
                {assignedLocations.map((assignment) => <option key={assignment.id} value={assignment.location_id || ''}>{workspace.reference.locations.find((location) => location.id === assignment.location_id)?.name || 'Assigned location'} · {assignment.role}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>}
      <ClinicalDashboard
        organizationName={tenant.name}
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
        onOpenNotification={openNotification}
        approvalsHref={`/${tenant.slug}/admin/settings/roles?tab=approvals`}
        frontOfficeHref={tenant.features.front_office ? `${tenantWebBase}/` : undefined}
        patientPortalHref={tenant.features.patient_portal ? `${tenantWebBase}/${tenant.slug}/portal` : undefined}
        dark={ui.dark}
        onToggleTheme={() => patchUi({ dark: !ui.dark })}
        refreshBusy={ui.busy}
        onRefresh={() => void run(() => refresh(), 'Workspace refreshed.')}
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
