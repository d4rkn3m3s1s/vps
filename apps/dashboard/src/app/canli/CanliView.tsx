'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, Pause, Play, Radio, Trash2, Zap } from 'lucide-react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat } from '../../components/hud';
import { useFleetEvents } from '../../lib/live';

// ★★★2026-08-18 CANLI OPERASYON EKRANI.
// Operatör isteği: "jobları görebileceğim, neler var neler verilmiş, API isteklerini
// görebileceğim canlı ekran".
//
// İKİ AKIŞ TEK EKRANDA:
//   • API istekleri — panel / sunucu aracısı / dış API ayrımıyla, her istek anında düşer
//   • İşler (job)   — oluşturma ve durum değişimi anında düşer
// İkisi de mevcut '/ws/devices' kanalından gelir (yeni WS ucu açılmadı); sayfa
// açılırken son 200 istek REST ile bir kez doldurulur.
//
// İstekler SUNUCUDA BELLEKTE tutulur, veritabanına YAZILMAZ — sunucu aracısı saniyede
// bir yokladığı için o hacim veritabanını şişirirdi (bkz. api/modules/ops/ops.service.ts).

type OpsRequest = {
  id: string;
  at: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  source: 'panel' | 'agent' | 'public' | 'bilinmiyor';
  ip?: string;
};

type JobEvent = { key: string; at: string; type: string; status: string };

type Summary = { total: number; err4xx: number; err5xx: number; avgMs: number; buffered: number };

const SOURCE_TR: Record<string, string> = {
  panel: 'Panel',
  agent: 'Sunucu aracısı',
  public: 'Dış API',
  bilinmiyor: 'Bilinmiyor'
};

const JOB_STATUS_TR: Record<string, string> = {
  PENDING: 'Bekliyor',
  RUNNING: 'Çalışıyor',
  COMPLETED: 'Tamamlandı',
  FAILED: 'Başarısız'
};

// Akış hızlı; tarayıcı DOM'u şişmesin diye tutulan satır sayısı sınırlı.
const MAX_ROWS = 250;

// Durum kodunu mevcut durum-noktası sınıflarına eşle.
// ⚠️Renk sınıfları `tone-ok` / `tone-warn` / `tone-bad`'dir (globals.css:4961).
// İlk sürümde `status-dot-online` gibi UYDURMA adlar yazmıştım — CSS'te karşılığı
// olmadığı için nokta RENKSİZ 8px boşluk olarak çiziliyor, satır hizasını da
// bozuyordu (ekranda "200" yanında hiç nokta görünmüyordu).
function dotClass(status: number): string {
  if (status >= 500) return 'status-dot tone-bad';
  if (status >= 400) return 'status-dot tone-warn';
  if (status >= 300) return 'status-dot tone-muted';
  return 'status-dot tone-ok';
}

function hhmmss(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '--:--:--' : d.toLocaleTimeString('tr-TR', { hour12: false });
}

export function CanliView() {
  const [requests, setRequests] = useState<OpsRequest[]>([]);
  const [jobs, setJobs] = useState<JobEvent[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [paused, setPaused] = useState(false);
  const [srcFilter, setSrcFilter] = useState<'hepsi' | OpsRequest['source']>('hepsi');
  const [onlyErrors, setOnlyErrors] = useState(false);
  // Duraklatınca akış durmaz, sadece ekran dondurulur — kaçırılan sayısı gösterilir.
  const pausedCount = useRef(0);
  const [pausedShown, setPausedShown] = useState(0);

  // İlk dolum — sunucudaki bellek tamponundan son N istek.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/ops/requests?limit=200');
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        const data = (body?.data ?? {}) as { requests?: OpsRequest[]; summary?: Summary };
        if (Array.isArray(data.requests)) setRequests(data.requests.slice(0, MAX_ROWS));
        if (data.summary) setSummary(data.summary);
      } catch {
        /* ilk dolum başarısız olsa da canlı akış çalışır */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ★2026-08-18 İŞLER PANELİ AÇILIŞ DOLUMU.
  // Panel yalnızca sayfa AÇIKKEN oluşan işleri gösteriyordu; sayfa ilk açıldığında
  // boş kalıyor ve operatör "iş akmıyor mu?" diye tereddüt ediyordu. Artık son
  // işler bir kez REST ile doldurulur, üstüne canlı olaylar eklenir.
  // (İstekler bellekte tutulur ama İŞLER veritabanındadır — geçmiş burada gerçek.)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/jobs');
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        const raw = body?.data;
        const list = (Array.isArray(raw) ? raw : raw?.jobs ?? []) as Array<{
          id?: string; type?: string; status?: string; createdAt?: string; finishedAt?: string | null;
        }>;
        const rows: JobEvent[] = list
          .filter((j) => j?.id)
          .slice(0, 40)
          .map((j) => ({
            key: `init-${j.id}`,
            at: j.finishedAt ?? j.createdAt ?? new Date().toISOString(),
            type: j.type ?? '—',
            status: j.status ?? '—'
          }));
        if (rows.length) setJobs(rows);
      } catch {
        /* dolum başarısız olsa da canlı akış çalışır */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useFleetEvents(
    ['ops.request'],
    useCallback(
      (e) => {
        const r = e.payload as OpsRequest | undefined;
        if (!r || typeof r.path !== 'string') return;
        if (paused) {
          pausedCount.current += 1;
          setPausedShown(pausedCount.current);
          return;
        }
        setRequests((prev) => [r, ...prev].slice(0, MAX_ROWS));
      },
      [paused]
    )
  );

  useFleetEvents(
    ['job.created', 'job.updated'],
    useCallback(
      (e) => {
        if (paused) return;
        const p = (e.payload ?? {}) as { id?: string; type?: string; status?: string };
        if (!p.id) return;
        const at = e.timestamp ?? new Date().toISOString();
        const status = p.status ?? (e.type === 'job.created' ? 'PENDING' : '—');
        setJobs((prev) => [{ key: `${p.id}-${status}-${at}`, at, type: p.type ?? '—', status }, ...prev].slice(0, MAX_ROWS));
      },
      [paused]
    )
  );

  const shown = useMemo(
    () => requests.filter((r) => (srcFilter === 'hepsi' || r.source === srcFilter) && (!onlyErrors || r.status >= 400)),
    [requests, srcFilter, onlyErrors]
  );

  const live = useMemo(() => {
    const errs = requests.filter((r) => r.status >= 400).length;
    const avg = requests.length ? Math.round(requests.reduce((a, r) => a + r.ms, 0) / requests.length) : 0;
    const bySource = requests.reduce<Record<string, number>>((acc, r) => {
      acc[r.source] = (acc[r.source] ?? 0) + 1;
      return acc;
    }, {});
    return { errs, avg, bySource };
  }, [requests]);

  function togglePause() {
    setPaused((p) => {
      if (p) {
        pausedCount.current = 0;
        setPausedShown(0);
      }
      return !p;
    });
  }

  return (
    <PageMotion>
      <HoloHeader
        eyebrow="CANLI OPERASYON"
        title="Canlı Akış"
        subtitle="Panelin, sunucu aracısının ve dış API'nin attığı her istek — anlık."
        actions={
          <div className="canli-actions">
            <button type="button" className={paused ? 'btn-primary' : 'btn-ghost'} onClick={togglePause}>
              {paused ? (
                <>
                  <Play size={14} /> Devam et{pausedShown ? ` (${pausedShown})` : ''}
                </>
              ) : (
                <>
                  <Pause size={14} /> Duraklat
                </>
              )}
            </button>
            <button type="button" className="btn-ghost" onClick={() => { setRequests([]); setJobs([]); }}>
              <Trash2 size={14} /> Temizle
            </button>
          </div>
        }
      />

      <div className="holo-stats-grid">
        <HoloStat
          label="Ekrandaki istek"
          value={String(requests.length)}
          sub={paused ? `duraklatıldı · ${pausedShown} bekliyor` : 'canlı akıyor'}
        />
        <HoloStat label="Hata" value={String(live.errs)} sub={summary ? `sunucu toplamı: ${summary.err4xx + summary.err5xx}` : '4xx / 5xx'} />
        <HoloStat label="Ortalama süre" value={`${live.avg} ms`} sub={summary ? `sunucu ort.: ${summary.avgMs} ms` : 'yanıt süresi'} />
        <HoloStat label="Sunucu aracısı" value={String(live.bySource.agent ?? 0)} sub="iş alma + heartbeat" />
        <HoloStat label="Panel" value={String(live.bySource.panel ?? 0)} sub="dashboard çağrıları" />
        <HoloStat label="Dış API" value={String(live.bySource.public ?? 0)} sub="/v1 · /public" />
      </div>

      <div className="grid console-grid canli-grid">
        <HoloPanel
          title={`API İstekleri (${shown.length})`}
          icon={<Activity size={16} />}
          actions={
            <div className="canli-filters">
              {(['hepsi', 'panel', 'agent', 'public'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={srcFilter === s ? 'btn-ghost btn-xs is-active' : 'btn-ghost btn-xs'}
                  onClick={() => setSrcFilter(s)}
                >
                  {s === 'hepsi' ? 'Hepsi' : SOURCE_TR[s]}
                </button>
              ))}
              <button
                type="button"
                className={onlyErrors ? 'btn-ghost btn-xs is-active' : 'btn-ghost btn-xs'}
                onClick={() => setOnlyErrors((v) => !v)}
                title="Yalnızca 4xx / 5xx"
              >
                <AlertTriangle size={12} /> Hatalar
              </button>
            </div>
          }
        >
          <div className="profile-table-wrap canli-scroll canli-req">
            <table className="profile-table">
              <thead>
                <tr>
                  <th className="canli-col-time">Saat</th>
                  <th className="canli-col-method">Yöntem</th>
                  <th>Yol</th>
                  <th className="canli-col-src">Kaynak</th>
                  <th className="canli-col-code">Kod</th>
                  <th className="canli-col-ms">Süre</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="table-empty">
                        <div className="empty-art">◉</div>
                        <p>Henüz istek yok — panelde gezinince ya da sunucu aracısı iş alınca anında burada belirir.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  shown.map((r) => (
                    <tr key={r.id}>
                      <td className="mono helper">{hhmmss(r.at)}</td>
                      <td className="mono">{r.method}</td>
                      <td className="mono canli-path" title={r.path}>{r.path}</td>
                      <td>{SOURCE_TR[r.source] ?? r.source}</td>
                      <td>
                        <span className="status-chip">
                          <span className={dotClass(r.status)} /> {r.status}
                        </span>
                      </td>
                      <td className="mono helper">{r.ms}ms</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </HoloPanel>

        <HoloPanel title={`İşler (${jobs.length})`} icon={<Zap size={16} />}>
          <div className="profile-table-wrap canli-scroll canli-jobs">
            <table className="profile-table">
              <thead>
                <tr>
                  <th className="canli-col-time">Saat</th>
                  <th>Tür</th>
                  <th className="canli-col-src">Durum</th>
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={3}>
                      <div className="table-empty">
                        <div className="empty-art">☰</div>
                        <p>Bir iş oluşturulduğunda ya da durumu değiştiğinde burada belirir.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  jobs.map((j) => (
                    <tr key={j.key}>
                      <td className="mono helper">{hhmmss(j.at)}</td>
                      <td className="mono canli-path" title={j.type}>{j.type}</td>
                      <td>{JOB_STATUS_TR[j.status] ?? j.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </HoloPanel>
      </div>

      <p className="helper canli-note">
        <Radio size={12} /> İstekler sunucuda <b>bellekte</b> tutulur (son {summary?.buffered ?? '—'} kayıt), veritabanına yazılmaz —
        sunucu aracısı saniyede bir yokladığı için o hacim veritabanını şişirirdi. Gövde ve kimlik başlıkları <b>hiç saklanmaz</b>.
      </p>
    </PageMotion>
  );
}
