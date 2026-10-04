'use client';

import { useCallback, useEffect, useState } from 'react';
import { Smartphone, RefreshCcw, AlertTriangle, PackagePlus, Loader2 } from 'lucide-react';
import { HoloPanel } from '../../components/hud';

// ★2026-10-04 MOBİL PROXY KOTASI kartı.
// 4 Eki'de mobil trafik bittiği için 154 cihaz 2 saat internetsiz kaldı ve kimse önceden
// bilmedi. Thordata kalan mobil kotayı API'den vermediği için API "paket − alımdan beri
// kullanım" hesaplar (proxies/mobile-quota.ts). Bu kart onu, kaç gün yeteceğini, son 7 günü
// ve Thordata'da kullanıcı adının değişip değişmediğini gösterir.

type Quota = {
  ok: boolean;
  error?: string;
  configuredUser: string | null;
  thordataUsers: Array<{ username: string; active: boolean }>;
  userMismatch: boolean;
  activeUser: string | null;
  packageGb: number | null;
  usedGb: number | null;
  remainingGb: number | null;
  avgDailyGb: number | null;
  daysLeft: number | null;
  todayGb: number | null;
  lastDays: Array<{ date: string; gb: number }>;
  packageSetAt: string | null;
  checkedAt: string;
};

function tone(q: Quota): 'ok' | 'warn' | 'bad' {
  if (q.remainingGb === null) return 'warn';
  if (q.remainingGb < 15 || (q.daysLeft !== null && q.daysLeft < 3)) return 'bad';
  if (q.remainingGb < 30 || (q.daysLeft !== null && q.daysLeft < 7)) return 'warn';
  return 'ok';
}
const COLOR = { ok: 'var(--success, #34d399)', warn: 'var(--warning, #fbbf24)', bad: 'var(--danger)' } as const;

export function MobileQuotaPanel() {
  const [q, setQ] = useState<Quota | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [gb, setGb] = useState('100');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/proxies/mobile-quota${refresh ? '?refresh=1' : ''}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Kota okunamadı');
      setQ(j.data as Quota);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Kota okunamadı');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function savePackage() {
    const n = Number(gb.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) { setMsg('Geçerli bir GB miktarı girin'); return; }
    setSaving(true); setMsg(null);
    try {
      const r = await fetch('/api/proxies/mobile-quota', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packageGb: n }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Kaydedilemedi');
      setQ(j.data as Quota);
      setMsg(`Kaydedildi: ${n} GB paket, sayaç sıfırlandı.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  }

  const t = q ? tone(q) : 'warn';
  const pct = q && q.packageGb && q.remainingGb !== null ? Math.max(0, Math.min(100, Math.round((q.remainingGb * 100) / q.packageGb))) : null;
  const days = q?.lastDays.slice(-7) ?? [];
  const max = Math.max(0.01, ...days.map((d) => d.gb));

  return (
    <HoloPanel
      title="Mobil proxy kotası"
      icon={<Smartphone size={16} />}
      actions={
        <button type="button" className="btn-ghost btn-xs" onClick={() => void load(true)} disabled={loading} title="Thordata'dan yeniden oku">
          {loading ? <Loader2 size={13} className="spin" /> : <RefreshCcw size={13} />} Yenile
        </button>
      }
    >
      {err ? <p className="field-error">{err}</p> : null}
      {!q && !err ? <p className="helper"><Loader2 size={13} className="spin" /> Thordata'dan okunuyor…</p> : null}

      {q ? (
        <div style={{ display: 'grid', gap: 14 }}>
          {q.userMismatch ? (
            <div className="field-error" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <AlertTriangle size={16} />
              <span>
                <b>Mobil kullanıcı değişmiş.</b> Sistem <code>{q.configuredUser}</code> kullanıyor, Thordata&apos;da{' '}
                <code>{q.thordataUsers.map((u) => u.username).join(', ') || '—'}</code> var. Paket yenilemede kullanıcı adı/şifre
                değişmiş olabilir — cihazlar internete çıkamaz.
              </span>
            </div>
          ) : null}

          {!q.ok ? <p className="helper">Kota okunamadı{q.error ? `: ${q.error}` : ''}.</p> : null}

          {q.ok && q.remainingGb !== null && q.packageGb !== null ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '2rem', fontWeight: 650, color: COLOR[t], fontVariantNumeric: 'tabular-nums' }}>
                  {q.remainingGb.toFixed(1)} GB
                </span>
                <span className="helper">kaldı / {q.packageGb} GB paket</span>
                {q.daysLeft !== null ? (
                  <span className="helper" style={{ color: COLOR[t] }}>· ~<b>{q.daysLeft.toFixed(1)} gün</b> yeter</span>
                ) : null}
              </div>
              <div style={{ height: 8, borderRadius: 99, background: 'var(--panel-2)', overflow: 'hidden', marginTop: 8 }}>
                <div style={{ width: `${pct ?? 0}%`, height: '100%', background: COLOR[t], transition: 'width .6s ease' }} />
              </div>
              <p className="helper" style={{ marginTop: 6 }}>
                Kullanılan {q.usedGb?.toFixed(1) ?? '?'} GB · günde ~{q.avgDailyGb?.toFixed(1) ?? '?'} GB · bugün {q.todayGb?.toFixed(1) ?? '?'} GB
                {q.activeUser ? <> · kullanıcı <code>{q.activeUser}</code></> : null}
                {q.packageSetAt ? <> · paket {new Date(q.packageSetAt).toLocaleDateString('tr-TR')}</> : null}
              </p>
            </div>
          ) : null}

          {q.ok && q.remainingGb === null ? (
            <p className="helper">Paket tanımlı değil — aşağıdan yeni aldığınız paketin GB miktarını girin (günde ~{q.avgDailyGb?.toFixed(1) ?? '?'} GB harcanıyor).</p>
          ) : null}

          {days.length ? (
            <div>
              <p className="helper" style={{ marginBottom: 6 }}>Son 7 gün (mobil)</p>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 70 }}>
                {days.map((d) => (
                  <div key={d.date} title={`${d.date}: ${d.gb.toFixed(2)} GB`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: '100%', height: `${Math.max(3, (d.gb / max) * 52)}px`, borderRadius: '4px 4px 0 0', background: 'var(--accent)', opacity: 0.75 }} />
                    <span className="helper mono" style={{ fontSize: '0.65rem' }}>{d.date.slice(8)}/{d.date.slice(5, 7)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <label className="field" style={{ margin: 0 }}>
              <span>Yeni paket aldınız mı? (GB)</span>
              <input className="field-input" style={{ width: 120 }} inputMode="decimal" value={gb} onChange={(e) => setGb(e.target.value)} />
            </label>
            <button type="button" className="btn-primary" onClick={savePackage} disabled={saving}>
              {saving ? <Loader2 size={14} className="spin" /> : <PackagePlus size={14} />} Paketi kaydet
            </button>
            <span className="helper" style={{ flexBasis: '100%' }}>
              Sayaç şu andan itibaren bu miktardan düşer. Kota 15 GB&apos;ın ya da 3 günün altına inince Telegram&apos;a uyarı gelir. (Telegram: <code>/mobilpaket 100</code>)
            </span>
            {msg ? <span className="helper" style={{ flexBasis: '100%' }}>{msg}</span> : null}
          </div>
        </div>
      ) : null}
    </HoloPanel>
  );
}
