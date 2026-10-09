import { useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { api, setToken } from "../../shared/api";
import { Field } from "../../shared/Fields";
import { isSandboxEnvironment, supportDestination } from "../../shared/environment";
import type { TenantContext } from "../../shared/tenant";

type Challenge = {
  tenant_slug: string;
  challenge_token: string;
  enrollment_required: boolean;
};
type Enrollment = { secret: string; qr: string };
type AuthView =
  | { type: "login" }
  | { type: "invite" }
  | { type: "mfa"; challenge: Challenge; enrollment?: Enrollment };

export function Auth({
  tenant,
  onAuthenticated,
}: {
  tenant: TenantContext;
  onAuthenticated: () => Promise<void>;
}) {
  const [view, setView] = useState<AuthView>({ type: "login" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function run(action: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const result = await api<{
        challenge_token: string;
        enrollment_required: boolean;
      }>("/auth/staff/login", {
        tenant_slug: tenant.slug,
        email: form.get("email"),
        password: form.get("password"),
      });
      const challenge: Challenge = { tenant_slug: tenant.slug, ...result };
      if (!result.enrollment_required)
        return setView({ type: "mfa", challenge });
      const setup = await api<{ secret: string; uri: string }>(
        "/auth/mfa/setup",
        challenge,
      );
      setView({
        type: "mfa",
        challenge,
        enrollment: {
          secret: setup.secret,
          qr: await QRCode.toDataURL(setup.uri),
        },
      });
    });
  }

  async function handleMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (view.type !== "mfa") return;
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const result = await api<{ access_token: string }>("/auth/mfa/verify", {
        ...view.challenge,
        code: form.get("code"),
      });
      setToken(result.access_token);
      await onAuthenticated();
    });
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api("/auth/invites/accept", {
        tenant_slug: tenant.slug,
        token: form.get("token"),
        password: form.get("password"),
      });
      setView({ type: "login" });
    });
  }

  function form() {
    if (view.type === "mfa")
      return (
        <form className="staff-auth-form" onSubmit={handleMfa}>
          <h2 className="staff-auth-heading">
            {view.enrollment
              ? "Set up your authenticator"
              : "Verify your identity"}
          </h2>
          {view.enrollment && (
            <>
              <p className="staff-auth-copy">
                Scan this QR code in your authenticator app, then enter its
                six-digit code.
              </p>
              <img
                src={view.enrollment.qr}
                width="220"
                height="220"
                alt="Authenticator enrollment QR code"
              />
              <details>
                <summary className="text-sm">Manual setup key</summary>
                <code data-testid="mfa-secret" className="break-all text-sm">
                  {view.enrollment.secret}
                </code>
              </details>
            </>
          )}
          <Field label="Authenticator code">
            <input
              className="staff-auth-field"
              name="code"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
            />
          </Field>
          <button className="staff-auth-primary" disabled={busy}>
            Verify and sign in
          </button>
          <button
            type="button"
            className="staff-auth-secondary"
            onClick={() => setView({ type: "login" })}
          >
            Back to sign in
          </button>
        </form>
      );
    if (view.type === "invite")
      return (
        <form className="staff-auth-form" onSubmit={handleInvite}>
          <h2 className="staff-auth-heading">Accept invitation</h2>
          <p className="staff-auth-copy">Invitation for {tenant.name}</p>
          <Field label="Invitation token">
            <input className="staff-auth-field" name="token" required />
          </Field>
          <Field label="Choose password">
            <input
              className="staff-auth-field"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </Field>
          <button className="staff-auth-primary" disabled={busy}>
            Create staff account
          </button>
          <button
            className="staff-auth-secondary"
            type="button"
            onClick={() => setView({ type: "login" })}
          >
            Back
          </button>
        </form>
      );
    return (
      <form className="staff-auth-form" onSubmit={handleLogin}>
        <h2 className="staff-auth-heading">Staff sign in</h2>
        {tenant.name && <p className="staff-auth-copy">{tenant.name}</p>}
        <Field label="Email">
          <input
            className="staff-auth-field"
            name="email"
            type="email"
            autoComplete="username"
            required
            defaultValue="admin@dhmis.test"
          />
        </Field>
        <div>
          <div className="staff-auth-password-label">
            <label htmlFor="staff-password">Password</label>
            <button type="button" className="staff-auth-forgot" onClick={() => setError("Ask your clinic administrator to send a one-time password reset link.")}>Forgot password?</button>
          </div>
          <div className="password-field">
            <input
              id="staff-password"
              className="staff-auth-field"
              data-password-toggle-ready="true"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
            />
            <button type="button" data-password-toggle="true" aria-pressed={showPassword} onClick={() => setShowPassword((current) => !current)}>{showPassword ? "Hide" : "Show"}</button>
          </div>
        </div>
        <button className="staff-auth-primary" disabled={busy}>
          {busy ? "Connecting…" : "Continue to MFA"}
        </button>
        <button
          type="button"
          className="staff-auth-secondary"
          onClick={() => setView({ type: "invite" })}
        >
          Accept a staff invitation
        </button>
        <p className="staff-auth-note">You’ll confirm your identity with MFA next.</p>
      </form>
    );
  }

  return (
    <main className="staff-auth">
      {isSandboxEnvironment && <div className="staff-auth-sandbox"><strong>Development sandbox</strong> · Synthetic records · no live payments, claims, or signatures</div>}
      <div className="staff-auth-layout">
        <section className="staff-auth-intro">
          <span className="staff-auth-badge">DHMIS · {tenant.name}</span>
          <h1>Sign in to your clinic workspace.</h1>
          <p>Patients, schedule, charting, billing, and practice operations in one connected workspace.</p>
          <p className="staff-auth-security">Your clinic’s data only · MFA required</p>
        </section>
        <div className="staff-auth-card-wrap">
          <section className="staff-auth-card">
            {form()}
            {error && <p role="alert" className="staff-auth-error">{error}</p>}
            <div className="staff-auth-help">
              Need help signing in?
              <button type="button" onClick={() => setError("Contact your clinic administrator for staff access or account recovery.")}>Ask your clinic administrator →</button>
              {supportDestination
                ? <a href={supportDestination}><strong>Contact DHMIS Support →</strong></a>
                : <button type="button" onClick={() => setError("DHMIS support can help with platform access issues. Do not include patient names or health information in a support request.")}><strong>Contact DHMIS Support →</strong></button>}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
