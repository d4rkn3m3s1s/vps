'use client';

import { useEffect, useState, useCallback } from 'react';
import { Download, FileJson, FileText, BarChart3, Activity, Cpu, BellRing, Gauge, Layers } from 'lucide-react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, Holo3D, Reveal } from '../../components/hud';
import { downloadCsv } from '../../lib/csv';

type Summary = {
  range: { from: string; to: string };
  devices: { total: number; online: number };
  jobs: { total: number; completed: number; failed: number; pending: number; inRange: number; successRate: number };
  proxies: number;
  members: number;
  alertEvents: number;
  jobsByType: { type: string; count: number }[];
};

const RANGES = [
  { key: '7', label: 'Son 7 gün', days: 7 },
  { key: '30', label: 'Son 30 gün', days: 30 },
  { key: '90', label: 'Son 90 gün', days: 90 }
];

export function ReportsView() {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  // ★2026-08-12: dışa aktarma hatası ARTIK GÖRÜNÜR. Önceden sunucu hatası sessizce
  // BOŞ/BOZUK DOSYAYA dönüşüyordu (aşağıdaki notlara bakın) — operatör indirdiği
  // dosyaya bakıp "bu dönemde veri yok" sanıyordu. Rapor ekranında bu, yanlış karar demek.
  const [exportError, setExportError] = useState<string | null>(null);

  const rangeQs = useCallback(() => {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    return `from=${from.toISOString()}&to=${to.toISOString()}`;
  }, [days]);

  useEffect(() => {
    fetch(`/api/reports?${rangeQs()}`)
      .then((r) => r.json())
      .then((j) => setSummary(j.data ?? null))
      .catch(() => {});
  }, [rangeQs]);

  async function exportCsv() {
    setBusy(true);
    setExportError(null);
    try {
      const res = await fetch(`/api/reports/jobs?${rangeQs()}`);
      // ★2026-08-12: `res.ok` kontrolü YOKTU ve catch bile yoktu (sadece finally).
      // Sunucu 500 dönse `res.json()` hata gövdesini ayrıştırıyor, `Array.isArray(...)`
      // false çıkıyor ve BOŞ CSV iniyordu ("fleet-report-7d-0.csv") — indirme başarılı
      // göründüğü için operatör "bu dönemde görev yok" sanıyordu.
      if (!res.ok) throw new Error(`reports ${res.status}`);
      const json = await res.json();
      const rows = Array.isArray(json.data) ? json.data : [];
      downloadCsv(
        `fleet-report-${days}d-${rows.length}.csv`,
        [
          { key: 'id', label: 'Görev ID' },
          { key: 'type', label: 'Tür' },
          { key: 'status', label: 'Durum' },
          { key: 'deviceId', label: 'Cihaz' },
          { key: 'createdAt', label: 'Oluşturulma' },
          { key: 'finishedAt', label: 'Tamamlanma' },
          { key: 'error', label: 'Hata' }
        ],
        rows
      );
    } catch {
      setExportError('CSV dışa aktarılamadı — sunucuya ulaşılamadı. Dosya indirilmedi.');
    } finally {
      setBusy(false);
    }
  }

  async function exportJson() {
    setExportError(null);
    const res = await fetch(`/api/reports?${rangeQs()}`);
    // ★2026-08-12: burada hata DAHA da sinsiydi — `json.data` undefined olunca
    // `JSON.stringify(undefined)` üretiyor ve içinde tek kelime "undefined" yazan
    // bir .json dosyası indiriliyordu. Hatalı dosya indirmektense hiç indirmemek doğru.
    if (!res.ok) { setExportError('JSON dışa aktarılamadı — sunucuya ulaşılamadı. Dosya indirilmedi.'); return; }
    const json = await res.json();
    if (json?.data == null) { setExportError('JSON dışa aktarılamadı — sunucu veri döndürmedi.'); return; }
    const blob = new Blob([JSON.stringify(json.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fleet-report-${days}d.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // PDF export via the browser's native print-to-PDF (no dependency, no server).
  // Opens a clean, print-styled report window and triggers the print dialog where
  // the operator picks "Save as PDF".
  async function exportPdf() {
    setBusy(true);
    try {
      const res = await fetch(`/api/reports?${rangeQs()}`);
      const json = await res.json();
      const d = json.data as Summary | null;
      if (!d) return;
      const esc = (v: unknown) => String(v ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
      const now = new Date().toLocaleString('tr-TR');
      const rows = (d.jobsByType ?? []).map((j) => `<tr><td>${esc(j.type)}</td><td style="text-align:right">${esc(j.count)}</td></tr>`).join('');
      const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Filo Raporu ${days} gün</title>
<style>
  *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:40px;line-height:1.5}
  h1{font-size:22px;margin:0 0 4px} .sub{color:#666;font-size:12px;margin-bottom:24px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:18px 0}
  .kpi{border:1px solid #ddd;border-radius:10px;padding:12px 14px} .kpi .l{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.04em}
  .kpi .v{font-size:24px;font-weight:700;margin-top:4px}
  table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px} th,td{border-bottom:1px solid #eee;padding:7px 6px;text-align:left}
  th{color:#666;font-size:11px;text-transform:uppercase} h2{font-size:14px;margin:24px 0 4px}
  .foot{margin-top:32px;color:#999;font-size:11px;border-top:1px solid #eee;padding-top:8px}
  @media print{body{margin:16mm}}
</style></head><body>
  <h1>VPS Fleet — Operasyonel Rapor</h1>
  <div class="sub">${esc(d.range.from?.slice(0,10))} → ${esc(d.range.to?.slice(0,10))} · ${days} gün · oluşturma: ${esc(now)}</div>
  <div class="grid">
    <div class="kpi"><div class="l">Toplam cihaz</div><div class="v">${esc(d.devices.total)}</div></div>
    <div class="kpi"><div class="l">Çevrimiçi</div><div class="v">${esc(d.devices.online)}</div></div>
    <div class="kpi"><div class="l">Aralıktaki görev</div><div class="v">${esc(d.jobs.inRange)}</div></div>
    <div class="kpi"><div class="l">Başarı oranı</div><div class="v">${esc(d.jobs.successRate)}%</div></div>
    <div class="kpi"><div class="l">Başarısız görev</div><div class="v">${esc(d.jobs.failed)}</div></div>
    <div class="kpi"><div class="l">Proxy / Üye / Uyarı</div><div class="v">${esc(d.proxies)} / ${esc(d.members)} / ${esc(d.alertEvents)}</div></div>
  </div>
  <h2>Görev türüne göre dağılım</h2>
  <table><thead><tr><th>Tür</th><th style="text-align:right">Adet</th></tr></thead><tbody>${rows || '<tr><td colspan="2">Kayıt yok</td></tr>'}</tbody></table>
  <div class="foot">VPS Fleet · Bulut Telefon Filosu · bu rapor tarayıcıdan PDF olarak kaydedilmiştir.</div>
</body></html>`;
      const w = window.open('', '_blank', 'width=900,height=1000');
      if (!w) return;
      w.document.write(html);
      w.document.close();
      // Give the new window a tick to render before invoking print.
      w.onload = () => { w.focus(); w.print(); };
    } finally {
      setBusy(false);
    }
  }

  const s = summary;

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="RAPORLAR"
        title="Raporlar"
        subtitle="Çalışma alanı operasyonel özeti ve dışa aktarma"
        actions={
          <>
            <select className="inline-select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {RANGES.map((r) => (
                <option key={r.key} value={r.days}>{r.label}</option>
              ))}
            </select>
            <button type="button" className="btn-ghost" disabled={busy} onClick={exportCsv}>
              <Download size={15} /> CSV
            </button>
            <button type="button" className="btn-ghost" onClick={exportJson}>
              <FileJson size={15} /> JSON
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={exportPdf}>
              <FileText size={15} /> PDF
            </button>
          </>
        }
      />

      {/* ★2026-08-12: dışa aktarma hatası. Sessizce boş/bozuk dosya indirmektense
          hiç indirmeyip nedenini söylemek doğru — indirilen dosyaya bakıp "veri yok"
          sanmak, rapor ekranında yanlış karara yol açar. */}
      {exportError ? (
        <p className="form-status form-status--err" role="alert">{exportError}</p>
      ) : null}

      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat
            tone="info"
            icon={<Activity size={16} />}
            label="Aralıktaki görevler"
            value={<span className="mono">{s?.jobs.inRange ?? 0}</span>}
            sub={<span className="mono">{s?.jobs.total ?? 0}</span>}
          />
          <HoloStat
            tone="success"
            icon={<Gauge size={16} />}
            label="Başarı oranı"
            value={<span className="mono">{s?.jobs.successRate ?? 0}%</span>}
            sub={<><span className="mono">{s?.jobs.completed ?? 0}</span> başarılı · <span className="mono">{s?.jobs.failed ?? 0}</span> başarısız</>}
          />
          <HoloStat
            tone="cyan"
            icon={<Cpu size={16} />}
            label="Cihazlar"
            value={<span className="mono">{s?.devices.total ?? 0}</span>}
            sub={<><span className="mono">{s?.devices.online ?? 0}</span> çevrimiçi</>}
          />
          <HoloStat
            tone="warning"
            icon={<BellRing size={16} />}
            label="Tetiklenen uyarılar"
            value={<span className="mono">{s?.alertEvents ?? 0}</span>}
            sub="aralıkta"
          />
        </div>
      </Reveal>

      <Reveal delay={0.06}>
        <HoloPanel title="Türe göre görevler" icon={<BarChart3 size={16} />} scan>
          {!s || s.jobsByType.length === 0 ? (
            <p className="helper">Bu aralıkta görev yok.</p>
          ) : (
            <div className="holo-grid-auto">
              {s.jobsByType.map((row) => {
                const max = s.jobsByType[0]?.count || 1;
                const pct = Math.round((row.count / max) * 100);
                return (
                  <Holo3D className="holo-stat holo-tone-violet" max={6} key={row.type}>
                    <div className="holo-stat-top">
                      <span className="holo-stat-ico"><Layers size={16} /></span>
                      <span className="holo-stat-label">{row.type}</span>
                    </div>
                    <div className="holo-stat-value mono">{row.count}</div>
                    <div className="report-bar-track" style={{ marginTop: 10 }}>
                      <div className="report-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="holo-stat-sub mono">{pct}%</div>
                  </Holo3D>
                );
              })}
            </div>
          )}
        </HoloPanel>
      </Reveal>
    </PageMotion>
  );
}
