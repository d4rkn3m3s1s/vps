'use client';

import { useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

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
      <PageHeader title="Davet" subtitle="Arkadaşlarınızı davet edin ve bulut telefon kredisi kazanın." />

      <div className="stats">
        <div className="metric">
          <p className="metric-label">Davet edilen</p>
          <p className="metric-value">{data?.invited ?? 0}</p>
        </div>
        <div className="metric">
          <p className="metric-label">Kaydolan</p>
          <p className="metric-value">{data?.signedUp ?? 0}</p>
        </div>
        <div className="metric">
          <p className="metric-label">Kazanılan kredi</p>
          <p className="metric-value">{dollars(data?.creditsEarnedCents ?? 0)}</p>
        </div>
        <div className="metric">
          <p className="metric-label">Bekleyen</p>
          <p className="metric-value">{dollars(data?.pendingCents ?? 0)}</p>
        </div>
      </div>

      <div className="config-card">
        <h3>Davet bağlantınız</h3>
        <p className="helper">Bu bağlantıyı paylaşın. Davet ettikleriniz abone olduğunda %{rewardPct} kredi kazanırsınız.</p>
        <div className="copy-row">
          <input className="copy-input mono" readOnly value={link} />
          <button type="button" className="btn-primary" onClick={copy} disabled={!data}>
            {copied ? '✓ Kopyalandı' : 'Kopyala'}
          </button>
        </div>
        <p className="helper" style={{ marginTop: '10px' }}>
          Kodunuz: <span className="mono">{code}</span>
        </p>
      </div>

      {/* Real referral activity */}
      <div className="config-card">
        <h3>Son davetler</h3>
        {data && data.recent.length > 0 ? (
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
                  <td>{STATUS_LABEL[r.status] ?? r.status}</td>
                  <td>{dollars(r.rewardCents)}</td>
                  <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="helper">
            Henüz davet yok. Yukarıdaki bağlantınızı paylaşın — davet ettikleriniz kaydolur olmaz burada görünecek.
          </p>
        )}
      </div>

      <div className="config-card">
        <h3>Nasıl çalışır</h3>
        <ol className="how-list">
          <li>Bağlantınızı arkadaşlarınızla ve topluluklarla paylaşın.</li>
          <li>Kaydolup ücretli bir plan başlatırlar.</li>
          <li>İlk ödemelerinin %{rewardPct}'ini filo kredisi olarak kazanırsınız.</li>
          <li>Kredi otomatik olarak bir sonraki faturanıza uygulanır.</li>
        </ol>
      </div>
    </PageMotion>
  );
}
