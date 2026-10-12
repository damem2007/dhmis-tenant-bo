export const isSandboxEnvironment = ['development', 'sandbox', 'test'].includes(
  (import.meta.env.VITE_APP_ENVIRONMENT || '').toLowerCase(),
);

export const supportDestination = (import.meta.env.VITE_SUPPORT_URL || '').trim();
export const supportAdminDestination = (import.meta.env.VITE_SUPPORT_ADMIN_URL || '').trim();
export const supportEmail = (import.meta.env.VITE_SUPPORT_EMAIL || '').trim();
export const clinicAdministratorDestination = (import.meta.env.VITE_CLINIC_ADMIN_URL || '').trim();
export const guidesDestination = (import.meta.env.VITE_GUIDES_URL || '').trim();
