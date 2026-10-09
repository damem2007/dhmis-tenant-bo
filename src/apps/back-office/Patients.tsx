import { useState, type FormEvent } from "react";
import { api } from "../../shared/api";
import type { Patient, Reference, Service } from "../../shared/types";
import { Field, Title, Empty } from "../../shared/Fields";
import { ClinicalWorkspace } from "./ClinicalWorkspace";
import { PatientDetails } from "./PatientDetails";
type Props = {
  patients: Patient[];
  reference: Reference;
  query: string;
  refresh: () => Promise<void>;
  run: (fn: () => Promise<void>) => Promise<void>;
  services: Service[];
  permissions: string[];
  busy: boolean;
};
export function Patients({
  patients,
  reference,
  query,
  refresh,
  run,
  busy,
  services,
  permissions,
}: Props) {
  const [selected, setSelected] = useState<Patient | null>(null);
  const visible = patients.filter((p) =>
    `${p.first_name} ${p.last_name}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  async function handleCreatePatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await run(async () => {
      await api("/patients", {
        first_name: form.get("first"),
        last_name: form.get("last"),
        birth_date: form.get("dob"),
        email: form.get("email"),
        phone: form.get("phone"),
        location_id: form.get("location"),
      });
      formElement.reset();
      await refresh();
    });
  }

  return (
    <>
      <Title
        title="Patients & clinical records"
        description="Synthetic development records, saved to PostgreSQL. Select a patient to view their chart."
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <section className="panel overflow-auto">
          <table>
            <thead>
              <tr>
                <th>Patient</th>
                <th>Born</th>
                <th>Contact</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">
                    {p.first_name} {p.last_name}
                  </td>
                  <td>{p.birth_date}</td>
                  <td>{p.email || p.phone || "—"}</td>
                  <td>
                    <button
                      className="btn-secondary"
                      onClick={() => setSelected(p)}
                    >
                      Open record
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && <Empty>No matching patients.</Empty>}
        </section>
        <form className="panel space-y-3" onSubmit={handleCreatePatient}>
          <h2 className="font-semibold">Add patient</h2>
          <Field label="First name">
            <input className="field" name="first" required maxLength={80} />
          </Field>
          <Field label="Last name">
            <input className="field" name="last" required maxLength={80} />
          </Field>
          <Field label="Date of birth">
            <input
              className="field"
              name="dob"
              type="date"
              required
              max={new Date().toISOString().slice(0, 10)}
            />
          </Field>
          <Field label="Email">
            <input
              className="field"
              name="email"
              type="email"
              maxLength={254}
            />
          </Field>
          <Field label="Phone">
            <input className="field" name="phone" maxLength={40} />
          </Field>
          <Field label="Location">
            <select name="location" className="field">
              {reference.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <button disabled={busy} className="btn w-full">
            Save patient
          </button>
        </form>
      </div>
      {selected && (
        <PatientDetails
          key={selected.id}
          patient={patients.find((p) => p.id === selected.id) || selected}
          patients={patients}
          reference={reference}
          run={run}
          busy={busy}
          refresh={refresh}
          permissions={permissions}
        />
      )}
      {selected && permissions.includes("clinical") && (
        <ClinicalWorkspace
          key={selected.id}
          patient={selected}
          services={services}
          reference={reference}
          run={run}
          busy={busy}
          refresh={refresh}
        />
      )}
    </>
  );
}
