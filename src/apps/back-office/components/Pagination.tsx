import type { ChangeEvent } from 'react';

/** The page sizes exposed by list screens. These mirror the Supabase table control. */
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 500, 1000] as const;
export const DEFAULT_PAGE_SIZE: number = 25;

type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  pages?: number;
  label?: string;
  busy?: boolean;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
};

/** Render a consistent API-driven paginator with bounded, user-selectable page sizes. */
export function Pagination({ page, pageSize, total, pages, label = 'records', busy = false, onPage, onPageSize }: PaginationProps) {
  const totalPages = Math.max(1, pages || Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = total === 0 ? 0 : Math.min(total, page * pageSize);
  const changePage = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    if (Number.isInteger(next) && next >= 1 && next <= totalPages) onPage(next);
  };
  return (
    <nav className="mt-3 flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm" aria-label={`${label} pagination`}>
      <span>{first}–{last} of {total.toLocaleString()} {label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">Rows
          <select className="field inline-block w-auto" aria-label={`${label} per page`} value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))} disabled={busy}>
            {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <span className="flex items-center gap-1">Page
          <input className="field inline-block w-16 text-center" type="number" min={1} max={totalPages} value={page} onChange={changePage} aria-label={`Current ${label} page`} disabled={busy || totalPages <= 1} />
          <span>of {totalPages}</span>
        </span>
        <button type="button" className="btn-secondary min-w-11" aria-label="Previous page" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>←</button>
        <button type="button" className="btn-secondary min-w-11" aria-label="Next page" disabled={busy || page >= totalPages} onClick={() => onPage(page + 1)}>→</button>
      </div>
    </nav>
  );
}
