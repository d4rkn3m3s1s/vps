'use client';

import { useEffect, useState } from 'react';
import { Activity, Smartphone, Wifi, ListChecks, HeartPulse, Sprout, RefreshCw, TrendingUp } from 'lucide-react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, Reveal } from '../../components/hud';

type TrendPoint = {
  date: string;
  devices: number;
  onlineDevices: number;
  jobs: number;
  jobsCompleted: number;
  jobsFailed: number;
  farmAccounts: number;
  avgHealthScore: number;
  onlineMinutes: number;
};

type TrendTotals = {
  devices: number;
  onlineDevices: number;
  jobs: number;
  jobsCompleted: number;
  jobsFailed: number;
  farmAccounts: number;
  avgHealthScore: number;
  onlineMinutes: number;
};

type TrendData = { days: number; series: TrendPoint[]; totals: TrendTotals };

const RANGES = [7, 30, 90] as const;

function fmtDay(date: string): string {
  // "2026-06-26" → "26.06"
  const [, m, d] = date.split('-');
  return `${d}.${m}`;
}

// Pick a sparse set of labels so the x-axis doesn't crowd on long ranges.
function showLabel(index: number, total: number): boolean {
  if (total <= 10) return true;
  const step = Math.ceil(total / 8);
  return index % step === 0 || index === total - 1;
}

export default function TrendsPage() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<TrendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/trends/summary?days=${days}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Trend verileri alınamadı.');
        const body = (await res.json()) as { data: TrendData };
        if (alive) setData(body.data);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'Bir hata oluştu.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [days]);

  const series = data?.series ?? [];
  const totals = data?.totals;
  const hasData = series.length > 0;

  // Chart scales.
  const maxJobs = Math.max(1, ...series.map((p) => p.jobs));
  const maxOnline = Math.max(1, ...series.map((p) => p.onlineDevices));

  return (
    <PageMotion className="page holo-page">
      <HoloHeader
        eyebrow="FİLO TRENDLERİ"
        title="Trendler"
        subtitle="Filo metriklerinizin günlük zaman serisi ve trend grafikleri."
        actions={
          <div className="holo-tabs" role="tablist" aria-label="Zaman aralığı">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={days === r}
                className={`holo-tab ${days === r ? 'is-active' : ''}`}
                onClick={() => setDays(r)}
              >
                <span className="holo-tab-label">{r} gün</span>
              </button>
            ))}
          </div>
        }
      />

      {error ? (
        <HoloPanel title="Hata" icon={<RefreshCw size={16} />}>
          <p className="form-status form-status--err">{error}</p>
          <button type="button" className="btn-ghost icon-row" onClick={() => setDays((d) => d)} style={{ marginTop: '0.75rem' }}>
            <RefreshCw size={14} /> Yeniden dene
          </button>
        </HoloPanel>
      ) : loading ? (
        <HoloPanel title="Trendler yükleniyor" icon={<TrendingUp size={16} />}>
          <div aria-busy="true" aria-live="polite" style={{ color: 'var(--muted)' }}>
            Veriler hesaplanıyor…
          </div>
        </HoloPanel>
      ) : !hasData ? (
        <HoloPanel title="Henüz veri yok" icon={<TrendingUp size={16} />}>
          <p style={{ color: 'var(--muted)' }}>
            Henüz trend kaydı bulunmuyor. Metrikler her gün otomatik olarak toplanır; ilk anlık görüntü oluştuğunda grafikler burada görünecek.
          </p>
        </HoloPanel>
      ) : (
        <>
          <Reveal>
            <div className="holo-stats-grid" style={{ marginBottom: '1rem' }}>
              <HoloStat
                label="Cihaz (çevrimiçi / toplam)"
                tone="cyan"
                icon={<Smartphone size={16} />}
                value={<span className="mono">{totals?.onlineDevices ?? 0} / {totals?.devices ?? 0}</span>}
              />
              <HoloStat
                label="İş (tamamlanan)"
                tone="violet"
                icon={<ListChecks size={16} />}
                value={<span className="mono">{totals?.jobs ?? 0}</span>}
                sub={<span className="mono">{totals?.jobsCompleted ?? 0} tamamlandı · {totals?.jobsFailed ?? 0} başarısız</span>}
              />
              <HoloStat
                label="Ortalama sağlık skoru"
                tone="success"
                icon={<HeartPulse size={16} />}
                value={<span className="mono">{totals?.avgHealthScore ?? 0}</span>}
                sub={<span className="mono">/ 100</span>}
              />
              <HoloStat
                label="Çiftlik hesapları"
                tone="warning"
                icon={<Sprout size={16} />}
                value={<span className="mono">{totals?.farmAccounts ?? 0}</span>}
                sub={<span className="mono">{Math.round((totals?.onlineMinutes ?? 0) / 60)} sa çevrimiçi</span>}
              />
            </div>
          </Reveal>

          <Reveal delay={0.05}>
            <HoloPanel title="Günlük işler (tamamlanan / başarısız)" icon={<ListChecks size={16} />}>
              <div className="bar-chart" role="img" aria-label="Günlük iş sayısı grafiği">
                {series.map((p, i) => {
                  const completedH = (p.jobsCompleted / maxJobs) * 100;
                  const failedH = (p.jobsFailed / maxJobs) * 100;
                  return (
                    <div className="bar-col" key={p.date} title={`${p.date}: ${p.jobsCompleted} tamamlandı, ${p.jobsFailed} başarısız`}>
                      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', width: '70%', height: '100%', gap: '2px' }}>
                        <div
                          style={{
                            height: `${failedH}%`,
                            minHeight: p.jobsFailed > 0 ? 4 : 0,
                            borderRadius: '6px 6px 0 0',
                            background: 'linear-gradient(180deg, var(--error, #f87171), rgba(248,113,113,0.3))'
                          }}
                        />
                        <div
                          style={{
                            height: `${completedH}%`,
                            minHeight: p.jobsCompleted > 0 ? 4 : 0,
                            borderRadius: failedH > 0 ? 0 : '6px 6px 0 0',
                            background: 'linear-gradient(180deg, var(--success, #4ade80), rgba(74,222,128,0.3))'
                          }}
                        />
                      </div>
                      <span className="bar-label">{showLabel(i, series.length) ? fmtDay(p.date) : ''}</span>
                    </div>
                  );
                })}
              </div>
            </HoloPanel>
          </Reveal>

          <Reveal delay={0.1}>
            <HoloPanel title="Günlük çevrimiçi cihaz" icon={<Wifi size={16} />}>
              <div className="bar-chart" role="img" aria-label="Günlük çevrimiçi cihaz grafiği">
                {series.map((p, i) => (
                  <div className="bar-col" key={p.date} title={`${p.date}: ${p.onlineDevices} çevrimiçi / ${p.devices} cihaz`}>
                    <div className="bar-fill" style={{ height: `${(p.onlineDevices / maxOnline) * 100}%` }} />
                    <span className="bar-label">{showLabel(i, series.length) ? fmtDay(p.date) : ''}</span>
                  </div>
                ))}
              </div>
            </HoloPanel>
          </Reveal>

          <Reveal delay={0.15}>
            <HoloPanel title="Günlük ortalama sağlık skoru" icon={<HeartPulse size={16} />}>
              <div className="bar-chart" role="img" aria-label="Günlük ortalama sağlık skoru grafiği">
                {series.map((p, i) => (
                  <div className="bar-col" key={p.date} title={`${p.date}: ${p.avgHealthScore} / 100`}>
                    <div
                      className="bar-fill"
                      style={{
                        height: `${p.avgHealthScore}%`,
                        background: 'linear-gradient(180deg, var(--success, #4ade80), rgba(74,222,128,0.3))'
                      }}
                    />
                    <span className="bar-label">{showLabel(i, series.length) ? fmtDay(p.date) : ''}</span>
                  </div>
                ))}
              </div>
            </HoloPanel>
          </Reveal>
        </>
      )}
    </PageMotion>
  );
}
