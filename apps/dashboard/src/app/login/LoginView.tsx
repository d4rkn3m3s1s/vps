'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LoginView() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? 'Sign in failed.');
      }
      router.replace('/profiles');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <span className="brand-mark">V</span>
          <div className="brand-text">
            <strong>VPS Fleet</strong>
            <span className="brand-sub">Cloud Phones</span>
          </div>
        </div>

        <h1 className="login-title">Sign in</h1>
        <p className="helper">Manage your Android cloud phone fleet.</p>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            className="field-input"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            className="field-input"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </label>

        {error ? <p className="field-error">{error}</p> : null}

        <button type="submit" className="btn-primary login-submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
