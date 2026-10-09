import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { api } from './api';

export type ApprovalNotification = {
  request_id: string;
  kind: 'action' | 'decision' | 'waiting';
  title: string;
  detail: string;
  status: string;
  created_at: string;
  counted: boolean;
  seen: boolean;
};

export type ApprovalNotificationFeed = { items: ApprovalNotification[]; unread_count: number };

export function ApprovalBell({ domain, approvalsHref }: { domain: 'tenant' | 'platform'; approvalsHref: string }) {
  const [feed, setFeed] = useState<ApprovalNotificationFeed>({ items: [], unread_count: 0 });
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const prefix = domain === 'platform' ? '/platform/rbac' : '/rbac';

  async function load() {
    try { setFeed(await api<ApprovalNotificationFeed>(`${prefix}/notifications`)); }
    catch { setFeed({ items: [], unread_count: 0 }); }
  }
  async function openApprovals() {
    try { await api(`${prefix}/notifications/seen`, {}); } catch { /* Keep navigation available. */ }
    window.location.assign(approvalsHref);
  }

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener('focus', refresh);
    window.addEventListener('dhmis:rbac-updated', refresh);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('dhmis:rbac-updated', refresh); };
  }, [prefix]);
  useEffect(() => {
    function dismiss(event: MouseEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (event instanceof MouseEvent && root.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', dismiss); };
  }, []);

  return <div className="approval-bell" ref={root}>
    <button type="button" aria-label={`Approvals and notifications${feed.unread_count ? `, ${feed.unread_count} need attention` : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Bell size={17} aria-hidden="true" />
      {feed.unread_count > 0 && <span aria-hidden="true">{feed.unread_count > 99 ? '99+' : feed.unread_count}</span>}
    </button>
    {open && <div className="approval-bell-menu" role="menu">
      <div><strong>Approvals</strong><small>{feed.unread_count ? `${feed.unread_count} need your attention` : 'Nothing needs your attention'}</small></div>
      {feed.items.slice(0, 8).map((item) => <button key={`${item.kind}-${item.request_id}`} type="button" role="menuitem" className={item.kind === 'waiting' ? 'is-waiting' : ''} onClick={() => void openApprovals()}><strong>{item.title}</strong><small>{item.detail}</small></button>)}
      {!feed.items.length && <p>No role or action approval updates.</p>}
      <button type="button" role="menuitem" className="approval-bell-open" onClick={() => void openApprovals()}>Open approvals</button>
    </div>}
  </div>;
}
