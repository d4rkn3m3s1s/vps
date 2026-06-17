'use client';

import { useState } from 'react';
import { Button, Input } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion, StaggerGrid, MotionItem } from '../../components/Motion';

export type Host = {
  id: string;
  name: string;
  address: string;
  region: string | null;
  status: string;
  capacity: number;
  runningPhones: number;
  cpuCores: number | null;
  memoryGb: number | null;
  kvm: boolean;
  lastSeenAt: string | null;
};

type Toast = { kind: 'ok' | 'err'; text: string } | null;

function statusDot(s: string): string {
  if (s === 'ONLINE') return 'dot dot-online';
  if (s === 'DEGRADED') return 'dot dot-busy';
  return 'dot dot-offline';
}

export function HostsView({ hosts }: { hosts: Host[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [agentKey, setAgentKey] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', address: '', region: '', capacity: '4', cpuCores: '8', memoryGb: '32' });

  function flash(t: Toast) {
    setToast(t);
    setTimeout(() => setToast(null), 3500);
  }

  async function register() {
    if (!form.name.trim() || !form.address.trim()) {
      flash({ kind: 'err', text: 'Name and address are required.' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/hosts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          address: form.address.trim(),
          region: form.region.trim() || undefined,
          capacity: Number(form.capacity) || 0,
          cpuCores: Number(form.cpuCores) || undefined,
          memoryGb: Number(form.memoryGb) || undefined
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error();
      setAgentKey(json.data?.agentKey ?? null);
      setForm({ name: '', address: '', region: '', capacity: '4', cpuCores: '8', memoryGb: '32' });
      router.refresh();
    } catch {
      flash({ kind: 'err', text: 'Could not register host.' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(h: Host) {
    if (!confirm(`Remove host "${h.name}"?`)) return;
    await fetch(`/api/hosts/${h.id}`, { method: 'DELETE' });
    router.refresh();
  }

  function closeModal() {
    setOpen(false);
    setAgentKey(null);
  }

  return (
    <PageMotion className="page">
      <PageHeader
        title="Hosts"
        subtitle="KVM servers that run your cloud phones. Register a host, then run install.sh on it."
        actions={
          <Button type="button" variant="primary" onPress={() => setOpen(true)}>
            + Register host
          </Button>
        }
      />

      {toast ? <div className={`toast toast-${toast.kind}`}>{toast.text}</div> : null}

      {hosts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-art">🖥</div>
          <h3>No hosts registered</h3>
          <p>Register a KVM bare-metal server, then run the installer to bring cloud phones online.</p>
          <Button type="button" variant="primary" onPress={() => setOpen(true)}>
            + Register host
          </Button>
        </div>
      ) : (
        <StaggerGrid className="app-grid">
          {hosts.map((h) => (
            <MotionItem className="host-card" key={h.id}>
              <div className="row">
                <strong>{h.name}</strong>
                <span className="status-chip"><span className={statusDot(h.status)} /> {h.status}</span>
              </div>
              <div className="helper mono">{h.address}</div>
              <div className="host-stats">
                <div><span className="helper">Phones</span><strong>{h.runningPhones}/{h.capacity}</strong></div>
                <div><span className="helper">CPU</span><strong>{h.cpuCores ?? '—'}c</strong></div>
                <div><span className="helper">RAM</span><strong>{h.memoryGb ?? '—'}GB</strong></div>
                <div><span className="helper">KVM</span><strong>{h.kvm ? '✓' : '✕'}</strong></div>
              </div>
              <div className="row">
                <span className="helper">{h.region ?? 'self-hosted'} · seen {h.lastSeenAt ? new Date(h.lastSeenAt).toLocaleTimeString('tr-TR') : 'never'}</span>
                <Button type="button" variant="danger" size="sm" onPress={() => remove(h)}>Remove</Button>
              </div>
            </MotionItem>
          ))}
        </StaggerGrid>
      )}

      {open ? (
        <div className="modal-overlay" onClick={() => !busy && closeModal()}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>{agentKey ? 'Host registered' : 'Register host'}</h2>
              <Button type="button" className="modal-close" variant="ghost" isIconOnly onPress={() => !busy && closeModal()}>✕</Button>
            </header>

            {agentKey ? (
              <>
                <p className="helper">Copy this agent key now — it is shown only once. Set it as <span className="mono">FLEET_HOST_KEY</span> on the host.</p>
                <div className="copy-row">
                  <Input className="copy-input mono" readOnly value={agentKey} />
                  <Button type="button" variant="primary" onPress={() => navigator.clipboard?.writeText(agentKey)}>Copy</Button>
                </div>
                <pre className="job-pre">{`# On your KVM server:\ncd fleet/deploy/kvm-host\nexport FLEET_HOST_KEY=${agentKey}\nsudo bash install.sh`}</pre>
                <footer className="modal-foot">
                  <Button type="button" variant="primary" onPress={closeModal}>Done</Button>
                </footer>
              </>
            ) : (
              <>
                <label className="field">
                  <span>Host name</span>
                  <Input className="field-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="hetzner-ax52-fra" />
                </label>
                <div className="field-row">
                  <label className="field">
                    <span>Address (IP / host)</span>
                    <Input className="field-input mono" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="10.0.0.5" />
                  </label>
                  <label className="field">
                    <span>Region</span>
                    <Input className="field-input" value={form.region} onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))} placeholder="eu-central" />
                  </label>
                </div>
                <div className="field-row">
                  <label className="field">
                    <span>Capacity (phones)</span>
                    <Input className="field-input" type="number" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
                  </label>
                  <label className="field">
                    <span>CPU cores</span>
                    <Input className="field-input" type="number" value={form.cpuCores} onChange={(e) => setForm((f) => ({ ...f, cpuCores: e.target.value }))} />
                  </label>
                  <label className="field">
                    <span>RAM (GB)</span>
                    <Input className="field-input" type="number" value={form.memoryGb} onChange={(e) => setForm((f) => ({ ...f, memoryGb: e.target.value }))} />
                  </label>
                </div>
                <footer className="modal-foot">
                  <Button type="button" variant="ghost" onPress={() => !busy && closeModal()}>Cancel</Button>
                  <Button type="button" variant="primary" isDisabled={busy} onPress={register}>{busy ? 'Registering…' : 'Register'}</Button>
                </footer>
              </>
            )}
          </div>
        </div>
      ) : null}
    </PageMotion>
  );
}
