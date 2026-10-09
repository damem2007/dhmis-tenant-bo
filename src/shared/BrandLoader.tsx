import { DhmisMark } from "./LogoMark";

export function BrandLoader({ size = 24, className = "" }: { size?: number | string; className?: string }) {
  return <span className={`brand-loader ${className}`.trim()} aria-hidden="true"><DhmisMark className="brand-loader-mark" size={size} /></span>;
}
