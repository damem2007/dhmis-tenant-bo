import { useEffect, useState, type FormEvent } from "react";
import { api } from "./lib/api";
import type { Appointment, Invoice, Patient, PatientPage, Reference, Service } from "./types";
import { Field, Empty } from "./components/Fields";
import { ClinicalWorkspace } from "./ClinicalWorkspace";
import { PatientDetails, type PatientRecordTab } from "./PatientDetails";
import { DEFAULT_PAGE_SIZE, Pagination } from "./components/Pagination";

type Props = {
  patients: Patient[];
  appointments: Appointment[];
  invoices: Invoice[];
  reference: Reference;
  query: string;
  refresh: () => Promise<void>;
  run: (fn: () => Promise<void>) => Promise<void>;
  services: Service[];
  permissions: string[];
  busy: boolean;
};

type FilterState = { location: string; ageFrom: string; ageTo: string; status: string };

function ageFor(birthDate: string) {
  const birth = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

export function Patients({ patients, appointments, invoices, reference, query, refresh, run, busy, services, permissions }: Props) {
  const [selected, setSelected] = useState<Patient | null>(null);
  const [recordTab, setRecordTab] = useState<PatientRecordTab>("details");
  const [search, setSearch] = useState(query);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [invitationLink, setInvitationLink] = useState("");
  const [filters, setFilters] = useState<FilterState>({ location: "", ageFrom: "", ageTo: "", status: "active" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [patientPage, setPatientPage] = useState<PatientPage>({ items: [], total: 0, page: 1, page_size: DEFAULT_PAGE_SIZE, pages: 1 });
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => setSearch(query), [query]);

  useEffect(() => setPage(1), [search, filters]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (search.trim()) params.set("q", search.trim());
      if (filters.location) params.set("location_id", filters.location);
      if (filters.status) params.set("status", filters.status);
      if (filters.ageFrom) params.set("age_from", filters.ageFrom);
      if (filters.ageTo) params.set("age_to", filters.ageTo);
      setListLoading(true);
      setListError("");
      void api<PatientPage | Patient[]>(`/patients?${params.toString()}`)
        .then((result) => {
          if (!active) return;
          if (Array.isArray(result)) {
            const resultPages = Math.max(1, Math.ceil(result.length / pageSize));
            setPatientPage({ items: result, total: result.length, page, page_size: pageSize, pages: resultPages });
          } else {
            setPatientPage(result);
          }
        })
        .catch((reason) => {
          if (active) setListError(reason instanceof Error ? reason.message : "Patients could not be loaded");
        })
        .finally(() => { if (active) setListLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [filters, page, pageSize, reloadToken, search]);

  const pages = Math.max(1, patientPage.pages || Math.ceil(patientPage.total / pageSize));
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const visible = patientPage.items;

  async function openRecord(patient: Patient, tab: PatientRecordTab = "details") {
    setSelected(patient);
    setRecordTab(tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const detail = await api<Patient>(`/patients/${patient.id}`);
      setSelected((current) => current?.id === detail.id ? detail : current);
    } catch {
      // Keep the list row available when a detail refresh is temporarily unavailable.
    }
  }

  async function handleCreatePatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await run(async () => {
      const result = await api<{ invitation_link?: string }>("/patients", {
        first_name: form.get("first"), last_name: form.get("last"), birth_date: form.get("dob"),
        email: form.get("email"), phone: form.get("phone"), location_id: form.get("location"),
        send_portal_invitation: form.get("send_invitation") === "on",
      });
      setInvitationLink(result.invitation_link || "");
      formElement.reset();
      setReloadToken((current) => current + 1);
      await refresh();
    });
  }

  if (selected) {
    const current = selected;
    return (
      <div className="patients-record-page">
        <PatientDetails
          key={current.id}
          patient={current}
          patients={patients}
          reference={reference}
          run={run}
          busy={busy}
          refresh={refresh}
          permissions={permissions}
          invoices={invoices}
          appointments={appointments}
          activeTab={recordTab}
          onTabChange={setRecordTab}
          onBack={() => { setSelected(null); setRecordTab("details"); }}
        />
        {recordTab === "clinical" && permissions.includes("clinical") && (
          <ClinicalWorkspace key={`clinical-${current.id}`} patient={current} services={services} reference={reference} run={run} busy={busy} refresh={refresh} />
        )}
      </div>
    );
  }

  return (
    <div className="patients-page">
      <header className="patients-page-header">
        <div><p className="patients-eyebrow">PATIENT CARE</p><h1>Patients</h1><p>Manage patient records and clinical care.</p></div>
        <button className="btn patients-primary" type="button" onClick={() => { setInvitationLink(""); setAddOpen(true); }}>Add patient</button>
      </header>

      <section className="patients-list-card panel">
        <div className="patients-list-head">
          <div><h2>All patients</h2><p className="muted">{patientPage.total} patient {patientPage.total === 1 ? "record" : "records"}</p></div>
          <div className="patients-toolbar">
            <label className="patients-search"><span className="sr-only">Search patients</span><input className="field" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patients..." /></label>
            <button className={filtersOpen ? "btn-secondary patients-filter-active" : "btn-secondary"} type="button" onClick={() => setFiltersOpen(true)}>More filters</button>
          </div>
        </div>
        {listError && <p className="patients-error" role="alert">{listError}</p>}
        <div className="patients-table-wrap" aria-busy={listLoading}>
          {listLoading && <div className="patients-loading-state" role="status">Loading patients…</div>}
          <table className="patients-table">
            <thead><tr><th>Patient</th><th>Date of birth</th><th>Age</th><th>Location</th><th>Contact</th><th>Last visit</th><th>Next visit</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{visible.map((patient) => {
              const location = reference.locations.find((item) => item.id === patient.location_id);
              const patientAppointments = appointments.filter((appointment) => appointment.patient_id === patient.id).sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
              const now = Date.now();
              const lastVisit = patientAppointments.filter((appointment) => new Date(appointment.starts_at).getTime() < now).at(-1);
              const nextVisit = patientAppointments.find((appointment) => new Date(appointment.starts_at).getTime() >= now);
              return <tr key={patient.id}>
                <td><button className="patients-name-link" type="button" onClick={() => openRecord(patient)}>{patient.first_name} {patient.last_name}</button></td>
                <td>{patient.birth_date || "—"}</td><td>{ageFor(patient.birth_date) ?? "—"}</td><td>{location?.name || "—"}</td>
                <td><span>{patient.email || "—"}</span>{patient.phone && <small>{patient.phone}</small>}</td>
                <td>{lastVisit ? new Date(lastVisit.starts_at).toLocaleDateString() : "—"}</td><td>{nextVisit ? new Date(nextVisit.starts_at).toLocaleDateString() : "—"}</td>
                <td><span className={patient.archived_at ? "patients-status is-inactive" : "patients-status"}><span aria-hidden="true">●</span> {patient.archived_at ? "Archived" : "Active"}</span></td>
                <td><button className="btn-secondary" type="button" onClick={() => openRecord(patient)}>Open record</button></td>
              </tr>;
            })}</tbody>
          </table>
          {!listLoading && !listError && !visible.length && <Empty>No matching patients.</Empty>}
        </div>
        <Pagination page={page} pageSize={pageSize} total={patientPage.total} pages={pages} label="patients" busy={listLoading} onPage={setPage} onPageSize={(next) => { setPageSize(next); setPage(1); }} />
      </section>

      {filtersOpen && <aside className="patients-drawer" role="dialog" aria-modal="true" aria-labelledby="patient-filters-title">
        <div className="patients-drawer-head"><div><h2 id="patient-filters-title">More filters</h2><p className="muted">Narrow the patient list.</p></div><button className="patients-close" type="button" aria-label="Close filters" onClick={() => setFiltersOpen(false)}>×</button></div>
        <div className="patients-drawer-body">
          <Field label="Status"><select className="field" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="active">Active</option><option value="all">All statuses</option></select></Field>
          <Field label="Location"><select className="field" value={filters.location} onChange={(event) => setFilters((current) => ({ ...current, location: event.target.value }))}><option value="">All locations</option>{reference.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
          <div className="patients-filter-grid"><Field label="Age from"><input className="field" inputMode="numeric" type="number" min="0" max="120" value={filters.ageFrom} onChange={(event) => setFilters((current) => ({ ...current, ageFrom: event.target.value }))} /></Field><Field label="Age to"><input className="field" inputMode="numeric" type="number" min="0" max="120" value={filters.ageTo} onChange={(event) => setFilters((current) => ({ ...current, ageTo: event.target.value }))} /></Field></div>
          <fieldset className="patients-filter-fieldset"><legend>Flags</legend><label><input type="checkbox" disabled /> Recall overdue</label><label><input type="checkbox" disabled /> Outstanding balance</label><label><input type="checkbox" disabled /> Portal not activated</label><p className="muted">Flags will appear when available in the patient feed.</p></fieldset>
        </div>
        <div className="patients-drawer-footer"><button className="btn-secondary" type="button" onClick={() => setFilters({ location: "", ageFrom: "", ageTo: "", status: "active" })}>Clear all</button><button className="btn-secondary" type="button" onClick={() => setFiltersOpen(false)}>Cancel</button><button className="btn" type="button" onClick={() => setFiltersOpen(false)}>Show {patientPage.total} patients</button></div>
      </aside>}

      {addOpen && <aside className="patients-drawer patients-add-drawer" role="dialog" aria-modal="true" aria-labelledby="add-patient-title">
        <form onSubmit={handleCreatePatient}>
          <div className="patients-drawer-head"><div><h2 id="add-patient-title">Add patient</h2><p className="muted">Create a patient record and optionally invite them to the Client Portal.</p></div><button className="patients-close" type="button" aria-label="Close add patient" onClick={() => setAddOpen(false)}>×</button></div>
          <div className="patients-drawer-body">
            <div className="patients-filter-grid"><Field label="First name"><input className="field" name="first" required maxLength={80} /></Field><Field label="Last name"><input className="field" name="last" required maxLength={80} /></Field></div>
            <Field label="Date of birth"><input className="field" name="dob" type="date" required max={new Date().toISOString().slice(0, 10)} /></Field>
            <Field label="Email"><input className="field" name="email" type="email" maxLength={254} /></Field><Field label="Phone"><input className="field" name="phone" maxLength={40} /></Field>
            <Field label="Home location"><select name="location" className="field" required>{reference.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
            <label className="patients-checkbox"><input type="checkbox" name="send_invitation" defaultChecked /> <span>Send a patient portal invitation</span></label>
            {invitationLink && <p className="patients-invitation" role="status"><strong>Client Portal invitation:</strong> <a className="underline" href={invitationLink}>{invitationLink}</a></p>}
          </div>
          <div className="patients-drawer-footer"><button className="btn-secondary" type="button" onClick={() => setAddOpen(false)}>Cancel</button><button className="btn-secondary" type="submit" disabled={busy}>Save patient</button><button className="btn" type="submit" disabled={busy} onClick={() => setAddOpen(false)}>Save and close</button></div>
        </form>
      </aside>}
      {(filtersOpen || addOpen) && <button className="patients-drawer-backdrop" type="button" aria-label="Close drawer" onClick={() => { setFiltersOpen(false); setAddOpen(false); }} />}
    </div>
  );
}
