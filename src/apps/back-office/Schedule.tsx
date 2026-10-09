import { useState, type FormEvent } from 'react';
import { api } from '../../shared/api';
import type { Appointment, Patient, Reference } from '../../shared/types';
import { Empty, Field, Title } from '../../shared/Fields';

type Props = {
  patients: Patient[];
  appointments: Appointment[];
  reference: Reference;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  busy: boolean;
};

type ScheduleView =
  | { type: 'create'; locationId: string }
  | { type: 'edit'; appointment: Appointment; locationId: string }
  | { type: 'cancel'; appointmentId: string; locationId: string };

function localDateTime(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function Schedule({ patients, appointments, reference, refresh, run, busy }: Props) {
  const [view, setView] = useState<ScheduleView>({
    type: 'create',
    locationId: reference.locations[0]?.id ?? '',
  });
  const location = reference.locations.find((item) => item.id === view.locationId);
  const editing = view.type === 'edit' ? view.appointment : undefined;

  function setLocation(locationId: string) {
    setView((current) => ({ ...current, locationId }));
  }

  function startEditing(appointment: Appointment) {
    setView({ type: 'edit', appointment, locationId: appointment.location_id });
  }

  function startCancellation(appointmentId: string) {
    setView({ type: 'cancel', appointmentId, locationId: view.locationId });
  }

  function startNewBooking() {
    setView({ type: 'create', locationId: view.locationId });
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const occurrences = Number(form.get('occurrences') || 1);
      const path =
        view.type === 'edit'
          ? `/appointments/${view.appointment.id}`
          : occurrences > 1
            ? '/appointments/series'
            : '/appointments';
      await api(
        path,
        {
          patient_id: form.get('patient'),
          provider_id: form.get('provider'),
          location_id: view.locationId,
          chair: form.get('chair'),
          starts_at: new Date(String(form.get('start'))).toISOString(),
          ends_at: new Date(String(form.get('end'))).toISOString(),
          procedure: form.get('procedure'),
          ...(occurrences > 1
            ? { occurrences, interval_days: Number(form.get('interval')) }
            : {}),
        },
        view.type === 'edit' ? 'PUT' : 'POST',
      );
      startNewBooking();
      await refresh();
    });
  }

  async function handleCancellation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (view.type !== 'cancel') return;
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api(`/appointments/${view.appointmentId}/cancel`, { reason: form.get('reason') });
      startNewBooking();
      await refresh();
    });
  }

  async function markNoShow(appointmentId: string) {
    await run(async () => {
      await api(`/appointments/${appointmentId}/no-show`, { reason: 'Patient did not attend' });
      await refresh();
    });
  }

  async function checkIn(appointmentId: string) {
    await run(async () => {
      await api(`/appointments/${appointmentId}/check-in`, {});
      await refresh();
    });
  }

  return (
    <>
      <Title
        title="Schedule"
        description="Bookings check patient, provider, and chair conflicts inside a database transaction. Times below use your browser timezone."
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <section className="panel overflow-auto">
          <table>
            <thead>
              <tr><th>When</th><th>Patient / procedure</th><th>Chair</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {appointments.map((appointment) => (
                <tr key={appointment.id}>
                  <td>{new Date(appointment.starts_at).toLocaleString()}</td>
                  <td>
                    <strong>
                      {patients.find((patient) => patient.id === appointment.patient_id)?.first_name}{' '}
                      {patients.find((patient) => patient.id === appointment.patient_id)?.last_name}
                    </strong>
                    <p className="muted text-xs">{appointment.procedure}</p>
                  </td>
                  <td>{appointment.chair}</td>
                  <td><span className="badge">{appointment.status}</span></td>
                  <td>
                    {appointment.status === 'confirmed' && (
                      <div className="flex gap-2">
                        <button className="btn-secondary" onClick={() => startEditing(appointment)}>Reschedule</button>
                        <button className="btn-secondary" onClick={() => startCancellation(appointment.id)}>Cancel</button>
                        <button className="btn-secondary" disabled={busy} onClick={() => void checkIn(appointment.id)}>Check in</button>
                        {new Date(appointment.starts_at) <= new Date() && (
                          <button className="btn-secondary" onClick={() => void markNoShow(appointment.id)}>No-show</button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!appointments.length && <Empty>No appointments yet.</Empty>}
          {view.type === 'cancel' && (
            <form className="mt-4 flex flex-wrap gap-3" onSubmit={handleCancellation}>
              <label className="label flex-1">
                Cancellation reason
                <input name="reason" className="field" required minLength={3} maxLength={500} />
              </label>
              <button className="btn" disabled={busy}>Confirm cancellation</button>
              <button type="button" className="btn-secondary" onClick={startNewBooking}>Keep appointment</button>
            </form>
          )}
        </section>

        <form key={editing?.id ?? 'new'} className="panel space-y-3" onSubmit={handleSave}>
          <h2 className="font-semibold">{editing ? 'Reschedule appointment' : 'New appointment'}</h2>
          <Field label="Patient">
            <select name="patient" className="field" required defaultValue={editing?.patient_id}>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>{patient.first_name} {patient.last_name}</option>
              ))}
            </select>
          </Field>
          <Field label="Provider">
            <select className="field" name="provider" defaultValue={editing?.provider_id}>
              {reference.providers.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Location">
            <select className="field" value={view.locationId} onChange={(event) => setLocation(event.target.value)}>
              {reference.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Field label="Chair">
            <select key={view.locationId} className="field" name="chair" defaultValue={editing?.chair}>
              {location?.chairs.map((chair) => <option key={chair}>{chair}</option>)}
            </select>
          </Field>
          <Field label="Starts">
            <input className="field" name="start" type="datetime-local" required defaultValue={editing ? localDateTime(editing.starts_at) : undefined} />
          </Field>
          <Field label="Ends">
            <input className="field" name="end" type="datetime-local" required defaultValue={editing ? localDateTime(editing.ends_at) : undefined} />
          </Field>
          <Field label="Procedure">
            <input className="field" name="procedure" required maxLength={180} defaultValue={editing?.procedure} />
          </Field>
          {!editing && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Occurrences"><input className="field" name="occurrences" type="number" min="1" max="52" defaultValue="1" /></Field>
              <Field label="Repeat every (days)"><input className="field" name="interval" type="number" min="1" max="365" defaultValue="7" /></Field>
            </div>
          )}
          <button className="btn w-full" disabled={busy}>Save appointment</button>
          {editing && <button type="button" className="btn-secondary w-full" onClick={startNewBooking}>Start a new booking</button>}
        </form>
      </div>
    </>
  );
}
