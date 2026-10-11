import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Building2,
  CalendarClock,
  ClipboardList,
  ReceiptText,
  ShieldAlert,
  UserRound,
} from 'lucide-react';
import { api } from './api';

export type ApprovalNotification = {
  request_id?: string;
  id?: string;
  kind: string;
  title: string;
  detail: string;
  status: string;
  severity?: 'danger' | 'warning' | 'info';
  cta_label?: string;
  created_at: string;
  counted?: boolean;
  seen?: boolean;
  unread?: boolean;
};

export type ApprovalNotificationFeed = { items: ApprovalNotification[]; unread_count: number };
type SystemNotificationFeed = { items: ApprovalNotification[]; unread_count: number; page: number; pages: number };

function needsAttention(item: ApprovalNotification) {
  return Boolean(item.cta_label)
    || item.kind === 'action'
    || item.kind === 'waiting'
    || ['pending', 'retry', 'failed'].includes(item.status);
}

function notificationCta(item: ApprovalNotification) {
  if (item.cta_label) return item.cta_label;
  if (item.request_id) {
    return item.kind === 'action' ? 'Review action' : item.kind === 'waiting' ? 'View request' : 'View outcome';
  }
  const kind = item.kind.replace(/^system:/, '').toLowerCase();
  if (kind.includes('payment') || kind.includes('billing')) return 'Review payment';
  if (kind.includes('appointment') || kind.includes('schedule')) return 'View appointment';
  if (kind.includes('patient')) return 'View patient item';
  if (kind.includes('invitation')) return 'View invitation';
  if (kind.includes('password') || kind.includes('recovery')) return 'Review recovery';
  return 'View notification';
}

function relativeTime(value: string) {
  const age = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(age / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function notificationCategory(item: ApprovalNotification) {
  const text = `${item.kind} ${item.title} ${item.detail}`.toLowerCase();
  if (item.severity === 'danger' || /failed|error|retry|blocked|alert/.test(text)) return 'alert';
  if (/billing|invoice|subscription|plan|payment|payout|refund|deposit/.test(text)) return 'billing';
  if (/due|overdue|installment|appointment|schedule|calendar/.test(text)) return 'due-date';
  if (/onboard|provision|tenant|organization|invitation|invite/.test(text)) return 'onboarding';
  if (/audit|auditing|audit-trail|configuration change/.test(text)) return 'audit';
  if (/patient|clinical|user|staff/.test(text)) return 'people';
  if (/mfa|password|security|recovery|access/.test(text)) return 'security';
  return 'general';
}

function notificationIcon(item: ApprovalNotification): ReactNode {
  const category = notificationCategory(item);
  const Icon = {
    alert: AlertTriangle,
    billing: ReceiptText,
    'due-date': CalendarClock,
    onboarding: Building2,
    audit: ClipboardList,
    people: UserRound,
    security: ShieldAlert,
    general: Bell,
  }[category];
  return <Icon size={17} strokeWidth={2.2} aria-hidden="true" />;
}

function notificationKey(item: ApprovalNotification) {
  return `${item.kind}:${item.request_id || item.id || item.created_at}`;
}

function isUnread(item: ApprovalNotification) {
  return item.unread === true || item.seen === false || needsAttention(item);
}

function notificationGroupLabel(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Earlier';
  const age = Math.max(0, Date.now() - timestamp);
  if (age < 24 * 60 * 60 * 1000) return 'Today';
  if (age < 7 * 24 * 60 * 60 * 1000) return 'This week';
  if (age < 30 * 24 * 60 * 60 * 1000) return 'Last 30 days';
  return 'Earlier';
}

export function ApprovalBell({ domain, approvalsHref }: { domain: 'tenant' | 'platform'; approvalsHref: string }) {
  const [feed, setFeed] = useState<ApprovalNotificationFeed>({ items: [], unread_count: 0 });
  const [systemPage, setSystemPage] = useState(1);
  const [systemPages, setSystemPages] = useState(1);
  const [open, setOpen] = useState(false);
  const readStorageKey = `dhmis:notifications:read:${domain}`;
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try {
      const stored = typeof window === 'undefined' ? null : window.localStorage.getItem(readStorageKey);
      return new Set(stored ? JSON.parse(stored) : []);
    } catch {
      return new Set();
    }
  });
  const root = useRef<HTMLDivElement>(null);
  const prefix = domain === 'platform' ? '/platform/rbac' : '/rbac';

  async function load() {
    const systemPath = domain === 'platform' ? '/platform/notifications' : '/notifications/feed';
    const [approvals, system] = await Promise.all([
      api<ApprovalNotificationFeed>(`${prefix}/notifications`).catch(() => ({ items: [], unread_count: 0 })),
      api<SystemNotificationFeed>(`${systemPath}?page=${systemPage}&size=10`).catch(() => ({ items: [], unread_count: 0, page: systemPage, pages: 0 })),
    ]);
    const approvalItems = approvals.items.map((item) => ({
      ...item,
      severity: item.status === 'rejected' || item.status === 'conflicted' || item.status === 'expired' ? 'danger' as const : item.kind === 'action' || item.kind === 'waiting' ? 'warning' as const : 'info' as const,
    }));
    const systemItems = system.items.map((item) => ({ ...item, kind: `system:${item.kind}` }));
    const items = [...approvalItems, ...systemItems];
    setSystemPages(Math.max(1, system.pages || 1));
    setFeed({ items, unread_count: approvals.unread_count + system.unread_count });
  }
  function markRead(item: ApprovalNotification) {
    const key = notificationKey(item);
    setReadIds((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      try { window.localStorage.setItem(readStorageKey, JSON.stringify([...next])); } catch { /* Storage is optional. */ }
      return next;
    });
  }
  async function openApprovals(item?: ApprovalNotification) {
    if (item) markRead(item);
    try { await api(`${prefix}/notifications/seen`, {}); } catch { /* Keep navigation available. */ }
    window.location.assign(approvalsHref);
  }

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener('focus', refresh);
    window.addEventListener('dhmis:rbac-updated', refresh);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('dhmis:rbac-updated', refresh); };
  }, [prefix, systemPage, domain]);
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

  const visibleItems = useMemo(() => feed.items.filter((item) => !readIds.has(notificationKey(item))), [feed.items, readIds]);
  const unreadCount = visibleItems.filter(isUnread).length;
  const groupedItems = useMemo(() => {
    const groups = new Map<string, ApprovalNotification[]>();
    visibleItems.slice(0, 8).forEach((item) => {
      const label = notificationGroupLabel(item.created_at);
      groups.set(label, [...(groups.get(label) || []), item]);
    });
    return [...groups.entries()];
  }, [visibleItems]);

  return <div className="approval-bell" ref={root}>
    <button type="button" aria-label={`Approvals and notifications${unreadCount ? `, ${unreadCount} need attention` : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Bell size={17} aria-hidden="true" />
      {unreadCount > 0 && <span aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>}
    </button>
    {open && <div className="approval-bell-menu" role="menu">
      <div className="approval-bell-menu-header"><strong>Notifications</strong><small>{unreadCount ? `${unreadCount} need your attention` : 'All caught up'}</small></div>
      {groupedItems.map(([label, items]) => <Fragment key={label}><div className="approval-bell-group-label">{label}</div>{items.map((item) => <button key={`${item.kind}-${item.request_id || item.id || item.created_at}`} type="button" role="menuitem" className={`${item.kind === 'waiting' ? 'is-waiting' : ''} ${item.severity ? `is-${item.severity}` : ''}`} onClick={() => item.request_id ? void openApprovals(item) : (markRead(item), setOpen(false))}><span className={`approval-bell-icon is-${notificationCategory(item)}`}>{notificationIcon(item)}</span><span className="approval-bell-copy"><strong>{item.title}</strong><small>{item.detail}</small><time dateTime={item.created_at}>{relativeTime(item.created_at)}</time><span className="approval-bell-cta">{notificationCta(item)} <span aria-hidden="true">→</span></span></span></button>)}</Fragment>)}
      {!visibleItems.length && <p>No active notifications.</p>}
      <div className="approval-bell-pagination"><button type="button" disabled={systemPage <= 1} onClick={() => setSystemPage((page) => page - 1)}>Previous</button><span>Page {systemPage} of {systemPages}</span><button type="button" disabled={systemPage >= systemPages} onClick={() => setSystemPage((page) => page + 1)}>Next</button></div>
      <button type="button" role="menuitem" className="approval-bell-open" onClick={() => void openApprovals()}>Open approvals</button>
    </div>}
  </div>;
}
