'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowUpRight, Crown } from 'lucide-react';

const VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260606_154941_df1a96e1-a06f-450c-bd02-d863414cc1a0.mp4';

export function LoginView() {
  const router = useRouter();
  const [email, setEmail] = useState('');
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

      // Password ok but a 2FA code is required — reveal the code field.
      if (res.ok && (json as { twoFactorRequired?: boolean }).twoFactorRequired) {
        setNeedTwoFactor(true);
        setError(null);
        setBusy(false);
        return;
      }
      if (!res.ok) {
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
    <div className="fixed inset-0 z-[100] overflow-hidden bg-black font-inter">
      {/* Fullscreen looping background video */}
      <video
        className="absolute inset-0 h-full w-full object-cover"
        autoPlay
        muted
        loop
        playsInline
        src={VIDEO_URL}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/60 to-black/30" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" />

      {/* Top brand bar */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-6 py-5 sm:px-10 lg:px-16 lg:py-7">
        <Link
          href="/welcome"
          className="font-podium text-2xl font-bold uppercase tracking-wider text-white sm:text-3xl"
        >
          VPS Fleet
        </Link>
        <Link
          href="/welcome"
          className="hidden items-center gap-2 border border-white/30 px-6 py-3 text-xs uppercase tracking-widest text-white transition-all hover:border-white/60 hover:bg-white/10 sm:flex"
        >
          Back to Home
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </header>

      {/* Two-column hero: copy on the left, login card on the right */}
      <div className="relative z-10 flex h-full flex-col items-center justify-center gap-10 px-6 sm:px-10 lg:flex-row lg:items-center lg:justify-between lg:px-16">
        {/* Left copy (lg+) */}
        <div className="hidden max-w-lg lg:block">
          <div className="mb-6 flex items-center gap-2 animate-fade-up">
            <Crown className="h-4 w-4 text-white/70" />
            <span className="font-inter text-xs uppercase tracking-[0.3em] text-white/70 sm:text-sm">
              World-Class Cloud Phone Platform
            </span>
          </div>
          <h1 className="font-podium uppercase leading-[0.92] tracking-tight text-white animate-fade-up-delay-1">
            <span className="block text-[clamp(2.8rem,6vw,5.5rem)]">Welcome</span>
            <span className="block text-[clamp(2.8rem,6vw,5.5rem)]">Back.</span>
          </h1>
          <p className="mt-6 max-w-md font-inter text-sm leading-relaxed text-white/70 animate-fade-up-delay-2 sm:text-base">
            Sign in to command your Android cloud fleet —{' '}
            <span className="font-bold text-white">deploy, automate, scale.</span>
          </p>
        </div>

        {/* Login card */}
        <form
          onSubmit={submit}
          className="w-full max-w-md rounded-2xl border border-white/15 bg-black/40 p-8 backdrop-blur-xl animate-fade-up-delay-1 sm:p-10"
        >
          <h2 className="font-podium text-3xl font-bold uppercase tracking-wide text-white">Sign in</h2>
          <p className="mt-2 font-inter text-sm text-white/60">Manage your Android cloud phone fleet.</p>

          <label className="mt-7 block">
            <span className="font-inter text-xs uppercase tracking-widest text-white/60">Email</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="mt-2 w-full rounded-lg border border-white/20 bg-white/5 px-4 py-3 font-inter text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-white/50"
            />
          </label>

          <label className="mt-4 block">
            <span className="font-inter text-xs uppercase tracking-widest text-white/60">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={needTwoFactor}
              className="mt-2 w-full rounded-lg border border-white/20 bg-white/5 px-4 py-3 font-inter text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-white/50 disabled:opacity-60"
            />
          </label>

          {needTwoFactor ? (
            <label className="mt-4 block">
              <span className="font-inter text-xs uppercase tracking-widest text-white/60">
                Authentication code
              </span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={twoFactorToken}
                onChange={(e) => setTwoFactorToken(e.target.value)}
                placeholder="6-digit code or backup code"
                autoFocus
                className="mt-2 w-full rounded-lg border border-white/20 bg-white/5 px-4 py-3 font-inter text-sm tracking-widest text-white placeholder-white/30 outline-none transition-colors focus:border-white/50"
              />
              <span className="mt-2 block font-inter text-xs text-white/40">
                Enter the code from your authenticator app.
              </span>
            </label>
          ) : null}

          {error ? <p className="mt-4 font-inter text-sm text-red-400">{error}</p> : null}

          <button
            type="submit"
            disabled={busy || (needTwoFactor && twoFactorToken.trim().length < 6)}
            className="group mt-7 flex w-full items-center justify-center gap-2 rounded-lg bg-white px-6 py-3.5 font-inter text-xs font-semibold uppercase tracking-widest text-black transition-all hover:bg-white/90 disabled:opacity-60"
          >
            {busy ? 'Signing in…' : needTwoFactor ? 'Verify & sign in' : 'Sign in'}
            {!busy && (
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
