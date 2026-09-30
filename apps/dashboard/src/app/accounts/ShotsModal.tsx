'use client';

import { useEffect, useState } from 'react';
import { Camera, Loader2, X, ChevronLeft, ChevronRight } from 'lucide-react';

// ★2026-10-01 KAYIT EKRAN GÖRÜNTÜLERİ GALERİSİ.
// API'deki `/accounts/batch/accounts/:id/shots` ucu (kayıt işinin adım adım kareleri,
// Job.result.shots — son 12 kare, base64 PNG) 24 Eyl'den beri hazırdı ve panel proxy'si
// 26 Eyl'de eklendi, ama hiçbir bileşen onu ÇAĞIRMIYORDU: operatör başarısız bir kaydın
// hangi ekranda takıldığını görmek için sunucuya bağlanmak zorundaydı.
// Kareler yalnız modal açılınca çekilir (tablo yüklemesine yük bindirmez).

type Shot = { label: string; ts: string; png: string };
type ShotsResp = {
  accountId: string;
  status: string;
  error: string | null;
  jobStatus: string | null;
  resultStatus: string | null;
  note: string | null;
  shots: Shot[];
};

// Agent'taki snap('…') adım kodlarının Türkçe karşılıkları (bilinmeyen kod olduğu gibi gösterilir).
const STEP_TR: Record<string, string> = {
  launch: 'Uygulama açıldı',
  first_run: 'İlk açılış ekranı',
  register_screen: 'Kayıt ekranı',
  phone_filled: 'Numara yazıldı',
  number_filled: 'Numara yazıldı',
  submit: 'Gönderildi',
  switch_dialog: 'Hesap değiştir uyarısı',
  choose_verify: 'Doğrulama yöntemi seçimi',
  code_screen: 'Kod ekranı',
  otp_screen: 'SMS kodu ekranı',
  otp_wait: 'SMS kodu bekleniyor',
  otp_wait_poll: 'SMS kodu bekleniyor',
  otp_entered: 'SMS kodu girildi',
  password_screen: 'İki adımlı doğrulama',
  profile: 'Profil ekranı',
  chat_transfer: 'Sohbet aktarımı',
  downgrade_business: 'Business → normal WhatsApp',
  downgrade_confirm: 'Business geçiş onayı',
  downgrade_stuck: 'Business geçişte takıldı',
  number_wall: 'Numara engeli',
  rate_limited: 'Bekleme süresi (çok deneme)',
  rate_limited_at_otp: 'Kodda bekleme süresi',
  other_phone_rate_limit: 'Başka telefonda bekleme',
  flood_wait: 'Yoğunluk beklemesi',
  sms_send_failed: 'SMS gönderilemedi',
  sms_send_failed_terminal: 'SMS gönderilemedi (kalıcı)',
  adb_lost: 'Cihaz bağlantısı koptu'
};
const BAD_STEP = /wall|rate_limited|flood|failed|stuck|adb_lost/;

function hm(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts;
  }
}

export function ShotsModal({ accountId, title, onClose }: { accountId: string; title: string; onClose: () => void }) {
  const [data, setData] = useState<ShotsResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch(`/api/accounts/batch/accounts/${accountId}/shots`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.data?.message || 'Kareler alınamadı');
        if (alive) setData(j.data as ShotsResp);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Hata');
      }
    })();
    return () => { alive = false; };
  }, [accountId]);

  // Klavye: Esc kapatır, ←/→ büyük görünümde gezinir.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (open !== null) setOpen(null); else onClose(); }
      const n = data?.shots.length ?? 0;
      if (open !== null && n) {
        if (e.key === 'ArrowRight') setOpen((i) => (i === null ? i : (i + 1) % n));
        if (e.key === 'ArrowLeft') setOpen((i) => (i === null ? i : (i - 1 + n) % n));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, data, onClose]);

  const shots = data?.shots ?? [];
  const cur = open !== null ? shots[open] : undefined;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 880, width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Camera size={16} /> Kayıt kareleri — {title}
          </h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Kapat"><X size={16} /></button>
        </header>

        {err ? <p className="field-error">{err}</p> : null}
        {!data && !err ? (
          <p className="helper" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Loader2 size={14} className="spin" /> Kareler yükleniyor…</p>
        ) : null}

        {data ? (
          <>
            <p className="helper" style={{ marginBottom: 10 }}>
              Kayıt işi: <strong>{data.jobStatus ?? 'bulunamadı'}</strong>
              {data.resultStatus ? <> · sonuç <span className="mono">{data.resultStatus}</span></> : null}
              {data.note ? <> · {data.note}</> : null}
            </p>
            {shots.length === 0 ? (
              <div className="table-empty"><span>Bu hesabın kayıt işinde kaydedilmiş kare yok (eski kayıtlar ya da kare almadan biten işler).</span></div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
                {shots.map((s, i) => (
                  <button
                    key={`${s.ts}-${i}`}
                    type="button"
                    onClick={() => setOpen(i)}
                    title={`${STEP_TR[s.label] ?? s.label} · ${hm(s.ts)}`}
                    style={{
                      display: 'flex', flexDirection: 'column', gap: 6, padding: 6, cursor: 'zoom-in',
                      background: 'var(--panel-2)', borderRadius: 10, textAlign: 'left',
                      border: `1px solid ${BAD_STEP.test(s.label) ? 'var(--danger)' : 'var(--border)'}`
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`data:image/png;base64,${s.png}`} alt={STEP_TR[s.label] ?? s.label} loading="lazy"
                      style={{ width: '100%', aspectRatio: '9 / 19', objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                    <span style={{ fontSize: '0.72rem', lineHeight: 1.3 }}>
                      <span className="helper mono">{i + 1}.</span> {STEP_TR[s.label] ?? s.label}
                      <br /><span className="helper mono">{hm(s.ts)}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : null}

        {cur ? (
          <div className="modal-overlay" style={{ zIndex: 60 }} onClick={() => setOpen(null)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, maxHeight: '92vh' }} onClick={(e) => e.stopPropagation()}>
              <button type="button" className="btn-ghost" aria-label="Önceki" onClick={() => setOpen((i) => (i === null ? i : (i - 1 + shots.length) % shots.length))}><ChevronLeft size={18} /></button>
              <figure style={{ margin: 0, textAlign: 'center' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`data:image/png;base64,${cur.png}`} alt={STEP_TR[cur.label] ?? cur.label}
                  style={{ maxHeight: '84vh', maxWidth: '80vw', borderRadius: 10, display: 'block' }} />
                <figcaption className="helper" style={{ marginTop: 6 }}>
                  {(open ?? 0) + 1}/{shots.length} · {STEP_TR[cur.label] ?? cur.label} · {hm(cur.ts)}
                </figcaption>
              </figure>
              <button type="button" className="btn-ghost" aria-label="Sonraki" onClick={() => setOpen((i) => (i === null ? i : (i + 1) % shots.length))}><ChevronRight size={18} /></button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
