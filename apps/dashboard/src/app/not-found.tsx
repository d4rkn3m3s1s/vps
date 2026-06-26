import Link from 'next/link';
import { Cloud, Heart, Home, Disc3, ChevronRight } from 'lucide-react';

/**
 * 404 — full-screen ORBIT-themed "lost in space" page. Adapted from the
 * reference 404 spec (lost text → title with floating decorations → subtext
 * with highlight tags → two nav cards) but rendered in our brand: dark
 * blue-ink canvas, indigo→blue gradient decorations, Space Grotesk. It covers
 * the dashboard chrome via `fixed inset-0`. Redirects point to real routes.
 */
export default function NotFound() {
  return (
    <div className="nf-stage">
      <div className="login-aurora" aria-hidden />
      <div className="login-grid" aria-hidden />

      {/* drifting orbit ring echo of the homepage hero — ties 404 to the brand */}
      <div className="nf-orbit" aria-hidden>
        <span className="nf-orbit-ring" />
        <span className="nf-orbit-ring nf-orbit-ring-2" />
        <span className="nf-orbit-core" />
      </div>

      <main className="nf-main">
        <p className="nf-lost">Yörüngeden çıkmış görünüyorsun…</p>

        <div className="nf-title-wrap">
          <Cloud className="nf-deco nf-deco-cloud" strokeWidth={1.6} aria-hidden />
          <Heart className="nf-deco nf-deco-heart" strokeWidth={1.6} aria-hidden />
          <h1 className="nf-title">
            <span className="nf-404">404</span>
            <span>Burada henüz bir şey yok</span>
          </h1>
        </div>

        <p className="nf-sub">
          Aradığın sayfa taşınmış, silinmiş ya da hiç var olmamış olabilir. Filo
          komuta merkezine geri dön ya da{' '}
          <span className="nf-tag">cihazlarına</span> göz at — birlikte net bir{' '}
          <span className="nf-tag">rota</span> çizelim.
        </p>

        <div className="nf-cards">
          <Link href="/" className="nf-card">
            <span className="nf-card-icon">
              <Home size={22} strokeWidth={2} />
            </span>
            <span className="nf-card-body">
              <strong>Ana Sayfa</strong>
              <small>Her şeyin başladığı yere dön</small>
            </span>
            <ChevronRight className="nf-card-arrow" size={21} aria-hidden />
          </Link>

          <Link href="/wall" className="nf-card">
            <span className="nf-card-icon">
              <Disc3 size={22} strokeWidth={2} />
            </span>
            <span className="nf-card-body">
              <strong>Canlı Duvar</strong>
              <small>Tüm cihazları tek ekranda izle</small>
            </span>
            <ChevronRight className="nf-card-arrow" size={21} aria-hidden />
          </Link>
        </div>
      </main>
    </div>
  );
}
