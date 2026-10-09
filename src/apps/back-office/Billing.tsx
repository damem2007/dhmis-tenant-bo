import { useEffect, useState, type FormEvent } from "react";
import { api, money } from "../../shared/api";
import type {
  Patient,
  Invoice,
  Service,
  Claim,
  Reference,
} from "../../shared/types";
import { Field, Title } from "../../shared/Fields";
import { ClaimsWorkspace } from "./ClaimsWorkspace";
type Ledger = {
  id: string;
  invoice_id: string;
  kind: string;
  amount_cents: number;
  running_balance_cents: number;
  created_at: string;
};
type Statement = {
  balance_cents: number;
  aging: Record<string, number>;
  entries: Ledger[];
  payment_plans: {
    id: string;
    invoice_id: string;
    installments: { due: string; amount_cents: number }[];
  }[];
};
type Props = {
  patients: Patient[];
  invoices: Invoice[];
  services: Service[];
  claims: Claim[];
  reference: Reference;
  refresh: () => Promise<void>;
  run: (f: () => Promise<void>) => Promise<void>;
  busy: boolean;
  claimsOnly?: boolean;
};
type FeeVersion = {
  id: string;
  service_id: string;
  fee_cents: number;
  effective_at: string;
};
type BillingState = {
  selectedInvoiceId: string;
  statement: Statement | null;
  error: string;
  feeVersions: FeeVersion[];
};
type PendingRefund = {
  requestId: string;
  invoiceId: string;
  payload: {
    payment_id: FormDataEntryValue | null;
    amount_cents: number;
    reason: FormDataEntryValue | null;
    idempotency_key: FormDataEntryValue | null;
  };
};
export function Billing(props: Props) {
  const {
    patients,
    invoices,
    services,
    claims,
    reference,
    refresh,
    run,
    busy,
    claimsOnly = false,
  } = props;
  const [state, setState] = useState<BillingState>({
    selectedInvoiceId: "",
    statement: null,
    error: "",
    feeVersions: [],
  });
  const [pendingRefund, setPendingRefund] = useState<PendingRefund | null>(null);
  const patchState = (next: Partial<BillingState>) =>
    setState((current) => ({ ...current, ...next }));
  const invoice = invoices.find((item) => item.id === state.selectedInvoiceId);
  const loadStatement = async () => {
    if (invoice) patchState({ statement: await api<Statement>(`/billing/statement/${invoice.patient_id}`) });
  };
  useEffect(() => {
    patchState({ statement: null });
    void loadStatement().catch((reason) => patchState({ error: reason.message }));
  }, [state.selectedInvoiceId, invoices]);
  useEffect(() => {
    api<FeeVersion[]>("/billing/fee-versions")
      .then((feeVersions) => patchState({ feeVersions }))
      .catch((reason) => patchState({ error: reason.message }));
  }, [services]);

  async function handleInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api("/billing/invoices", { patient_id: form.get("patient"), service_ids: form.getAll("services") });
      await refresh();
    });
  }

  async function handleService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await run(async () => {
      await api("/billing/services", {
        code: form.get("code"),
        name: form.get("name"),
        fee_cents: Math.round(Number(form.get("fee")) * 100),
      });
      formElement.reset();
      await refresh();
    });
  }

  async function handleFeeVersion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api("/billing/fee-versions", {
        service_id: form.get("service"),
        location_id: form.get("location") || null,
        provider_id: form.get("provider") || null,
        fee_cents: Math.round(Number(form.get("fee")) * 100),
        effective_at: new Date(String(form.get("effective"))).toISOString(),
      });
      patchState({ feeVersions: await api<FeeVersion[]>("/billing/fee-versions") });
      await refresh();
    });
  }

  async function handlePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice) return;
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api(`/billing/invoices/${invoice.id}/payments`, {
        amount_cents: Math.round(Number(form.get("amount")) * 100),
        idempotency_key: form.get("key"),
      });
      await refresh();
    });
  }

  async function handleAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice) return;
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api(`/billing/invoices/${invoice.id}/adjustments`, {
        amount_cents: Math.round(Number(form.get("amount")) * 100),
        reason: form.get("reason"),
        idempotency_key: form.get("key"),
      });
      await refresh();
    });
  }

  async function handlePaymentPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice) return;
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api(`/billing/invoices/${invoice.id}/payment-plan`, {
        installments: Number(form.get("count")),
        first_due: form.get("due"),
      });
      await loadStatement();
    });
  }

  async function handleRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice) return;
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const payload = {
        payment_id: form.get("payment"),
        amount_cents: Math.round(Number(form.get("amount")) * 100),
        reason: form.get("reason"),
        idempotency_key: form.get("key"),
      };
      const result = await api<{ status?: string; request?: { id: string } }>(`/billing/invoices/${invoice.id}/refunds`, payload);
      if (result.status === "approval_required" && result.request) {
        setPendingRefund({ requestId: result.request.id, invoiceId: invoice.id, payload });
        patchState({ error: "Refund submitted for maker-checker approval. It has not changed the ledger or called the payment provider." });
        return;
      }
      await refresh();
    });
  }
  async function executeApprovedRefund() {
    if (!pendingRefund) return;
    await run(async () => {
      await api(`/billing/invoices/${pendingRefund.invoiceId}/refunds`, { ...pendingRefund.payload, approval_request_id: pendingRefund.requestId });
      setPendingRefund(null);
      patchState({ error: "" });
      await refresh();
      await loadStatement();
    });
  }
  if (claimsOnly) return <ClaimsWorkspace {...props} />;
  return (
    <>
      <Title
        title="Billing & services"
        description="Versioned fees, balanced ledger postings, patient statements, and configurable payment providers."
      />
      {state.error && <p role="alert">{state.error}</p>}
      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <form
          className="panel space-y-3"
          onSubmit={handleInvoice}
        >
          <h2 className="font-semibold">Create invoice</h2>
          <Field label="Patient">
            <select className="field" name="patient">
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.first_name} {p.last_name}
                </option>
              ))}
            </select>
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Services</legend>
            {services.map((s) => (
              <label
                className="mb-2 flex items-center gap-2 text-sm"
                key={s.id}
              >
                <input type="checkbox" name="services" value={s.id} />
                {s.name} · Base {money(s.fee_cents)}
              </label>
            ))}
          </fieldset>
          <button className="btn" disabled={busy}>
            Create invoice
          </button>
          <p className="muted text-xs">
            Completed encounters generate invoices from performed procedures
            automatically.
          </p>
        </form>
        <form
          className="panel space-y-3"
          onSubmit={handleService}
        >
          <h2 className="font-semibold">Add service</h2>
          <Field label="Service code">
            <input className="field" name="code" required maxLength={30} />
          </Field>
          <Field label="Service name">
            <input className="field" name="name" required maxLength={180} />
          </Field>
          <Field label="Base fee (CAD)">
            <input
              className="field"
              name="fee"
              type="number"
              min="0"
              step="0.01"
              required
            />
          </Field>
          <button className="btn-secondary" disabled={busy}>
            Save service
          </button>
        </form>
      </div>
      <details className="panel mb-5">
        <summary className="font-semibold">Versioned fee schedules</summary>
        <form
          className="mt-4 grid gap-3 md:grid-cols-3"
          onSubmit={handleFeeVersion}
        >
          <Field label="Service">
            <select className="field" name="service">
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Location">
            <select className="field" name="location">
              <option value="">All locations</option>
              {reference.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Provider">
            <select className="field" name="provider">
              <option value="">All providers</option>
              {reference.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="New fee CAD">
            <input
              className="field"
              name="fee"
              type="number"
              min="0"
              step="0.01"
              required
            />
          </Field>
          <Field label="Effective from">
            <input
              className="field"
              name="effective"
              type="datetime-local"
              required
            />
          </Field>
          <button className="btn self-end" disabled={busy}>
            Add fee version
          </button>
        </form>
        <ul className="mt-3 text-sm">
          {state.feeVersions.map((f) => (
            <li className="py-2" key={f.id}>
              {services.find((s) => s.id === f.service_id)?.name} ·{" "}
              {money(f.fee_cents)} · {new Date(f.effective_at).toLocaleString()}
            </li>
          ))}
        </ul>
        <p className="muted text-xs">
          Historical invoice lines retain their captured prices.
        </p>
      </details>
      <section className="panel overflow-auto">
        <table>
          <thead>
            <tr>
              <th>Patient</th>
              <th>Invoice</th>
              <th>Total</th>
              <th>Balance</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id}>
                <td>
                  {patients.find((p) => p.id === i.patient_id)?.first_name}{" "}
                  {patients.find((p) => p.id === i.patient_id)?.last_name}
                </td>
                <td>{i.lines.map((l) => l.name).join(", ")}</td>
                <td>{money(i.total_cents + i.adjustment_cents)}</td>
                <td>
                  {money(i.total_cents + i.adjustment_cents - i.paid_cents)}
                </td>
                <td>
                  <span className="badge">{i.status}</span>
                </td>
                <td>
                  <button
                    className="btn-secondary"
                    onClick={() => patchState({ selectedInvoiceId: i.id })}
                  >
                    Manage invoice
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {invoice && (
        <section key={invoice.id} className="panel mt-5">
          <h2 className="mb-4 text-lg font-semibold">
            Invoice {invoice.id.slice(0, 8)} · balance{" "}
            {money(
              invoice.total_cents +
                invoice.adjustment_cents -
                invoice.paid_cents,
            )}
          </h2>
          <div className="grid gap-5 xl:grid-cols-3">
            <form
              className="space-y-3"
              onSubmit={handlePayment}
            >
              <h3 className="font-semibold">Payment</h3>
              <input
                type="hidden"
                name="key"
                value={`payment:${invoice.id}:${state.statement?.entries.length || 0}`}
              />
              <Field label="Amount CAD">
                <input
                  className="field"
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                />
              </Field>
              <button
                className="btn"
                disabled={busy || invoice.status === "paid"}
              >
                Record sandbox payment
              </button>
            </form>
            <form
              className="space-y-3"
              onSubmit={handleAdjustment}
            >
              <h3 className="font-semibold">Adjustment / write-off</h3>
              <input
                type="hidden"
                name="key"
                value={`adjust:${invoice.id}:${state.statement?.entries.length || 0}`}
              />
              <Field label="Signed amount CAD (negative reduces balance)">
                <input
                  className="field"
                  name="amount"
                  type="number"
                  step="0.01"
                  required
                />
              </Field>
              <Field label="Reason">
                <input className="field" name="reason" minLength={5} required />
              </Field>
              <button className="btn-secondary" disabled={busy}>
                Post adjustment
              </button>
            </form>
            <form
              className="space-y-3"
              onSubmit={handlePaymentPlan}
            >
              <h3 className="font-semibold">Payment plan</h3>
              <Field label="Installments">
                <input
                  name="count"
                  className="field"
                  type="number"
                  min="2"
                  max="24"
                  required
                />
              </Field>
              <Field label="First due date">
                <input name="due" className="field" type="date" required />
              </Field>
              <button className="btn-secondary" disabled={busy}>
                Create installment schedule
              </button>
            </form>
          </div>
          <details className="mt-5">
            <summary className="font-medium">
              Refund a captured patient payment
            </summary>
            {pendingRefund?.invoiceId === invoice.id ? <div className="prototype-callout mt-3"><strong>Approval request {pendingRefund.requestId}</strong><p className="mt-1">After another eligible administrator approves it under Roles &amp; access → Approvals, execute the unchanged refund here.</p><button type="button" className="btn mt-3" disabled={busy} onClick={() => void executeApprovedRefund()}>Execute approved refund</button></div> : <form
              className="mt-3 flex flex-wrap items-end gap-3"
              onSubmit={handleRefund}
            >
              <input
                type="hidden"
                name="key"
                value={`refund:${invoice.id}:${state.statement?.entries.length || 0}`}
              />
              <Field label="Payment">
                <select className="field" name="payment" required>
                  <option value="">Select payment</option>
                  {state.statement?.entries
                    .filter(
                      (e) =>
                        e.invoice_id === invoice.id && e.kind === "payment",
                    )
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {money(-e.amount_cents)} ·{" "}
                        {new Date(e.created_at).toLocaleString()}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Refund CAD">
                <input
                  className="field"
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                />
              </Field>
              <Field label="Reason">
                <input className="field" name="reason" minLength={8} required />
              </Field>
              <button className="btn-secondary" disabled={busy}>
                Refund through adapter
              </button>
            </form>}
          </details>
          {state.statement && (
            <div className="mt-6">
              <h3 className="font-semibold">
                Patient statement · {money(state.statement.balance_cents)}
              </h3>
              <div className="my-3 flex flex-wrap gap-3">
                {Object.entries(state.statement.aging).map(([range, amount]) => (
                  <span className="badge" key={range}>
                    {range} days: {money(amount)}
                  </span>
                ))}
              </div>
              <div className="overflow-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Entry</th>
                      <th>Amount</th>
                      <th>Running balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.statement.entries.map((e) => (
                      <tr key={e.id}>
                        <td>{new Date(e.created_at).toLocaleString()}</td>
                        <td>{e.kind}</td>
                        <td>{money(e.amount_cents)}</td>
                        <td>{money(e.running_balance_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {state.statement.payment_plans.filter((p) => p.invoice_id === invoice.id).map((p) => (
                <div key={p.id} className="mt-5 overflow-auto rounded-lg border border-[var(--border)]">
                  <table>
                    <caption className="p-3 text-left text-sm font-semibold">Installment schedule</caption>
                    <thead><tr><th>Installment</th><th>Due date</th><th>Amount</th><th>Timing</th></tr></thead>
                    <tbody>{p.installments.map((item, index) => {
                      const due = new Date(`${item.due}T00:00:00`);
                      const days = Math.ceil((due.getTime() - Date.now()) / 86400000);
                      const timing = days < 0 ? 'Overdue' : days <= 3 ? 'Due soon' : 'Scheduled';
                      return <tr key={`${p.id}-${item.due}-${index}`}><td>{index + 1} of {p.installments.length}</td><td>{due.toLocaleDateString()}</td><td>{money(item.amount_cents)}</td><td><span className={`badge ${days < 0 ? 'text-[var(--danger)]' : days <= 3 ? 'text-[var(--amber)]' : ''}`}>{timing}</span></td></tr>;
                    })}</tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
