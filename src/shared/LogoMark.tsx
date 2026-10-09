import { forwardRef } from "react";
import type { SVGProps } from "react";

type DhmisMarkProps = SVGProps<SVGSVGElement> & { size?: number | string };

export const DhmisMark = forwardRef<SVGSVGElement, DhmisMarkProps>(
  ({ size = 24, ...props }, ref) => (
    <svg 
    ref={ref}
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 64 64" 
    width={size} 
    height={size}
    {...props} 
    role="img" 
    aria-label="Loading">
  <path d="M32 17.5C28 13 20 11.5 16.5 17C13.5 22 15.5 30 18 37C20 43 20.5 50 24 52C27 53.5 28.5 46 32 43C35.5 46 37 53.5 40 52C43.5 50 44 43 46 37C48.5 30 50.5 22 47.5 17C44 11.5 36 13 32 17.5Z" fill="none" stroke="#0b8a55" strokeOpacity=".35" strokeWidth="2.4" strokeLinejoin="round"/>
  <g stroke="#0b8a55" strokeOpacity=".3" strokeWidth="1.7" strokeLinecap="round">
    <line x1="32" y1="29" x2="23.5" y2="22"/>
    <line x1="32" y1="29" x2="40.5" y2="22"/>
    <line x1="32" y1="29" x2="32" y2="38"/>
  </g>
  <circle cx="23.5" cy="22" r="2.6" fill="#0b8a55" fillOpacity=".3"><animate attributeName="fillOpacity" values=".3;1;.3" dur="1.2s" begin="0s" repeatCount="indefinite"/></circle>
  <circle cx="40.5" cy="22" r="2.6" fill="#0b8a55" fillOpacity=".3"><animate attributeName="fillOpacity" values=".3;1;.3" dur="1.2s" begin="0.2s" repeatCount="indefinite"/></circle>
  <circle cx="32" cy="38" r="2.6" fill="#0b8a55" fillOpacity=".3"><animate attributeName="fillOpacity" values=".3;1;.3" dur="1.2s" begin="0.4s" repeatCount="indefinite"/></circle>
  <circle cx="32" cy="29" r="3.8" fill="#0b8a55" fillOpacity=".3"><animate attributeName="fillOpacity" values=".3;1;.3" dur="1.2s" begin="0.6s" repeatCount="indefinite"/></circle>
</svg>
  ),
);

DhmisMark.displayName = "DhmisMark";

export function nameInitials(name: string) {
  const parts = name.split(" ");
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  //return parts[0].charAt(0).toUpperCase() + parts[1].charAt(0).toUpperCase();

  return parts.map((p) => p[0])
    .filter(Boolean)
    .slice(-2)
    .join("")
    .toUpperCase();
}