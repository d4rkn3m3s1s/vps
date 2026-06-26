'use client';

import { useEffect, useState } from 'react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, Reveal } from '../../components/hud';

type CostSummary = {
  days: number;
  costs: { gpuSpendCents: number; usageSpendCents: number; totalCostCents: number };
  revenue: { mrrCents: number };
  profitCents: number;
  roi: number;
  perDevice: { count: number; costPerDeviceCents: number };
  perAccount: { count: number; costPerAccountCents: number };
  byDay: { date: string; minutes: number }[];
};

const RATE_PER_MINUTE_CENTS = 0.6;

const costRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '0.6rem 0',
  borderBottom: '1px solid var(--hairline, rgba(255,255,255,0.06))'
};

function usd(cents: number): string {
  const v = (cents ?? 0) / 100;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function CostsPage() {
  const [data, setData] = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch('/api/costs/summary?days=30')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        return json.data as CostSummary;
      })
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setError('Maliyet verileri yüklenemedi.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const profitable = (data?.profitCents ?? 0) >= 0;

  // Daily cost series: minutes → cents using the per-minute rate.
  const dailyCosts = (data?.byDay ?? []).map((d) => ({
    date: d.date,
    costCents: Math.round(d.minutes * RATE_PER_MINUTE_CENTS)
  }));
  const maxDaily = Math.max(1, ...dailyCosts.map((d) => d.costCents));

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="FINANS"
        title="Maliyet & Kâr"
        subtitle="Vast GPU harcaması, abonelik geliri ve cihaz/hesap başına birim maliyet — son 30 gün."
      />

      {loading ? (
        <HoloPanel>
          <div className="muted" style={{ padding: '1.5rem', textAlign: 'center' }}>Yükleniyor…</div>
        </HoloPanel>
      ) : error ? (
        <HoloPanel>
          <div className="muted" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--danger, #ef233c)' }}>
            {error}
          </div>
        </HoloPanel>
      ) : !data ? (
        <HoloPanel>
          <div className="muted" style={{ padding: '1.5rem', textAlign: 'center' }}>Veri bulunamadı.</div>
        </HoloPanel>
      ) : (
        <>
          <Reveal>
            <div className="holo-stats-grid">
              <HoloStat
                tone="warning"
                label="Vast GPU"
                value={usd(data.costs.gpuSpendCents)}
                sub="GPU host harcaması"
              />
              <HoloStat
                tone="cyan"
                label="Cihaz Kullanımı"
                value={usd(data.costs.usageSpendCents)}
                sub="Online dakika maliyeti"
              />
              <HoloStat
                tone="error"
                label="Toplam Maliyet"
                value={usd(data.costs.totalCostCents)}
                sub={`${data.days} günlük`}
              />
              <HoloStat
                tone="success"
                label="MRR Gelir"
                value={usd(data.revenue.mrrCents)}
                sub="Aylık tekrarlayan gelir"
              />
            </div>
          </Reveal>

          <Reveal delay={0.05}>
            <HoloPanel
              title={profitable ? 'Kâr & ROI' : 'Zarar & ROI'}
              className={profitable ? 'cost-profit-ok' : 'cost-profit-bad'}
            >
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '2rem',
                  alignItems: 'center',
                  padding: '0.5rem 0'
                }}
              >
                <div>
                  <div className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {profitable ? 'Net Kâr' : 'Net Zarar'}
                  </div>
                  <div
                    style={{
                      fontSize: '2rem',
                      fontWeight: 700,
                      color: profitable ? '#22c55e' : '#ef233c'
                    }}
                  >
                    {usd(data.profitCents)}
                  </div>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    ROI
                  </div>
                  <div
                    style={{
                      fontSize: '2rem',
                      fontWeight: 700,
                      color: profitable ? '#22c55e' : '#ef233c'
                    }}
                  >
                    {(data.roi * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="muted" style={{ maxWidth: 320, fontSize: '0.85rem' }}>
                  {profitable
                    ? 'Gelir toplam maliyeti karşılıyor. Operasyon kârda.'
                    : 'Maliyet geliri aşıyor. Birim maliyetleri düşürmeyi değerlendirin.'}
                </div>
              </div>
            </HoloPanel>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="holo-grid-2">
              <HoloPanel title="Cihaz Başına Maliyet">
                <div style={costRow}>
                  <span className="muted">Cihaz sayısı</span>
                  <span className="mono">{data.perDevice.count}</span>
                </div>
                <div style={costRow}>
                  <span className="muted">Cihaz başına maliyet</span>
                  <span className="mono" style={{ fontWeight: 600 }}>{usd(data.perDevice.costPerDeviceCents)}</span>
                </div>
              </HoloPanel>

              <HoloPanel title="Hesap Başına Maliyet">
                <div style={costRow}>
                  <span className="muted">Hesap sayısı</span>
                  <span className="mono">{data.perAccount.count}</span>
                </div>
                <div style={costRow}>
                  <span className="muted">Hesap başına maliyet</span>
                  <span className="mono" style={{ fontWeight: 600 }}>{usd(data.perAccount.costPerAccountCents)}</span>
                </div>
              </HoloPanel>
            </div>
          </Reveal>

          <Reveal delay={0.15}>
            <HoloPanel title="Günlük Maliyet">
              {dailyCosts.length === 0 ? (
                <div className="muted" style={{ padding: '1rem', textAlign: 'center' }}>
                  Bu dönemde kullanım maliyeti yok.
                </div>
              ) : (
                <div className="bar-chart">
                  {dailyCosts.map((d) => (
                    <div className="bar-col" key={d.date} title={`${d.date}: ${usd(d.costCents)}`}>
                      <div
                        className="bar-fill"
                        style={{ height: `${Math.max(4, (d.costCents / maxDaily) * 100)}%` }}
                      />
                      <span className="bar-label mono">{d.date.slice(5)}</span>
                    </div>
                  ))}
                </div>
              )}
            </HoloPanel>
          </Reveal>
        </>
      )}
    </PageMotion>
  );
}
