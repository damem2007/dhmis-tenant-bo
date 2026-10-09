import { useEffect, useState, type FormEvent } from 'react';
import { api, authenticatedBlobUrl, download } from '../../shared/api';
import { Field } from '../../shared/Fields';

type PatientChoice = { id: string; first_name: string; last_name: string };
type DocumentRecord = { id: string; patient_id: string; filename: string; description: string; mime_type: string; comparison_group: string };
type MessageThread = { id: string; patient_id: string; subject: string; status: string };
type SupportState = {
  selectedPatient: string;
  documents: DocumentRecord[];
  threads: MessageThread[];
  inviteToken: string;
  error: string;
  previews: Record<string, string>;
};

export function Phase2Support({
  patients,
  run,
  busy,
}: {
  patients: PatientChoice[];
  run: (action: () => Promise<void>) => Promise<void>;
  busy: boolean;
}) {
  const [state, setState] = useState<SupportState>({
    selectedPatient: patients[0]?.id || '',
    documents: [],
    threads: [],
    inviteToken: '',
    error: '',
    previews: {},
  });

  function patchState(next: Partial<SupportState>) {
    setState((current) => ({ ...current, ...next }));
  }

  async function load(patientId = state.selectedPatient || patients[0]?.id || '') {
    const [threads, documents] = await Promise.all([
      api<MessageThread[]>('/messages'),
      patientId ? api<DocumentRecord[]>(`/documents/${patientId}`) : Promise.resolve([]),
    ]);
    const previews = Object.fromEntries(
      await Promise.all(
        documents
          .filter((document) => document.mime_type.startsWith('image/'))
          .map(async (document) => [document.id, await authenticatedBlobUrl(`/documents/file/${document.id}`)]),
      ),
    );
    setState((current) => {
      return { ...current, threads, documents, selectedPatient: patientId, previews };
    });
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const result = await api<{ token: string }>('/portal/invites', {
        patient_id: form.get('patient_id'),
        email: form.get('email'),
      });
      patchState({ inviteToken: result.token });
    });
  }

  async function handleTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = String(form.get('fields')).split(',').map((name) => name.trim()).filter(Boolean).map((name) => ({ name, label: name }));
    await run(async () => {
      await api('/forms/templates', {
        title: form.get('title'),
        version: form.get('version'),
        fields,
      });
      event.currentTarget.reset();
    });
  }

  async function handleDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get('file');
    if (!(file instanceof File)) return;
    const contentBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Document could not be read'));
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.readAsDataURL(file);
    });
    await run(async () => {
      await api('/documents', {
        patient_id: form.get('patient_id'),
        category: file.type.startsWith('image/') ? 'image' : 'document',
        filename: file.name,
        mime_type: file.type,
        content_base64: contentBase64,
        description: form.get('description'),
        comparison_group: form.get('comparison_group'),
      });
      await load(String(form.get('patient_id')));
    });
  }

  async function handlePatient(patientId: string) {
    patchState({ selectedPatient: patientId });
    try {
      await load(patientId);
    } catch (reason) {
      patchState({ error: reason instanceof Error ? reason.message : 'Could not load documents' });
    }
  }

  async function handleReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api(`/messages/${form.get('thread_id')}/reply`, { body: form.get('body') });
      await load();
      event.currentTarget.reset();
    });
  }

  useEffect(() => {
    void load().catch((reason) => patchState({ error: reason.message }));
  }, []);

  useEffect(
    () => () => Object.values(state.previews).forEach(URL.revokeObjectURL),
    [state.previews],
  );

  const comparisons = state.documents.reduce<Record<string, DocumentRecord[]>>((groups, document) => {
    if (document.comparison_group && state.previews[document.id]) {
      (groups[document.comparison_group] ||= []).push(document);
    }
    return groups;
  }, {});

  return (
    <section className="mt-5 space-y-5">
      <h2 className="text-xl font-semibold">Phase 2 patient services</h2>
      {state.error && <p role="alert">{state.error}</p>}
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="panel space-y-5">
          <form className="space-y-3" onSubmit={handleInvite}>
            <h3 className="font-semibold">Client Portal invitation</h3>
            <Field label="Patient"><select className="field" name="patient_id">{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.first_name} {patient.last_name}</option>)}</select></Field>
            <Field label="Email"><input className="field" name="email" type="email" required /></Field>
            <button className="btn-secondary" disabled={busy}>Create invitation</button>
            {state.inviteToken && <p className="break-all text-sm"><strong>One-time token:</strong> {state.inviteToken}</p>}
          </form>
          <form className="space-y-3 border-t border-[var(--border)] pt-4" onSubmit={handleTemplate}>
            <h3 className="font-semibold">Versioned intake form</h3>
            <Field label="Title"><input className="field" name="title" required /></Field>
            <Field label="Version"><input className="field" name="version" required /></Field>
            <Field label="Fields (comma-separated)"><input className="field" name="fields" required /></Field>
            <button className="btn-secondary" disabled={busy}>Create template</button>
          </form>
        </div>

        <div className="panel">
          <h3 className="mb-3 font-semibold">Documents and images</h3>
          <Field label="Patient"><select className="field" value={state.selectedPatient} onChange={(event) => void handlePatient(event.target.value)}>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.first_name} {patient.last_name}</option>)}</select></Field>
          <form className="mt-3 space-y-3" onSubmit={handleDocument}>
            <input type="hidden" name="patient_id" value={state.selectedPatient} />
            <Field label="File"><input className="field" name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required /></Field>
            <Field label="Description"><input className="field" name="description" /></Field>
            <Field label="Comparison group"><input className="field" name="comparison_group" placeholder="Before/after case identifier" /></Field>
            <button className="btn-secondary" disabled={busy || !state.selectedPatient}>Upload</button>
          </form>
          <ul className="mt-4 space-y-2">{state.documents.map((document) => <li key={document.id} className="flex items-center justify-between text-sm"><span>{document.filename} · {document.description}</span><button className="underline" onClick={() => void download(`/documents/file/${document.id}`, document.filename)}>Open</button></li>)}</ul>
          {Object.entries(comparisons).map(([group, documents]) => documents.length > 1 && <div key={group} className="mt-4"><p className="mb-2 text-sm font-medium">Before/after · {group}</p><div className="grid grid-cols-2 gap-2">{documents.slice(0, 2).map((document) => <figure key={document.id}><img className="aspect-square w-full rounded-lg object-cover" src={state.previews[document.id]} alt={document.description || document.filename} /><figcaption className="mt-1 text-xs">{document.description || document.filename}</figcaption></figure>)}</div></div>)}
        </div>

        <div className="panel">
          <h3 className="mb-3 font-semibold">Secure patient messages</h3>
          {state.threads.map((thread) => <div key={thread.id} className="mb-3 rounded-lg border border-[var(--border)] p-3 text-sm"><strong>{thread.subject}</strong><p>{thread.status}</p><form className="mt-2 flex gap-2" onSubmit={handleReply}><input type="hidden" name="thread_id" value={thread.id} /><input className="field" name="body" placeholder="Reply" required /><button className="btn-secondary" disabled={busy}>Send</button></form></div>)}
        </div>
      </div>
    </section>
  );
}
