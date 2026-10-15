import type { ReactNode } from "react";
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="label">
      {label}
      {children}
    </label>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted p-6 text-sm">{children}</p>;
}
export function Title({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className={actions ? "mb-6 flex flex-wrap items-start justify-between gap-4" : "mb-6"}>
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="muted mt-1 text-sm">{description}</p>
      </div>
      {actions}
    </div>
  );
}
