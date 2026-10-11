import { BrandLoader } from '../../shared/BrandLoader';

export function WorkspaceLoadingOverlay({
  label = 'Loading your clinic workspace…',
  detail = 'Fetching your authorized dashboard and patient data.',
}: {
  label?: string;
  detail?: string;
}) {
  return (
    <div className="tenant-loading-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="tenant-loading-overlay-card">
        <BrandLoader size={56} />
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}
