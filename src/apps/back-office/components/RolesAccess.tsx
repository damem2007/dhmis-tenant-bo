import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';

type Domain = 'tenant' | 'platform';
type Page<T> = { page: number; size: number; total: number; pages: number; items: T[] };
type Grant = { permission_key: string; effect: 'allow' | 'deny'; scope: string; conditions: Record<string, unknown> };
type Role = { id: string; domain: Domain; name: string; description: string; status: string; parent_id: string | null; locked: boolean; version: number; user_count: number; permission_count: number; grants: Grant[] };
type Permission = { key: string; domain: Domain; module_id: string; module_name: string; resource_key: string; resource_name: string; action: string; group: string; risk: number; restricted: boolean; reviewed: boolean; retired: boolean; requires: string[]; valid_scopes: string[] };
type Decision = { permission_key: string; allowed: boolean; reach: string | null; filter_scope: string | null; needs_approval: boolean; needs_step_up: boolean; governing_rule_id: string | null; trace: string[] };
type ChangeRequest = { id: string; domain?: Domain; kind: string; maker_id: string; role_id?: string | null; created_at?: string; status: string; reason: string; patch?: Record<string, unknown> | unknown[]; runtime_permission_key?: string | null; risk: number; affected_users: number; required_approvals: number; expires_at: string; break_glass: boolean; decisions: { user_id: string; decision: string; comment: string; decided_at: string }[] };
type History = { id: string; version: number; author_id: string; approver_ids: string[]; reason: string; changes: unknown[]; break_glass: boolean; created_at: string };
type ApprovalSettings = { require_role_grant_critical_or_four_eyes: boolean; require_high_risk_assignment: boolean; require_sod_conflict: boolean; require_every_change: boolean; require_superadmin_change: boolean; approvers_needed: number; expires_after_hours: number; tenant_eligible_roles: string[]; platform_eligible_roles: string[]; break_glass_enabled: boolean; break_glass_requires_step_up_mfa: boolean; break_glass_review_within_hours: number };
type FourEyesRule = { id: string; name: string; scope: 'Off' | 'Tenant' | 'Platform' | 'Both'; priority: number; patterns: string[]; matches: number; governed: number; overlaps: number };
type RuleOverlap = { permission_key: string; label: string; match_count: number; rules: { id: string; name: string; priority: number; governs: boolean }[] };
type PolicyData = { settings: ApprovalSettings; rules: Page<FourEyesRule>; overlaps: RuleOverlap[]; awaiting_review: Permission[] };
type Tab = 'roles' | 'compare' | 'effective' | 'approvals' | 'policy' | 'history';
type ResourceGroup = { key: string; name: string; permissions: Permission[] };
type ModuleGroup = { key: string; name: string; resources: ResourceGroup[] };
type EffectivePerson = { id: string; name: string; email?: string; role?: string; assignments?: { role: string; scope: string; location_id: string | null }[] };

const emptyPage = <T,>(): Page<T> => ({ page: 1, size: 10, total: 0, pages: 0, items: [] });
const tone = (status: string) => status === 'published' || status === 'approved' || status === 'applied' ? 'good' : status === 'pending' ? 'info' : status === 'rejected' || status === 'conflicted' ? 'danger' : 'neutral';
const baseActions = new Set(['read', 'create', 'update']);
const actionLabel = (action: string) => action.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const requestKindLabel = (kind: string) => ({ 'role-policy': 'Role policy', 'role-publication': 'Role publication', 'approval-policy': 'Approval policy', 'four-eyes-rules': 'Four-eyes rules', 'runtime-action': 'Action approval' }[kind] || actionLabel(kind));
const relativeTime = (value?: string) => {
  if (!value) return 'time unavailable';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
};
function requestPatchLines(patch: Record<string, unknown> | unknown[] | undefined, catalogue: Permission[], runtimePermissionKey?: string | null): string[] {
  const entries = Array.isArray(patch) ? patch : patch ? Object.entries(patch).map(([key, value]) => ({ key, value })) : [];
  if (!entries.length && runtimePermissionKey) {
    const permission = catalogue.find((item) => item.key === runtimePermissionKey);
    return [permission ? `${permission.module_name} · ${permission.resource_name} · ${actionLabel(permission.action)} requested` : 'Action requested'];
  }
  if (Array.isArray(patch)) {
    return patch.slice(0, 8).flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const item = value as Record<string, unknown>;
      if (item.publish) return ['Publish role'];
      const key = String(item.permission_key || '');
      const permission = catalogue.find((candidate) => candidate.key === key);
      const label = permission ? `${permission.module_name} · ${permission.resource_name} · ${actionLabel(permission.action)}` : key || 'Permission';
      const grant = item.new_grant && typeof item.new_grant === 'object' ? item.new_grant as Record<string, unknown> : null;
      if (!grant) return [`${label}: removed`];
      const effect = String(grant.effect || 'changed');
      const scope = grant.scope ? ` · ${String(grant.scope)}` : '';
      return [`${label}: ${effect}${scope}`];
    });
  }
  return Object.entries(patch || {}).flatMap(([key, value]) => {
    if (key === 'grants' && Array.isArray(value)) {
      return value.slice(0, 8).map((grant) => {
        if (!grant || typeof grant !== 'object') return `${key}: ${String(grant)}`;
        const item = grant as Record<string, unknown>;
        const permissionKey = String(item.permission_key || item.permission || '');
        const permission = catalogue.find((candidate) => candidate.key === permissionKey);
        const label = permission ? `${permission.module_name} · ${permission.resource_name} · ${actionLabel(permission.action)}` : permissionKey || 'Permission';
        const effect = String(item.new_grant && typeof item.new_grant === 'object' ? (item.new_grant as Record<string, unknown>).effect || 'changed' : item.effect || 'changed');
        const scope = String(item.new_grant && typeof item.new_grant === 'object' ? (item.new_grant as Record<string, unknown>).scope || '' : item.scope || '');
        return `${label}: ${effect}${scope ? ` · ${scope}` : ''}`;
      });
    }
    if (key === 'settings' && value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).slice(0, 6).map(([setting, settingValue]) => `${setting.replaceAll('_', ' ')}: ${String(settingValue)}`);
    }
    if (key === 'rules' && Array.isArray(value)) return [`${value.length} approval rules changed`];
    return `${key.replaceAll('_', ' ')}: ${typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : 'updated'}`;
  });
}

function resourceLevel(resource: ResourceGroup, grants: Record<string, Grant>): 'n' | 'r' | 'w' {
  const read = grants[resource.permissions.find((permission) => permission.action === 'read')?.key || ''];
  if (read?.effect !== 'allow') return 'n';
  const writable = resource.permissions.filter((permission) => permission.action === 'create' || permission.action === 'update');
  return writable.length > 0 && writable.every((permission) => grants[permission.key]?.effect === 'allow') ? 'w' : 'r';
}

function setResourceLevelDraft(current: Record<string, Grant>, resource: ResourceGroup, level: 'n' | 'r' | 'w') {
  const next = { ...current };
  resource.permissions.forEach((permission) => {
    if (level === 'n' || (level === 'r' && !['read'].includes(permission.action))) {
      delete next[permission.key];
      return;
    }
    if (!baseActions.has(permission.action)) return;
    next[permission.key] = {
      permission_key: permission.key,
      effect: 'allow',
      scope: next[permission.key]?.scope || permission.valid_scopes[0] || 'Organization',
      conditions: next[permission.key]?.conditions || {},
    };
  });
  return next;
}

export function RolesAccess({ domain: initialDomain, staffHref = '/settings/staff' }: { domain: Domain; staffHref?: string }) {
  const [activeDomain, setActiveDomain] = useState<Domain>(initialDomain);
  const domain = activeDomain;
  const prefix = domain === 'platform' ? '/platform/rbac' : '/rbac';
  const requestedTab = new URLSearchParams(window.location.search).get('tab');
  const [tab, setTab] = useState<Tab>((['roles', 'compare', 'effective', 'approvals', 'policy', 'history'] as Tab[]).includes(requestedTab as Tab) ? requestedTab as Tab : 'roles');
  const [roles, setRoles] = useState<Page<Role>>(emptyPage());
  const [permissions, setPermissions] = useState<Page<Permission>>(emptyPage());
  const [catalogue, setCatalogue] = useState<Permission[]>([]);
  const [effectivePeople, setEffectivePeople] = useState<EffectivePerson[]>([]);
  const [currentActor, setCurrentActor] = useState<{ id: string; name: string; role: string; role_id?: string | null; is_bootstrap_operator?: boolean } | null>(null);
  const [effectivePersonId, setEffectivePersonId] = useState('');
  const [requests, setRequests] = useState<Page<ChangeRequest>>(emptyPage());
  const [requestPage, setRequestPage] = useState(1);
  const [requestSize, setRequestSize] = useState(10);
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
  const permissionRequest = useRef(0);
  const [permissionFilter, setPermissionFilter] = useState<'all' | 'granted' | 'high' | 'fourEyes' | 'changed'>('all');
  const [permissionPage, setPermissionPage] = useState(1);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [newRoleOpen, setNewRoleOpen] = useState(false);
  const [checkKey, setCheckKey] = useState('');
  const [checkUser, setCheckUser] = useState('');
  const [decision, setDecision] = useState<Decision | null>(null);
  const [approvalComments, setApprovalComments] = useState<Record<string, string>>({});
  const selected = roles.items.find((role) => role.id === selectedId) || roles.items[0];
  const sortedRoles = useMemo(() => [...roles.items].sort((left, right) => (
    right.user_count - left.user_count
    || Number(right.locked) - Number(left.locked)
    || left.name.localeCompare(right.name)
  )), [roles.items]);

  function switchDomain(next: Domain) {
    // The control-plane and tenant authorization domains are isolated. The
    // selector is shown for prototype parity, but an app instance may only
    // query the domain it was mounted for.
    if (next !== initialDomain || next === activeDomain) return;
    setActiveDomain(next);
    setSelectedId('');
    setEffectivePersonId('');
    setCheckUser('');
    setDecision(null);
    setCatalogue([]);
    setEffectivePeople([]);
    setMessage('');
  }

  async function loadRoles(preferredId = selectedId) {
    const result = await api<Page<Role>>(`${prefix}/roles?page=1&size=50`);
    const items = domain === 'tenant' ? [...result.items].sort((left, right) => (
      right.user_count - left.user_count
      || Number(right.locked) - Number(left.locked)
      || left.name.localeCompare(right.name)
    )) : result.items;
    const orderedResult = items === result.items ? result : { ...result, items };
    setRoles(orderedResult);
    const next = items.find((role) => role.id === preferredId) || items[0];
    setSelectedId(next?.id || '');
    setDraftGrants(Object.fromEntries((next?.grants || []).map((grant) => [grant.permission_key, grant])));
  }
  async function loadPermissions(page = permissionPage) {
    const requestId = ++permissionRequest.current;
    const query = new URLSearchParams({ domain, page: String(page), size: '50' });
    if (search) query.set('search', search);
    const result = await api<Page<Permission>>(`${prefix}/permissions?${query}`);
    if (requestId !== permissionRequest.current) return;
    setPermissions(result);
    setPermissionPage(page);
  }
  async function loadPermissionRows(filters: Record<string, string>) {
    const firstQuery = new URLSearchParams({ domain, page: '1', size: '50', ...filters });
    const first = await api<Page<Permission>>(`${prefix}/permissions?${firstQuery}`);
    const rows = [...first.items];
    for (let page = 2; page <= first.pages; page += 1) {
      const query = new URLSearchParams({ domain, page: String(page), size: '50', ...filters });
      rows.push(...(await api<Page<Permission>>(`${prefix}/permissions?${query}`)).items);
    }
    return rows;
  }
  async function loadCatalogue() { setCatalogue(await loadPermissionRows({})); }
  async function loadEffectivePeople() {
    try {
      if (domain === 'tenant') {
        const result = await api<{ items: EffectivePerson[] }>(`${prefix === '/rbac' ? '/organization/access/query' : '/platform/access/query'}?kind=staff&page=1&page_size=100`);
        setEffectivePeople(result.items || []);
      } else {
        const result = await api<{ items: EffectivePerson[] }>(`/platform/access/query?page=1&page_size=100`);
        setEffectivePeople(result.items || []);
      }
    } catch { setEffectivePeople([]); }
  }
  async function loadCurrentActor() {
    if (domain !== 'platform') return;
    try { setCurrentActor(await api<{ id: string; name: string; role: string; role_id?: string | null; is_bootstrap_operator?: boolean }>('/platform/auth/me')); }
    catch { setCurrentActor(null); }
  }
  async function loadRequests(page = requestPage, size = requestSize) { const result = await api<Page<ChangeRequest>>(`${prefix}/requests?page=${page}&size=${size}`); setRequests(result); setRequestPage(result.page); setRequestSize(result.size); }
  async function loadHistory() { setHistory(await api<Page<History>>(`${prefix}/history?page=1&size=25`)); }
  async function loadPolicy(page = policyPage, size = policySize) {
    const result = await api<PolicyData>(`${prefix}/policy?page=${page}&size=${size}`);
    const full = page === 1 && size === 50 ? result : await api<PolicyData>(`${prefix}/policy?page=1&size=50`);
    setPolicy(result); setPolicyDraft(result.settings); setRuleDrafts(full.rules.items); setPolicyPage(page); setPolicySize(size);
  }
  async function refresh() {
    setBusy(true);
    setMessage('');
    try { await Promise.all([loadRoles(), loadPermissions(), loadCatalogue(), loadEffectivePeople(), loadCurrentActor(), loadRequests(), loadHistory(), loadPolicy()]); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Roles and access could not be loaded'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, [activeDomain]);
  useEffect(() => {
    if (tab !== 'approvals') return;
    void api(`${prefix}/notifications/seen`, {})
      .then(() => window.dispatchEvent(new Event('dhmis:rbac-updated')))
      .catch(() => undefined);
  }, [tab, prefix]);
  useEffect(() => {
    if (!selected) return;
    if (selected.locked) {
      setDraftGrants(Object.fromEntries(catalogue.map((permission) => [permission.key, {
        permission_key: permission.key,
        effect: 'allow' as const,
        scope: permission.valid_scopes[0] || (domain === 'platform' ? 'Platform' : 'Organization'),
        conditions: {},
      }])));
      return;
    }
    setDraftGrants(Object.fromEntries(selected.grants.map((grant) => [grant.permission_key, grant])));
  }, [catalogue, domain, selectedId, roles.items]);
  useEffect(() => {
    if (!newRoleOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setNewRoleOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [newRoleOpen]);

  const modules = useMemo<ModuleGroup[]>(() => {
    const grouped = new Map<string, ModuleGroup>();
    permissions.items.forEach((permission) => {
      const moduleKey = permission.module_id || permission.module_name;
      const module = grouped.get(moduleKey) || { key: moduleKey, name: permission.module_name, resources: [] };
      const resource = module.resources.find((item) => item.key === permission.resource_key);
      if (resource) resource.permissions.push(permission);
      else module.resources.push({ key: permission.resource_key, name: permission.resource_name, permissions: [permission] });
      grouped.set(moduleKey, module);
    });
    return [...grouped.values()];
  }, [permissions.items]);
  const catalogueModules = useMemo<ModuleGroup[]>(() => {
    const grouped = new Map<string, ModuleGroup>();
    catalogue.forEach((permission) => {
      const moduleKey = permission.module_id || permission.module_name;
      const module = grouped.get(moduleKey) || { key: moduleKey, name: permission.module_name, resources: [] };
      const resource = module.resources.find((item) => item.key === permission.resource_key);
      if (resource) resource.permissions.push(permission);
      else module.resources.push({ key: permission.resource_key, name: permission.resource_name, permissions: [permission] });
      grouped.set(moduleKey, module);
    });
    return [...grouped.values()];
  }, [catalogue]);
  const effectivePerson = effectivePeople.find((person) => person.id === effectivePersonId);
  const effectiveRoleNames = useMemo(() => {
    if (!effectivePerson) return [];
    const assigned = effectivePerson.assignments?.map((assignment) => assignment.role) || [];
    const names = domain === 'platform' && assigned.length ? assigned : (effectivePerson.role ? [effectivePerson.role] : []);
    // Existing platform accounts carry the legacy platform_admin marker. It is
    // a compatibility value, not a second role; display the locked RBAC role.
    if (domain === 'platform' && !assigned.length && effectivePerson.role === 'platform_admin') {
      const superAdmin = roles.items.find((role) => role.locked);
      return superAdmin ? [superAdmin.name] : [];
    }
    return [...new Set(names)];
  }, [domain, effectivePerson, roles.items]);
  const effectiveGrants = useMemo(() => {
    const grants = new Map<string, Grant>();
    roles.items.filter((role) => effectiveRoleNames.includes(role.name)).forEach((role) => {
      if (role.locked) catalogue.forEach((permission) => grants.set(permission.key, { permission_key: permission.key, effect: 'allow', scope: domain === 'platform' ? 'Platform' : 'Organization', conditions: {} }));
      else role.grants.forEach((grant) => grants.set(grant.permission_key, grant));
    });
    return grants;
  }, [catalogue, domain, effectiveRoleNames, roles.items]);
  const visibleModules = useMemo(() => modules.map((module) => ({
    ...module,
    resources: module.resources.filter((resource) => {
      if (permissionFilter === 'all') return true;
      if (permissionFilter === 'high') return resource.permissions.some((permission) => permission.risk >= 3);
      if (permissionFilter === 'fourEyes') return resource.permissions.some((permission) => permission.requires.length > 0);
      if (permissionFilter === 'granted') return resourceLevel(resource, draftGrants) !== 'n' || resource.permissions.some((permission) => draftGrants[permission.key]);
      return resource.permissions.some((permission) => draftGrants[permission.key] || selected?.grants.some((grant) => grant.permission_key === permission.key));
    }),
  })).filter((module) => module.resources.length > 0), [modules, permissionFilter, draftGrants, selected]);

  function updateGrant(permission: Permission, effect: '' | 'allow' | 'deny', scope?: string) {
    setDraftGrants((current) => {
      const next = { ...current };
      if (!effect) delete next[permission.key];
      else next[permission.key] = { permission_key: permission.key, effect, scope: scope || current[permission.key]?.scope || permission.valid_scopes[0], conditions: current[permission.key]?.conditions || {} };
      return next;
    });
  }
  async function setResourceLevel(resource: ResourceGroup, level: 'n' | 'r' | 'w') {
    if (!selected || selected.locked) return;
    setBusy(true);
    try {
      const rows = (await loadPermissionRows({ search: resource.key })).filter((permission) => permission.resource_key === resource.key);
      const fullResource = { ...resource, permissions: rows.length ? rows : resource.permissions };
      setDraftGrants((current) => setResourceLevelDraft(current, fullResource, level));
      setMessage('Draft updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Permission draft could not be updated');
    } finally {
      setBusy(false);
    }
  }
  async function setModuleLevel(module: ModuleGroup, level: 'n' | 'r' | 'w') {
    if (!selected || selected.locked) return;
    setBusy(true);
    try {
      const rows = await loadPermissionRows({ module: module.key });
      const resources = [...rows.reduce((groups, permission) => {
        const resource = groups.get(permission.resource_key) || { key: permission.resource_key, name: permission.resource_name, permissions: [] as Permission[] };
        resource.permissions.push(permission);
        groups.set(permission.resource_key, resource);
        return groups;
      }, new Map<string, ResourceGroup>()).values()];
      setDraftGrants((current) => resources.reduce((draft, resource) => setResourceLevelDraft(draft, resource, level), current));
      setMessage('Draft updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Module draft could not be updated');
    } finally {
      setBusy(false);
    }
  }
  function cycleAction(permission: Permission, resource: ResourceGroup) {
    if (!selected || selected.locked || resourceLevel(resource, draftGrants) === 'n') return;
    const current = (draftGrants[permission.key]?.effect ?? '') as '' | 'allow' | 'deny';
    const nextEffect: '' | 'allow' | 'deny' = current === 'allow' ? 'deny' : current === 'deny' ? '' : 'allow';
    updateGrant(permission, nextEffect);
  }
  function discardChanges() {
    if (!selected) return;
    setDraftGrants(Object.fromEntries(selected.grants.map((grant) => [grant.permission_key, grant])));
    setMessage('Changes discarded.');
  }
  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await act(async () => { const role = await api<Role>(`${prefix}/roles`, { name: form.get('name'), description: form.get('description'), copy_from_id: form.get('copy_from_id') || null }); await loadRoles(role.id); event.currentTarget.reset(); setNewRoleOpen(false); });
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
  async function requestAction(request: ChangeRequest, action: 'approve' | 'reject' | 'withdraw', suppliedComment?: string) {
    const comment = suppliedComment ?? (action === 'reject' ? window.prompt('Why are you rejecting this request?') || '' : '');
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
    <div className="prototype-page-header rbac-page-header">
      <div>
        <h1>Roles &amp; access</h1>
        <p className="muted">{permissions.total ? `${permissions.total} ${domain} permissions from the DHMIS catalogue.` : `${domain === 'platform' ? 'Platform identities and control-plane permissions.' : 'Tenant staff roles, scope, and maker-checker governance.'}`}</p>
      </div>
      <button className="btn" type="button" onClick={() => setNewRoleOpen(true)}>+ Add role</button>
    </div>
    {message && <p className="prototype-callout" role="status">{message}</p>}
    <div className="prototype-tabs" role="tablist">{(['roles', 'compare', 'effective', 'approvals', 'policy', 'history'] as Tab[]).map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>{item === 'effective' ? 'Effective access' : item === 'policy' ? 'Approval policy' : item[0].toUpperCase() + item.slice(1)}{item === 'approvals' && requests.items.filter((request) => request.status === 'pending').length > 0 ? ` (${requests.items.filter((request) => request.status === 'pending').length})` : ''}</button>)}</div>

    {tab === 'roles' && <>
      {!!policy?.awaiting_review.length && <p className="rbac-review-note">{policy.awaiting_review.length} new permissions from the latest release need classification. <button type="button" className="link" onClick={() => setTab('policy')}>Review</button></p>}
      <div className="prototype-roles-layout">
        <aside className="panel prototype-role-list rbac-role-list" aria-label="Roles">
          <div className="rbac-domain-toggle tenant-domain-only" role="status" aria-label="Role type">Tenant</div>
          {sortedRoles.map((role) => <div className={`rbac-role-item ${selected?.id === role.id ? 'is-selected' : ''}`} key={role.id}><button className="rbac-role-select" type="button" aria-current={selected?.id === role.id ? 'page' : undefined} onClick={() => setSelectedId(role.id)}><strong>{role.name}{role.locked ? ' 🔒' : ''}</strong></button><div className="rbac-role-meta"><span>{role.permission_count} permissions{role.parent_id ? ' · inherited' : ''}</span><a className="rbac-role-users" aria-label={`View ${role.user_count} users assigned to ${role.name}`} href={`${staffHref}?role=${encodeURIComponent(role.name)}`}>{role.user_count} users</a></div></div>)}
        </aside>
        <section className="panel min-w-0 rbac-role-card">
          <div className="prototype-section-head rbac-role-card-header"><div><h2>{selected?.name || 'No role selected'}</h2><p>{selected?.description || 'Create a role to configure access.'}</p></div>{selected && <div className="rbac-role-actions"><span className={`prototype-badge prototype-badge-${tone(selected.status)}`}>{selected.locked ? 'Locked · ' : ''}{selected.status}</span>{!selected.locked && selected.status === 'draft' && <button className="btn-secondary" type="button" onClick={() => void lifecycle('delete')}>Delete draft</button>}{!selected.locked && selected.status === 'published' && <><button className="btn-secondary" type="button" onClick={() => void lifecycle('deactivate')}>Deactivate</button><button className="btn-secondary" type="button" disabled={selected.user_count > 0} title={selected.user_count ? 'Reassign its users first' : ''} onClick={() => void lifecycle('archive')}>Archive</button></>}{!selected.locked && selected.status === 'inactive' && <><button className="btn-secondary" type="button" onClick={() => void lifecycle('reactivate')}>Reactivate</button><button className="btn-secondary" type="button" disabled={selected.user_count > 0} title={selected.user_count ? 'Reassign its users first' : ''} onClick={() => void lifecycle('archive')}>Archive</button></>}{!selected.locked && selected.status === 'archived' && <button className="btn-secondary" type="button" onClick={() => void lifecycle('restore')}>Restore</button>}</div>}</div>
          {selected?.status === 'draft' && !selected.locked && <form className="rbac-draft-details" onSubmit={updateDraft}><label className="label">Role name<input className="field" name="name" minLength={3} defaultValue={selected.name} key={`${selected.id}-name`} required /></label><label className="label">Description<input className="field" name="description" defaultValue={selected.description} key={`${selected.id}-description`} /></label><button className="btn-secondary self-end" disabled={busy}>Save details</button></form>}
          {selected && <p className="rbac-assignable">{selected.status === 'published' ? `✓ Assignable when creating accounts and inviting staff.${selected.user_count ? ` ${selected.user_count} users hold it now.` : ''}` : `✕ Not assignable: ${selected.status === 'draft' ? 'publish this role first.' : selected.status === 'inactive' ? 'the role is inactive.' : selected.status === 'archived' ? 'the role is archived.' : 'waiting for approval.'}`}</p>}
          {selected && <>
            <div className="rbac-permission-toolbar">
              <label className="rbac-search-label" htmlFor="permission-search"><strong>Search permissions</strong></label>
              <form className="rbac-search-form" onSubmit={(event) => { event.preventDefault(); void loadPermissions(1); }}><input id="permission-search" className="field" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Resource or action, e.g. refund" /><button className="btn-secondary">Search</button></form>
              {([['all', 'All'], ['granted', 'Granted'], ['high', 'High risk'], ['fourEyes', 'Four-eyes'], ['changed', 'Changed']] as const).map(([key, label]) => <button key={key} type="button" className="rbac-filter-chip" aria-pressed={permissionFilter === key} onClick={() => setPermissionFilter(key)}>{label}</button>)}
              <button type="button" className="btn-secondary rbac-small-button" onClick={() => document.querySelectorAll<HTMLDetailsElement>('.rbac-module').forEach((element) => { element.open = true; })}>Expand all</button>
              <button type="button" className="btn-secondary rbac-small-button" onClick={() => document.querySelectorAll<HTMLDetailsElement>('.rbac-module').forEach((element) => { element.open = false; })}>Collapse all</button>
            </div>
            <p className="rbac-permission-note">{domain === 'platform' ? 'Platform permissions belong only to platform identities. They are never inherited from a tenant Super Admin.' : 'Tenant roles hold tenant permissions only.'} <strong>“Read &amp; write” means read, create and update; additional actions remain separate toggles.</strong> Click an action to cycle off → allowed → denied. <strong>Scope:</strong> Organization and Location set how far someone reaches; Assigned and Own narrow it to their own records. Change and Actions scopes can’t be wider than Read.</p>
            <div className="rbac-legend"><span><span className="rbac-legend-chip">Grey</span> not set: inherits from the parent role, otherwise no access</span><span><span className="rbac-legend-chip allowed">✓ Green</span> allowed</span><span><span className="rbac-legend-chip denied">✕ Red</span> denied: overrides everything</span><span>Dashed: inherited</span><span>🛡 four-eyes</span><span>🔒 restricted</span><span>Amber/red border: high/critical risk</span></div>
            {selected.locked && <div className="warn">Protected role: every {domain} permission. It can’t be edited.</div>}
            <div className="rbac-permission-list">{visibleModules.map((module) => {
              const permissionCount = module.resources.reduce((total, resource) => total + resource.permissions.length, 0);
              const allowedCount = module.resources.reduce((total, resource) => total + resource.permissions.filter((permission) => draftGrants[permission.key]?.effect === 'allow').length, 0);
              return <details className="rbac-module" key={module.key}>
                <summary className="rbac-module-header"><span className="rbac-module-caret" aria-hidden="true">▸</span><strong>{module.key} · {module.name}</strong><span>{allowedCount} of {permissionCount} allowed <span className="rbac-module-actions"><button type="button" className="btn-secondary rbac-small-button" disabled={selected.locked} onClick={(event) => { event.preventDefault(); setModuleLevel(module, 'r'); }}>Read</button><button type="button" className="btn-secondary rbac-small-button" disabled={selected.locked} onClick={(event) => { event.preventDefault(); setModuleLevel(module, 'w'); }}>Read &amp; write</button><button type="button" className="btn-secondary rbac-small-button" disabled={selected.locked} onClick={(event) => { event.preventDefault(); setModuleLevel(module, 'n'); }}>Clear</button></span></span></summary>
                <div className="rbac-module-body">{module.resources.map((resource) => { const level = resourceLevel(resource, draftGrants); return <div className="rbac-resource-row" key={resource.key}><div><strong>{resource.name}</strong><code>{resource.key}</code></div><div className="rbac-resource-controls"><span className="rbac-level-control" role="group" aria-label={`${resource.name} access`}><button type="button" aria-pressed={level === 'n'} disabled={selected.locked} onClick={() => setResourceLevel(resource, 'n')}>No access</button><button type="button" aria-pressed={level === 'r'} disabled={selected.locked} onClick={() => setResourceLevel(resource, 'r')}>Read only</button><button type="button" aria-pressed={level === 'w'} disabled={selected.locked} onClick={() => setResourceLevel(resource, 'w')}>Read &amp; write</button></span></div><div className="rbac-action-chips">{resource.permissions.filter((permission) => !baseActions.has(permission.action)).map((permission) => { const grant = draftGrants[permission.key]; const isAllowed = grant?.effect === 'allow'; const isDenied = grant?.effect === 'deny'; const requiresRead = level === 'n'; return <button type="button" key={permission.key} className={`rbac-action-chip ${isAllowed ? 'allowed' : ''} ${isDenied ? 'denied' : ''} ${permission.risk >= 3 ? 'high-risk' : ''}`} disabled={selected.locked || requiresRead} title={permission.key} aria-label={`${actionLabel(permission.action)}: ${isDenied ? 'denied' : isAllowed ? 'allowed' : 'off'}${requiresRead ? ', requires read' : ''}`} onClick={() => cycleAction(permission, resource)}>{isAllowed ? '✓ ' : isDenied ? '✕ ' : ''}{actionLabel(permission.action)}{permission.requires.length ? ' 🛡' : ''}{permission.restricted ? ' 🔒' : ''}</button>; })}</div></div>; })}</div>
              </details>;
            })}</div>
            <div className="prototype-pagination"><span>Page {permissions.page} of {permissions.pages || 1} · {permissions.total} permissions</span><button className="btn-secondary" disabled={permissions.page <= 1} onClick={() => void loadPermissions(permissions.page - 1)}>Previous</button><button className="btn-secondary" disabled={permissions.page >= permissions.pages} onClick={() => void loadPermissions(permissions.page + 1)}>Next</button></div>
          </>}
        </section>
        <aside className="panel rbac-review"><h2>Review changes</h2><p className="muted text-sm">{selected?.locked ? 'No pending changes. Edits appear here with their impact before they take effect.' : `${Object.keys(draftGrants).length} direct grants. Dependencies, scope, deny, SoD, and four-eyes rules are validated by the backend.`}</p>{selected && !selected.locked && <form className="rbac-review-form" onSubmit={submitChange}><label className="label"><strong>Change reason</strong> (required)<input className="field" name="reason" minLength={8} placeholder="Why is this changing?" required /></label><button className="btn w-full" disabled={busy}>Save policy</button><button className="btn-secondary w-full" type="button" disabled={busy} onClick={discardChanges}>Discard changes</button><label className="flex gap-2 text-xs"><input type="checkbox" name="acknowledge" /> Acknowledge reported SoD conflicts</label></form>}</aside>
      </div>
    </>}

    {newRoleOpen && <div className="rbac-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNewRoleOpen(false); }}><div className="rbac-modal" role="dialog" aria-modal="true" aria-labelledby="new-role-title"><h2 id="new-role-title">Add role</h2><p className="muted">Create a draft role and assign permissions before publishing it.</p><form onSubmit={createRole}><label className="label">Role name<input className="field" name="name" minLength={3} placeholder="e.g. Treatment coordinator" required autoFocus /></label><label className="label">Description<input className="field" name="description" placeholder="What this role is for" /></label><label className="label">Copy permissions from<select className="field" name="copy_from_id" defaultValue=""><option value="">Start empty</option>{roles.items.filter((role) => role.status === 'published' && !role.locked).map((role) => <option key={role.id} value={role.id}>Copy permissions from {role.name}</option>)}</select></label><p className="muted text-sm">It is saved as a <strong>draft</strong>. Nobody can be assigned to it until you publish it.</p><div className="rbac-modal-actions"><button type="button" className="btn-secondary" onClick={() => setNewRoleOpen(false)}>Cancel</button><button className="btn" disabled={busy}>Create draft</button></div></form></div></div>}
    {tab === 'compare' && <section className="rbac-tab-content">
      <p className="rbac-tab-intro">Read-only audit view of all {catalogueModules.length || 'the'} {domain} modules, including modules no role has yet. Cells show permissions allowed out of the total. Select a role to edit it.</p>
      <div className="rbac-domain-toggle tenant-domain-only rbac-domain-toggle-wide" role="status" aria-label="Comparison domain">Tenant</div>
      <section className="panel rbac-compare-panel overflow-auto"><table className="rbac-compare-table"><thead><tr><th>Module</th>{sortedRoles.map((role) => <th key={role.id}><button type="button" className="rbac-role-link" onClick={() => { setSelectedId(role.id); setTab('roles'); }}>{role.name}</button></th>)}</tr></thead><tbody>{catalogueModules.map((module) => <tr key={module.key}><td>{module.key} · {module.name}</td>{sortedRoles.map((role) => { const allowed = module.resources.flatMap((resource) => resource.permissions).filter((permission) => role.locked || role.grants.some((grant) => grant.permission_key === permission.key && grant.effect === 'allow')).length; const total = module.resources.reduce((count, resource) => count + resource.permissions.length, 0); return <td key={role.id}><strong className={allowed ? 'rbac-count-good' : ''}>{allowed}/{total}</strong><span className="rbac-progress"><span style={{ width: `${total ? Math.round((allowed / total) * 100) : 0}%` }} /></span></td>; })}</tr>)}</tbody></table>{!catalogueModules.length && <p className="muted p-4">Loading permission catalogue…</p>}</section>
    </section>}
    {tab === 'effective' && <section className="rbac-tab-content">
      <h2>Effective access</h2><p className="rbac-tab-intro">People never receive permissions directly. They receive roles, and roles carry the permissions. Pick a person to see their roles and what those roles add up to.</p>
      <div className="rbac-domain-toggle tenant-domain-only rbac-domain-toggle-wide" role="status" aria-label="Effective access domain">Tenant</div>
      <label className="label rbac-person-label">Person<select className="field" value={effectivePersonId} onChange={(event) => setEffectivePersonId(event.target.value)}><option value="">{effectivePeople.length ? 'Select a person…' : 'No people available from the access service'}</option>{effectivePeople.map((person) => <option key={person.id} value={person.id}>{person.name}{person.email ? ` · ${person.email}` : ''}</option>)}</select></label>
      <h3>Roles held</h3><section className="panel rbac-roles-held">{effectivePersonId ? (effectiveRoleNames.length ? effectiveRoleNames.map((roleName) => { const assignment = effectivePerson?.assignments?.find((item) => item.role === roleName); return <div className="rbac-held-role" key={`${roleName}-${assignment?.scope || 'domain'}`}><strong>{roleName}</strong><span>Scope: {assignment?.scope || (domain === 'platform' ? 'Platform' : 'Organization')}</span><span className="prototype-badge prototype-badge-good">assigned</span></div>; }) : <p className="muted">No role assignments were returned for this person.</p>) : <p className="muted">Select a person to view assigned roles.</p>}</section>
      <p className="muted">Roles are assigned on the staff account (Settings → Staff &amp; invitations), not on this page.</p>
      <h3>Access by module</h3><section className="panel rbac-effective-table"><table><thead><tr><th>Module</th><th>Allowed</th></tr></thead><tbody>{catalogueModules.map((module) => { const permissionsInModule = module.resources.flatMap((resource) => resource.permissions); const total = permissionsInModule.length; const allowed = effectivePersonId ? permissionsInModule.filter((permission) => effectiveGrants.get(permission.key)?.effect === 'allow').length : 0; return <tr key={module.key}><td>{module.key} · {module.name}</td><td><strong className={allowed ? 'rbac-count-good' : ''}>{effectivePersonId ? `${allowed}/${total}` : `—/${total}`}</strong><span className="rbac-progress"><span style={{ width: `${effectivePersonId && total ? Math.round((allowed / total) * 100) : 0}%` }} /></span></td></tr>; })}</tbody></table>{!catalogueModules.length && <p className="muted p-4">Permission catalogue unavailable.</p>}</section>
      <h3>Check one permission</h3><section className="panel"><form className="rbac-effective-check" onSubmit={checkAccess}><label className="label">Permission key<input className="field" value={checkKey} onChange={(event) => setCheckKey(event.target.value)} required placeholder="billing.payment.refund" /></label><label className="label">User ID (blank means me)<input className="field" value={checkUser || effectivePersonId} onChange={(event) => setCheckUser(event.target.value)} /></label><button className="btn self-end">Check access</button></form>{decision && <div className="rbac-decision"><div className="flex gap-2"><span className={`prototype-badge prototype-badge-${decision.allowed ? 'good' : 'danger'}`}>{decision.allowed ? 'Allowed' : 'Denied'}</span>{decision.reach && <span className="prototype-badge">{decision.reach}{decision.filter_scope ? ` · ${decision.filter_scope}` : ''}</span>}{decision.needs_approval && <span className="prototype-badge prototype-badge-warn">Approval required</span>}</div><ol>{decision.trace.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol></div>}</section>
    </section>}
    {tab === 'approvals' && <section className="rbac-tab-content"><p className="rbac-tab-intro">One person makes a sensitive change or action, another approves it. Requests shown here are loaded from the built-in approval workflow for the selected authorization domain.</p><section className="rbac-approval-list">{requests.items.map((request) => {
      const riskLabel = ['None', 'Low', 'Medium', 'High', 'Critical'][request.risk] || 'High';
      const comment = approvalComments[request.id] || '';
      const role = request.role_id ? roles.items.find((item) => item.id === request.role_id) : undefined;
      const patchItems = Array.isArray(request.patch) ? request.patch.filter((item) => item && typeof item === 'object') : [];
      const changeCount = patchItems.length || (request.runtime_permission_key ? 1 : 0);
      const title = role ? `${requestKindLabel(request.kind)} · ${role.name}: ${changeCount || 1} change${changeCount === 1 ? '' : 's'}` : `${requestKindLabel(request.kind)} · ${changeCount ? `${changeCount} change${changeCount === 1 ? '' : 's'}` : 'request'}`;
      const maker = effectivePeople.find((person) => person.id === request.maker_id);
      const makerLabel = maker ? `${maker.name}${maker.email ? ` · ${maker.email}` : ''}` : 'Requester unavailable';
      const createdLabel = relativeTime(request.created_at);
      const expiresLabel = request.expires_at ? new Date(request.expires_at).toLocaleString() : 'expiry unavailable';
      const isMaker = currentActor?.id === request.maker_id;
      const isPlatformSuperAdmin = domain === 'platform' && (
        currentActor?.is_bootstrap_operator === true
        || currentActor?.role_id === 'platform-super-admin'
        || currentActor?.role === 'Platform Super Admin'
        || currentActor?.role === 'platform-super-admin'
      );
      const canDecide = Boolean(currentActor) && (!isMaker || isPlatformSuperAdmin);
      const canWithdraw = Boolean(currentActor) && isMaker;
      const eligibilityHint = !currentActor ? 'Your identity could not be loaded; approval actions are unavailable.' : isMaker && !isPlatformSuperAdmin ? 'Only another eligible platform operator can approve this request. You can withdraw it while it is pending.' : isMaker ? 'Platform Super Admin self-approval is enabled for system setup.' : 'Approval eligibility is enforced by the backend for this authorization domain.';
      return <article className="panel rbac-approval-card" key={request.id}>
        <div className="rbac-approval-head"><div><h3>{title}</h3><p className="muted">{request.break_glass ? 'Break-glass action' : 'Role or permission change'} · {domain} · by {makerLabel} · {createdLabel} · <time dateTime={request.expires_at} title={expiresLabel}>expires {expiresLabel}</time></p></div><div className="rbac-approval-badges"><span className={`prototype-badge prototype-badge-${request.status === 'pending' ? 'warn' : tone(request.status)}`}>{request.status === 'pending' ? 'Pending approval' : request.status}</span><span className={`prototype-badge prototype-badge-${request.risk >= 4 ? 'danger' : 'warn'}`}>{riskLabel} risk</span></div></div>
        <p><strong>Reason:</strong> {request.reason || '—'}</p>
        {(request.patch || request.runtime_permission_key) && <ul className="rbac-request-details">{requestPatchLines(request.patch, catalogue, request.runtime_permission_key).map((line, index) => <li key={`${request.id}-detail-${index}`}>{line}</li>)}</ul>}
        <p className="muted">{request.affected_users >= 0 ? `Affects ${request.affected_users} user${request.affected_users === 1 ? '' : 's'}` : 'Affected users unavailable'} · {request.decisions.length} of {request.required_approvals} approval{request.required_approvals === 1 ? '' : 's'}</p>
        {request.status === 'pending' && <><input className="field rbac-comment" value={comment} onChange={(event) => setApprovalComments((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Comment (required to reject)" /><div className="rbac-approval-actions"><button className="btn" type="button" disabled={busy || !canDecide} onClick={() => void requestAction(request, 'approve', comment)}>Approve</button><button className="btn-secondary" type="button" disabled={busy || !canDecide || comment.trim().length < 5} onClick={() => void requestAction(request, 'reject', comment)}>Reject</button><button className="btn-secondary" type="button" disabled={busy || !canWithdraw} onClick={() => void requestAction(request, 'withdraw', comment)}>Withdraw</button></div><p className="rbac-approval-hint">{eligibilityHint}</p></>}
      </article>;
    })}{!requests.items.length && <section className="panel rbac-empty-approval"><div className="rbac-empty-approval-grid"><strong>Request</strong><strong>Maker / reason</strong><strong>Risk</strong><strong>Expires</strong><strong>Status</strong><strong>Actions</strong></div><p className="muted">No approval requests.</p></section>}<div className="prototype-pagination rbac-request-pagination"><label className="label">Rows<select className="field" value={requestSize} onChange={(event) => void loadRequests(1, Number(event.target.value))}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></label><span>Page {requests.page} of {requests.pages || 1} · {requests.total} requests</span><button className="btn-secondary" disabled={requests.page <= 1} onClick={() => void loadRequests(requests.page - 1, requestSize)}>Previous</button><button className="btn-secondary" disabled={requests.page >= requests.pages} onClick={() => void loadRequests(requests.page + 1, requestSize)}>Next</button></div></section></section>}
    {tab === 'policy' && policy && policyDraft && <div className="rbac-tab-content rbac-policy-content"><h2>Approval policy</h2><div className="rbac-domain-toggle tenant-domain-only rbac-domain-toggle-wide" role="status" aria-label="Approval policy domain">Tenant</div><p className="rbac-tab-intro">Configure maker-checker for the selected authorization domain. Role-change approval and runtime action approval are separate mechanisms.</p>
      <section className="panel"><div className="prototype-section-head"><div><h2>Role and permission change approvals</h2><p>Policy for the {domain} authorization domain. Saving creates a request for a different eligible checker.</p></div></div><form onSubmit={submitPolicy}><div className="rbac-policy-grid">
        <PolicyToggle label="Critical or four-eyes permissions" checked={policyDraft.require_role_grant_critical_or_four_eyes} onChange={(checked) => setPolicyDraft({ ...policyDraft, require_role_grant_critical_or_four_eyes: checked })} />
        <PolicyToggle label="High-risk role assignments" checked={policyDraft.require_high_risk_assignment} onChange={(checked) => setPolicyDraft({ ...policyDraft, require_high_risk_assignment: checked })} />
        <PolicyToggle label="Separation-of-duties conflicts" checked={policyDraft.require_sod_conflict} onChange={(checked) => setPolicyDraft({ ...policyDraft, require_sod_conflict: checked })} />
        <PolicyToggle label="Every policy change" checked={policyDraft.require_every_change} onChange={(checked) => setPolicyDraft({ ...policyDraft, require_every_change: checked })} />
        <PolicyToggle label="Any Super Admin change · locked" checked={policyDraft.require_superadmin_change} disabled onChange={() => undefined} />
        <label className="label">Approvals needed<select className="field" value={policyDraft.approvers_needed} onChange={(event) => setPolicyDraft({ ...policyDraft, approvers_needed: Number(event.target.value) })}><option value={1}>1 approver</option><option value={2}>2 approvers</option></select></label>
        <label className="label">Request expires after<select className="field" value={policyDraft.expires_after_hours} onChange={(event) => setPolicyDraft({ ...policyDraft, expires_after_hours: Number(event.target.value) })}><option value={24}>24 hours</option><option value={48}>48 hours</option><option value={72}>72 hours</option><option value={168}>7 days</option></select></label>
        <PolicyToggle label="Emergency break-glass" checked={policyDraft.break_glass_enabled} onChange={(checked) => setPolicyDraft({ ...policyDraft, break_glass_enabled: checked })} />
      </div><div className="rbac-policy-row rbac-policy-approvers"><div><strong>Who can approve</strong><span>Never the maker. Approvers must belong to the same authorization domain as the request.</span></div><div className="rbac-approver-tags">{(domain === 'platform' ? policyDraft.platform_eligible_roles : policyDraft.tenant_eligible_roles).map((role) => <span className="prototype-badge prototype-badge-info" key={role}>{role}</span>)}</div></div><div className="prototype-controls mt-3"><label className="label">Reason<input className="field" value={policyReason} minLength={8} maxLength={1000} onChange={(event) => setPolicyReason(event.target.value)} required /></label><button className="btn self-end" disabled={busy}>Submit policy change</button></div></form></section>
      <section className="panel overflow-auto"><div className="prototype-section-head"><div><h2>Action approval rules (maker-checker)</h2><p>Each rule describes which permission actions require a second person. Rules are evaluated in priority order; lower numbers run first. Reordering does not remove an overlap.</p><p className="muted text-sm">Put specific rules before broad catch-all rules. <code>*</code> matches one part; <code>{'{a,b}'}</code> lists options.</p></div></div><table><thead><tr><th>Order</th><th>Rule</th><th>Patterns</th><th>Domain</th><th>Matches</th><th>Governed</th><th>Overlaps</th><th /></tr></thead><tbody>{policy.rules.items.filter((row) => ruleDrafts.some((draft) => draft.id === row.id)).map((row) => { const rule = ruleDrafts.find((draft) => draft.id === row.id) || row; return <tr key={rule.id} draggable onDragStart={() => setDragRuleId(rule.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropRule(rule.id)}><td><div className="rbac-order"><button type="button" aria-label={`Move ${rule.name} up`} onClick={() => moveRule(rule.id, -1)}>↑</button><strong>{rule.priority}</strong><button type="button" aria-label={`Move ${rule.name} down`} onClick={() => moveRule(rule.id, 1)}>↓</button></div></td><td>{rule.name}</td><td><code>{rule.patterns.join(' ; ')}</code></td><td><select className="field" value={rule.scope} onChange={(event) => setRuleDrafts((current) => current.map((item) => item.id === rule.id ? { ...item, scope: event.target.value as FourEyesRule['scope'] } : item))}><option>Off</option>{domain === 'tenant' && <option>Tenant</option>}{domain === 'platform' && <option>Platform</option>}<option>Both</option></select></td><td>{row.matches}</td><td>{row.governed}</td><td>{row.overlaps}</td><td><button type="button" className="btn-secondary" onClick={() => setRuleDrafts((current) => normalizedRules(current.filter((item) => item.id !== rule.id)))}>Remove</button></td></tr>; })}</tbody></table><div className="prototype-pagination"><label className="label">Rows<select className="field" value={policySize} onChange={(event) => void loadPolicy(1, Number(event.target.value))}><option>10</option><option>25</option><option>50</option></select></label><span>Page {policy.rules.page} of {policy.rules.pages || 1} · {policy.rules.total} rules</span><button className="btn-secondary" disabled={policy.rules.page <= 1} onClick={() => void loadPolicy(policy.rules.page - 1)}>Previous</button><button className="btn-secondary" disabled={policy.rules.page >= policy.rules.pages} onClick={() => void loadPolicy(policy.rules.page + 1)}>Next</button></div><form className="rbac-add-rule" onSubmit={addRule}><label className="label">Rule name<input className="field" name="name" minLength={3} required /></label><label className="label">Permission patterns, separated by ;<input className="field" name="patterns" required placeholder="billing.*.reverse ; *.*.refund" /></label><label className="label">Authorization domain<select className="field" name="scope" defaultValue={domain === 'platform' ? 'Platform' : 'Tenant'}>{domain === 'tenant' && <option>Tenant</option>}{domain === 'platform' && <option>Platform</option>}<option>Both</option></select></label><button className="btn-secondary self-end">Add rule to draft</button></form><form className="prototype-controls mt-3" onSubmit={submitRules}><label className="label">Reason<input className="field" value={ruleReason} minLength={8} maxLength={1000} onChange={(event) => setRuleReason(event.target.value)} required /></label><button className="btn self-end" disabled={busy}>Submit rule changes</button></form></section>
      <section className="panel"><div className="prototype-section-head"><div><h2>Overlapping rule matches</h2><p>Diagnostic view of permissions matched by more than one enabled rule.</p></div><span className="prototype-badge">{policy.overlaps.length} permissions</span></div>{policy.overlaps.length ? <div className="rbac-overlaps">{policy.overlaps.map((item) => <details key={item.permission_key}><summary><span><strong>{item.label}</strong><code>{item.permission_key}</code></span><span>{item.match_count} matching rules</span></summary><ol>{item.rules.map((rule) => <li key={rule.id}><strong>{rule.priority}</strong> {rule.name} {rule.governs && <span className="prototype-badge prototype-badge-good">Governs</span>}</li>)}</ol></details>)}</div> : <p className="muted">No permissions match more than one enabled rule.</p>}</section>
      <section className="panel"><div className="prototype-section-head"><div><h2>New permissions awaiting review</h2><p>New catalogue keys remain default-deny until they are classified.</p></div><span className={`prototype-badge ${policy.awaiting_review.length ? 'prototype-badge-warn' : 'prototype-badge-good'}`}>{policy.awaiting_review.length}</span></div>{policy.awaiting_review.length ? <ul className="space-y-2">{policy.awaiting_review.map((permission) => <li key={permission.key}><strong>{permission.resource_name} · {permission.action.replaceAll('_', ' ')}</strong><br /><code>{permission.key}</code></li>)}</ul> : <p className="muted">All registered permissions have been reviewed.</p>}</section>
    </div>}
    {tab === 'history' && <section className="rbac-tab-content"><h2>Change history</h2><p className="rbac-tab-intro">Every save is a numbered version with who, why and what changed.</p><section className="panel rbac-history-card"><div className="rbac-history-toolbar"><span>Rows</span><select className="field" value={history.size} onChange={(event) => void api<Page<History>>(`${prefix}/history?page=1&size=${Number(event.target.value)}`).then(setHistory).catch(() => setMessage('History could not be loaded'))}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select><span className="muted">Page {history.page} of {history.pages || 1}</span><button className="btn-secondary" disabled={history.page <= 1} onClick={() => void api<Page<History>>(`${prefix}/history?page=${history.page - 1}&size=${history.size}`).then(setHistory)}>Previous</button><button className="btn-secondary" disabled={history.page >= history.pages} onClick={() => void api<Page<History>>(`${prefix}/history?page=${history.page + 1}&size=${history.size}`).then(setHistory)}>Next</button></div><div className="rbac-history-list">{history.items.map((item, index) => <article className="rbac-history-version" key={item.id}><div><h3>Version {item.version}</h3><p className="muted">By {item.author_id} · {new Date(item.created_at).toLocaleString()}</p><p>{item.reason || 'No reason supplied.'}</p><p className="muted">{item.changes.length} change{item.changes.length === 1 ? '' : 's'} · {item.approver_ids.join(', ') || 'Review pending'}{item.break_glass ? ' · Break-glass' : ''}</p></div><div className="rbac-history-actions"><span className="prototype-badge prototype-badge-good">{index === 0 ? 'Current' : 'Applied'}</span><button className="btn-secondary" type="button" disabled title="Version restore is not exposed by the current RBAC API">Restore this version</button></div></article>)}{!history.items.length && <p className="muted">No policy versions have been applied.</p>}</div><p className="muted text-sm">Restore controls are shown for workflow parity but remain unavailable until the backend exposes a version-restore operation.</p></section></section>}
  </section>;
}

function PolicyToggle({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  const descriptions: Record<string, string> = {
    'Critical or four-eyes permissions': 'Granting a critical permission or a permission covered by a runtime four-eyes rule waits for approval.',
    'High-risk role assignments': 'High-risk role assignments require a second eligible person.',
    'Separation-of-duties conflicts': 'Any change that lets one role make and approve the same thing.',
    'Every policy change': 'Strictest option. Even low-risk changes wait for a checker.',
    'Any Super Admin change · locked': 'Always required.',
    'Emergency break-glass': 'Apply at once with a reason and step-up MFA; flagged for review.',
  };
  return <div className="rbac-policy-row"><div><strong>{label}</strong><span>{descriptions[label] || 'Require maker-checker approval for this change.'}</span></div><input className="rbac-switch" type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} aria-label={label} /></div>;
}
