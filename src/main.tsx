import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './apps/back-office/App';
import { setTenantSlug } from './apps/back-office/lib/api';
import type { TenantContext } from './apps/back-office/lib/tenant';
import { installFormEnhancements } from './formEnhancements';
import { BrandLoader } from './apps/back-office/components/BrandLoader';
import './styles/global.css';

function tenantSlugFromHostname(hostname: string) {
  const labels = hostname.split('.').filter(Boolean);
  if (labels[0] === 'admin' && labels.length >= 3) return labels[1];
  return labels[0] || '';
}

function TenantAdminEntry() {
  const fallback: TenantContext = {
    organizationId: import.meta.env.VITE_DEFAULT_TENANT_ID || '',
    slug: import.meta.env.VITE_DEFAULT_TENANT_SLUG || tenantSlugFromHostname(window.location.hostname),
    name: import.meta.env.VITE_DEFAULT_TENANT_SLUG || tenantSlugFromHostname(window.location.hostname),
    source: 'platform-slug',
    surface: 'back-office',
    features: { front_office: true, booking: true, patient_portal: true },
    branding: {},
    logoUrl: '',
  };
  const [tenant, setTenant] = useState<TenantContext | null>(null);

  useEffect(() => {
    const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
    const query = new URLSearchParams({ surface: 'back-office' });
    if (fallback.slug) query.set('slug', fallback.slug);
    else query.set('hostname', window.location.hostname);
    fetch(`${apiBase}/v1/tenants/resolve?${query}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(typeof payload?.detail === 'string' ? payload.detail : 'Clinic route was not found or is not enabled.');
        setTenant({
          ...fallback,
          organizationId: payload.organization_id || fallback.organizationId,
          slug: payload.slug || fallback.slug,
          name: payload.name || fallback.name,
          source: payload.source || fallback.source,
          domain: payload.domain || undefined,
          features: payload.features || fallback.features,
          branding: payload.branding || fallback.branding,
          logoUrl: payload.logo_url || fallback.logoUrl,
        });
      })
      .catch((reason) => {
        void reason;
        setTenant(fallback);
      });
  }, []);

  useEffect(() => {
    if (tenant) setTenantSlug(tenant.slug);
  }, [tenant]);

  if (!tenant) return <div className="tenant-route-loading" role="status" aria-label="Loading clinic"><BrandLoader size={42} /><strong>DHMIS</strong><span>Loading tenant workspace…</span></div>;
  return <App tenant={tenant} />;
}

installFormEnhancements();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><TenantAdminEntry /></React.StrictMode>,
);
