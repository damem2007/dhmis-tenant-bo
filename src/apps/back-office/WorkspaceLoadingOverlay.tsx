import { BrandLoader } from './components/BrandLoader';

export function WorkspaceLoadingOverlay({
  label = 'Loading',
}: {
  label?: string;
}) {
  return (
    <div className="tenant-loading-overlay" role="status" aria-label={label} aria-live="polite" aria-busy="true">
      <div className="tenant-loading-overlay-card">
        <BrandLoader size={56} />
      </div>
    </div>
  );
}
