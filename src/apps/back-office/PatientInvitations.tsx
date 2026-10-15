import { useEffect, useState } from 'react';
import { api } from './lib/api';
import { DEFAULT_PAGE_SIZE, Pagination } from './components/Pagination';

interface PatientInvitation {
  id: string;
  patient_id: string;
  recipient_name: string;
  email: string;
  created_at: string;
  expires: number;
  status: string;
}

interface Page<T> {
  page: number;
  page_size: number;
  total: number;
  items: T[];
}

export function PatientInvitations() {
  const [page, setPage] = useState<Page<PatientInvitation>>({ page: 1, page_size: DEFAULT_PAGE_SIZE, total: 0, items: [] });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [message, setMessage] = useState('');
  const [invitationLink, setInvitationLink] = useState('');
  const [busy, setBusy] = useState(false);

  async function load(nextPage = 1, nextPageSize = page.page_size) {
    setBusy(true);
    try {
      const query = new URLSearchParams({ page: String(nextPage), page_size: String(nextPageSize) });
      if (search) query.set('search', search);
      if (status) query.set('status', status);
      setPage(await api<Page<PatientInvitation>>(`/portal/invites/query?${query}`));
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Patient invitations could not be loaded');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function action(identifier: string, operation: 'resend' | 'revoke') {
    setBusy(true);
    try {
      const result = await api<{ token?: string; invitation_link?: string }>(`/portal/invites/${identifier}/${operation}`, {});
      setInvitationLink(result.invitation_link || '');
      setMessage(result.invitation_link ? 'Replacement Client Portal invitation created.' : 'Invitation revoked.');
      await load(page.page, page.page_size);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Invitation update failed');
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-semibold">Patient invitations</h1><p className="muted text-sm">Client Portal invitations issued by this organization.</p></div></div>
      {message && <p className="prototype-callout mb-3" role="status">{message}{invitationLink && <> <a className="underline" href={invitationLink}>{invitationLink}</a></>}</p>}
      <form className="mb-4 grid gap-2 md:grid-cols-[2fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); void load(1); }}>
        <label className="text-sm">Find patient invitation<input className="field mt-1" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or email" /></label>
        <label className="text-sm">Status<select className="field mt-1" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All</option><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="expired">Expired</option></select></label>
        <button className="btn-secondary self-end" disabled={busy}>Apply filters</button>
      </form>
      <div className="overflow-auto"><table><thead><tr><th>Patient</th><th>Recipient</th><th>Created</th><th>Expires</th><th>Status</th><th>Actions</th></tr></thead><tbody>{page.items.map((invitation) => <tr key={invitation.id}><td><strong>{invitation.recipient_name}</strong><p className="muted text-xs">{invitation.patient_id}</p></td><td>{invitation.email}</td><td>{new Date(invitation.created_at).toLocaleString()}</td><td>{new Date(invitation.expires * 1000).toLocaleString()}</td><td>{invitation.status}</td><td>{['pending', 'expired'].includes(invitation.status) && <button type="button" className="btn-secondary" disabled={busy} onClick={() => void action(invitation.id, 'resend')}>Resend</button>} {invitation.status === 'pending' && <button type="button" className="btn-secondary ml-2" disabled={busy} onClick={() => void action(invitation.id, 'revoke')}>Revoke</button>}</td></tr>)}</tbody></table>{!page.items.length && <p className="muted p-4">No patient invitations match these filters.</p>}</div>
      <Pagination page={page.page} pageSize={page.page_size} total={page.total} label="patient invitations" busy={busy} onPage={(next) => void load(next)} onPageSize={(size) => void load(1, size)} />
    </section>
  );
}
