import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { api } from './lib/api';
import { WorkspaceLoadingOverlay } from './WorkspaceLoadingOverlay';
import type { ApprovalNotification, ApprovalNotificationFeed } from './components/ApprovalBell';

type SystemNotificationFeed = { items: ApprovalNotification[]; unread_count: number; page: number; pages: number };

function category(item: ApprovalNotification) {
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

function icon(item: ApprovalNotification): ReactNode {
  const Icon = {
    alert: AlertTriangle,
    billing: ReceiptText,
    'due-date': CalendarClock,
    onboarding: Building2,
    audit: ClipboardList,
    people: UserRound,
    security: ShieldAlert,
    general: Bell,
  }[category(item)];
  return <Icon size={18} strokeWidth={2.2} aria-hidden="true" />;
}

function cta(item: ApprovalNotification) {
  if (item.cta_label) return item.cta_label;
  if (item.request_id) return item.kind === 'action' ? 'Review action' : item.kind === 'waiting' ? 'View request' : 'View outcome';
  const kind = item.kind.replace(/^system:/, '').toLowerCase();
  if (kind.includes('payment') || kind.includes('billing')) return 'Review payment';
  if (kind.includes('appointment') || kind.includes('schedule')) return 'View appointment';
  if (kind.includes('patient')) return 'View patient item';
  if (kind.includes('invitation')) return 'View invitation';
  if (kind.includes('password') || kind.includes('recovery')) return 'Review recovery';
  return 'View notification';
}

function ctaHref(item: ApprovalNotification, basePath: string, approvalsHref: string) {
  if (item.request_id) return approvalsHref;
  const adminPath = basePath.replace(/\/settings\/?$/, '');
  if (item.thread_id) return `${adminPath}/care?thread=${encodeURIComponent(item.thread_id)}`;
  const kind = item.kind.replace(/^system:/, '').toLowerCase();
  if (kind.includes('payment') || kind.includes('billing')) return `${adminPath}/billing`;
  if (kind.includes('appointment') || kind.includes('schedule')) return `${adminPath}/schedule`;
  if (kind.includes('patient')) return `${adminPath}/patients`;
  if (kind.includes('invitation')) return `${basePath}/staff`;
  return `${basePath}/notifications`;
}

function groupLabel(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Earlier';
  const age = Math.max(0, Date.now() - timestamp);
  if (age < 24 * 60 * 60 * 1000) return 'Today';
  if (age < 7 * 24 * 60 * 60 * 1000) return 'This week';
  if (age < 30 * 24 * 60 * 60 * 1000) return 'Last 30 days';
  return 'Earlier';
}

function relativeTime(value: string) {
  const minutes = Math.floor(Math.max(0, Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationCenter({ approvalsHref, basePath }: { approvalsHref: string; basePath: string }) {
  const [items, setItems] = useState<ApprovalNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [approvalResult, systemResult] = await Promise.all([
        api<ApprovalNotificationFeed>('/rbac/notifications').catch(() => ({ items: [], unread_count: 0 })),
        api<SystemNotificationFeed>(`/notifications/feed?page=${page}&size=10`).catch(() => ({ items: [], unread_count: 0, page, pages: 0 })),
      ]);
      const approvalItems = approvalResult.items || [];
      const systemItems = (systemResult.items || []).map((item) => ({ ...item, kind: item.kind.startsWith('system:') ? item.kind : `system:${item.kind}` }));
      const seen = new Set<string>();
      const merged = [...approvalItems, ...systemItems].filter((item) => {
        const key = `${item.kind}:${item.request_id || item.id || item.created_at}:${item.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setItems(merged);
      setUnreadCount((approvalResult.unread_count || 0) + (systemResult.unread_count || 0));
      setPages(Math.max(1, systemResult.pages || 1));
      setMessage('');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Notifications could not be loaded');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [page]);

  const grouped = useMemo(() => {
    const groups = new Map<string, ApprovalNotification[]>();
    items.forEach((item) => {
      const label = groupLabel(item.created_at);
      groups.set(label, [...(groups.get(label) || []), item]);
    });
    return [...groups.entries()];
  }, [items]);

  if (loading) return <WorkspaceLoadingOverlay label="Loading notifications" />;
  return <>
    <div className="prototype-page-header mb-6 flex items-center justify-between gap-3">
      <div><h1>Notifications</h1><p className="muted">Review approvals and operational updates for this clinic.</p></div>
      <button type="button" className="btn-secondary" onClick={() => void load()}>Refresh</button>
    </div>
    {message && <p className="prototype-callout" role="status">{message}</p>}
    <section className="panel approval-notification-center-page">
      <div className="prototype-section-head"><div><h2>Notification center</h2><p className="muted">{unreadCount ? `${unreadCount} need your attention` : 'All caught up'}</p></div></div>
      {!grouped.length && <p className="muted p-6">No active notifications.</p>}
      <div className="approval-notification-center-list">
        {grouped.map(([label, group]) => <Fragment key={label}>
          <div className="approval-bell-group-label">{label}</div>
          {group.map((item) => <article key={`${item.kind}-${item.request_id || item.id || item.created_at}`} className="flex items-start gap-3 border-b border-[var(--border)] p-4">
            <span className={`approval-bell-icon is-${category(item)}`}>{icon(item)}</span>
            <div className="approval-bell-copy"><strong>{item.title}</strong><small>{item.detail}</small><time dateTime={item.created_at}>{relativeTime(item.created_at)}</time></div>
            <a className="approval-bell-item-cta" href={ctaHref(item, basePath, approvalsHref)}>{cta(item)} <span aria-hidden="true">→</span></a>
          </article>)}
        </Fragment>)}
      </div>
      <div className="approval-bell-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Next</button></div>
    </section>
  </>;
}
