'use client';

import { useState } from 'react';
import { Button, Input } from '@heroui/react';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

export function ReferralView({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const link = `https://app.vpsfleet.io/r/${code}`;

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
          <p className="metric-value">0</p>
        </div>
        <div className="metric">
          <p className="metric-label">Signed up</p>
          <p className="metric-value">0</p>
        </div>
        <div className="metric">
          <p className="metric-label">Credits earned</p>
          <p className="metric-value">$0</p>
        </div>
        <div className="metric">
          <p className="metric-label">Pending</p>
          <p className="metric-value">$0</p>
        </div>
      </div>

      <div className="config-card">
        <h3>Your referral link</h3>
        <p className="helper">Share this link. You earn 20% credit when invitees subscribe.</p>
        <div className="copy-row">
          <Input className="copy-input mono" readOnly value={link} />
          <Button type="button" variant="primary" className="btn-primary" onPress={copy}>
            {copied ? '✓ Copied' : 'Copy'}
          </Button>
        </div>
        <p className="helper" style={{ marginTop: '10px' }}>
          Your code: <span className="mono">{code}</span>
        </p>
      </div>

      <div className="config-card">
        <h3>How it works</h3>
        <ol className="how-list">
          <li>Share your link with friends and communities.</li>
          <li>They sign up and start a paid plan.</li>
          <li>You earn 20% of their first payment as fleet credit.</li>
          <li>Credit applies automatically to your next invoice.</li>
        </ol>
      </div>
    </PageMotion>
  );
}
