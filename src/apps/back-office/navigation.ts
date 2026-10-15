export type NavKey =
  | "dashboard"
  | "schedule"
  | "patients"
  | "patient-invitations"
  | "patient-communication"
  | "care"
  | "billing"
  | "claims"
  | "reports"
  | "operations"
  | "locations"
  | "staff"
  | "site"
  | "services"
  | "settings"
  | "account";

export type TenantSettingsSection =
  | "practice"
  | "integrations"
  | "staff"
  | "templates"
  | "audit"
  | "roles"
  | "notifications";

export const NAV_PATHS: Record<NavKey, string> = {
  dashboard: "",
  schedule: "schedule",
  patients: "patients",
  "patient-invitations": "patients/invitations",
  "patient-communication": "patients/communication",
  care: "care",
  billing: "billing",
  claims: "claims",
  reports: "reports",
  operations: "operations",
  locations: "locations",
  staff: "staff",
  site: "site-editor",
  services: "services",
  settings: "settings",
  account: "account",
};

const SETTINGS_SECTIONS: TenantSettingsSection[] = [
  "practice",
  "integrations",
  "staff",
  "templates",
  "audit",
  "roles",
  "notifications",
];

export function navFromPath(slug: string, pathname = window.location.pathname): NavKey {
  if (pathname.replace(new RegExp(`^/${slug}/admin/?`), "").startsWith("settings/services")) return "services";
  const tail = pathname.replace(new RegExp(`^/${slug}/admin/?`), "").split("/")[0];
  if (pathname.replace(new RegExp(`^/${slug}/admin/?`), "").startsWith("patients/communication")) return "patient-communication";
  if (pathname.replace(new RegExp(`^/${slug}/admin/?`), "").startsWith("patients/invitations")) return "patient-invitations";
  return (Object.entries(NAV_PATHS).find(([, path]) => path === tail)?.[0] as NavKey | undefined) || "dashboard";
}

export function settingsSectionFromPath(slug: string, pathname = window.location.pathname): TenantSettingsSection {
  const section = pathname.replace(new RegExp(`^/${slug}/admin/settings/?`), "").split("/")[0];
  return SETTINGS_SECTIONS.includes(section as TenantSettingsSection)
    ? (section as TenantSettingsSection)
    : "practice";
}
