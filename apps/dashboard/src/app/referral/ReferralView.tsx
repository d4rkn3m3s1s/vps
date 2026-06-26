'use client';

import { useState } from 'react';
import { Gift, Link2, Users, UserCheck, Wallet, Hourglass, Copy, Check, ListChecks, Sparkles, Share2, Coins } from 'lucide-react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, Holo3D, Reveal } from '../../components/hud';

export type ReferralData = {
  code: string;
  rewardRate: number;
  invited: number;
  signedUp: number;
  converted: number;
  creditsEarnedCents: number;
  pendingCents: number;
  recent: { id: string; email: string; status: string; rewardCents: number; createdAt: string }[];
};

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const STATUS_LABEL: Record<string, string> = {
  INVITED: 'Davet edildi',
  SIGNED_UP: 'Kaydoldu',
  CONVERTED: 'Dönüştü'
};

const STATUS_DOT: Record<string, string> = {
  INVITED: 'dot-offline',
  SIGNED_UP: 'dot-online',
  CONVERTED: 'dot-online'
};

export function ReferralView({ data }: { data: ReferralData | null }) {
  const [copied, setCopied] = useState(false);
  const code = data?.code ?? '—';
  const link = `https://app.vpsfleet.io/r/${code}`;
  const rewardPct = Math.round((data?.rewardRate ?? 0.2) * 100);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="DAVET PROGRAMI"
        title="Davet"
        subtitle="Arkadaşlarınızı davet edin ve bulut telefon kredisi kazanın."
      />

      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat
            label="Davet edilen"
            value={<span className="mono">{data?.invited ?? 0}</span>}
            tone="cyan"
            icon={<Users size={16} />}
          />
          <HoloStat
            label="Kaydolan"
            value={<span className="mono">{data?.signedUp ?? 0}</span>}
            tone="info"
            icon={<UserCheck size={16} />}
            {...(data ? { sub: <span className="mono">{data.converted} dönüştü</span> } : {})}
          />
          <HoloStat
            label="Kazanılan kredi"
            value={<span className="mono">{dollars(data?.creditsEarnedCents ?? 0)}</span>}
            tone="success"
            icon={<Wallet size={16} />}
          />
          <HoloStat
            label="Bekleyen"
            value={<span className="mono">{dollars(data?.pendingCents ?? 0)}</span>}
            tone="warning"
            icon={<Hourglass size={16} />}
          />
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <HoloPanel title="Davet bağlantınız" icon={<Link2 size={16} />} tilt>
          <p className="helper">Bu bağlantıyı paylaşın. Davet ettikleriniz abone olduğunda %{rewardPct} kredi kazanırsınız.</p>
          <div className="field-row" style={{ marginTop: '12px' }}>
            <input className="field-input mono" readOnly value={link} />
            <button type="button" className="btn-primary" onClick={copy} disabled={!data}>
              {copied ? <><Check size={14} /> Kopyalandı</> : <><Copy size={14} /> Kopyala</>}
            </button>
          </div>
          <p className="helper" style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="status-chip"><Gift size={12} /> Ödül %{rewardPct}</span>
            Kodunuz: <span className="mono">{code}</span>
          </p>
        </HoloPanel>
      </Reveal>

      {/* Real referral activity */}
      <Reveal delay={0.1}>
        <HoloPanel title="Son davetler" icon={<ListChecks size={16} />}>
          {data && data.recent.length > 0 ? (
            <div className="profile-table-wrap">
              <table className="profile-table">
                <thead>
                  <tr>
                    <th>Davet edilen</th>
                    <th>Durum</th>
                    <th>Ödül</th>
                    <th>Tarih</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.email}</td>
                      <td>
                        <span className="status-chip">
                          <span className={`dot ${STATUS_DOT[r.status] ?? 'dot-offline'}`} />
                          {STATUS_LABEL[r.status] ?? r.status}
                        </span>
                      </td>
                      <td className="mono">{dollars(r.rewardCents)}</td>
                      <td className="mono">{new Date(r.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="table-empty">
              <p className="helper">
                Henüz davet yok. Yukarıdaki bağlantınızı paylaşın — davet ettikleriniz kaydolur olmaz burada görünecek.
              </p>
            </div>
          )}
        </HoloPanel>
      </Reveal>

      <Reveal delay={0.15}>
        <HoloPanel title="Nasıl çalışır" icon={<Sparkles size={16} />}>
          <div className="holo-grid-auto">
            <Holo3D className="holo-panel holo-tone-cyan" max={6}>
              <div className="holo-stat-top">
                <span className="holo-stat-ico"><Share2 size={16} /></span>
                <span className="holo-stat-label mono">01</span>
              </div>
              <p className="helper" style={{ marginTop: '8px' }}>Bağlantınızı arkadaşlarınızla ve topluluklarla paylaşın.</p>
            </Holo3D>
            <Holo3D className="holo-panel holo-tone-accent" max={6}>
              <div className="holo-stat-top">
                <span className="holo-stat-ico"><UserCheck size={16} /></span>
                <span className="holo-stat-label mono">02</span>
              </div>
              <p className="helper" style={{ marginTop: '8px' }}>Kaydolup ücretli bir plan başlatırlar.</p>
            </Holo3D>
            <Holo3D className="holo-panel holo-tone-success" max={6}>
              <div className="holo-stat-top">
                <span className="holo-stat-ico"><Coins size={16} /></span>
                <span className="holo-stat-label mono">03</span>
              </div>
              <p className="helper" style={{ marginTop: '8px' }}>İlk ödemelerinin %{rewardPct}&apos;ini filo kredisi olarak kazanırsınız.</p>
            </Holo3D>
            <Holo3D className="holo-panel holo-tone-violet" max={6}>
              <div className="holo-stat-top">
                <span className="holo-stat-ico"><Wallet size={16} /></span>
                <span className="holo-stat-label mono">04</span>
              </div>
              <p className="helper" style={{ marginTop: '8px' }}>Kredi otomatik olarak bir sonraki faturanıza uygulanır.</p>
            </Holo3D>
          </div>
        </HoloPanel>
      </Reveal>
    </PageMotion>
  );
}
