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
  INVITED: 'Invited',
  SIGNED_UP: 'Signed up',
  CONVERTED: 'Converted'
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
      <PageHeader title="Referral" subtitle="Invite friends and earn cloud phone credits." />

      <div className="stats">
        <div className="metric">
          <p className="metric-label">Invited</p>
          <p className="metric-value">{data?.invited ?? 0}</p>
        </div>
        <div className="metric">
          <p className="metric-label">Signed up</p>
          <p className="metric-value">{data?.signedUp ?? 0}</p>
        </div>
        <div className="metric">
          <p className="metric-label">Credits earned</p>
          <p className="metric-value">{dollars(data?.creditsEarnedCents ?? 0)}</p>
        </div>
        <div className="metric">
          <p className="metric-label">Pending</p>
          <p className="metric-value">{dollars(data?.pendingCents ?? 0)}</p>
        </div>
      </div>

      <div className="config-card">
        <h3>Your referral link</h3>
        <p className="helper">Share this link. You earn {rewardPct}% credit when invitees subscribe.</p>
        <div className="copy-row">
          <input className="copy-input mono" readOnly value={link} />
          <button type="button" className="btn-primary" onClick={copy} disabled={!data}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        <p className="helper" style={{ marginTop: '10px' }}>
          Your code: <span className="mono">{code}</span>
        </p>
      </div>

      {/* Real referral activity */}
      <div className="config-card">
        <h3>Recent referrals</h3>
        {data && data.recent.length > 0 ? (
          <table className="profile-table">
            <thead>
              <tr>
                <th>Invitee</th>
                <th>Status</th>
                <th>Reward</th>
                <th>Date</th>
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
            No referrals yet. Share your link above — invitees will appear here as soon as they sign up.
          </p>
        )}
      </div>

      <div className="config-card">
        <h3>How it works</h3>
        <ol className="how-list">
          <li>Share your link with friends and communities.</li>
          <li>They sign up and start a paid plan.</li>
          <li>You earn {rewardPct}% of their first payment as fleet credit.</li>
          <li>Credit applies automatically to your next invoice.</li>
        </ol>
      </div>
    </PageMotion>
  );
}
