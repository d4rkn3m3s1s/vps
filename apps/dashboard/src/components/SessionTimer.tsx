'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

// ★2026-07-27: Üst-barda oturum (auth) süresi göstergesi. Operatör isteği:
// "sistem auth süresi varya logout yapıyor, kaç dk kaldığını küçük bir yerde
// görelim yukarı". fleet_session cookie'si backend'in JWT'sidir; exp claim'i
// (saniye) oturumun ne zaman biteceğini söyler. İmza DOĞRULAMAYIZ (sadece exp
// okunur — client'ta güvenli, gerçek doğrulama backend'de). Kalan süre azaldıkça
// renk kızarır; <2dk kalınca uyarı tonu.

function readSessionExp(): number | null {
  // Cookie httpOnly OLABİLİR — o zaman client okuyamaz. Önce document.cookie dene.
  try {
    const m = document.cookie.match(/(?:^|;\s*)fleet_session=([^;]+)/);
    if (!m || !m[1]) return null;
    const parts = decodeURIComponent(m[1]).split('.');
    const body = parts[1];
    if (parts.length !== 3 || !body) return null;
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function SessionTimer() {
  const [expMs, setExpMs] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    setExpMs(readSessionExp());
    // exp'i periyodik yeniden-oku (token yenilenmiş olabilir) + saati güncelle.
    const tick = setInterval(() => {
      setNow(Date.now());
      setExpMs(readSessionExp());
    }, 30_000);
    return () => clearInterval(tick);
  }, []);

  // Cookie httpOnly ise (client okuyamaz) → göstergeyi hiç render etme.
  if (expMs === null) return null;

  const remainingMs = expMs - now;
  if (remainingMs <= 0) {
    return (
      <span className="session-timer session-timer--expired" title="Oturum süresi doldu — sayfayı yenileyin">
        <Clock size={13} />
        <span>Oturum bitti</span>
      </span>
    );
  }

  const totalMin = Math.floor(remainingMs / 60_000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  const label = hours > 0 ? `${hours}s ${mins}dk` : `${mins}dk`;
  const warn = remainingMs < 5 * 60_000;     // <5dk → uyarı
  const urgent = remainingMs < 2 * 60_000;   // <2dk → acil

  return (
    <span
      className={`session-timer${urgent ? ' session-timer--urgent' : warn ? ' session-timer--warn' : ''}`}
      title={`Oturum ${label} sonra sona erer (${new Date(expMs).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })})`}
    >
      <Clock size={13} />
      <span>{label}</span>
    </span>
  );
}
