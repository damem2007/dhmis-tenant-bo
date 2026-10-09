export type NavKey =
  | "dashboard"
  | "schedule"
  | "patients"
  | "care"
  | "billing"
  | "claims"
  | "reports"
  | "operations"
  | "site"
  | "settings"
  | "account";

export type TenantSettingsSection =
  | "practice"
  | "integrations"
  | "staff"
  | "templates"
  | "audit"
  | "roles"
  | "delivery";

export const NAV_PATHS: Record<NavKey, string> = {
  dashboard: "",
  schedule: "schedule",
  patients: "patients",
  care: "care",
  billing: "billing",
  claims: "claims",
  reports: "reports",
  operations: "operations",
  site: "site-editor",
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
  "delivery",
];

export function navFromPath(slug: string, pathname = window.location.pathname): NavKey {
  const tail = pathname.replace(new RegExp(`^/${slug}/admin/?`), "").split("/")[0];
  return (Object.entries(NAV_PATHS).find(([, path]) => path === tail)?.[0] as NavKey | undefined) || "dashboard";
}

export function settingsSectionFromPath(slug: string, pathname = window.location.pathname): TenantSettingsSection {
  const section = pathname.replace(new RegExp(`^/${slug}/admin/settings/?`), "").split("/")[0];
  return SETTINGS_SECTIONS.includes(section as TenantSettingsSection)
    ? (section as TenantSettingsSection)
    : "practice";
}
