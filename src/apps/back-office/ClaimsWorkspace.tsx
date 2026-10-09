import { useEffect, useState, type FormEvent } from "react";
import { api, money } from "../../shared/api";
import { Field, Title, Empty } from "../../shared/Fields";
import type {
  Patient,
  Invoice,
  Claim,
  InsurancePlan,
  Reference,
} from "../../shared/types";
export function ClaimsWorkspace({
  patients,
  invoices,
  claims,
  run,
  busy,
  refresh,
  reference,
}: {
  patients: Patient[];
  invoices: Invoice[];
  claims: Claim[];
  run: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  refresh: () => Promise<void>;
  reference: Reference;
}) {
  const [state, setState] = useState<{
    plans: Record<string, InsurancePlan[]>;
    error: string;
  }>({ plans: {}, error: "" });
  const [claimPage, setClaimPage] = useState<{
    page: number;
    page_size: number;
    total: number;
    items: Claim[];
  }>({ page: 1, page_size: 25, total: 0, items: [] });
  const [filters, setFilters] = useState({ status: "", patient_id: "", location_id: "" });

  async function loadClaims(page = 1, pageSize = claimPage.page_size) {
    const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    Object.entries(filters).forEach(([key, value]) => value && query.set(key, value));
    setClaimPage(await api(`/claims/query?${query}`));
  }
  useEffect(() => {
    Promise.all(
      patients.map(
        async (p) =>
          [p.id, await api<InsurancePlan[]>(`/claims/plans/${p.id}`)] as const,
      ),
    )
      .then((values) => setState({ plans: Object.fromEntries(values), error: "" }))
      .catch((reason) => setState((current) => ({ ...current, error: reason.message })));
  }, [patients]);
  useEffect(() => {
    void loadClaims(1).catch((reason) => setState((current) => ({ ...current, error: reason.message })));
  }, [filters.status, filters.patient_id, filters.location_id]);

  async function submitClaim(event: FormEvent<HTMLFormElement>, invoiceId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api("/claims", {
        invoice_id: invoiceId,
        plan_id: form.get("plan"),
        idempotency_key: `claim:${invoiceId}:${form.get("plan")}`,
      });
      await refresh();
    });
  }

  async function advanceClaim(claimId: string) {
    await run(async () => {
      await api(`/claims/${claimId}/adjudicate`, {});
      await refresh();
      await loadClaims(claimPage.page);
    });
  }

  async function reconcileClaim(claimId: string) {
    await run(async () => {
      await api(`/claims/${claimId}/reconcile`, {});
      await refresh();
      await loadClaims(claimPage.page);
    });
  }

  async function appealClaim(event: FormEvent<HTMLFormElement>, claimId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api(`/claims/${claimId}/appeal`, { reason: form.get("reason") });
      await refresh();
      await loadClaims(claimPage.page);
    });
  }
  return (
    <>
      <Title
        title="Insurance claims"
        description="Provider-neutral claims workflow. Phase 1 uses simulated Canadian or US adapters selected in Settings."
      />
      {state.error && <p role="alert">{state.error}</p>}
      <section className="panel mb-5">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="mr-auto"><h2 className="font-semibold">Claims worklist</h2><p className="muted text-sm">Filtered and paginated by the server within your selected tenant and location scope.</p></div>
          <Field label="Status"><select className="field" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">All</option>{['submitted', 'adjudicated', 'paid', 'denied', 'appealed', 'review_required'].map((status) => <option key={status}>{status}</option>)}</select></Field>
          <Field label="Patient"><select className="field" value={filters.patient_id} onChange={(event) => setFilters((current) => ({ ...current, patient_id: event.target.value }))}><option value="">All</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.first_name} {patient.last_name}</option>)}</select></Field>
          <Field label="Location"><select className="field" value={filters.location_id} onChange={(event) => setFilters((current) => ({ ...current, location_id: event.target.value }))}><option value="">All assigned</option>{reference.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
          <Field label="Rows"><select className="field" value={claimPage.page_size} onChange={(event) => void loadClaims(1, Number(event.target.value))}>{[10, 25, 50, 100].map((size) => <option key={size}>{size}</option>)}</select></Field>
        </div>
        <div className="overflow-auto"><table><thead><tr><th>Created</th><th>Reference</th><th>Network</th><th>Status</th><th>Submitted</th></tr></thead><tbody>{claimPage.items.map((claim) => <tr key={claim.id}><td>{new Date(claim.created_at).toLocaleString()}</td><td>{claim.reference || claim.id}</td><td>{claim.network}</td><td>{claim.status}</td><td>{money(claim.submitted_cents)}</td></tr>)}</tbody></table></div>
        {!claimPage.items.length && <Empty>No claims match these filters.</Empty>}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm"><button type="button" className="btn-secondary" disabled={claimPage.page <= 1} onClick={() => void loadClaims(claimPage.page - 1)}>Previous</button><span>{claimPage.total ? `${(claimPage.page - 1) * claimPage.page_size + 1}–${Math.min(claimPage.page * claimPage.page_size, claimPage.total)} of ${claimPage.total}` : '0 claims'}</span><button type="button" className="btn-secondary" disabled={claimPage.page * claimPage.page_size >= claimPage.total} onClick={() => void loadClaims(claimPage.page + 1)}>Next</button></div>
      </section>
      <div className="space-y-4">
        {invoices.map((invoice) => {
          const rows = claims.filter((c) => c.invoice_id === invoice.id);
          const patient = patients.find((p) => p.id === invoice.patient_id);
          return (
            <section className="panel" key={invoice.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-semibold">
                  {patient?.first_name} {patient?.last_name} ·{" "}
                  {invoice.lines.map((l) => l.name).join(", ")}
                </h2>
                <span className="badge">
                  Balance{" "}
                  {money(
                    invoice.total_cents +
                      invoice.adjustment_cents -
                      invoice.paid_cents,
                  )}
                </span>
              </div>
              <form
                className="my-4 flex flex-wrap items-end gap-3"
                onSubmit={(event) => void submitClaim(event, invoice.id)}
              >
                <Field label="Coverage">
                  <select className="field" name="plan" required>
                    <option value="">
                      Select primary / secondary coverage
                    </option>
                    {(state.plans[invoice.patient_id] || []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.priority === 1 ? "Primary" : "Secondary"} ·{" "}
                        {p.payer_name}
                      </option>
                    ))}
                  </select>
                </Field>
                <button
                  className="btn"
                  disabled={busy || !state.plans[invoice.patient_id]?.length}
                >
                  Submit claim
                </button>
              </form>
              {!state.plans[invoice.patient_id]?.length && (
                <p className="muted text-sm">
                  Add insurance coverage from the patient's record first.
                </p>
              )}
              {rows.map((c) => (
                <article
                  key={c.id}
                  className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] py-3 text-sm"
                >
                  <span className="font-medium">{c.network}</span>
                  <span className="badge">{c.status}</span>
                  <span>{money(c.covered_cents)}</span>
                  {(c.status === "submitted" || c.status === "appealed") && (
                    <button
                      className="btn-secondary"
                      disabled={busy}
                      onClick={() => void advanceClaim(c.id)}
                    >
                      Advance sandbox response
                    </button>
                  )}
                  {c.status === "adjudicated" && (
                    <button
                      className="btn-secondary"
                      disabled={busy}
                      onClick={() => void reconcileClaim(c.id)}
                    >
                      Reconcile remittance
                    </button>
                  )}
                  {c.status === "denied" && (
                    <form
                      className="flex gap-2"
                      onSubmit={(event) => void appealClaim(event, c.id)}
                    >
                      <input
                        name="reason"
                        aria-label="Appeal reason"
                        className="field"
                        minLength={5}
                        required
                        placeholder="Appeal reason"
                      />
                      <button className="btn-secondary" disabled={busy}>
                        Appeal
                      </button>
                    </form>
                  )}
                  {c.status === "review_required" && (
                    <span className="text-[var(--danger)]">
                      Remittance requires review: balance or plan maximum
                      changed.
                    </span>
                  )}
                </article>
              ))}
            </section>
          );
        })}
        {!invoices.length && (
          <Empty>Create an invoice before submitting claims.</Empty>
        )}
      </div>
    </>
  );
}
