export type Surface = 'back-office' | 'public' | 'portal';

export interface TenantContext {
  organizationId: string;
  slug: string;
  name: string;
  source: 'platform-slug' | 'custom-domain' | 'organization-id';
  domain?: string;
  surface: Surface;
  features: {
    front_office: boolean;
    booking: boolean;
    patient_portal: boolean;
  };
  branding: Record<string, string>;
}

export interface HostedRoute {
  slug: string;
  surface: Surface;
  canonicalPath: string;
  legacy: boolean;
}

export function hostedRoute(pathname: string): HostedRoute | null {
  const segments = pathname.split('/').filter(Boolean);
  if (!segments.length) return null;
  const slug = segments[0];
  const section = segments[1];
  if (section === 'admin') {
    return { slug, surface: 'back-office', canonicalPath: pathname, legacy: false };
  }
  if (section === 'portal') {
    return { slug, surface: 'portal', canonicalPath: pathname, legacy: false };
  }
  if (section === 'patient') {
    const suffix = segments.slice(2).join('/');
    return {
      slug,
      surface: 'portal',
      canonicalPath: `/${slug}/portal${suffix ? `/${suffix}` : ''}`,
      legacy: true,
    };
  }
  if (section === 'public') {
    const suffix = segments.slice(2).join('/');
    return {
      slug,
      surface: 'public',
      canonicalPath: `/${slug}${suffix ? `/${suffix}` : ''}`,
      legacy: true,
    };
  }
  return { slug, surface: 'public', canonicalPath: pathname, legacy: false };
}

export function tenantPath(tenant: TenantContext, surface: Surface) {
  const suffix = surface === 'back-office' ? '/admin' : surface === 'portal' ? '/portal' : '';
  return `/${tenant.slug}${suffix}`;
}
