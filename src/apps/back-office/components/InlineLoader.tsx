import { BrandLoader } from './BrandLoader';

export function InlineLoader({ label, size = 20 }: { label: string; size?: number }) {
  return <span className="inline-loader" role="status" aria-live="polite" aria-busy="true"><BrandLoader size={size} /><span>{label}</span></span>;
}
