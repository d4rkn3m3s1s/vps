'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Bot,
  Code2,
  Zap,
  Star,
  User,
  Check,
  ShieldCheck
} from 'lucide-react';
import { MagicCard } from './MagicBento';
import { Reveal } from './Reveal';

/**
 * FleetLanding — "RED NOIR" marketing landing, structured 1:1 after the reference
 * (floating pill navbar → hero with live-dot badge + underlined accent word + shiny
 * CTA → logo strip → bento features → full-red testimonial banner → pricing → waitlist
 * CTA → footer with giant outline wordmark). Copy is adapted to our product (a
 * self-hosted cloud-phone fleet) in Turkish; the palette is blood-red on noir black.
 * Classes are defined in globals.css under the `rn-*` namespace (no Tailwind here).
 */

const INTEGRATIONS = ['Android', 'KVM', 'ADB', 'Vast.ai', 'Stripe'];

export function FleetLanding() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [waitEmail, setWaitEmail] = useState('');
  const router = useRouter();

  // The waitlist form forwards the entered email to the login screen (prefilled),
  // so the CTA actually does something instead of being a dead input.
  function joinWaitlist(e: React.FormEvent) {
    e.preventDefault();
    const q = waitEmail.trim() ? `?email=${encodeURIComponent(waitEmail.trim())}` : '';
    router.push(`/login${q}`);
  }

  return (
    <div className="rn-root selection-red">
      {/* ── Global background: crimson ember + parallax stars + grid ───────── */}
      <div className="rn-bg" aria-hidden>
        <div className="rn-bg-gradient" />
        <div className="rn-stars rn-stars-1" />
        <div className="rn-stars rn-stars-2" />
        <div className="rn-bg-orb" />
        <div className="rn-bg-grid" />
      </div>

      {/* top blur header strip */}
      <div className="rn-gradient-blur" aria-hidden />

      {/* ── Navbar (floating pill) ──────────────────────────────────────────── */}
      <header className="rn-header">
        <nav className="rn-nav">
          <Link href="/" className="rn-brand">
            <span className="rn-brand-mark" />
            <span className="rn-brand-name">VPS Fleet</span>
          </Link>

          <div className="rn-nav-links">
            <a href="#features" className="rn-nav-link">Özellikler</a>
            <a href="#how" className="rn-nav-link">Çözümler</a>
            <a href="#pricing" className="rn-nav-link">Fiyatlandırma</a>
            <Link href="/billing" className="rn-nav-link">Faturalama</Link>
          </div>

          <div className="rn-nav-right">
            <Link href="/login" className="rn-nav-login">Giriş Yap</Link>
            <Link href="/login" className="rn-get-access">
              <span className="rn-get-access-border" />
              <span className="rn-get-access-spin" />
              <span className="rn-get-access-inner" />
              <span className="rn-get-access-text">
                Erişim Al <ArrowRight size={12} />
              </span>
            </Link>
          </div>

          <button
            type="button"
            className="rn-burger"
            aria-label="Menü"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span>{menuOpen ? '✕' : '☰'}</span>
          </button>
        </nav>

        {menuOpen && (
          <div className="rn-mobile">
            <a href="#features" onClick={() => setMenuOpen(false)}>Özellikler</a>
            <a href="#how" onClick={() => setMenuOpen(false)}>Çözümler</a>
            <a href="#pricing" onClick={() => setMenuOpen(false)}>Fiyatlandırma</a>
            <Link href="/login" onClick={() => setMenuOpen(false)}>Giriş Yap</Link>
          </div>
        )}
      </header>

      <main className="rn-main">
        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        <section className="rn-hero">
          <div className="rn-hero-inner">
            <div className="rn-badge rn-fade" style={{ animationDelay: '0.1s' }}>
              <span className="rn-badge-pulse">
                <span className="rn-badge-ping" />
                <span className="rn-badge-dot" />
              </span>
              <span className="rn-badge-text">VPS Fleet 2.0 yayında</span>
              <ArrowRight size={12} className="rn-badge-arrow" />
            </div>

            <h1 className="rn-hero-title rn-fade" style={{ animationDelay: '0.2s' }}>
              <span className="rn-hero-line">Bulut telefon filosu</span>
              <span className="rn-hero-line">
                tek{' '}
                <span className="rn-hero-accent">
                  komuta merkezinden
                  <svg className="rn-hero-underline" viewBox="0 0 100 10" preserveAspectRatio="none">
                    <path d="M0 5 Q 50 10 100 5" stroke="currentColor" strokeWidth="2" fill="none" />
                  </svg>
                </span>
              </span>
            </h1>

            <p className="rn-hero-sub rn-fade" style={{ animationDelay: '0.3s' }}>
              Multilogin Cloud Phone, VMOS ve DuoPlus’a kendi sunucunda çalışan açık
              alternatif. Gerçek Android cihazlar, RPA otomasyonu, hesap çiftliği ve
              canlı kontrol — hepsi tek panelde, 10× hızlı.
            </p>

            <div className="rn-hero-cta rn-fade" style={{ animationDelay: '0.4s' }}>
              <Link href="/login" className="shiny-cta">
                <span className="shiny-cta-text">
                  Hemen Başla <ArrowRight size={18} />
                </span>
              </Link>
              <a href="#features" className="rn-ghost-btn">
                <Code2 size={18} />
                Özellikleri Gör
              </a>
            </div>
          </div>

          {/* Logo / integration strip */}
          <div className="rn-logos">
            <div className="rn-logos-inner">
              <p className="rn-logos-label">Entegre olduğu sistemler:</p>
              <div className="rn-logos-list">
                {INTEGRATIONS.map((name) => (
                  <div key={name} className="rn-logo-item">
                    <span className="rn-logo-dot" />
                    {name}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Bento features ────────────────────────────────────────────────── */}
        <section id="features" className="rn-section">
          <Reveal className="rn-section-head">
            <h2 className="rn-h2">
              Modern operatör ekipleri için
              <br />
              <span className="rn-accent">işletim sistemi</span>
            </h2>
            <p className="rn-section-sub">
              Dağınık araç setini, AI ile çalışan tek bütünleşik platformla değiştir.
            </p>
          </Reveal>

          <div className="rn-bento">
            {/* Main feature card (2×2) */}
            <Link href="/profiles" className="rn-card rn-card-main">
              <div className="rn-card-body">
                <span className="rn-card-icon rn-icon-red">
                  <Bot size={24} />
                </span>
                <h3 className="rn-card-title-lg">Gerçek Android bulut telefonlar</h3>
                <p className="rn-card-text-lg">
                  KVM hostlarında çalışan gerçek cihazlar. Saniyeler içinde aç,
                  fingerprint’le, canlı kontrol et. Her cihaz benzersiz IMEI / model /
                  parmak izi taşır — sektör standartlarına uygun anti-detection.
                </p>
                <div className="rn-card-go">
                  <span>ÖZELLİĞİ KEŞFET</span>
                  <ArrowRight size={16} />
                </div>
              </div>
              <div className="rn-card-glow rn-glow-red" />
            </Link>

            {/* Feature 2 (wide) */}
            <Link href="/rpa" className="rn-card rn-card-wide">
              <div className="rn-card-body">
                <span className="rn-card-icon rn-icon-blue">
                  <Code2 size={24} />
                </span>
                <h3 className="rn-card-title">Görsel RPA otomasyonu</h3>
                <p className="rn-card-text">
                  tap · type · swipe · openApp — sürükle-bırak akışlar, tüm filoda
                  eşzamanlı çalışır.
                </p>
              </div>
              <div className="rn-card-glow rn-glow-blue" />
            </Link>

            {/* Feature 3 — wrapped in MagicCard for particle + tilt + spotlight */}
            <MagicCard className="rn-card" particleCount={8}>
              <Link href="/farm" className="rn-card-body" style={{ textDecoration: 'none', color: 'inherit' }}>
                <span className="rn-card-icon rn-icon-yellow">
                  <Zap size={24} />
                </span>
                <h3 className="rn-card-title-sm">Hesap çiftliği</h3>
                <p className="rn-card-text-sm">
                  Kampanyalar, sağlık skoru, ban-risk uyarıları, şifreli kasa + TOTP.
                </p>
              </Link>
            </MagicCard>

            {/* Feature 4 */}
            <MagicCard className="rn-card" particleCount={8}>
              <Link href="/fingerprints" className="rn-card-body" style={{ textDecoration: 'none', color: 'inherit' }}>
                <span className="rn-card-icon rn-icon-violet">
                  <ShieldCheck size={24} />
                </span>
                <h3 className="rn-card-title-sm">Anti-detection</h3>
                <p className="rn-card-text-sm">
                  IMEI / model / OS rastgeleleştirme, cihaz başına benzersiz parmak izi.
                </p>
              </Link>
            </MagicCard>
          </div>
        </section>

        {/* ── Testimonial banner (full red) ─────────────────────────────────── */}
        <div className="rn-testimonial">
          <div className="rn-testimonial-inner">
            <div className="rn-stars-row">
              {[0, 1, 2, 3, 4].map((i) => (
                <Star key={i} size={24} fill="currentColor" />
              ))}
            </div>
            <h3 className="rn-testimonial-quote">
              “VPS Fleet, cihaz operasyonumuzu tamamen değiştirdi. Eskiden günler süren
              filo yönetimi artık dakikalar alıyor.”
            </h3>
            <div className="rn-testimonial-author">
              <div className="rn-testimonial-avatar">
                <User size={24} />
              </div>
              <div className="rn-testimonial-meta">
                <div className="rn-testimonial-name">Mert Aydın</div>
                <div className="rn-testimonial-role">Operasyon Direktörü · FleetOps</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Pricing ───────────────────────────────────────────────────────── */}
        <section id="pricing" className="rn-section rn-pricing-section">
          <Reveal className="rn-section-head">
            <h2 className="rn-h2">Basit, şeffaf fiyatlandırma</h2>
            <p className="rn-section-sub">Ücretsiz başla, büyüdükçe ölçekle.</p>
          </Reveal>

          <Reveal className="rn-pricing" delay={80}>
            {/* Starter */}
            <div className="rn-plan">
              <h3 className="rn-plan-name">Başlangıç</h3>
              <p className="rn-plan-desc">Bulut telefon operasyonunu keşfeden bireyler için.</p>
              <div className="rn-plan-price">
                <span className="rn-plan-cur">₺</span>
                <span className="rn-plan-amt">0</span>
                <span className="rn-plan-per">/ay</span>
              </div>
              <ul className="rn-plan-feats">
                <li><Check size={16} /> 1 cihaz</li>
                <li><Check size={16} /> Temel RPA akışları</li>
                <li><Check size={16} /> Topluluk desteği</li>
              </ul>
              <Link href="/login" className="rn-plan-btn">Başla</Link>
            </div>

            {/* Pro (recommended) */}
            <div className="rn-plan rn-plan-pro">
              <div className="rn-plan-badge">Önerilen</div>
              <h3 className="rn-plan-name">Pro</h3>
              <p className="rn-plan-desc">Profesyonel operatörler ve büyüyen ekipler için.</p>
              <div className="rn-plan-price">
                <span className="rn-plan-cur">₺</span>
                <span className="rn-plan-amt">1490</span>
                <span className="rn-plan-per">/ay</span>
              </div>
              <ul className="rn-plan-feats">
                <li><Check size={16} /> Sınırsız cihaz</li>
                <li><Check size={16} /> Gelişmiş AI flow builder</li>
                <li><Check size={16} /> Hesap çiftliği + warmup</li>
                <li><Check size={16} /> Öncelikli destek</li>
              </ul>
              <Link href="/login" className="rn-plan-btn rn-plan-btn-pro">Pro’ya Geç</Link>
            </div>

            {/* Team */}
            <div className="rn-plan">
              <h3 className="rn-plan-name">Takım</h3>
              <p className="rn-plan-desc">Ölçeklenen operasyon ekipleri ve ajanslar için.</p>
              <div className="rn-plan-price">
                <span className="rn-plan-cur">₺</span>
                <span className="rn-plan-amt">5990</span>
                <span className="rn-plan-per">/ay</span>
              </div>
              <ul className="rn-plan-feats">
                <li><Check size={16} /> Ekip işbirliği + RBAC</li>
                <li><Check size={16} /> Özel fingerprint katalogları</li>
                <li><Check size={16} /> API erişimi & SSO</li>
              </ul>
              <Link href="/login" className="rn-plan-btn">Satışla Görüş</Link>
            </div>
          </Reveal>
        </section>

        {/* ── Waitlist / final CTA ──────────────────────────────────────────── */}
        <section id="how" className="rn-waitlist">
          <Reveal className="rn-waitlist-inner">
            <h2 className="rn-waitlist-title">
              Kurmaya <span className="rn-accent">hazır mısın?</span>
            </h2>
            <p className="rn-waitlist-sub">
              Bugün konsola gir ve yeni nesil cihaz operasyonunu hemen kullanmaya başla.
            </p>
            <form className="rn-waitlist-form" onSubmit={joinWaitlist}>
              <input
                type="email"
                placeholder="E-posta adresin"
                className="rn-waitlist-input"
                value={waitEmail}
                onChange={(e) => setWaitEmail(e.target.value)}
              />
              <button type="submit" className="rn-waitlist-btn">Hemen Katıl</button>
            </form>
          </Reveal>
        </section>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="rn-footer">
        <div className="rn-footer-grid">
          <div className="rn-footer-brand">
            <div className="rn-brand">
              <span className="rn-brand-mark" />
              <span className="rn-brand-name rn-brand-name-lg">VPS Fleet</span>
            </div>
            <p className="rn-footer-tag">
              Kendi sunucunda çalışan açık bulut-telefon operatör platformu. Gerçek
              cihazlar, gerçek kontrol, tam sahiplik.
            </p>
          </div>

          <div className="rn-footer-col">
            <h4 className="rn-footer-h">Platform</h4>
            <ul>
              <li><a href="#features">Özellikler</a></li>
              <li><Link href="/wall">Canlı Duvar</Link></li>
              <li><a href="#pricing">Fiyatlandırma</a></li>
              <li><Link href="/rpa">RPA Stüdyo</Link></li>
            </ul>
          </div>

          <div className="rn-footer-col">
            <h4 className="rn-footer-h">Şirket</h4>
            <ul>
              <li><Link href="/analytics">Analitik</Link></li>
              <li><Link href="/audit">Denetim</Link></li>
              <li><Link href="/health">Filo Sağlığı</Link></li>
              <li><Link href="/billing">Faturalama</Link></li>
            </ul>
          </div>
        </div>

        <div className="rn-footer-mega" aria-hidden>
          <h1 className="rn-footer-wordmark">VPS&nbsp;FLEET</h1>
        </div>

        <div className="rn-footer-bar">
          <p>© 2026 VPS Fleet · Kendi altyapında, tam kontrol sende.</p>
          <div className="rn-footer-social">
            <Link href="/console">Konsol</Link>
            <Link href="/jobs">İşler</Link>
            <Link href="/logs">Kayıtlar</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
