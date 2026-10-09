import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ArrowDown, ArrowUp, Image, Plus, Trash2 } from 'lucide-react';
import { api, authenticatedBlobUrl } from '../../shared/api';
import type { Reference, User } from '../../shared/types';
import type { TenantContext } from '../../shared/tenant';
import { DentalServiceIcon, dentalServiceIconLabels, dentalServiceIconNames } from '../../shared/DentalServiceIcon';

type ConsentEvidence = {
  confirmed: boolean;
  confirmed_by: string;
  confirmed_at: string;
  source: string;
  document_reference: string;
};
type CmsMedia = {
  key: string;
  kind: 'hero' | 'provider' | 'gallery' | 'testimonial';
  file_name: string;
  file_url: string;
  mime_type: string;
  alt_text: string;
  consent: ConsentEvidence;
  visible: boolean;
};
type CmsService = {
  id: string;
  title: string;
  icon: string;
  description: string;
  fee_mode: 'from' | 'free' | 'contact';
  fee_cents: number | null;
  visible: boolean;
  order: number;
};
type CmsDentist = {
  id: string;
  name: string;
  role: string;
  biography: string;
  languages: string[];
  accepting_new_patients: boolean;
  bookable_online: boolean;
  photo_key: string;
  visible: boolean;
  order: number;
};
type CmsLocation = {
  location_id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  timezone: string;
  hours: Record<string, string>;
  closure_note: string;
  visible: boolean;
};
type CmsTestimonial = {
  id: string;
  quote: string;
  attribution: string;
  consent: ConsentEvidence;
  visible: boolean;
};
type CmsContent = {
  headline: string;
  introduction: string;
  contact_email: string;
  contact_phone: string;
  address: string;
  brand: Record<string, string>;
  services: CmsService[];
  dentists: CmsDentist[];
  locations: CmsLocation[];
  media: CmsMedia[];
  testimonials_enabled: boolean;
  regulator_declaration: boolean;
  testimonials: CmsTestimonial[];
};
type CmsRevision = {
  id: string;
  revision_number: number;
  status: string;
  content: CmsContent;
  applicability: { scope: 'organization' | 'location'; location_ids: string[] };
  validation: Preflight | Record<string, never>;
  updated_at: string;
};
type PendingPublication = {
  revisionId: string;
  requestId: string;
  payload: {
    idempotency_key: string;
    expected_updated_at: string;
    confirmed_scope: string;
    confirmed_location_ids: string[];
    reason: string;
  };
};
type Blocker = { code: string; asset_key?: string; dentist_id?: string; location_id?: string; testimonial_id?: string };
type Preflight = {
  valid: boolean;
  blocker_count: number;
  blockers: Blocker[];
  policy_versions: Record<string, string>;
  revision_updated_at: string;
};
type Tab = 'services' | 'dentists' | 'hours' | 'media' | 'testimonials';
type PhotoDraft = {
  key: string;
  kind: CmsMedia['kind'];
  label: string;
  file: File | null;
  fileName: string;
  mimeType: string;
  contentBase64: string;
  altText: string;
  consent: boolean;
};

const tabs: { key: Tab; label: string }[] = [
  { key: 'services', label: 'Services' },
  { key: 'dentists', label: 'Dentists' },
  { key: 'hours', label: 'Hours & location' },
  { key: 'media', label: 'Media' },
  { key: 'testimonials', label: 'Testimonials' },
];
const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function initials(name: string) {
  return name.replace(/^Dr\.?\s+/i, '').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}
function feeLabel(service: CmsService) {
  if (service.fee_mode === 'free') return 'Free';
  if (service.fee_mode === 'contact') return 'Contact us';
  return `from ${new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format((service.fee_cents || 0) / 100)}`;
}
function blockerLabel(blocker: Blocker) {
  const labels: Record<string, string> = {
    'media.file.required': 'Choose a photo',
    'media.alt.required': 'Add photo alt text of at least 8 characters',
    'media.consent.required': 'Record written photo consent',
    'dentist.photo.unknown': 'A dentist refers to a missing photo',
    'dentist.booking.unsupported': 'A dentist is not available in the booking provider list',
    'testimonials.regulator_declaration.required': 'Confirm that your regulator permits testimonials',
    'testimonial.consent.required': 'Record written testimonial consent',
    'scope.location.unknown': 'A publication location is no longer available',
    'content.location.unknown': 'A website location is no longer available',
  };
  return labels[blocker.code] || blocker.code;
}
async function fileBase64(file: File) {
  const result = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The photo could not be read.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
  return result.split(',')[1] || '';
}

export function SiteEditor({ tenant, user, reference }: { tenant: TenantContext; user: User; reference: Reference }) {
  const [tab, setTab] = useState<Tab>('services');
  const [revision, setRevision] = useState<CmsRevision | null>(null);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [photo, setPhoto] = useState<PhotoDraft | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [publishReason, setPublishReason] = useState('');
  const [pendingPublication, setPendingPublication] = useState<PendingPublication | null>(null);
  const photoDialogRef = useRef<HTMLElement>(null);
  const photoOpenerRef = useRef<HTMLElement | null>(null);

  async function load() {
    setBusy(true);
    setError('');
    try {
      const draft = await api<CmsRevision>('/cms/revisions/draft');
      const checked = await api<Preflight>(`/cms/revisions/${draft.id}/preflight`, {});
      const current = { ...draft, updated_at: checked.revision_updated_at, validation: checked };
      setRevision(current);
      setPreflight(checked);
      setDirty(false);
      const nextPreviews: Record<string, string> = {};
      await Promise.all(current.content.media.map(async (asset) => {
        try {
          nextPreviews[asset.key] = await authenticatedBlobUrl(`/cms/revisions/${current.id}/media/${asset.key}`);
        } catch {
          if (asset.file_url.startsWith('http')) nextPreviews[asset.key] = asset.file_url;
        }
      }));
      setPreviews((previous) => {
        Object.values(previous).filter((url) => url.startsWith('blob:')).forEach(URL.revokeObjectURL);
        return nextPreviews;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The site editor could not load.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => () => Object.values(previews).filter((url) => url.startsWith('blob:')).forEach(URL.revokeObjectURL), [previews]);
  useEffect(() => {
    if (!photo) return;
    photoOpenerRef.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => photoDialogRef.current?.querySelector<HTMLElement>('input,button')?.focus());
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPhoto(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(photoDialogRef.current?.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)') || []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKey);
      photoOpenerRef.current?.focus();
    };
  }, [Boolean(photo)]);

  function changeContent(change: (content: CmsContent) => void) {
    setRevision((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      change(next.content);
      return next;
    });
    setDirty(true);
    setPreflight(null);
    setMessage('');
  }

  async function saveDraft(current = revision) {
    if (!current) throw new Error('The draft is not ready.');
    const saved = await api<CmsRevision>(`/cms/revisions/${current.id}`, {
      content: current.content,
      applicability: current.applicability,
      expected_updated_at: current.updated_at,
    }, 'PUT');
    setRevision(saved);
    setDirty(false);
    return saved;
  }

  async function checkDraft(current: CmsRevision) {
    const result = await api<Preflight>(`/cms/revisions/${current.id}/preflight`, {});
    const updated = { ...current, updated_at: result.revision_updated_at, validation: result };
    setRevision(updated);
    setPreflight(result);
    return { revision: updated, result };
  }

  async function handleSave() {
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await saveDraft();
      await checkDraft(saved);
      setMessage('Draft saved to the database.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Draft could not be saved.'); }
    finally { setBusy(false); }
  }

  async function handlePreview() {
    const previewWindow = window.open('about:blank', '_blank');
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await saveDraft();
      const token = await api<{ token: string }>(`/cms/revisions/${saved.id}/preview-token`, {});
      const destination = `/${tenant.slug}?cms_preview=${encodeURIComponent(token.token)}`;
      if (previewWindow) previewWindow.location.href = destination;
      else window.location.href = destination;
      setMessage('Signed preview opened. The link expires in 10 minutes.');
    } catch (reason) {
      previewWindow?.close();
      setError(reason instanceof Error ? reason.message : 'Preview could not be opened.');
    } finally { setBusy(false); }
  }

  async function handlePublish() {
    setBusy(true); setError(''); setMessage('');
    try {
      if (pendingPublication) {
        await api(`/cms/revisions/${pendingPublication.revisionId}/publish`, { ...pendingPublication.payload, approval_request_id: pendingPublication.requestId });
        setPendingPublication(null);
        setPublishReason('');
        setMessage('Published. The clinic website now uses this revision.');
        await load();
        return;
      }
      const saved = await saveDraft();
      const checked = await checkDraft(saved);
      if (!checked.result.valid) {
        setTab('media');
        setError(`${checked.result.blocker_count} item${checked.result.blocker_count === 1 ? '' : 's'} must be fixed before publishing.`);
        return;
      }
      const payload = {
        idempotency_key: crypto.randomUUID(),
        expected_updated_at: checked.result.revision_updated_at,
        confirmed_scope: saved.applicability.scope,
        confirmed_location_ids: saved.applicability.location_ids,
        reason: publishReason.trim(),
      };
      const result = await api<{ status?: string; request?: { id: string } }>(`/cms/revisions/${saved.id}/publish`, payload);
      if (result.status === 'approval_required' && result.request) {
        setPendingPublication({ revisionId: saved.id, requestId: result.request.id, payload });
        setMessage('Publication submitted for maker-checker approval. After another eligible administrator approves it, choose Publish approved revision.');
        return;
      }
      setPublishReason('');
      setMessage('Published. The clinic website now uses this revision.');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Publication failed.'); }
    finally { setBusy(false); }
  }

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !photo) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPG, PNG, or WebP photo.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Photo must be 5 MB or smaller.');
      return;
    }
    setPhoto({ ...photo, file, fileName: file.name, mimeType: file.type, contentBase64: await fileBase64(file) });
  }

  async function savePhoto() {
    if (!revision || !photo || !photo.file || photo.altText.trim().length < 8 || !photo.consent) return;
    setBusy(true); setError('');
    try {
      const saved = await saveDraft(revision);
      const updated = await api<CmsRevision>(`/cms/revisions/${saved.id}/media`, {
        key: photo.key,
        kind: photo.kind,
        file_name: photo.fileName,
        mime_type: photo.mimeType,
        content_base64: photo.contentBase64,
        alt_text: photo.altText.trim(),
        consent: {
          confirmed: true,
          confirmed_by: user.name,
          confirmed_at: new Date().toISOString(),
          source: 'written-consent-confirmed-by-content-editor',
          document_reference: '',
        },
        visible: true,
        expected_updated_at: saved.updated_at,
      });
      const objectUrl = URL.createObjectURL(photo.file);
      setPreviews((current) => ({ ...current, [photo.key]: objectUrl }));
      setRevision(updated);
      setDirty(false);
      setPreflight(null);
      setPhoto(null);
      setMessage('Photo and consent evidence saved to the draft.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Photo could not be saved.'); }
    finally { setBusy(false); }
  }

  function openPhoto(key: string, kind: CmsMedia['kind'], label: string) {
    const existing = revision?.content.media.find((asset) => asset.key === key);
    if (kind === 'provider') {
      changeContent((content) => {
        const dentist = content.dentists.find((item) => `provider-${item.id}` === key && !item.photo_key);
        if (dentist) dentist.photo_key = key;
      });
    }
    setPhoto({ key, kind, label, file: null, fileName: existing?.file_name || '', mimeType: existing?.mime_type || '', contentBase64: '', altText: existing?.alt_text || '', consent: Boolean(existing?.consent.confirmed) });
  }

  function moveService(index: number, direction: -1 | 1) {
    changeContent((content) => {
      const target = index + direction;
      if (target < 0 || target >= content.services.length) return;
      [content.services[index], content.services[target]] = [content.services[target], content.services[index]];
      content.services.forEach((service, order) => { service.order = order; });
    });
  }

  const content = revision?.content;
  const visibleServices = useMemo(() => content?.services.filter((service) => service.visible).sort((a, b) => a.order - b.order) || [], [content]);
  const visibleDentists = useMemo(() => content?.dentists.filter((dentist) => dentist.visible).sort((a, b) => a.order - b.order) || [], [content]);
  const blockers = preflight?.blockers || [];

  if (!revision || !content) return <section className="panel" aria-busy={busy}>{error || 'Loading site editor…'}</section>;

  return (
    <section className="cms-editor" aria-label="Clinic site editor">
      <header className="cms-editor-header">
        <div><strong>{tenant.name}</strong><span>Site editor · Draft {revision.revision_number}</span></div>
        <span className={`cms-status ${preflight?.valid && !dirty ? 'ready' : 'attention'}`}>
          {dirty ? 'Unsaved changes' : preflight?.valid ? 'Ready to publish' : `${blockers.length} to fix before publishing`}
        </span>
        <button type="button" className="btn-secondary" disabled={busy || !dirty} onClick={() => void handleSave()}>Save draft</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void handlePreview()}>Preview site</button>
        <button type="button" className="btn" disabled={busy || (!pendingPublication && (publishReason.trim().length < 8 || Boolean(preflight && !preflight.valid && !dirty)))} onClick={() => void handlePublish()}>{pendingPublication ? 'Publish approved revision' : 'Publish changes'}</button>
      </header>
      {(error || message) && <p className={`cms-editor-message ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{error || message}</p>}
      {!pendingPublication && <label className="cms-publish-reason label">Publication reason<input className="field" value={publishReason} minLength={8} maxLength={1000} onChange={(event) => setPublishReason(event.target.value)} placeholder="Why this revision is ready to publish" /></label>}
      <div className="cms-editor-layout">
        <nav className="cms-editor-nav" aria-label="Site sections">
          {tabs.map((item) => <button type="button" key={item.key} aria-current={tab === item.key ? 'page' : undefined} onClick={() => setTab(item.key)}>{item.label}</button>)}
        </nav>
        <main className="cms-editor-main">
          {tab === 'services' && <>
            <h1>Services &amp; fees</h1><p className="muted">Shown in this order. Hidden services stay saved.{visibleServices.length === 0 && <strong> With none visible, this section is hidden from your site.</strong>}</p>
            {content.services.map((service, index) => <article className="cms-edit-card" key={service.id}>
              <label className="label">Title<input className="field" value={service.title} onChange={(event) => changeContent((draft) => { draft.services[index].title = event.target.value; })} /></label>
              <fieldset className="cms-icon-picker"><legend>Service icon</legend>{dentalServiceIconNames.map((icon) => <label key={icon} className={service.icon === icon ? 'selected' : ''}><input type="radio" name={`service-icon-${service.id}`} value={icon} checked={service.icon === icon} onChange={() => changeContent((draft) => { draft.services[index].icon = icon; })} /><DentalServiceIcon name={icon} size={24} /><span>{dentalServiceIconLabels[icon]}</span></label>)}</fieldset>
              <label className="label">Short description<textarea className="field" rows={2} maxLength={90} value={service.description} onChange={(event) => changeContent((draft) => { draft.services[index].description = event.target.value; })} /><small>{service.description.length}/90</small></label>
              <div className="cms-two"><label className="label">Fee display<select className="field" value={service.fee_mode} onChange={(event) => changeContent((draft) => { draft.services[index].fee_mode = event.target.value as CmsService['fee_mode']; if (event.target.value === 'from' && draft.services[index].fee_cents === null) draft.services[index].fee_cents = 0; })}><option value="from">From $…</option><option value="free">Free</option><option value="contact">Contact us</option></select></label>{service.fee_mode === 'from' && <label className="label">Starting fee (CAD)<input className="field" type="number" min="0" step="0.01" value={(service.fee_cents || 0) / 100} onChange={(event) => changeContent((draft) => { draft.services[index].fee_cents = Math.round(Number(event.target.value) * 100); })} /></label>}</div>
              <div className="cms-card-tools"><label><input type="checkbox" checked={service.visible} onChange={(event) => changeContent((draft) => { draft.services[index].visible = event.target.checked; })} /> Show on site</label><span /><button type="button" aria-label={`Move ${service.title} up`} disabled={index === 0} onClick={() => moveService(index, -1)}><ArrowUp size={15} /></button><button type="button" aria-label={`Move ${service.title} down`} disabled={index === content.services.length - 1} onClick={() => moveService(index, 1)}><ArrowDown size={15} /></button><button type="button" onClick={() => changeContent((draft) => { draft.services.splice(index, 1); })}><Trash2 size={15} /> Remove</button></div>
            </article>)}
            <button type="button" className="btn-secondary" onClick={() => changeContent((draft) => { draft.services.push({ id: crypto.randomUUID(), title: '', icon: 'consult', description: '', fee_mode: 'contact', fee_cents: null, visible: true, order: draft.services.length }); })}><Plus size={16} /> Add service</button>
          </>}
          {tab === 'dentists' && <>
            <h1>Dentists</h1><p className="muted">Photos are optional. Initials show when there is no photo.</p>
            {content.dentists.map((dentist, index) => {
              const asset = content.media.find((item) => item.key === dentist.photo_key);
              const photoKey = dentist.photo_key || `provider-${dentist.id}`;
              return <article className="cms-edit-card" key={dentist.id}>
                <div className="cms-person"><span className="cms-avatar">{previews[photoKey] ? <img src={previews[photoKey]} alt={asset?.alt_text || ''} /> : initials(dentist.name)}</span><div>{asset ? <><strong>{asset.file_name}</strong><p><span className={asset.alt_text.trim().length >= 8 ? 'cms-ok' : 'cms-bad'}>{asset.alt_text.trim().length >= 8 ? '✓ Alt text' : 'Missing alt text'}</span> <span className={asset.consent.confirmed ? 'cms-ok' : 'cms-bad'}>{asset.consent.confirmed ? '✓ Consent on file' : 'No consent record'}</span></p></> : <p className="muted">No photo · initials will be shown</p>}<button type="button" className="btn-secondary" onClick={() => { if (!dentist.photo_key) changeContent((draft) => { draft.dentists[index].photo_key = photoKey; }); openPhoto(photoKey, 'provider', `Photo for ${dentist.name}`); }}>{asset ? 'Fix / replace photo' : '+ Add photo'}</button></div></div>
                <div className="cms-two"><label className="label">Name<input className="field" value={dentist.name} onChange={(event) => changeContent((draft) => { draft.dentists[index].name = event.target.value; })} /></label><label className="label">Role<input className="field" value={dentist.role} onChange={(event) => changeContent((draft) => { draft.dentists[index].role = event.target.value; })} /></label></div>
                <label className="label">Bio (optional)<textarea className="field" rows={2} maxLength={160} value={dentist.biography} onChange={(event) => changeContent((draft) => { draft.dentists[index].biography = event.target.value; })} /><small>{dentist.biography.length}/160</small></label>
                <label className="label">Languages (optional)<input className="field" value={dentist.languages.join(', ')} onChange={(event) => changeContent((draft) => { draft.dentists[index].languages = event.target.value.split(',').map((value) => value.trim()).filter(Boolean); })} /></label>
                <div className="cms-card-tools"><label><input type="checkbox" checked={dentist.accepting_new_patients} onChange={(event) => changeContent((draft) => { draft.dentists[index].accepting_new_patients = event.target.checked; })} /> Accepting new patients</label><label><input type="checkbox" checked={dentist.bookable_online} onChange={(event) => changeContent((draft) => { draft.dentists[index].bookable_online = event.target.checked; })} /> Bookable online</label><label><input type="checkbox" checked={dentist.visible} onChange={(event) => changeContent((draft) => { draft.dentists[index].visible = event.target.checked; })} /> Show on site</label></div>
              </article>;
            })}
            <button type="button" className="btn-secondary" onClick={() => changeContent((draft) => { draft.dentists.push({ id: crypto.randomUUID(), name: 'Dr. New Dentist', role: 'General dentistry', biography: '', languages: [], accepting_new_patients: true, bookable_online: false, photo_key: '', visible: true, order: draft.dentists.length }); })}><Plus size={16} /> Add dentist</button>
          </>}
          {tab === 'hours' && <>
            <h1>Hours &amp; location</h1>
            {content.locations.map((location, index) => <article className="cms-edit-card" key={location.location_id}>
              <label className="label">Location name<input className="field" value={location.name} onChange={(event) => changeContent((draft) => { draft.locations[index].name = event.target.value; })} /></label>
              <label className="label">Street address<input className="field" value={location.address} onChange={(event) => changeContent((draft) => { draft.locations[index].address = event.target.value; })} /></label>
              <div className="cms-two"><label className="label">Phone<input className="field" value={location.phone} onChange={(event) => changeContent((draft) => { draft.locations[index].phone = event.target.value; })} /></label><label className="label">Email (optional)<input className="field" type="email" value={location.email} onChange={(event) => changeContent((draft) => { draft.locations[index].email = event.target.value; })} /></label></div>
              <label className="label">Time zone<input className="field" value={location.timezone || reference.locations.find((item) => item.id === location.location_id)?.timezone || ''} disabled /><small>Used for “Open now” and booking times. Set by your organization.</small></label>
              <div className="cms-map-resource" role="img" aria-label={`Map placeholder for ${location.name}`}><span>Map</span><small>The interactive map resource will be configured in the next phase.</small></div>
              <h2>Opening hours</h2>{weekdays.map((day) => <label className="cms-hours" key={day}><span>{day[0].toUpperCase() + day.slice(1)}</span><input type="checkbox" checked={Boolean(location.hours[day])} onChange={(event) => changeContent((draft) => { if (event.target.checked) draft.locations[index].hours[day] = '09:00–17:00'; else delete draft.locations[index].hours[day]; })} /><span>{location.hours[day] ? <input className="field" value={location.hours[day]} onChange={(event) => changeContent((draft) => { draft.locations[index].hours[day] = event.target.value; })} aria-label={`${day} hours`} /> : 'Closed'}</span></label>)}
              <label className="label">Holiday or closure notice (optional)<input className="field" value={location.closure_note} onChange={(event) => changeContent((draft) => { draft.locations[index].closure_note = event.target.value; })} placeholder="Closed Dec 25–26" /></label>
            </article>)}
          </>}
          {tab === 'media' && <>
            <h1>Media</h1><p className="muted">Every visible photo needs alt text and a written-consent record before you can publish.</p>
            <div className="cms-edit-card cms-media-table"><table><thead><tr><th>Used in</th><th>File</th><th>Alt text</th><th>Consent</th><th /></tr></thead><tbody>
              <tr><td>Hero photo</td><td>{content.media.find((asset) => asset.key === 'hero')?.file_name || '—'}</td><td>{content.media.find((asset) => asset.key === 'hero')?.alt_text || '—'}</td><td>{content.media.find((asset) => asset.key === 'hero')?.consent.confirmed ? '✓ On file' : '—'}</td><td><button type="button" className="btn-secondary" onClick={() => openPhoto('hero', 'hero', 'Hero photo')}>Add / replace</button></td></tr>
              {content.dentists.map((dentist) => { const asset = content.media.find((item) => item.key === dentist.photo_key); const key = dentist.photo_key || `provider-${dentist.id}`; return <tr key={dentist.id}><td>{dentist.name}</td><td>{asset?.file_name || '—'}</td><td>{asset ? (asset.alt_text.length >= 8 ? '✓ Added' : 'Missing') : '—'}</td><td>{asset?.consent.confirmed ? `✓ ${asset.consent.confirmed_by}` : asset ? 'None' : '—'}</td><td><button type="button" className="btn-secondary" onClick={() => openPhoto(key, 'provider', `Photo for ${dentist.name}`)}>Add / replace</button></td></tr>; })}
            </tbody></table></div>
            {blockers.length > 0 && <div className="cms-blockers"><strong>{blockers.length} to fix before publishing</strong><ul>{blockers.map((blocker, index) => <li key={`${blocker.code}-${index}`}>{blockerLabel(blocker)}</li>)}</ul></div>}
          </>}
          {tab === 'testimonials' && <>
            <h1>Testimonials</h1><article className="cms-edit-card"><span className="cms-status attention">Off by default</span><p>Many dental regulators restrict or prohibit patient testimonials and reviews in advertising. Check your own college’s rules before enabling this section.</p><label className="cms-check"><input type="checkbox" checked={content.regulator_declaration} onChange={(event) => changeContent((draft) => { draft.regulator_declaration = event.target.checked; if (!event.target.checked) draft.testimonials_enabled = false; })} /> My regulator permits publishing patient testimonials</label><p className="muted">Each visible testimonial requires written patient consent, a display name or initials, and a date. Before-and-after images and treatment claims are not supported.</p><label className="cms-check"><input type="checkbox" disabled={!content.regulator_declaration} checked={content.testimonials_enabled} onChange={(event) => changeContent((draft) => { draft.testimonials_enabled = event.target.checked; })} /> Enable testimonials section</label></article>
            {content.testimonials_enabled && <>{content.testimonials.map((testimonial, index) => <article className="cms-edit-card" key={testimonial.id}><label className="label">Testimonial<textarea className="field" rows={3} value={testimonial.quote} onChange={(event) => changeContent((draft) => { draft.testimonials[index].quote = event.target.value; })} /></label><label className="label">Display name or initials<input className="field" value={testimonial.attribution} onChange={(event) => changeContent((draft) => { draft.testimonials[index].attribution = event.target.value; })} /></label><label className="cms-check"><input type="checkbox" checked={testimonial.consent.confirmed} onChange={(event) => changeContent((draft) => { draft.testimonials[index].consent = { confirmed: event.target.checked, confirmed_by: event.target.checked ? user.name : '', confirmed_at: event.target.checked ? new Date().toISOString() : '', source: event.target.checked ? 'written-patient-consent' : '', document_reference: '' }; })} /> Written patient consent is on file</label></article>)}<button type="button" className="btn-secondary" onClick={() => changeContent((draft) => { draft.testimonials.push({ id: crypto.randomUUID(), quote: '', attribution: '', visible: true, consent: { confirmed: false, confirmed_by: '', confirmed_at: '', source: '', document_reference: '' } }); })}><Plus size={16} /> Add testimonial</button></>}
          </>}
        </main>
        <aside className="cms-live-preview" aria-label="Live preview"><h2>How it looks</h2>
          {tab === 'services' && (visibleServices.length ? visibleServices.slice(0, 3).map((service) => <article className="cms-preview-card" key={service.id}><span className={`cms-preview-icon ${service.icon === 'emergency' ? 'is-emergency' : ''}`}><DentalServiceIcon name={service.icon} size={23} /></span><h3>{service.title || 'Untitled service'}</h3><p>{service.description}</p><div><strong>{feeLabel(service)}</strong><span>Book →</span></div></article>) : <p className="cms-preview-card muted">Services section hidden.</p>)}
          {tab === 'dentists' && visibleDentists.slice(0, 2).map((dentist) => <article className="cms-preview-card" key={dentist.id}><span className="cms-avatar">{previews[dentist.photo_key] ? <img src={previews[dentist.photo_key]} alt={content.media.find((asset) => asset.key === dentist.photo_key)?.alt_text || ''} /> : initials(dentist.name)}</span><h3>{dentist.name}</h3><strong className="cms-role">{dentist.role}</strong><p>{dentist.biography}</p>{dentist.bookable_online && <span className="cms-link">Book with {dentist.name} →</span>}</article>)}
          {tab === 'hours' && content.locations.slice(0, 1).map((location) => <article className="cms-preview-card" key={location.location_id}><h3>{location.name}</h3><p>{location.address}<br />{location.phone}</p>{weekdays.map((day) => <div className="cms-preview-hours" key={day}><span>{day.slice(0, 3)}</span><strong>{location.hours[day] || 'Closed'}</strong></div>)}{location.closure_note && <p className="cms-warning">{location.closure_note}</p>}<div className="cms-preview-map" role="img" aria-label={`Map placeholder for ${location.name}`}>Map</div></article>)}
          {(tab === 'media' || tab === 'testimonials') && <p className="cms-preview-card muted">Select Services, Dentists, or Hours to see a section preview. Use Preview site for the full signed preview.</p>}
        </aside>
      </div>
      {photo && <div className="cms-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPhoto(null); }}><section ref={photoDialogRef} className="cms-photo-dialog" role="dialog" aria-modal="true" aria-labelledby="cms-photo-title"><h2 id="cms-photo-title">{photo.label}</h2><label className="label">1. Photo<input type="file" className="field" accept="image/jpeg,image/png,image/webp" onChange={(event) => void choosePhoto(event)} /></label><p className="muted">{photo.fileName || 'JPG, PNG, or WebP · maximum 5 MB'}</p><label className="label">2. Alt text (describes the photo for screen readers)<input className="field" value={photo.altText} onChange={(event) => setPhoto({ ...photo, altText: event.target.value })} placeholder="Dr. Alex Chen smiling in the clinic" /></label><p className="muted">Say who or what is shown. Skip “photo of”.</p><label className="cms-check"><input type="checkbox" checked={photo.consent} onChange={(event) => setPhoto({ ...photo, consent: event.target.checked })} /> 3. I have written consent from everyone identifiable in this photo to publish it on this website.</label><ul className="cms-photo-checks"><li className={photo.file ? 'done' : ''}>{photo.file ? '✓' : '○'} Photo chosen</li><li className={photo.altText.trim().length >= 8 ? 'done' : ''}>{photo.altText.trim().length >= 8 ? '✓' : '○'} Alt text added (8+ characters)</li><li className={photo.consent ? 'done' : ''}>{photo.consent ? '✓' : '○'} Consent confirmed</li></ul><div className="cms-dialog-actions"><button type="button" className="btn-secondary" onClick={() => setPhoto(null)}>Cancel</button><button type="button" className="btn" disabled={busy || !photo.file || photo.altText.trim().length < 8 || !photo.consent} onClick={() => void savePhoto()}><Image size={16} /> Save photo</button></div></section></div>}
    </section>
  );
}
