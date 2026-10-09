import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './apps/back-office/App';
import { setTenantSlug } from './shared/api';
import type { TenantContext } from './shared/tenant';
import { installFormEnhancements } from './formEnhancements';
import './styles/global.css';

const tenant: TenantContext = {
  organizationId: import.meta.env.VITE_DEFAULT_TENANT_ID || '',
  slug: import.meta.env.VITE_DEFAULT_TENANT_SLUG || window.location.hostname.split('.')[0],
  name: '',
  source: 'platform-slug',
  surface: 'back-office',
  features: { front_office: true, booking: true, patient_portal: true },
  branding: {},
};

setTenantSlug(tenant.slug);
installFormEnhancements();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App tenant={tenant} /></React.StrictMode>,
);
