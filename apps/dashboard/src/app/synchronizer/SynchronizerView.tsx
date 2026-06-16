'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

export type SyncDevice = {
  id: string;
  name: string;
  status: string;
  androidVersion: string | null;
};

type Toast = { kind: 'ok' | 'err'; text: string } | null;

export function SynchronizerView({ devices }: { devices: SyncDevice[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [leader, setLeader] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  function flash(t: Toast) {
    setToast(t);
    setTimeout(() => setToast(null), 3500);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (leader === id) setLeader(null);
      } else {
        next.add(id);
        if (!leader) setLeader(id);
      }
      return next;
    });
  }

  const selectedList = useMemo(() => devices.filter((d) => selected.has(d.id)), [devices, selected]);
  const canSync = selected.size >= 2 && leader !== null;

  async function startSync() {
    if (!canSync) return;
    setSyncing(true);
    try {
      // Mirror the leader's session across the selected followers by opening
      // each selected phone — real mirroring runs once the KVM host is attached.
      const followers = selectedList.filter((d) => d.id !== leader);
      const results = await Promise.all(
        selectedList.map((d) =>
          fetch('/api/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'EMULATOR_START',
              emulatorId: d.id,
              payload: { syncGroup: leader, role: d.id === leader ? 'leader' : 'follower' }
            })
          })
        )
      );
      const failed = results.filter((r) => !r.ok).length;
      if (failed > 0) {
        flash({ kind: 'err', text: `${failed} job(s) failed to queue.` });
      } else {
        flash({ kind: 'ok', text: `Sync queued: 1 leader + ${followers.length} follower(s).` });
        router.refresh();
      }
    } catch {
      flash({ kind: 'err', text: 'Could not reach the API.' });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <PageMotion className="page">
      <PageHeader
        title="Synchronizer"
        subtitle="Mirror actions from one cloud phone across all others in the group."
        actions={
          <>
            <button type="button" className="btn-ghost" onClick={() => { setSelected(new Set()); setLeader(null); }}>
              Clear
            </button>
            <button type="button" className="btn-primary" disabled={!canSync || syncing} onClick={startSync}>
              {syncing ? 'Starting…' : `Start sync (${selected.size})`}
            </button>
          </>
        }
      />

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}

      {devices.length === 0 ? (
        <div className="empty-state">
          <div className="empty-art">⧉</div>
          <h3>No cloud phones yet</h3>
          <p>Create profiles first, then select two or more here to mirror their inputs.</p>
        </div>
      ) : (
        <>
          <p className="helper" style={{ marginBottom: '14px' }}>
            Select 2+ phones, then mark one as the <strong>leader</strong>. Its inputs mirror to every follower.
          </p>
          <div className="profile-grid">
            {devices.map((d) => {
              const isSel = selected.has(d.id);
              const isLeader = leader === d.id;
              return (
                <article
                  key={d.id}
                  className={`profile-card sync-card${isSel ? ' sync-card-selected' : ''}`}
                  onClick={() => toggle(d.id)}
                >
                  <div className="row">
                    <strong>{d.name}</strong>
                    <span className="status-chip">
                      <span className={d.status === 'ONLINE' ? 'dot dot-online' : 'dot dot-offline'} />
                      {d.status === 'ONLINE' ? 'Running' : 'Stopped'}
                    </span>
                  </div>
                  <div className="helper">Android {d.androidVersion ?? '—'}</div>
                  <div className="row" style={{ marginTop: '10px' }}>
                    <span className="helper">{isSel ? 'Selected' : 'Tap to select'}</span>
                    {isSel && (
                      <button
                        type="button"
                        className={isLeader ? 'btn-primary btn-xs' : 'btn-ghost btn-xs'}
                        onClick={(e) => {
                          e.stopPropagation();
                          setLeader(d.id);
                        }}
                      >
                        {isLeader ? '★ Leader' : 'Set leader'}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </PageMotion>
  );
}
