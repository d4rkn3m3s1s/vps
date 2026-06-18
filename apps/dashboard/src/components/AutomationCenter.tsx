'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Pencil, Workflow } from 'lucide-react';

export type AutomationWorkflow = {
  id: string;
  name: string;
  kind: 'rpa' | 'schedule';
  status: 'ACTIVE' | 'PAUSED' | 'IDLE';
  devices: number;
  successRate: number;
  lastRun: string | null;
  editHref: string;
};

function statusTone(status: AutomationWorkflow['status']): string {
  if (status === 'ACTIVE') return 'wf-status-active';
  if (status === 'PAUSED') return 'wf-status-paused';
  return 'wf-status-idle';
}

export function AutomationCenter({ workflows }: { workflows: AutomationWorkflow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  // Run an RPA flow for real; schedule toggles are surfaced as info (managed on
  // the Scheduler page). Either way we report what happened — no fake success.
  async function run(wf: AutomationWorkflow) {
    if (wf.kind !== 'rpa') {
      flash('Schedules are managed on the Scheduler page.');
      router.push('/scheduler');
      return;
    }
    setBusy(wf.id);
    try {
      const res = await fetch(`/api/rpa/${wf.id}/run`, { method: 'POST' });
      flash(res.ok ? `${wf.name} queued` : 'Run failed');
      router.refresh();
    } catch {
      flash('Run failed');
    } finally {
      setBusy(null);
    }
  }

  if (workflows.length === 0) {
    return (
      <div className="wf-empty">
        <Workflow size={20} />
        <span>No automations yet.</span>
        <a href="/rpa" className="btn-primary">Create one</a>
      </div>
    );
  }

  return (
    <>
      {toast ? <div className="toast toast-ok">{toast}</div> : null}
      <div className="wf-grid">
        {workflows.map((wf) => (
          <article className="wf-card" key={`${wf.kind}-${wf.id}`}>
            <header className="wf-card-head">
              <div className="wf-card-title">
                <span className="wf-ico"><Workflow size={16} /></span>
                <div>
                  <strong>{wf.name}</strong>
                  <span className="wf-kind">{wf.kind === 'rpa' ? 'RPA Flow' : 'Scheduled'}</span>
                </div>
              </div>
              <span className={`wf-status ${statusTone(wf.status)}`}>{wf.status}</span>
            </header>

            <div className="wf-stats">
              <div><span className="wf-stat-v">{wf.devices}</span><span className="wf-stat-l">Devices</span></div>
              <div><span className="wf-stat-v">{wf.successRate}%</span><span className="wf-stat-l">Success</span></div>
              <div>
                <span className="wf-stat-v">{wf.lastRun ? new Date(wf.lastRun).toLocaleDateString('tr-TR') : '—'}</span>
                <span className="wf-stat-l">Last run</span>
              </div>
            </div>

            <div className="wf-actions">
              <button type="button" className="wf-btn" disabled={busy === wf.id} onClick={() => run(wf)} title="Run now">
                <Play size={15} /> Run now
              </button>
              <a className="wf-btn" href={wf.editHref} title="Edit">
                <Pencil size={15} /> Edit
              </a>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
