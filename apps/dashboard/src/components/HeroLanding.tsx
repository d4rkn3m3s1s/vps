'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Award, Crown, X } from 'lucide-react';

const VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260606_154941_df1a96e1-a06f-450c-bd02-d863414cc1a0.mp4';

// VPS Fleet-themed nav. "Inquire"/"Studio" etc. map to our actual surfaces.
const NAV_LINKS = [
  { label: 'Telefonlar', href: '/profiles' },
  { label: 'Platform', href: '/welcome' },
  { label: 'Fiyatlandırma', href: '/billing' },
  { label: 'İletişim', href: '/login' }
];

const STATS = [
  { value: '10B+', label: 'Çalıştırılan Bulut Telefon' },
  { value: '%99,9', label: 'Filo Çalışma Süresi' },
  { value: '7/24', label: 'Otomasyon Motoru' }
];

export function HeroLanding() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden bg-black font-inter">
      {/* Fullscreen looping background video */}
      <video
        className="absolute inset-0 h-full w-full object-cover"
        autoPlay
        muted
        loop
        playsInline
        src={VIDEO_URL}
      />
      {/* Dark gradient overlay so the overlaid content stays readable */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-black/20" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/40" />

      {/* ───────────────────────────── Navbar ───────────────────────────── */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-6 py-5 sm:px-10 lg:px-16 lg:py-7">
        <Link
          href="/welcome"
          className="font-podium text-2xl font-bold uppercase tracking-wider text-white sm:text-3xl"
        >
          VPS Fleet
        </Link>

        {/* Center nav (md+) */}
        <nav className="hidden items-center gap-10 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="font-inter text-sm uppercase tracking-widest text-white/80 transition-colors hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* CTA (md+) */}
        <Link
          href="/login"
          className="hidden items-center gap-2 border border-white/30 px-6 py-3 text-xs uppercase tracking-widest text-white transition-all hover:border-white/60 hover:bg-white/10 md:flex"
        >
          Başla
          <ArrowUpRight className="h-4 w-4" />
        </Link>

        {/* Hamburger (below md) */}
        <button
          type="button"
          aria-label="Menüyü aç"
          onClick={() => setMenuOpen(true)}
          className="flex flex-col space-y-1.5 md:hidden"
        >
          <span className="h-0.5 w-6 bg-white" />
          <span className="h-0.5 w-6 bg-white" />
          <span className="h-0.5 w-4 bg-white" />
        </button>
      </header>

      {/* ──────────────────────── Mobile menu overlay ─────────────────────── */}
      <div
        className={`fixed inset-0 z-50 bg-black/95 backdrop-blur-sm transition-all duration-500 md:hidden ${
          menuOpen ? 'visible opacity-100' : 'invisible opacity-0'
        }`}
      >
        <div className="flex items-center justify-between px-6 py-5 sm:px-10">
          <span className="font-podium text-2xl font-bold uppercase tracking-wider text-white sm:text-3xl">
            VPS Fleet
          </span>
          <button type="button" aria-label="Menüyü kapat" onClick={() => setMenuOpen(false)}>
            <X className="h-7 w-7 text-white" />
          </button>
        </div>

        <div className="flex h-[calc(100%-5rem)] flex-col items-center justify-center gap-6">
          {NAV_LINKS.map((link, i) => (
            <Link
              key={link.label}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="font-podium text-4xl uppercase text-white transition-all duration-500 sm:text-5xl"
              style={{
                transitionDelay: `${i * 80 + 100}ms`,
                opacity: menuOpen ? 1 : 0,
                transform: menuOpen ? 'translateY(0)' : 'translateY(20px)'
              }}
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/login"
            onClick={() => setMenuOpen(false)}
            className="mt-4 flex items-center gap-2 border border-white/30 px-8 py-4 text-sm uppercase tracking-widest text-white transition-all duration-500 hover:border-white/60 hover:bg-white/10"
            style={{
              transitionDelay: `${NAV_LINKS.length * 80 + 100}ms`,
              opacity: menuOpen ? 1 : 0,
              transform: menuOpen ? 'translateY(0)' : 'translateY(20px)'
            }}
          >
            Başla
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* ───────────────────────────── Hero content ───────────────────────── */}
      <div className="relative z-10 flex h-full flex-col justify-center px-6 sm:px-10 lg:px-16">
        <div className="max-w-3xl">
          {/* Tagline */}
          <div className="mb-6 flex items-center gap-2 animate-fade-up lg:mb-8">
            <Crown className="h-4 w-4 text-white/70" />
            <span className="font-inter text-xs uppercase tracking-[0.3em] text-white/70 sm:text-sm">
              Dünya Standartlarında Bulut Telefon Platformu
            </span>
          </div>

          {/* Main heading */}
          <h1 className="font-podium uppercase leading-[0.92] tracking-tight text-white animate-fade-up-delay-1">
            <span className="block text-[clamp(2.8rem,8vw,7rem)]">Kur.</span>
            <span className="block text-[clamp(2.8rem,8vw,7rem)]">Otomatikleştir.</span>
            <span className="block text-[clamp(2.8rem,8vw,7rem)]">Ölçeklendir.</span>
          </h1>

          {/* Subtext */}
          <p className="mt-6 max-w-md font-inter text-sm leading-relaxed text-white/70 animate-fade-up-delay-2 sm:text-base lg:mt-8">
            Gerçek Android bulut telefonları saniyeler içinde başlatın,
            <br />
            RPA akışlarını tüm filonuzda çalıştırın —{' '}
            <span className="font-bold text-white">her ölçekte.</span>
          </p>

          {/* CTA row */}
          <div className="mt-8 flex flex-wrap items-center gap-4 animate-fade-up-delay-3 sm:gap-6 lg:mt-10">
            <Link
              href="/login"
              className="group flex items-center gap-2 bg-black px-5 py-3 text-[11px] uppercase tracking-widest text-white transition-colors hover:bg-neutral-900 sm:px-7 sm:py-4 sm:text-xs"
            >
              Konsolu Başlat
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>

            <div className="hidden items-center gap-3 sm:flex">
              <Award className="h-8 w-8 text-white/50" />
              <div className="text-xs uppercase tracking-wider text-white/60">
                <div>Kurumsal Düzeyde</div>
                <div>Bulut Filosu</div>
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-8 flex flex-wrap gap-6 animate-fade-up-delay-4 sm:mt-10 sm:gap-12 lg:mt-14 lg:gap-16">
            {STATS.map((stat) => (
              <div key={stat.label}>
                <div className="font-inter text-2xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
                  {stat.value}
                </div>
                <div className="mt-1 text-[9px] uppercase tracking-widest text-white/50 sm:text-xs">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
