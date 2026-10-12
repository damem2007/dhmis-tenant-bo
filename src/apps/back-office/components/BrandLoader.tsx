export function BrandLoader({ size = 24, className = "" }: { size?: number | string; className?: string }) {
  return <span className={`brand-loader ${className}`.trim()} aria-hidden="true"><img className="brand-loader-mark" src="/assets/dhmis-logo-v2/svg/dhmis-loader-light.svg" width={size} height={size} alt="" /></span>;
}
