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
      if (!res.ok) throw new Error(json.message ?? 'Kurulum başarısız oldu');
      setSetup(json.data as SetupData);
      setStep('setup');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kurulum başarısız oldu');
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
      if (!res.ok) throw new Error(json.message ?? 'Geçersiz kod');
      setBackupCodes((json.data as { backupCodes: string[] }).backupCodes);
      setStep('backup');
      setCode('');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Geçersiz kod');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    const token = prompt('2FA özelliğini devre dışı bırakmak için geçerli bir 2FA kodu (veya yedek kod) girin:');
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
      if (!res.ok) throw new Error(json.message ?? 'Devre dışı bırakılamadı');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Devre dışı bırakılamadı');
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
            <ShieldCheck size={16} color="#22C55E" /> İki faktörlü kimlik doğrulama AÇIK
          </span>
        </div>
        <p className="helper">Hesabınız bir kimlik doğrulama uygulamasıyla korunuyor. Giriş için 6 haneli bir kod gerekir.</p>
        <button type="button" className="btn-ghost danger-btn" onClick={disable} disabled={busy}>
          {busy ? 'İşleniyor…' : '2FA\'yı devre dışı bırak'}
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
          <span className="status-chip"><ShieldCheck size={16} color="#22C55E" /> 2FA etkinleştirildi!</span>
        </div>
        <p className="helper">
          Bu tek kullanımlık yedek kodları güvenli bir yerde saklayın. Kimlik doğrulayıcınızı kaybederseniz her biri bir kez çalışır.
        </p>
        <div className="backup-grid">
          {backupCodes.map((c) => (
            <code key={c} className="backup-code">{c}</code>
          ))}
        </div>
        <button type="button" className="btn-ghost" onClick={copyBackup}>
          {copied ? <><Check size={15} /> Kopyalandı</> : <><Copy size={15} /> Tümünü kopyala</>}
        </button>
        <button type="button" className="btn-primary" onClick={() => setStep('idle')}>Tamam</button>
      </div>
    );
  }

  // ── Setup (scan QR + confirm) ──
  if (step === 'setup' && setup) {
    return (
      <div className="panel-stack">
        <p className="helper">1. Bu QR kodunu Google Authenticator, Authy veya 1Password ile tarayın.</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={setup.qrDataUrl} alt="2FA QR kodu" className="twofa-qr" />
        <p className="helper">Veya bu anahtarı elle girin:</p>
        <code className="backup-code">{setup.secret}</code>
        <p className="helper">2. Onaylamak için uygulamanızdaki 6 haneli kodu girin.</p>
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
            {busy ? 'Doğrulanıyor…' : '2FA\'yı etkinleştir'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => { setStep('idle'); setError(null); }}>
            İptal
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
          <ShieldAlert size={16} color="#F59E0B" /> İki faktörlü kimlik doğrulama KAPALI
        </span>
      </div>
      <p className="helper">İkinci bir güvenlik katmanı ekleyin. Bir kimlik doğrulama uygulamasına ihtiyacınız olacak.</p>
      <button type="button" className="btn-primary" onClick={beginSetup} disabled={busy}>
        {busy ? 'Yükleniyor…' : '2FA kur'}
      </button>
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
