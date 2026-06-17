'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@heroui/react';
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
        <Button type="button" variant="danger" className="btn-ghost danger-btn" onPress={disable} isDisabled={Boolean(busy)}>
          {busy ? 'Working…' : 'Disable 2FA'}
        </Button>
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
        <Button type="button" variant="ghost" className="btn-ghost" onPress={copyBackup}>
          {copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy all</>}
        </Button>
        <Button type="button" variant="primary" className="btn-primary" onPress={() => setStep('idle')}>Done</Button>
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
        <Input
          className="field-input"
          inputMode="numeric"
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={6}
        />
        {error ? <p className="field-error">{error}</p> : null}
        <div className="quick-grid">
          <Button type="button" variant="primary" className="btn-primary" onPress={confirmEnable} isDisabled={Boolean(busy || code.length < 6)}>
            {busy ? 'Verifying…' : 'Enable 2FA'}
          </Button>
          <Button type="button" variant="ghost" className="btn-ghost" onPress={() => { setStep('idle'); setError(null); }}>
            Cancel
          </Button>
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
      <Button type="button" variant="primary" className="btn-primary" onPress={beginSetup} isDisabled={Boolean(busy)}>
        {busy ? 'Loading…' : 'Set up 2FA'}
      </Button>
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
