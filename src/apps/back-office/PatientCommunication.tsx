import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from './lib/api';
import { DEFAULT_PAGE_SIZE, Pagination } from './components/Pagination';

type PatientChoice = { id: string; first_name: string; last_name: string; email?: string; location_id?: string };
type LocationChoice = { id: string; name: string };
type MessageThread = { id: string; patient_id: string; subject: string; status: string; updated_at: string; latest_sender_type?: string; is_new?: boolean };
type ThreadMessage = { id: string; sender_type: string; body: string; created_at: string };
type MessagePage = { items: MessageThread[]; page: number; page_size: number; total: number; pages: number; new_count: number };
type ConversationFilter = 'all' | 'new' | 'open' | 'history';

export function PatientCommunication({
  patients,
  locations,
  run,
  busy,
  permissions,
}: {
  patients: PatientChoice[];
  locations: LocationChoice[];
  run: (action: () => Promise<void>, successMessage?: string) => Promise<void>;
  busy: boolean;
  permissions: string[];
}) {
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [selectedPatient, setSelectedPatient] = useState('');
  const [selectedThreadId, setSelectedThreadId] = useState('');
  const [selectedMessages, setSelectedMessages] = useState<ThreadMessage[]>([]);
  const [threadDetails, setThreadDetails] = useState<Record<string, ThreadMessage[]>>({});
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [messagePage, setMessagePage] = useState<MessagePage>({ items: [], page: 1, page_size: DEFAULT_PAGE_SIZE, total: 0, pages: 0, new_count: 0 });
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [newLocationId, setNewLocationId] = useState('');
  const requestSequence = useRef(0);
  const prefetching = useRef(new Set<string>());
  const canClose = permissions.includes('messaging.message_thread.close');

  const patientNames = useMemo(
    () => new Map(patients.map((patient) => [patient.id, `${patient.first_name} ${patient.last_name}`])),
    [patients],
  );
  const groupedPatients = useMemo(() => {
    const groups = new Map<string, PatientChoice[]>();
    patients.forEach((patient) => {
      const locationId = patient.location_id || '';
      if (newLocationId && locationId !== newLocationId) return;
      const rows = groups.get(locationId) || [];
      rows.push(patient);
      groups.set(locationId, rows);
    });
    return [...groups.entries()].sort(([a], [b]) => {
      const nameA = locations.find((location) => location.id === a)?.name || 'Other locations';
      const nameB = locations.find((location) => location.id === b)?.name || 'Other locations';
      return nameA.localeCompare(nameB);
    });
  }, [locations, newLocationId, patients]);
  const visibleThreads = threads;
  const newThreads = visibleThreads.filter((thread) => thread.is_new);
  const openThreads = visibleThreads.filter((thread) => thread.status === 'open' && !thread.is_new);
  const historyThreads = visibleThreads.filter((thread) => thread.status === 'closed');

  async function load(page = 1, overrides: { search?: string; selectedPatient?: string; filter?: ConversationFilter; pageSize?: number } = {}) {
    setError('');
    setLoading(true);
    const effectiveSearch = overrides.search ?? search;
    const effectivePatient = overrides.selectedPatient ?? selectedPatient;
    const effectiveFilter = overrides.filter ?? filter;
    const effectivePageSize = overrides.pageSize ?? messagePage.page_size;
    const query = new URLSearchParams({ page: String(page), page_size: String(effectivePageSize) });
    if (effectiveSearch.trim()) query.set('search', effectiveSearch.trim());
    if (effectivePatient) query.set('patient_id', effectivePatient);
    if (effectiveFilter === 'history') query.set('status', 'closed');
    if (effectiveFilter === 'new') query.set('status', 'new');
    if (effectiveFilter === 'open') query.set('status', 'open');
    try {
      const result = await api<MessagePage>(`/messages/page?${query}`);
      setThreads(result.items);
      setMessagePage(result);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Patient communication could not be loaded'); }
    finally { setLoading(false); }
  }

  async function openThread(threadId: string, force = false) {
    const sequence = ++requestSequence.current;
    if (!force && selectedThreadId === threadId) {
      setSelectedThreadId('');
      setThreadLoading(false);
      return;
    }
    if (!force && threadDetails[threadId]) {
      setThreadLoading(false);
      setSelectedThreadId(threadId);
      setSelectedMessages(threadDetails[threadId]);
      return;
    }
    setThreadLoading(true);
    try {
      const result = await api<{ thread: MessageThread; messages: ThreadMessage[] }>(`/messages/${threadId}`);
      if (sequence !== requestSequence.current) return;
      setSelectedThreadId(threadId);
      setSelectedMessages(result.messages);
      setThreadDetails((current) => ({ ...current, [threadId]: result.messages }));
      setThreads((current) => current.some((thread) => thread.id === result.thread.id)
        ? current.map((thread) => thread.id === result.thread.id ? { ...thread, ...result.thread } : thread)
        : [result.thread, ...current]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The patient conversation could not be opened');
    } finally {
      setThreadLoading(false);
    }
  }

  async function prefetchThread(threadId: string) {
    if (threadDetails[threadId] || prefetching.current.has(threadId)) return;
    prefetching.current.add(threadId);
    try {
      const result = await api<{ thread: MessageThread; messages: ThreadMessage[] }>(`/messages/${threadId}`);
      setThreadDetails((current) => ({ ...current, [threadId]: result.messages }));
    } catch {
      // The click path reports errors; speculative prefetch remains silent.
    } finally {
      prefetching.current.delete(threadId);
    }
  }

  async function reply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const threadId = String(form.get('thread_id') || '');
    await run(async () => {
      await api(`/messages/${threadId}/reply`, { body: String(form.get('body') || '') });
      setThreadDetails((current) => { const next = { ...current }; delete next[threadId]; return next; });
      await openThread(threadId, true);
      await load(messagePage.page);
      event.currentTarget.reset();
    }, 'Message sent.');
  }

  async function createMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    let createdId = '';
    await run(async () => {
      const result = await api<{ thread: MessageThread }>('/messages', {
        patient_id: String(form.get('patient_id') || ''),
        subject: String(form.get('subject') || ''),
        body: String(form.get('body') || ''),
      });
      createdId = result.thread.id;
      setNewMessageOpen(false);
      setNewLocationId('');
      formElement.reset();
      await load();
      await openThread(createdId, true);
    }, 'Message sent securely.');
  }

  async function closeThread(threadId: string) {
    if (!canClose) return;
    await run(async () => {
      await api(`/messages/${threadId}/close`, {});
      setThreadDetails((current) => { const next = { ...current }; delete next[threadId]; return next; });
      setSelectedThreadId('');
      setSelectedMessages([]);
      await load(messagePage.page);
    }, 'Conversation resolved and closed.');
  }

  useEffect(() => {
    void load(1);
  }, []);

  useEffect(() => {
    const threadId = new URLSearchParams(window.location.search).get('thread');
    if (threadId) void openThread(threadId);
    const handleNotification = (event: Event) => {
      const threadId = (event as CustomEvent<{ threadId?: string }>).detail?.threadId;
      if (threadId) void openThread(threadId);
    };
    window.addEventListener('dhmis:open-message', handleNotification);
    return () => window.removeEventListener('dhmis:open-message', handleNotification);
  }, []);

  function renderThread(thread: MessageThread) {
    const selected = selectedThreadId === thread.id;
    const summary = thread.is_new ? patientNames.get(thread.patient_id) || 'Patient' : thread.status === 'closed' ? 'Closed conversation' : 'You replied';
    return <article key={thread.id} onMouseEnter={() => void prefetchThread(thread.id)} className={`min-h-[7.2rem] rounded-lg border p-4 ${selected ? (thread.is_new ? 'border-[var(--sage)] bg-[var(--sage-tint)]' : 'border-[var(--border)] bg-[var(--paper)]') : 'border-[var(--border)]'}`}>
      <button type="button" className="w-full text-left" onClick={() => void openThread(thread.id)}>
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>{thread.subject}</strong><time className="muted text-sm">{new Date(thread.updated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div>
        <p className="muted text-sm">{summary}</p>
      </button>
      {selected && <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3 lg:hidden">
        {threadLoading ? <div className="py-5 text-center"><span className="inline-loader" role="status" aria-label="Loading conversation" /></div> : <>
          {selectedMessages.map((message) => <p key={message.id} className={`rounded-md p-3 text-sm ${message.sender_type === 'patient' ? 'bg-[var(--paper)]' : 'ml-auto bg-[var(--sage-tint)]'}`}><strong>{message.sender_type === 'patient' ? 'Patient' : 'Clinic'}:</strong> {message.body}</p>)}
          {thread.status !== 'closed' && <form className="flex flex-wrap gap-2" onSubmit={reply}><input type="hidden" name="thread_id" value={thread.id} /><input className="field min-w-[16rem] flex-1" name="body" placeholder="Reply securely" required /><button className="btn" disabled={busy}>Send</button></form>}
          {canClose && thread.status !== 'closed' && <button type="button" className="btn-secondary w-full" disabled={busy} onClick={() => void closeThread(thread.id)}>Mark resolved</button>}
        </>}
      </div>}
    </article>;
  }

  return (
    <section className="space-y-5">
      <div className="prototype-page-header flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-semibold" style={{ fontSize: '2.75rem', lineHeight: 1.1 }}>Messages</h1>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={() => { setNewMessageOpen((current) => !current); setSelectedThreadId(''); setSelectedMessages([]); }} disabled={busy}>{newMessageOpen ? 'Hide' : '+ New message'}</button>
          <button type="button" className="btn-secondary" onClick={() => void load()} disabled={busy}>Refresh</button>
        </div>
      </div>
      {error && <p className="prototype-callout" role="alert">{error}</p>}
      <section className="grid gap-8 lg:grid-cols-[minmax(15rem,34rem)_minmax(0,1fr)]">
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input className="field w-full" value={search} onChange={(event) => { const value = event.target.value; setSearch(value); void load(1, { search: value }); }} placeholder="Search patient or message" />
            <button type="button" className={filter === 'all' ? 'btn' : 'btn-secondary'} onClick={() => { setFilter('all'); void load(1, { filter: 'all' }); }}>All</button>
            <button type="button" className={filter === 'new' ? 'btn' : 'btn-secondary'} onClick={() => { setFilter('new'); void load(1, { filter: 'new' }); }}>New · {messagePage.new_count}</button>
            <button type="button" className={filter === 'open' ? 'btn' : 'btn-secondary'} onClick={() => { setFilter('open'); void load(1, { filter: 'open' }); }}>Open</button>
            <button type="button" className={filter === 'history' ? 'btn' : 'btn-secondary'} onClick={() => { setFilter('history'); void load(1, { filter: 'history' }); }}>History</button>
          </div>
          {loading && <div className="py-10 text-center"><span className="inline-loader" role="status" aria-label="Loading messages" /></div>}
          {!loading && !visibleThreads.length && <p className="muted py-8">No patient conversations yet.</p>}
          {!loading && <div className="space-y-5">
            {newThreads.length > 0 && <section><h3 className="mb-3 px-1 text-sm font-semibold uppercase tracking-wide text-[var(--sage-deep)]">New</h3><div className="space-y-2">{newThreads.map(renderThread)}</div></section>}
            {openThreads.length > 0 && <section><h3 className="mb-3 px-1 text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Open</h3><div className="space-y-2">{openThreads.map(renderThread)}</div></section>}
            {historyThreads.length > 0 && <section><h3 className="mb-3 px-1 text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">History</h3><div className="space-y-2">{historyThreads.map(renderThread)}</div></section>}
          </div>}
          <Pagination page={messagePage.page} pageSize={messagePage.page_size} total={messagePage.total} pages={messagePage.pages} label="conversations" busy={loading} onPage={(next) => void load(next)} onPageSize={(size) => void load(1, { pageSize: size })} />
        </div>
        <div className="min-h-[40rem] rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">{newMessageOpen ? <form className="space-y-4" onSubmit={createMessage}><div><h2 className="text-2xl font-semibold">New message</h2><p className="muted">Send a secure message to a registered patient.</p></div><label className="block text-sm">Location<select className="field mt-1" value={newLocationId} onChange={(event) => setNewLocationId(event.target.value)}><option value="">All locations</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label className="block text-sm">Patient<select className="field mt-1" name="patient_id" required defaultValue=""><option value="" disabled>Select a patient</option>{groupedPatients.map(([locationId, rows]) => <optgroup key={locationId || 'unassigned'} label={locations.find((location) => location.id === locationId)?.name || 'Other locations'}>{rows.map((patient) => <option key={patient.id} value={patient.id}>{patient.first_name} {patient.last_name}{patient.email ? ` · ${patient.email}` : ''}</option>)}</optgroup>)}</select></label><label className="block text-sm">Subject<input className="field mt-1" name="subject" maxLength={180} required /></label><label className="block text-sm">Message<textarea className="field mt-1 min-h-[10rem]" name="body" maxLength={8000} required /></label><button className="btn" disabled={busy || !patients.length}>Send securely</button></form> : threadLoading ? <div className="py-10 text-center"><span className="inline-loader" role="status" aria-label="Loading conversation" /></div> : selectedThreadId ? <><div className="mb-4 flex items-start justify-between gap-3 border-b border-[var(--border)] pb-4"><div><h2 className="text-xl font-semibold">{threads.find((thread) => thread.id === selectedThreadId)?.subject}</h2><p className="muted">{patientNames.get(threads.find((thread) => thread.id === selectedThreadId)?.patient_id || '') || 'Patient'}</p></div><div className="flex items-center gap-2"><span className="prototype-badge">{threads.find((thread) => thread.id === selectedThreadId)?.status === 'closed' ? 'Closed' : 'Open'}</span>{canClose && threads.find((thread) => thread.id === selectedThreadId)?.status !== 'closed' && <button type="button" className="btn-secondary shrink-0" disabled={busy} onClick={() => void closeThread(selectedThreadId)}>Mark resolved</button>}</div></div><div className="space-y-3">{selectedMessages.map((message) => <div key={message.id} className={`max-w-[85%] ${message.sender_type === 'clinic' ? 'ml-auto text-right' : ''}`}><p className={`rounded-xl p-3 text-sm ${message.sender_type === 'patient' ? 'bg-[var(--paper)]' : 'bg-[var(--sage-tint)]'}`}>{message.body}</p><small className="muted">{message.sender_type === 'clinic' ? 'Sent securely' : new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></div>)}</div>{threads.find((thread) => thread.id === selectedThreadId)?.status !== 'closed' && <form className="mt-5 flex gap-2 border-t border-[var(--border)] pt-5" onSubmit={reply}><input type="hidden" name="thread_id" value={selectedThreadId} /><input className="field flex-1" name="body" placeholder="Reply securely" required /><button className="btn" disabled={busy}>Send</button></form>}</> : <p className="muted">Select a conversation to read and reply.</p>}</div>
      </section>
    </section>
  );
}
