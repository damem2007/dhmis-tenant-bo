import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Home,
  Calendar,
  Users,
  FileText,
  HeartPulse,
  ShieldCheck,
  BarChart3,
  Settings,
  Building2,
  Globe2,
  Search,
  ChevronDown,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  Clock,
  type LucideIcon,
} from "lucide-react";
import {
  clinicAdministratorDestination,
  guidesDestination,
  isSandboxEnvironment,
  supportDestination,
  supportEmail,
} from "../../shared/environment";
import { ApprovalBell } from "../../shared/ApprovalBell";
import { nameInitials } from "../../shared/LogoMark";
import type { NavKey, TenantSettingsSection } from "./navigation";
export type { NavKey, TenantSettingsSection } from "./navigation";

/**
 * Back Office clinical dashboard — enterprise shell (top bar + grouped
 * sidebar) around the day's schedule, key metrics, and things needing
 * attention.
 *
 * Import into the Back Office (React + Vite) app, e.g.:
 *   import ClinicalDashboard from "./ClinicalDashboard";
 * and remember to import "../tokens/tokens.css" once at your app root.
 */

export interface ScheduleItem {
  time: string;
  patient: string;
  initials: string;
  procedure: string;
  provider: string;
  chair: string;
  status: "checked-in" | "confirmed" | "forms-pending";
}

export interface AlertItem {
  severity: "warning" | "danger";
  title: string;
  detail: string;
}

export type AccentHue = "sage" | "blue" | "amber" | "violet";

export interface DashboardMetric {
  label: string;
  value: string;
  deltaPct: number; // positive = up, negative = down
  icon: LucideIcon;
  hue: AccentHue;
}

const HUE_STYLE: Record<AccentHue, { bg: string; fg: string }> = {
  sage: { bg: "bg-[var(--sage-tint)]", fg: "text-[var(--sage-deep)]" },
  blue: { bg: "bg-[var(--blue-tint)]", fg: "text-[var(--blue)]" },
  amber: { bg: "bg-[var(--amber-tint)]", fg: "text-[var(--amber)]" },
  violet: { bg: "bg-[var(--violet-tint)]", fg: "text-[var(--violet)]" },
};

export interface ClinicalDashboardProps {
  permissions?: string[];
  children?: ReactNode;
  onSearch?: (query: string) => void;
  providerName: string;
  locationName: string;
  role?: string;
  activeNav?: NavKey;
  dateLabel?: string;
  metrics?: DashboardMetric[];
  schedule?: ScheduleItem[];
  alerts?: AlertItem[];
  onNavigate?: (key: NavKey) => void;
  activeSettingsSection?: TenantSettingsSection;
  onSettingsSection?: (section: TenantSettingsSection) => void;
  onNewAppointment?: () => void;
  onAccountSection?: (section: "profile" | "password" | "security") => void;
  onSignOut?: () => void;
  approvalsHref?: string;
}

interface NavGroup {
  label: string;
  items: { key: NavKey; label: string; icon: LucideIcon }[];
}

const NAV_GROUPS: NavGroup[] = [
  { label: "Overview", items: [{ key: "dashboard", label: "Dashboard", icon: Home }] },
  {
    label: "Clinical",
    items: [
      { key: "schedule", label: "Schedule", icon: Calendar },
      { key: "patients", label: "Patients", icon: Users },
      { key: "care", label: "Care workflows", icon: HeartPulse },
    ],
  },
  {
    label: "Practice",
    items: [
      { key: "billing", label: "Billing", icon: FileText },
      { key: "claims", label: "Claims", icon: ShieldCheck },
      { key: "reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    label: "Admin",
    items: [
      { key: "operations", label: "Operations", icon: Building2 },
      { key: "site", label: "Site editor", icon: Globe2 },
      { key: "settings", label: "Settings", icon: Settings },
    ],
  },
];

const NAV_PERMISSION: Partial<Record<NavKey, string>> = {
  schedule: "scheduling",
  patients: "patients",
  care: "clinical",
  billing: "billing",
  claims: "claims",
  reports: "reporting",
  operations: "operations",
  site: "settings",
  settings: "settings",
};

const STATUS_STYLE: Record<ScheduleItem["status"], string> = {
  "checked-in": "bg-[var(--sage-tint)] text-[var(--sage-deep)]",
  confirmed: "bg-[var(--blue-tint)] text-[var(--blue)]",
  "forms-pending": "bg-[var(--amber-tint)] text-[var(--amber)]",
};

const STATUS_LABEL: Record<ScheduleItem["status"], string> = {
  "checked-in": "Checked in",
  confirmed: "Confirmed",
  "forms-pending": "Forms pending",
};

export function ClinicalDashboard({
  permissions = [],
  children,
  onSearch,
  providerName,
  locationName,
  role = "Dentist",
  activeNav = "dashboard",
  dateLabel = "",
  metrics = [],
  schedule = [],
  alerts = [],
  onNavigate,
  activeSettingsSection = "practice",
  onSettingsSection,
  onNewAppointment,
  onAccountSection,
  onSignOut,
  approvalsHref = "/admin/settings/roles?tab=approvals",
}: ClinicalDashboardProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [supportMessage, setSupportMessage] = useState("");
  const helpRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function dismiss(event: MouseEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof MouseEvent
        && (helpRef.current?.contains(event.target as Node) || accountRef.current?.contains(event.target as Node))
      ) return;
      setHelpOpen(false);
      setAccountOpen(false);
    }
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, []);
  useEffect(() => {
    const menu = helpOpen ? helpRef.current : accountOpen ? accountRef.current : null;
    menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [helpOpen, accountOpen]);
  function unavailable(label: string) {
    setSupportMessage(`${label} has not been configured for this clinic. Ask an organization administrator to configure it in Settings.`);
  }
  function supportItem(label: string, destination: string) {
    return destination
      ? <a href={destination} role="menuitem" onClick={() => setHelpOpen(false)}>{label}</a>
      : <button type="button" role="menuitem" onClick={() => unavailable(label)}>{label}</button>;
  }
  const initials = nameInitials(providerName);

  return (
    <div className="min-h-screen bg-[var(--paper)] font-[var(--font-ui)] text-[var(--ink)]">
      {isSandboxEnvironment && <div className="staff-sandbox"><strong>Development sandbox</strong> · Synthetic records · no live payments, claims, or signatures</div>}
      {/* Top bar */}
      <header className="flex h-14 items-center gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-[var(--paper)]"
        >
          DHMIS
          <span className="text-[var(--ink-faint)]">·</span>
          <span className="text-[var(--ink-muted)]">{locationName}</span>
          <ChevronDown size={14} className="text-[var(--ink-faint)]" aria-hidden="true" />
        </button>

        <label className="relative ml-2 hidden max-w-sm flex-1 sm:block">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Search patients…"
            onChange={(event) => onSearch?.(event.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--paper)] py-1.5 pl-9 pr-3 text-sm outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--sage)]"
          />
        </label>

        <div className="ml-auto flex items-center gap-3">
          <div className="staff-help" ref={helpRef}>
            <button type="button" aria-haspopup="menu" aria-expanded={helpOpen} onClick={() => { setAccountOpen(false); setSupportMessage(""); setHelpOpen((current) => !current); }} className="rounded-md px-2 py-1 text-xs font-semibold text-[var(--ink-muted)] hover:bg-[var(--paper)]">? Help</button>
            {helpOpen && <div className="staff-help-menu" role="menu"><strong>Help &amp; support</strong><span>All systems operational</span>{supportItem("Contact DHMIS support", supportDestination)}{supportItem("Email support", supportEmail ? `mailto:${supportEmail}` : "")}{supportItem("Ask my clinic administrator", clinicAdministratorDestination)}{supportItem("Guides & how-tos", guidesDestination)}{supportMessage && <span role="status">{supportMessage}</span>}<small>Do not include patient names or health details in a support request. The page and time may be attached automatically.</small></div>}
          </div>
          <ApprovalBell domain="tenant" approvalsHref={approvalsHref} />
          <div className="h-6 w-px bg-[var(--border)]" />
          <div className="staff-help" ref={accountRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            onClick={() => { setHelpOpen(false); setAccountOpen((current) => !current); }}
            className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-[var(--paper)]"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--sage-tint)] text-xs font-medium text-[var(--sage-deep)]">
              {initials}
            </span>
            <span className="hidden text-left text-xs leading-tight sm:block">
              <span className="block font-medium">{providerName}</span>
              <span className="block text-[var(--ink-muted)]">{role}</span>
            </span>
            <ChevronDown size={14} className="text-[var(--ink-faint)]" aria-hidden="true" />
          </button>
          {accountOpen && <div className="staff-help-menu" role="menu"><small>{providerName} · {role}</small><button role="menuitem" onClick={() => { setAccountOpen(false); onAccountSection?.("profile"); }}>My profile</button><button role="menuitem" onClick={() => { setAccountOpen(false); onAccountSection?.("password"); }}>Change password</button><button role="menuitem" onClick={() => { setAccountOpen(false); onAccountSection?.("security"); }}>Security &amp; MFA</button><hr />{supportItem("Contact support", supportDestination)}{supportItem("Guides & how-tos", guidesDestination)}{supportMessage && <span role="status">{supportMessage}</span>}<hr /><button role="menuitem" onClick={() => { setAccountOpen(false); onSignOut?.(); }}>Sign out</button></div>}
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <nav className="hidden w-52 shrink-0 border-r border-[var(--border)] p-3 md:block" aria-label="Primary">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="mb-1.5 px-3 text-xs font-medium text-[var(--ink-faint)]">{group.label}</p>
              <ul className="flex flex-col gap-0.5">
                {group.items.filter((item) => item.key === "dashboard" || permissions.includes(NAV_PERMISSION[item.key] || item.key)).map(({ key, label, icon: Icon }) => {
                  const active = key === activeNav;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        aria-current={active ? "page" : undefined}
                        onClick={() => onNavigate?.(key)}
                        className={
                          "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors " +
                          (active
                            ? "bg-[var(--sage-tint)] font-medium text-[var(--sage-deep)]"
                            : "text-[var(--ink-muted)] hover:bg-[var(--paper)]")
                        }
                      >
                        <Icon size={16} aria-hidden="true" />
                        {label}
                      </button>
                      {key === "settings" && activeNav === "settings" && (
                        <ul className="ml-5 mt-1 border-l border-[var(--border)] pl-2">
                          {([
                            ["practice", "Practice policy"],
                            ["integrations", "Integrations"],
                            ["staff", "Staff & invitations"],
                            ["templates", "Message templates"],
                            ["audit", "Audit trail"],
                            ["roles", "Roles & access"],
                          ] as [TenantSettingsSection, string][]).map(([section, sectionLabel]) => (
                            <li key={section}>
                              <button type="button" aria-current={activeSettingsSection === section ? "page" : undefined} onClick={() => onSettingsSection?.(section)} className={`w-full rounded-r-md px-2 py-1.5 text-left text-xs ${activeSettingsSection === section ? "font-semibold text-[var(--sage-deep)]" : "text-[var(--ink-muted)] hover:bg-[var(--paper)]"}`}>{sectionLabel}</button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <div className="staff-need-hand">Need a hand?<button type="button" onClick={() => { setSupportMessage(""); setHelpOpen(true); }}>Contact support</button></div>
        </nav>

        {/* Main content */}
        <main className="min-w-0 flex-1 p-4 md:p-6">
          {children ?? <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-lg font-medium">Good morning, {providerName}</p>
              <p className="flex items-center gap-1.5 text-sm text-[var(--ink-muted)]">
                <Clock size={13} aria-hidden="true" />
                {dateLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={onNewAppointment}
              className="flex items-center gap-1.5 rounded-md bg-[var(--sage)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--sage-deep)]"
            >
              <Plus size={16} aria-hidden="true" />
              New appointment
            </button>
          </div>

          {/* Metrics */}
          <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Key metrics">
            {metrics.map((m) => {
              const Icon = m.icon;
              const up = m.deltaPct >= 0;
              const hueStyle = HUE_STYLE[m.hue];
              return (
                <div
                  key={m.label}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs text-[var(--ink-muted)]">{m.label}</p>
                    <span className={`flex h-6 w-6 items-center justify-center rounded-md ${hueStyle.bg}`}>
                      <Icon size={14} className={hueStyle.fg} aria-hidden="true" />
                    </span>
                  </div>
                  <p className="mb-1 text-2xl font-medium">{m.value}</p>
                  {m.deltaPct !== 0 && (
                    <p
                      className={
                        "flex items-center gap-1 text-xs font-medium " +
                        (up ? "text-[var(--success)]" : "text-[var(--danger)]")
                      }
                    >
                      {up ? (
                        <ArrowUpRight size={13} aria-hidden="true" />
                      ) : (
                        <ArrowDownRight size={13} aria-hidden="true" />
                      )}
                      {Math.abs(m.deltaPct)}% vs last week
                    </p>
                  )}
                </div>
              );
            })}
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Schedule */}
            <section
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] lg:col-span-2"
              aria-label="Today's schedule"
            >
              <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                <p className="text-sm font-medium">Today's schedule</p>
                <button type="button" onClick={() => onNavigate?.("schedule")} className="text-xs font-medium text-[var(--sage)] hover:underline">
                  View full calendar
                </button>
              </div>
              <ul>
                {schedule.length === 0 && <li className="p-4 text-sm text-[var(--ink-muted)]">No appointments scheduled today.</li>}
                {schedule.map((item, i) => (
                  <li
                    key={`${item.time}-${item.patient}-${i}`}
                    className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 text-sm last:border-b-0 hover:bg-[var(--paper)]"
                  >
                    <span className="w-11 shrink-0 text-[var(--ink-muted)]">{item.time}</span>
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ${STATUS_STYLE[item.status]}`}
                    >
                      {item.initials}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.patient}</span>
                      <span className="block truncate text-xs text-[var(--ink-muted)]">
                        {item.procedure} · {item.provider} · {item.chair}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-xs ${STATUS_STYLE[item.status]}`}
                    >
                      {STATUS_LABEL[item.status]}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {/* Alerts */}
            <section
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)]"
              aria-label="Needs attention"
            >
              <div className="border-b border-[var(--border)] px-4 py-3">
                <p className="text-sm font-medium">Needs attention</p>
              </div>
              <ul>
                {alerts.length === 0 && <li className="p-4 text-sm text-[var(--ink-muted)]">No alerts for this milestone.</li>}
                {alerts.map((alert, i) => (
                  <li
                    key={i}
                    className={
                      "flex gap-2.5 border-l-2 px-4 py-3 text-sm " +
                      (alert.severity === "danger"
                        ? "border-l-[var(--danger)]"
                        : "border-l-[var(--amber)]")
                    }>
                    <AlertTriangle
                      size={15}
                      className={
                        "mt-0.5 shrink-0 " +
                        (alert.severity === "danger" ? "text-[var(--danger)]" : "text-[var(--amber)]")
                      }
                      aria-hidden="true"
                    />
                    <span>
                      <span className="block font-medium leading-snug">{alert.title}</span>
                      <span className="block text-xs text-[var(--ink-muted)]">{alert.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>}
        </main>
      </div>
      <nav className="staff-mobile-nav" aria-label="Staff sections">
        {NAV_GROUPS.flatMap((group) => group.items)
          .filter((item) => item.key === "dashboard" || permissions.includes(NAV_PERMISSION[item.key] || item.key))
          .map(({ key, label, icon: Icon }) => <button key={key} type="button" aria-current={key === activeNav ? "page" : undefined} onClick={() => onNavigate?.(key)}><Icon size={16} />{label}</button>)}
      </nav>
    </div>
  );
}

export default ClinicalDashboard;
