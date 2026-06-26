'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, ShieldCheck, Zap, Radio } from 'lucide-react';

export function LoginView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Prefill the email when arriving from the landing waitlist (?email=...).
  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [twoFactorToken, setTwoFactorToken] = useState('');
  const [needTwoFactor, setNeedTwoFactor] = useState(false);
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
        body: JSON.stringify({
          email,
          password,
          ...(needTwoFactor && twoFactorToken ? { twoFactorToken: twoFactorToken.trim() } : {})
        })
      });
      const json = await res.json().catch(() => ({}));

      if (res.ok && (json as { twoFactorRequired?: boolean }).twoFactorRequired) {
        setNeedTwoFactor(true);
        setError(null);
        setBusy(false);
        return;
      }
      if (!res.ok) {
        throw new Error((json as { error?: string }).error ?? 'Giriş başarısız.');
      }
      router.replace('/profiles');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Giriş başarısız.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lg-root selection-red">
      {/* Ambient background — crimson ember + parallax stars + grid (shared rn-* bg) */}
      <div className="rn-bg" aria-hidden>
        <div className="rn-bg-gradient" />
        <div className="rn-stars rn-stars-1" />
        <div className="rn-stars rn-stars-2" />
        <div className="rn-bg-orb" />
        <div className="rn-bg-grid" />
      </div>

      {/* Top brand bar */}
      <header className="lg-topbar">
        <Link href="/welcome" className="rn-brand">
          <span className="rn-brand-mark" />
          <span className="rn-brand-name">VPS Fleet</span>
        </Link>
        <Link href="/welcome" className="lg-back">
          Ana Sayfa
          <ArrowUpRight size={15} />
        </Link>
      </header>

      <div className="lg-split">
        {/* Left: marketing copy + feature pills */}
        <div className="lg-copy">
          <div className="lg-eyebrow rn-fade" style={{ animationDelay: '0.05s' }}>
            <span className="rn-badge-pulse">
              <span className="rn-badge-ping" />
              <span className="rn-badge-dot" />
            </span>
            DÜNYA STANDARDINDA BULUT TELEFON PLATFORMU
          </div>
          <h1 className="lg-title rn-fade" style={{ animationDelay: '0.15s' }}>
            <span className="rn-hero-line">Tekrar</span>
            <span className="rn-hero-line">
              hoş <span className="rn-hero-accent">geldin.</span>
            </span>
          </h1>
          <p className="lg-lead rn-fade" style={{ animationDelay: '0.25s' }}>
            Android bulut filonu komuta etmek için giriş yap —{' '}
            <strong>başlat, otomatikleştir, ölçekle.</strong>
          </p>

          <div className="lg-pills rn-fade" style={{ animationDelay: '0.35s' }}>
            <span className="lg-pill"><Zap size={14} /> RPA otomasyonu</span>
            <span className="lg-pill"><ShieldCheck size={14} /> Anti-detection</span>
            <span className="lg-pill"><Radio size={14} /> Canlı kontrol</span>
          </div>
        </div>

        {/* Right: login card */}
        <form onSubmit={submit} className="lg-card rn-fade" style={{ animationDelay: '0.2s' }}>
          <span className="lg-card-glow" aria-hidden />
          <h2 className="lg-card-title">Giriş Yap</h2>
          <p className="lg-card-sub">Bulut telefon filonu tek panelden yönet.</p>

          <label className="lg-field">
            <span className="lg-label">E-posta</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="sen@sirket.com"
              className="lg-input"
            />
          </label>

          <label className="lg-field">
            <span className="lg-label">Şifre</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={needTwoFactor}
              className="lg-input"
            />
          </label>

          {needTwoFactor ? (
            <label className="lg-field">
              <span className="lg-label">Doğrulama Kodu</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={twoFactorToken}
                onChange={(e) => setTwoFactorToken(e.target.value)}
                placeholder="6 haneli kod veya yedek kod"
                autoFocus
                className="lg-input lg-input-code"
              />
              <span className="lg-hint">Authenticator uygulamandaki kodu gir.</span>
            </label>
          ) : null}

          {error ? <p className="lg-error">{error}</p> : null}

          <button
            type="submit"
            disabled={busy || (needTwoFactor && twoFactorToken.trim().length < 6)}
            className="lg-submit"
          >
            <span className="lg-submit-text">
              {busy ? 'Giriş yapılıyor…' : needTwoFactor ? 'Doğrula ve Gir' : 'Giriş Yap'}
              {!busy && <ArrowRight size={16} />}
            </span>
          </button>

          <p className="lg-foot">
            Hesabın yok mu? <Link href="/welcome">Platformu keşfet</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
