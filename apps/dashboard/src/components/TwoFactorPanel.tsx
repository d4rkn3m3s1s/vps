'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, ShieldAlert, Copy, Check } from 'lucide-react';

type SetupData = { otpauthUrl: string; qrDataUrl: string; secret: string };

export function TwoFactorPanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<'idle' | 'setup' | 'backup'>('idle');
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function beginSetup() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/2fa/setup', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Setup failed');
      setSetup(json.data as SetupData);
      setStep('setup');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Setup failed');
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/2fa/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: code.trim() })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Invalid code');
      setBackupCodes((json.data as { backupCodes: string[] }).backupCodes);
      setStep('backup');
      setCode('');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    const token = prompt('Enter a current 2FA code (or a backup code) to disable 2FA:');
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? 'Failed to disable');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disable');
    } finally {
      setBusy(false);
    }
  }

  function copyBackup() {
    navigator.clipboard.writeText(backupCodes.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Enabled state ──
  if (enabled && step !== 'backup') {
    return (
      <div className="panel-stack">
        <div className="row">
          <span className="status-chip">
            <ShieldCheck size={16} color="#22C55E" /> Two-factor authentication is ON
          </span>
        </div>
        <p className="helper">Your account is protected by an authenticator app. Login requires a 6-digit code.</p>
        <button type="button" className="btn-ghost danger-btn" onClick={disable} disabled={busy}>
          {busy ? 'Working…' : 'Disable 2FA'}
        </button>
        {error ? <p className="field-error">{error}</p> : null}
      </div>
    );
  }

  // ── Backup codes (just enabled) ──
  if (step === 'backup') {
    return (
      <div className="panel-stack">
        <div className="row">
          <span className="status-chip"><ShieldCheck size={16} color="#22C55E" /> 2FA enabled!</span>
        </div>
        <p className="helper">
          Save these one-time backup codes somewhere safe. Each works once if you lose your authenticator.
        </p>
        <div className="backup-grid">
          {backupCodes.map((c) => (
            <code key={c} className="backup-code">{c}</code>
          ))}
        </div>
        <button type="button" className="btn-ghost" onClick={copyBackup}>
          {copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy all</>}
        </button>
        <button type="button" className="btn-primary" onClick={() => setStep('idle')}>Done</button>
      </div>
    );
  }

  // ── Setup (scan QR + confirm) ──
  if (step === 'setup' && setup) {
    return (
      <div className="panel-stack">
        <p className="helper">1. Scan this QR with Google Authenticator, Authy, or 1Password.</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={setup.qrDataUrl} alt="2FA QR code" className="twofa-qr" />
        <p className="helper">Or enter this key manually:</p>
        <code className="backup-code">{setup.secret}</code>
        <p className="helper">2. Enter the 6-digit code from your app to confirm.</p>
        <input
          className="field-input"
          inputMode="numeric"
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={6}
        />
        {error ? <p className="field-error">{error}</p> : null}
        <div className="quick-grid">
          <button type="button" className="btn-primary" onClick={confirmEnable} disabled={busy || code.length < 6}>
            {busy ? 'Verifying…' : 'Enable 2FA'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => { setStep('idle'); setError(null); }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Disabled state (idle) ──
  return (
    <div className="panel-stack">
      <div className="row">
        <span className="status-chip">
          <ShieldAlert size={16} color="#F59E0B" /> Two-factor authentication is OFF
        </span>
      </div>
      <p className="helper">Add a second layer of security. You&apos;ll need an authenticator app.</p>
      <button type="button" className="btn-primary" onClick={beginSetup} disabled={busy}>
        {busy ? 'Loading…' : 'Set up 2FA'}
      </button>
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
