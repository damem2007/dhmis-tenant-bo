import type { FormEvent } from 'react';
import { api } from '../../shared/api';
import { Field, Title } from '../../shared/Fields';
import type { User } from '../../shared/types';

type Props = {
  user: User;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  onProfileUpdated: () => Promise<void>;
  onSignedOut: () => void;
};

export function Account({ user, busy, run, onProfileUpdated, onSignedOut }: Props) {
  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api('/auth/profile', { name: form.get('name'), photo_url: form.get('photo_url') }, 'PUT');
      await onProfileUpdated();
    });
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api('/auth/password/change', {
        current_password: form.get('current_password'),
        new_password: form.get('new_password'),
      }, 'POST');
      onSignedOut();
    });
  }

  return (
    <>
      <Title title="My account" description="Manage your own profile, password, and sign-in security." />
      <div className="grid gap-5 lg:grid-cols-2">
        <form id="account-profile" className="panel space-y-3" onSubmit={updateProfile}>
          <h2 className="font-semibold">My profile</h2>
          <Field label="Display name"><input className="field" name="name" defaultValue={user.name} required /></Field>
          <Field label="Photo URL"><input className="field" name="photo_url" type="url" defaultValue={user.photo_url || ''} /></Field>
          <button className="btn-secondary" disabled={busy}>Update profile</button>
        </form>
        <form id="account-password" className="panel space-y-3" onSubmit={changePassword}>
          <h2 className="font-semibold">Change password</h2>
          {user.local_password === false
            ? <p className="muted text-sm">Your password is managed by your configured identity provider.</p>
            : <><Field label="Current password"><input className="field" name="current_password" type="password" autoComplete="current-password" required /></Field><Field label="New password"><input className="field" name="new_password" type="password" autoComplete="new-password" minLength={12} required /></Field><button className="btn-secondary" disabled={busy}>Change password and sign out other sessions</button></>}
        </form>
      </div>
      <section id="account-security" className="panel mt-5">
        <h2 className="font-semibold">Security &amp; MFA</h2>
        <p className="mt-2 text-sm"><strong>Authenticator status:</strong> {user.mfa_enabled === false ? 'Enrollment required' : 'Enrolled'}</p>
        <p className="muted mt-1 text-sm">For a lost authenticator or an MFA reset, contact your clinic administrator. A reset revokes existing staff sessions and is recorded in the audit trail.</p>
      </section>
    </>
  );
}
