'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion, StaggerGrid, MotionItem } from '../../components/Motion';

export type Listing = {
  id: string;
  title: string;
  description: string;
  category: string;
  icon: string;
  price: string;
  installs: number;
};

const CATEGORIES = ['All', 'TEMPLATE', 'AUTOMATION', 'INTEGRATION'];
const LABEL: Record<string, string> = { TEMPLATE: 'Template', AUTOMATION: 'Automation', INTEGRATION: 'Integration' };

export function FleetHubView({ listings }: { listings: Listing[] }) {
  const router = useRouter();
  const [cat, setCat] = useState('All');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const filtered = useMemo(() => (cat === 'All' ? listings : listings.filter((l) => l.category === cat)), [listings, cat]);

  async function install(l: Listing) {
    setBusy(l.id);
    try {
      const res = await fetch(`/api/catalog/listings/${l.id}/install`, { method: 'POST' });
      if (!res.ok) throw new Error();
      setToast(`Installed ${l.title}`);
      router.refresh();
    } catch {
      setToast(`Failed to install ${l.title}`);
    } finally {
      setBusy(null);
      setTimeout(() => setToast(null), 2500);
    }
  }

  return (
    <PageMotion className="page">
      <PageHeader
        title="FleetHub"
        subtitle="Marketplace for templates, automations and integrations."
      />

      <div className="tab-row">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className={c === cat ? 'tab tab-active' : 'tab'} onClick={() => setCat(c)}>
            {c === 'All' ? 'All' : LABEL[c]}
          </button>
        ))}
      </div>

      <StaggerGrid className="app-grid">
        {filtered.map((l) => (
          <MotionItem className="app-card" key={l.id}>
            <div className="app-icon">{l.icon}</div>
            <div className="app-body">
              <div className="row">
                <strong>{l.title}</strong>
                <span className="badge">{LABEL[l.category] ?? l.category}</span>
              </div>
              <p className="helper">{l.description}</p>
              <div className="row" style={{ marginTop: '8px' }}>
                <span className="helper mono">↓ {l.installs.toLocaleString()} installs</span>
                <span className="price-tag">{l.price}</span>
              </div>
            </div>
            <button type="button" className="btn-ghost" disabled={busy === l.id} onClick={() => install(l)}>
              {busy === l.id ? '…' : 'Install'}
            </button>
          </MotionItem>
        ))}
      </StaggerGrid>

      {toast ? <div className="toast toast-ok">{toast}</div> : null}
    </PageMotion>
  );
}
