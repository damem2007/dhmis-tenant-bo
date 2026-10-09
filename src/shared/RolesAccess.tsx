import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from './api';

type Domain = 'tenant' | 'platform';
type Page<T> = { page: number; size: number; total: number; pages: number; items: T[] };
type Grant = { permission_key: string; effect: 'allow' | 'deny'; scope: string; conditions: Record<string, unknown> };
type Role = { id: string; domain: Domain; name: string; description: string; status: string; parent_id: string | null; locked: boolean; version: number; user_count: number; permission_count: number; grants: Grant[] };
type Permission = { key: string; domain: Domain; module_id: string; module_name: string; resource_key: string; resource_name: string; action: string; group: string; risk: number; restricted: boolean; reviewed: boolean; retired: boolean; requires: string[]; valid_scopes: string[] };
type Decision = { permission_key: string; allowed: boolean; reach: string | null; filter_scope: string | null; needs_approval: boolean; needs_step_up: boolean; governing_rule_id: string | null; trace: string[] };
type ChangeRequest = { id: string; kind: string; status: string; maker_id: string; reason: string; risk: number; affected_users: number; required_approvals: number; expires_at: string; break_glass: boolean; decisions: { user_id: string; decision: string; comment: string; decided_at: string }[] };
type History = { id: string; version: number; author_id: string; approver_ids: string[]; reason: string; changes: unknown[]; break_glass: boolean; created_at: string };
type ApprovalSettings = { require_role_grant_critical_or_four_eyes: boolean; require_high_risk_assignment: boolean; require_sod_conflict: boolean; require_every_change: boolean; require_superadmin_change: boolean; approvers_needed: number; expires_after_hours: number; tenant_eligible_roles: string[]; platform_eligible_roles: string[]; break_glass_enabled: boolean; break_glass_requires_step_up_mfa: boolean; break_glass_review_within_hours: number };
type FourEyesRule = { id: string; name: string; scope: 'Off' | 'Tenant' | 'Platform' | 'Both'; priority: number; patterns: string[]; matches: number; governed: number; overlaps: number };
type RuleOverlap = { permission_key: string; label: string; match_count: number; rules: { id: string; name: string; priority: number; governs: boolean }[] };
type PolicyData = { settings: ApprovalSettings; rules: Page<FourEyesRule>; overlaps: RuleOverlap[]; awaiting_review: Permission[] };
type Tab = 'roles' | 'compare' | 'effective' | 'approvals' | 'policy' | 'history';

const emptyPage = <T,>(): Page<T> => ({ page: 1, size: 10, total: 0, pages: 0, items: [] });
const tone = (status: string) => status === 'published' || status === 'approved' || status === 'applied' ? 'good' : status === 'pending' ? 'info' : status === 'rejected' || status === 'conflicted' ? 'danger' : 'neutral';

export function RolesAccess({ domain }: { domain: Domain }) {
  const prefix = domain === 'platform' ? '/platform/rbac' : '/rbac';
  const requestedTab = new URLSearchParams(window.location.search).get('tab');
  const [tab, setTab] = useState<Tab>((['roles', 'compare', 'effective', 'approvals', 'policy', 'history'] as Tab[]).includes(requestedTab as Tab) ? requestedTab as Tab : 'roles');
  const [roles, setRoles] = useState<Page<Role>>(emptyPage());
  const [permissions, setPermissions] = useState<Page<Permission>>(emptyPage());
  const [requests, setRequests] = useState<Page<ChangeRequest>>(emptyPage());
  const [history, setHistory] = useState<Page<History>>(emptyPage());
  const [policy, setPolicy] = useState<PolicyData | null>(null);
  const [policyDraft, setPolicyDraft] = useState<ApprovalSettings | null>(null);
  const [ruleDrafts, setRuleDrafts] = useState<FourEyesRule[]>([]);
  const [policyPage, setPolicyPage] = useState(1);
  const [policySize, setPolicySize] = useState(10);
  const [policyReason, setPolicyReason] = useState('');
  const [ruleReason, setRuleReason] = useState('');
  const [dragRuleId, setDragRuleId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [draftGrants, setDraftGrants] = useState<Record<string, Grant>>({});
  const [search, setSearch] = useState('');
  const [permissionPage, setPermissionPage] = useState(1);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkKey, setCheckKey] = useState('');
  const [checkUser, setCheckUser] = useState('');
  const [decision, setDecision] = useState<Decision | null>(null);
  const selected = roles.items.find((role) => role.id === selectedId) || roles.items[0];

  async function loadRoles(preferredId = selectedId) {
    const result = await api<Page<Role>>(`${prefix}/roles?page=1&size=50`);
    setRoles(result);
    const next = result.items.find((role) => role.id === preferredId) || result.items[0];
    setSelectedId(next?.id || '');
    setDraftGrants(Object.fromEntries((next?.grants || []).map((grant) => [grant.permission_key, grant])));
  }
  async function loadPermissions(page = permissionPage) {
    const query = new URLSearchParams({ domain, page: String(page), size: '50' });
    if (search) query.set('search', search);
    setPermissions(await api<Page<Permission>>(`${prefix}/permissions?${query}`));
    setPermissionPage(page);
  }
  async function loadRequests() { setRequests(await api<Page<ChangeRequest>>(`${prefix}/requests?page=1&size=25`)); }
  async function loadHistory() { setHistory(await api<Page<History>>(`${prefix}/history?page=1&size=25`)); }
  async function loadPolicy(page = policyPage, size = policySize) {
    const result = await api<PolicyData>(`${prefix}/policy?page=${page}&size=${size}`);
    const full = page === 1 && size === 50 ? result : await api<PolicyData>(`${prefix}/policy?page=1&size=50`);
    setPolicy(result); setPolicyDraft(result.settings); setRuleDrafts(full.rules.items); setPolicyPage(page); setPolicySize(size);
  }
  async function refresh() {
    setBusy(true);
    setMessage('');
    try { await Promise.all([loadRoles(), loadPermissions(), loadRequests(), loadHistory(), loadPolicy()]); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Roles and access could not be loaded'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, [domain]);
  useEffect(() => {
    if (tab !== 'approvals') return;
    void api(`${prefix}/notifications/seen`, {})
      .then(() => window.dispatchEvent(new Event('dhmis:rbac-updated')))
      .catch(() => undefined);
  }, [tab, prefix]);
  useEffect(() => {
    if (!selected) return;
    setDraftGrants(Object.fromEntries(selected.grants.map((grant) => [grant.permission_key, grant])));
  }, [selectedId, roles.items]);

  const modules = useMemo(() => {
    const grouped = new Map<string, Permission[]>();
    permissions.items.forEach((permission) => grouped.set(permission.module_name, [...(grouped.get(permission.module_name) || []), permission]));
    return [...grouped.entries()];
  }, [permissions.items]);

  function updateGrant(permission: Permission, effect: '' | 'allow' | 'deny', scope?: string) {
    setDraftGrants((current) => {
      const next = { ...current };
      if (!effect) delete next[permission.key];
      else next[permission.key] = { permission_key: permission.key, effect, scope: scope || current[permission.key]?.scope || permission.valid_scopes[0], conditions: current[permission.key]?.conditions || {} };
      return next;
    });
  }
  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await act(async () => { const role = await api<Role>(`${prefix}/roles`, { name: form.get('name'), description: form.get('description'), copy_from_id: form.get('copy_from_id') || null }); await loadRoles(role.id); event.currentTarget.reset(); });
  }
  async function updateDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; const form = new FormData(event.currentTarget);
    await act(async () => { await api(`${prefix}/roles/${selected.id}`, { name: form.get('name'), description: form.get('description'), version: selected.version }, 'PATCH'); await loadRoles(selected.id); });
  }
  async function lifecycle(action: 'deactivate' | 'reactivate' | 'archive' | 'restore' | 'delete') {
    if (!selected) return;
    const detail = action === 'delete' ? 'This permanently removes the draft.' : action === 'archive' ? 'This archives the role. It can be restored later.' : action === 'deactivate' ? 'New assignments will be blocked; existing holders retain access.' : `Continue with ${action}?`;
    if (!window.confirm(`${action[0].toUpperCase() + action.slice(1)} “${selected.name}”? ${detail}`)) return;
    await act(async () => { if (action === 'delete') await api(`${prefix}/roles/${selected.id}`, undefined, 'DELETE'); else await api(`${prefix}/roles/${selected.id}/${action}`, {}); await loadRoles(); });
  }
  async function saveGrants() {
    if (!selected) return;
    await act(async () => { await api(`${prefix}/roles/${selected.id}/grants`, { version: selected.version, grants: Object.values(draftGrants) }, 'PUT'); await loadRoles(selected.id); });
  }
  async function publish() {
    if (!selected) return;
    await act(async () => { await api(`${prefix}/roles/${selected.id}/publish`, {}); await loadRoles(selected.id); });
  }
  async function submitChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; const form = new FormData(event.currentTarget);
    await act(async () => { await api(`${prefix}/roles/${selected.id}/changes`, { version: selected.version, grants: Object.values(draftGrants), publish: selected.status === 'draft', reason: form.get('reason'), acknowledge_conflicts: form.get('acknowledge') === 'on', break_glass: false }); await Promise.all([loadRoles(selected.id), loadRequests()]); });
  }
  async function requestAction(request: ChangeRequest, action: 'approve' | 'reject' | 'withdraw') {
    const comment = action === 'reject' ? window.prompt('Why are you rejecting this request?') || '' : '';
    await act(async () => { await api(`${prefix}/requests/${request.id}/${action}`, { comment }); await Promise.all([loadRequests(), loadRoles(selectedId), loadHistory(), loadPolicy()]); });
  }
  async function checkAccess(event: FormEvent) {
    event.preventDefault();
    await act(async () => { const query = new URLSearchParams({ key: checkKey }); if (checkUser) query.set('user_id', checkUser); setDecision(await api<Decision>(`${prefix}/check?${query}`)); });
  }
  async function act(work: () => Promise<void>) { setBusy(true); setMessage(''); try { await work(); setMessage('Saved.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'The operation failed'); } finally { setBusy(false); } }
  async function submitPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!policyDraft) return;
    await act(async () => { await api(`${prefix}/policy`, { settings: policyDraft, reason: policyReason }, 'PUT'); setPolicyReason(''); await loadRequests(); setTab('approvals'); });
  }
  function normalizedRules(values: FourEyesRule[]) { return values.map((rule, index) => ({ ...rule, priority: (index + 1) * 10 })); }
  function moveRule(identifier: string, offset: number) {
    setRuleDrafts((current) => { const index = current.findIndex((rule) => rule.id === identifier); const target = index + offset; if (index < 0 || target < 0 || target >= current.length) return current; const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return normalizedRules(next); });
  }
  function dropRule(targetId: string) {
    if (!dragRuleId || dragRuleId === targetId) return;
    setRuleDrafts((current) => { const from = current.findIndex((rule) => rule.id === dragRuleId); const to = current.findIndex((rule) => rule.id === targetId); if (from < 0 || to < 0) return current; const next = [...current]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return normalizedRules(next); });
    setDragRuleId('');
  }
  function addRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get('name') || '').trim(); const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80); const patterns = String(form.get('patterns') || '').split(';').map((item) => item.trim()).filter(Boolean); if (!id || !patterns.length || ruleDrafts.some((rule) => rule.id === id)) { setMessage('Use a unique rule name and at least one permission pattern.'); return; } setRuleDrafts(normalizedRules([...ruleDrafts, { id, name, scope: String(form.get('scope')) as FourEyesRule['scope'], priority: 0, patterns, matches: 0, governed: 0, overlaps: 0 }])); event.currentTarget.reset();
  }
  async function submitRules(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await act(async () => { await api(`${prefix}/four-eyes-rules`, { rules: normalizedRules(ruleDrafts).map(({ matches: _matches, governed: _governed, overlaps: _overlaps, ...rule }) => rule), reason: ruleReason }, 'PUT'); setRuleReason(''); await loadRequests(); setTab('approvals'); });
  }

  return <section className="rbac-page" aria-busy={busy}>
    <div className="prototype-section-head"><div><h2>Roles &amp; access</h2><p>{domain === 'platform' ? 'Platform identities and control-plane permissions.' : 'Tenant staff roles, scope, and maker-checker governance.'}</p></div><span className="prototype-badge prototype-badge-info">{domain === 'platform' ? 'Platform' : 'Tenant'} domain</span></div>
    {message && <p className="prototype-callout" role="status">{message}</p>}
    <div className="prototype-tabs" role="tablist">{(['roles', 'compare', 'effective', 'approvals', 'policy', 'history'] as Tab[]).map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>{item === 'effective' ? 'Effective access' : item === 'policy' ? 'Approval policy' : item[0].toUpperCase() + item.slice(1)}{item === 'approvals' && requests.items.filter((request) => request.status === 'pending').length > 0 ? ` (${requests.items.filter((request) => request.status === 'pending').length})` : ''}</button>)}</div>

    {tab === 'roles' && <>
      <form className="rbac-add-role" onSubmit={createRole}><input className="field" name="name" minLength={3} placeholder="New role name" required /><input className="field" name="description" placeholder="Description" /><select className="field" name="copy_from_id" defaultValue=""><option value="">Start empty</option>{roles.items.filter((role) => role.status === 'published' && !role.locked).map((role) => <option key={role.id} value={role.id}>Copy {role.name}</option>)}</select><button className="btn" disabled={busy}>Add role</button></form>
      <div className="prototype-roles-layout">
        <aside className="panel prototype-role-list">{roles.items.map((role) => <button type="button" key={role.id} aria-current={selected?.id === role.id ? 'page' : undefined} onClick={() => setSelectedId(role.id)}><strong>{role.name}</strong><span>{role.status} · {role.user_count} users · {role.permission_count} grants</span></button>)}</aside>
        <section className="panel min-w-0"><div className="prototype-section-head"><div><h2>{selected?.name || 'No role selected'}</h2><p>{selected?.description || 'Create a role to configure access.'}</p></div>{selected && <div className="rbac-role-actions"><span className={`prototype-badge prototype-badge-${tone(selected.status)}`}>{selected.locked ? 'Locked · ' : ''}{selected.status}</span>{!selected.locked && selected.status === 'draft' && <button className="btn-secondary" type="button" onClick={() => void lifecycle('delete')}>Delete draft</button>}{!selected.locked && selected.status === 'published' && <><button className="btn-secondary" type="button" onClick={() => void lifecycle('deactivate')}>Deactivate</button><button className="btn-secondary" type="button" disabled={selected.user_count > 0} title={selected.user_count ? 'Reassign its users first' : ''} onClick={() => void lifecycle('archive')}>Archive</button></>}{!selected.locked && selected.status === 'inactive' && <><button className="btn-secondary" type="button" onClick={() => void lifecycle('reactivate')}>Reactivate</button><button className="btn-secondary" type="button" disabled={selected.user_count > 0} title={selected.user_count ? 'Reassign its users first' : ''} onClick={() => void lifecycle('archive')}>Archive</button></>}{!selected.locked && selected.status === 'archived' && <button className="btn-secondary" type="button" onClick={() => void lifecycle('restore')}>Restore</button>}</div>}</div>
          {selected?.status === 'draft' && !selected.locked && <form className="rbac-draft-details" onSubmit={updateDraft}><label className="label">Role name<input className="field" name="name" minLength={3} defaultValue={selected.name} key={`${selected.id}-name`} required /></label><label className="label">Description<input className="field" name="description" defaultValue={selected.description} key={`${selected.id}-description`} /></label><button className="btn-secondary self-end" disabled={busy}>Save details</button></form>}
          {selected && <p className="rbac-assignable">{selected.status === 'published' ? '✓ Assignable when creating accounts and inviting staff.' : `✕ Not assignable: ${selected.status === 'draft' ? 'publish this role first.' : selected.status === 'inactive' ? 'the role is inactive.' : selected.status === 'archived' ? 'the role is archived.' : 'waiting for approval.'}`}</p>}
          {selected && <><form className="prototype-controls" onSubmit={(event) => { event.preventDefault(); void loadPermissions(1); }}><input className="field" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search permissions…" /><button className="btn-secondary">Search</button></form><div className="rbac-permission-list">{modules.map(([module, items]) => <details key={module} open><summary><strong>{module}</strong><span>{items.filter((item) => draftGrants[item.key]?.effect === 'allow').length} of {items.length} allowed on this page</span></summary><div className="overflow-auto"><table><thead><tr><th>Resource / action</th><th>Access</th><th>Scope</th><th>Risk</th></tr></thead><tbody>{items.map((permission) => { const grant = draftGrants[permission.key]; return <tr key={permission.key}><td><strong>{permission.resource_name}</strong><div className="muted text-xs"><code>{permission.key}</code>{permission.requires.length ? ` · requires ${permission.requires.join(', ')}` : ''}</div></td><td><select className="field" aria-label={`${permission.key} access`} value={grant?.effect || ''} disabled={selected.locked} onChange={(event) => updateGrant(permission, event.target.value as '' | 'allow' | 'deny')}><option value="">No access</option><option value="allow">Allow</option><option value="deny">Deny</option></select></td><td>{grant ? <select className="field" aria-label={`${permission.key} scope`} value={grant.scope} disabled={selected.locked} onChange={(event) => updateGrant(permission, grant.effect, event.target.value)}>{permission.valid_scopes.map((scope) => <option key={scope}>{scope}</option>)}</select> : <span className="muted">—</span>}</td><td><span className={`prototype-badge ${permission.risk >= 3 ? 'prototype-badge-warn' : ''}`}>{['', 'Low', 'Medium', 'High', 'Critical'][permission.risk]}</span></td></tr>; })}</tbody></table></div></details>)}</div><div className="prototype-pagination"><span>Page {permissions.page} of {permissions.pages || 1} · {permissions.total} permissions</span><button className="btn-secondary" disabled={permissions.page <= 1} onClick={() => void loadPermissions(permissions.page - 1)}>Previous</button><button className="btn-secondary" disabled={permissions.page >= permissions.pages} onClick={() => void loadPermissions(permissions.page + 1)}>Next</button></div></>}
        </section>
        <aside className="panel rbac-review"><h2>Review changes</h2><p className="muted text-sm">{Object.keys(draftGrants).length} direct grants. Dependencies, scope, deny, SoD, and four-eyes rules are validated by the backend.</p>{selected && !selected.locked && <><button className="btn-secondary w-full" disabled={busy || selected.status !== 'draft'} onClick={() => void saveGrants()}>Save draft</button>{selected.status === 'draft' && <button className="btn-secondary w-full" disabled={busy} onClick={() => void publish()}>Publish if no approval is needed</button>}<form className="space-y-2" onSubmit={submitChange}><textarea className="field" name="reason" minLength={8} placeholder="Reason for governed change" required /><label className="flex gap-2 text-xs"><input type="checkbox" name="acknowledge" /> Acknowledge reported SoD conflicts</label><button className="btn w-full" disabled={busy}>Submit for approval</button></form></>}</aside>
      </div>
    </>}

    {tab === 'compare' && <section className="panel overflow-auto"><table><thead><tr><th>Role</th><th>Status</th><th>Users</th><th>Direct grants</th><th>Inheritance</th></tr></thead><tbody>{roles.items.map((role) => <tr key={role.id}><td><strong>{role.name}</strong></td><td>{role.status}</td><td>{role.user_count}</td><td>{role.permission_count}</td><td>{role.parent_id ? roles.items.find((item) => item.id === role.parent_id)?.name || role.parent_id : 'None'}</td></tr>)}</tbody></table></section>}
    {tab === 'effective' && <section className="panel max-w-4xl"><form className="grid gap-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={checkAccess}><label className="label">Permission key<input className="field" value={checkKey} onChange={(event) => setCheckKey(event.target.value)} required placeholder="billing.payment.refund" /></label><label className="label">User ID (blank means me)<input className="field" value={checkUser} onChange={(event) => setCheckUser(event.target.value)} /></label><button className="btn self-end">Check access</button></form>{decision && <div className="mt-5 rounded-lg border border-[var(--border)] p-4"><div className="flex gap-2"><span className={`prototype-badge prototype-badge-${decision.allowed ? 'good' : 'danger'}`}>{decision.allowed ? 'Allowed' : 'Denied'}</span>{decision.reach && <span className="prototype-badge">{decision.reach}{decision.filter_scope ? ` · ${decision.filter_scope}` : ''}</span>}{decision.needs_approval && <span className="prototype-badge prototype-badge-warn">Approval required</span>}</div><ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">{decision.trace.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol></div>}</section>}
    {tab === 'approvals' && <section className="panel overflow-auto"><table><thead><tr><th>Request</th><th>Maker / reason</th><th>Risk</th><th>Expires</th><th>Status</th><th>Actions</th></tr></thead><tbody>{requests.items.map((request) => <tr key={request.id}><td><strong>{request.kind.replaceAll('-', ' ')}</strong><div className="muted text-xs">{request.id}</div></td><td>{request.maker_id}<div className="muted text-xs">{request.reason}</div></td><td>{['', 'Low', 'Medium', 'High', 'Critical'][request.risk]}</td><td>{new Date(request.expires_at).toLocaleString()}</td><td><span className={`prototype-badge prototype-badge-${tone(request.status)}`}>{request.break_glass ? 'Break-glass · ' : ''}{request.status}</span></td><td>{request.status === 'pending' && <div className="flex flex-wrap gap-1"><button className="btn-secondary" onClick={() => void requestAction(request, 'approve')}>Approve</button><button className="btn-secondary" onClick={() => void requestAction(request, 'reject')}>Reject</button><button className="btn-secondary" onClick={() => void requestAction(request, 'withdraw')}>Withdraw</button></div>}</td></tr>)}</tbody></table>{!requests.items.length && <p className="muted p-4">No approval requests.</p>}</section>}
    {tab === 'policy' && policy && policyDraft && <div className="space-y-4">
      <section className="panel"><div className="prototype-section-head"><div><h2>Role and permission change approvals</h2><p>Policy for the {domain} authorization domain. Saving creates a request for a different eligible checker.</p></div></div><form onSubmit={submitPolicy}><div className="rbac-policy-grid">
        <PolicyToggle label="Critical or four-eyes permissions" checked={policyDraft.require_role_grant_critical_or_four_eyes} onChange={(checked) => setPolicyDraft({ ...policyDraft, require_role_grant_critical_or_four_eyes: checked })} />
        <PolicyToggle label="High-risk role assignments" checked={policyDraft.require_high_risk_assignment} onChange={(checked) => setPolicyDraft({ ...policyDraft, require_high_risk_assignment: checked })} />
        <PolicyToggle label="Separation-of-duties conflicts" checked={policyDraft.require_sod_conflict} onChange={(checked) => setPolicyDraft({ ...policyDraft, require_sod_conflict: checked })} />
        <PolicyToggle label="Every policy change" checked={policyDraft.require_every_change} onChange={(checked) => setPolicyDraft({ ...policyDraft, require_every_change: checked })} />
        <PolicyToggle label="Any Super Admin change · locked" checked={policyDraft.require_superadmin_change} disabled onChange={() => undefined} />
        <label className="label">Approvals needed<select className="field" value={policyDraft.approvers_needed} onChange={(event) => setPolicyDraft({ ...policyDraft, approvers_needed: Number(event.target.value) })}><option value={1}>1 approver</option><option value={2}>2 approvers</option></select></label>
        <label className="label">Request expires after<select className="field" value={policyDraft.expires_after_hours} onChange={(event) => setPolicyDraft({ ...policyDraft, expires_after_hours: Number(event.target.value) })}><option value={24}>24 hours</option><option value={48}>48 hours</option><option value={72}>72 hours</option><option value={168}>7 days</option></select></label>
        <PolicyToggle label="Emergency break-glass" checked={policyDraft.break_glass_enabled} onChange={(checked) => setPolicyDraft({ ...policyDraft, break_glass_enabled: checked })} />
      </div><p className="muted mt-3 text-xs">Eligible approver roles: {(domain === 'platform' ? policyDraft.platform_eligible_roles : policyDraft.tenant_eligible_roles).join(', ')}. The maker is never eligible to approve their own request.</p><div className="prototype-controls mt-3"><label className="label">Reason<input className="field" value={policyReason} minLength={8} maxLength={1000} onChange={(event) => setPolicyReason(event.target.value)} required /></label><button className="btn self-end" disabled={busy}>Submit policy change</button></div></form></section>
      <section className="panel overflow-auto"><div className="prototype-section-head"><div><h2>Action approval rules</h2><p>Drag rows or use the arrow buttons to change priority. The new order becomes effective only after approval.</p></div></div><table><thead><tr><th>Order</th><th>Rule</th><th>Patterns</th><th>Domain</th><th>Matches</th><th>Governed</th><th>Overlaps</th><th /></tr></thead><tbody>{policy.rules.items.filter((row) => ruleDrafts.some((draft) => draft.id === row.id)).map((row) => { const rule = ruleDrafts.find((draft) => draft.id === row.id) || row; return <tr key={rule.id} draggable onDragStart={() => setDragRuleId(rule.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropRule(rule.id)}><td><div className="rbac-order"><button type="button" aria-label={`Move ${rule.name} up`} onClick={() => moveRule(rule.id, -1)}>↑</button><strong>{rule.priority}</strong><button type="button" aria-label={`Move ${rule.name} down`} onClick={() => moveRule(rule.id, 1)}>↓</button></div></td><td>{rule.name}</td><td><code>{rule.patterns.join(' ; ')}</code></td><td><select className="field" value={rule.scope} onChange={(event) => setRuleDrafts((current) => current.map((item) => item.id === rule.id ? { ...item, scope: event.target.value as FourEyesRule['scope'] } : item))}><option>Off</option>{domain === 'tenant' && <option>Tenant</option>}{domain === 'platform' && <option>Platform</option>}<option>Both</option></select></td><td>{row.matches}</td><td>{row.governed}</td><td>{row.overlaps}</td><td><button type="button" className="btn-secondary" onClick={() => setRuleDrafts((current) => normalizedRules(current.filter((item) => item.id !== rule.id)))}>Remove</button></td></tr>; })}</tbody></table><div className="prototype-pagination"><label className="label">Rows<select className="field" value={policySize} onChange={(event) => void loadPolicy(1, Number(event.target.value))}><option>10</option><option>25</option><option>50</option></select></label><span>Page {policy.rules.page} of {policy.rules.pages || 1} · {policy.rules.total} rules</span><button className="btn-secondary" disabled={policy.rules.page <= 1} onClick={() => void loadPolicy(policy.rules.page - 1)}>Previous</button><button className="btn-secondary" disabled={policy.rules.page >= policy.rules.pages} onClick={() => void loadPolicy(policy.rules.page + 1)}>Next</button></div><form className="rbac-add-rule" onSubmit={addRule}><label className="label">Rule name<input className="field" name="name" minLength={3} required /></label><label className="label">Permission patterns, separated by ;<input className="field" name="patterns" required placeholder="billing.*.reverse ; *.*.refund" /></label><label className="label">Authorization domain<select className="field" name="scope" defaultValue={domain === 'platform' ? 'Platform' : 'Tenant'}>{domain === 'tenant' && <option>Tenant</option>}{domain === 'platform' && <option>Platform</option>}<option>Both</option></select></label><button className="btn-secondary self-end">Add rule to draft</button></form><form className="prototype-controls mt-3" onSubmit={submitRules}><label className="label">Reason<input className="field" value={ruleReason} minLength={8} maxLength={1000} onChange={(event) => setRuleReason(event.target.value)} required /></label><button className="btn self-end" disabled={busy}>Submit rule changes</button></form></section>
      <section className="panel"><div className="prototype-section-head"><div><h2>Overlapping rule matches</h2><p>Diagnostic view of permissions matched by more than one enabled rule.</p></div><span className="prototype-badge">{policy.overlaps.length} permissions</span></div>{policy.overlaps.length ? <div className="rbac-overlaps">{policy.overlaps.map((item) => <details key={item.permission_key}><summary><span><strong>{item.label}</strong><code>{item.permission_key}</code></span><span>{item.match_count} matching rules</span></summary><ol>{item.rules.map((rule) => <li key={rule.id}><strong>{rule.priority}</strong> {rule.name} {rule.governs && <span className="prototype-badge prototype-badge-good">Governs</span>}</li>)}</ol></details>)}</div> : <p className="muted">No permissions match more than one enabled rule.</p>}</section>
      <section className="panel"><div className="prototype-section-head"><div><h2>New permissions awaiting review</h2><p>New catalogue keys remain default-deny until they are classified.</p></div><span className={`prototype-badge ${policy.awaiting_review.length ? 'prototype-badge-warn' : 'prototype-badge-good'}`}>{policy.awaiting_review.length}</span></div>{policy.awaiting_review.length ? <ul className="space-y-2">{policy.awaiting_review.map((permission) => <li key={permission.key}><strong>{permission.resource_name} · {permission.action.replaceAll('_', ' ')}</strong><br /><code>{permission.key}</code></li>)}</ul> : <p className="muted">All registered permissions have been reviewed.</p>}</section>
    </div>}
    {tab === 'history' && <section className="panel overflow-auto"><table><thead><tr><th>Version</th><th>Maker</th><th>Checker(s)</th><th>Reason</th><th>Applied</th></tr></thead><tbody>{history.items.map((item) => <tr key={item.id}><td><strong>v{item.version}</strong>{item.break_glass && <div className="prototype-badge prototype-badge-warn">Break-glass</div>}</td><td>{item.author_id}</td><td>{item.approver_ids.join(', ') || 'Review pending'}</td><td>{item.reason}</td><td>{new Date(item.created_at).toLocaleString()}</td></tr>)}</tbody></table>{!history.items.length && <p className="muted p-4">No policy versions have been applied.</p>}</section>}
  </section>;
}

function PolicyToggle({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}
