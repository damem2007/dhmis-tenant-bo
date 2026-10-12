import type { ReactNode } from 'react';

export const dentalServiceIconNames = [
  'checkup',
  'filling',
  'emergency',
  'whitening',
  'kids',
  'consult',
] as const;

export type DentalServiceIconName = (typeof dentalServiceIconNames)[number];

export const dentalServiceIconLabels: Record<DentalServiceIconName, string> = {
  checkup: 'Check-up tooth',
  filling: 'Filling tooth',
  emergency: 'Emergency care',
  whitening: 'Whitening sparkle',
  kids: 'Children’s dentistry',
  consult: 'Consultation',
};

const tooth = 'M7 3C4.8 3 3 4.8 3 7.3c0 2 .8 3.4 1.4 5.2.6 1.8.6 4.5 1.4 7 .3 1 1.6 1 2 0l1-3.5c.3-.9 1.9-.9 2.2 0l1 3.5c.4 1 1.7 1 2 0 .8-2.5.8-5.2 1.4-7 .6-1.8 1.4-3.2 1.4-5.2C21 4.8 19.2 3 17 3c-1.3 0-2.2.5-4 .5S8.3 3 7 3z';

const paths: Record<DentalServiceIconName, ReactNode> = {
  checkup: <><path d={tooth} /><path d="M8.5 9.5l2.2 2.2 4.3-4.3" /></>,
  filling: <><path d={tooth} /><circle cx="12" cy="8.5" r="1.7" /></>,
  emergency: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v9M7.5 12h9" /></>,
  whitening: <><path d="M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>,
  kids: <><circle cx="12" cy="12" r="9" /><circle cx="9" cy="10" r=".6" /><circle cx="15" cy="10" r=".6" /><path d="M8 14c1 1.6 2.4 2.4 4 2.4s3-.8 4-2.4" /></>,
  consult: <><path d="M4 5h16v11H9l-5 4z" /><path d="M8 9.5h8M8 12.5h5" /></>,
};

export function isDentalServiceIconName(value: string): value is DentalServiceIconName {
  return dentalServiceIconNames.includes(value as DentalServiceIconName);
}

export function DentalServiceIcon({ name, size = 26 }: { name: string; size?: number }) {
  const icon = isDentalServiceIconName(name) ? name : 'consult';
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[icon]}
    </svg>
  );
}
