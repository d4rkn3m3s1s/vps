'use client';

import { useEffect, useState } from 'react';
import { Button, Input } from '@heroui/react';
import { Cpu, Search, Plus, Trash2, Power, PlugZap, RefreshCw } from 'lucide-react';

type Offer = {
  id: number;
  gpuName: string;
  numGpus: number;
  cpuCores: number;
  ramGb: number;
  diskGb: number;
  pricePerHour: number;
  region: string;
  reliability: number;
  cudaVersion: string;
};

type Instance = {
  id: number;
  status: string;
  gpuName: string;
  pricePerHour: number;
  publicIp: string | null;
  sshHost: string | null;
  sshPort: number | null;
  image: string;
  hostId: string | null;
};

export default function ServersPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [offers, setOffers] = useState<Offer[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [filters, setFilters] = useState<{ maxPrice: string; minGpus: string }>({ maxPrice: '', minGpus: '' });
  const [provisionTarget, setProvisionTarget] = useState<Offer | null>(null);
  const [provisionLabel, setProvisionLabel] = useState('');
  const [provisionDisk, setProvisionDisk] = useState('32');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 3000);
  }

  async function loadStatus() {
    try {
      const res = await fetch('/api/vast/status');
      const json = await res.json();
      const ok = Boolean(json.data?.configured);
      setConfigured(ok);
      if (ok) void loadInstances();
    } catch {
      setConfigured(false);
    }
  }

  async function loadInstances() {
    try {
      const res = await fetch('/api/vast/instances');
      const json = await res.json();
      setInstances(Array.isArray(json.data) ? json.data : []);
    } catch {
      setInstances([]);
    }
  }

  async function syncNow() {
    setBusy(true);
    try {
      const res = await fetch('/api/vast/sync', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Sync failed');
      const r = json.data ?? {};
      flash(`Synced ${r.checked ?? 0} instance(s) · ${r.hostsUpdated ?? 0} host(s) updated · ${r.devicesCreated ?? 0} phone(s) added`);
      await loadInstances();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  async function connect() {
    if (!apiKeyInput.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/vast/key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKeyInput.trim() })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Could not connect');
      setConfigured(true);
      setApiKeyInput('');
      flash('Vast.ai connected');
      await loadInstances();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not connect');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect your Vast.ai account? The stored API key will be removed.')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/vast/key', { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Could not disconnect');
      }
      setConfigured(false);
      setOffers([]);
      setInstances([]);
      flash('Vast.ai disconnected');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not disconnect');
    } finally {
      setBusy(false);
    }
  }

  async function searchOffers() {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (filters.maxPrice.trim()) params.set('maxPrice', filters.maxPrice.trim());
      if (filters.minGpus.trim()) params.set('minGpus', filters.minGpus.trim());
      const qs = params.toString();
      const res = await fetch(`/api/vast/offers${qs ? `?${qs}` : ''}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Could not load offers');
      setOffers(Array.isArray(json.data) ? json.data : []);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not load offers');
    } finally {
      setBusy(false);
    }
  }

  function openProvision(offer: Offer) {
    setProvisionTarget(offer);
    setProvisionLabel('');
    setProvisionDisk('32');
  }

  async function provision() {
    if (!provisionTarget) return;
    setBusy(true);
    try {
      const diskNum = Number(provisionDisk);
      const body: { offerId: number; label?: string; diskGb?: number } = { offerId: provisionTarget.id };
      if (provisionLabel.trim()) body.label = provisionLabel.trim();
      if (provisionDisk.trim() && Number.isFinite(diskNum) && diskNum > 0) body.diskGb = diskNum;
      const res = await fetch('/api/vast/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Could not provision');
      setProvisionTarget(null);
      flash(`Host provisioning… (instance #${json.data?.instanceId})`);
      await loadInstances();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not provision');
    } finally {
      setBusy(false);
    }
  }

  async function destroy(inst: Instance) {
    if (!confirm(`Destroy instance #${inst.id}? This is irreversible and stops billing.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/vast/instances/${inst.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Could not destroy');
      }
      flash(`Instance #${inst.id} destroyed`);
      await loadInstances();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not destroy');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="panel">
        <h2>
          <Cpu size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> GPU servers (Vast.ai)
        </h2>
        <p className="helper" style={{ marginTop: '-0.25rem' }}>
          Connect a Vast.ai account to search GPU offers and provision an Android-emulator host.
        </p>

        {configured === null ? (
          <p className="helper" style={{ marginTop: '1rem' }}>Loading…</p>
        ) : configured ? (
          <div className="row" style={{ marginTop: '1rem' }}>
            <span className="status-chip">
              <span className="dot dot-online" />
              Connected
            </span>
            <Button variant="danger" size="sm" isDisabled={busy} onPress={disconnect}>
              <Power size={15} /> Disconnect
            </Button>
          </div>
        ) : (
          <div className="admin-form" style={{ marginTop: '1rem' }}>
            <div className="admin-field">
              <label htmlFor="vast-key">API key</label>
              <Input
                id="vast-key"
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="Vast.ai API key"
              />
            </div>
            <p className="helper">
              Get your API key from vast.ai → Account → API Keys. It&apos;s stored encrypted and never shown again.
            </p>
            <Button variant="primary" isDisabled={busy || !apiKeyInput.trim()} isPending={busy} onPress={connect}>
              <PlugZap size={15} /> {busy ? 'Connecting…' : 'Connect'}
            </Button>
          </div>
        )}

        {msg ? <p className="helper" style={{ marginTop: '0.75rem' }}>{msg}</p> : null}
      </div>

      {configured ? (
        <section className="section-grid">
          <div className="panel">
            <h2>
              <Search size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Search &amp; provision
            </h2>
            <p className="helper" style={{ marginTop: '-0.25rem' }}>
              Provisioning rents a real server and incurs hourly charges on your Vast.ai account.
            </p>

            <div className="row" style={{ marginTop: '1rem', gap: '0.5rem', flexWrap: 'wrap' }}>
              <input
                className="field-input"
                type="number"
                step="0.01"
                value={filters.maxPrice}
                onChange={(e) => setFilters((f) => ({ ...f, maxPrice: e.target.value }))}
                placeholder="0.50"
                aria-label="Max price per hour"
              />
              <input
                className="field-input"
                type="number"
                value={filters.minGpus}
                onChange={(e) => setFilters((f) => ({ ...f, minGpus: e.target.value }))}
                placeholder="Min GPUs"
                aria-label="Minimum GPUs"
              />
              <button type="button" className="btn-primary" disabled={busy} onClick={searchOffers}>
                <Search size={15} /> {busy ? 'Searching…' : 'Search offers'}
              </button>
            </div>

            <div className="profile-table-wrap" style={{ marginTop: '1rem' }}>
              <table className="profile-table">
                <thead>
                  <tr>
                    <th>GPU</th>
                    <th>CPU / RAM</th>
                    <th>Disk</th>
                    <th>Region</th>
                    <th>Reliability</th>
                    <th>Price</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {offers.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <div className="table-empty">
                          <div className="empty-art">🖥</div>
                          <span>Search to see available GPU servers.</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    offers.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <strong>{o.gpuName}</strong> ×{o.numGpus}
                        </td>
                        <td className="mono helper">
                          {o.cpuCores} c / {o.ramGb} GB
                        </td>
                        <td className="mono helper">{o.diskGb} GB</td>
                        <td>{o.region}</td>
                        <td>{Math.round(o.reliability * 100)}%</td>
                        <td className="mono">${o.pricePerHour.toFixed(3)}/hr</td>
                        <td>
                          <button type="button" className="btn-ghost" disabled={busy} onClick={() => openProvision(o)}>
                            <Plus size={15} /> Provision
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <div className="row" style={{ alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Instances</h2>
              <button type="button" className="btn-ghost" disabled={busy} onClick={syncNow} title="Reconcile instances with hosts/devices">
                <RefreshCw size={14} /> Sync now
              </button>
            </div>
            <p className="helper" style={{ marginTop: '0.35rem' }}>
              Running and provisioning hosts on your Vast.ai account. Sync brings RUNNING instances online as fleet hosts
              and registers their cloud phone automatically.
            </p>

            <div className="profile-table-wrap" style={{ marginTop: '1rem' }}>
              <table className="profile-table">
                <thead>
                  <tr>
                    <th>Instance</th>
                    <th>Status</th>
                    <th>GPU</th>
                    <th>Public IP</th>
                    <th>SSH</th>
                    <th>Price/hr</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {instances.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <div className="table-empty">
                          <div className="empty-art">⇲</div>
                          <span>No instances yet.</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    instances.map((inst) => (
                      <tr key={inst.id}>
                        <td>
                          <strong>#{inst.id}</strong>
                          {inst.hostId ? <span className="policy-tag policy-tag-on" style={{ marginLeft: 6 }}>host</span> : null}
                        </td>
                        <td>
                          <span className="status-chip">
                            <span className={inst.status.includes('running') ? 'dot dot-online' : 'dot dot-offline'} />
                            {inst.status}
                          </span>
                        </td>
                        <td>{inst.gpuName}</td>
                        <td className="mono helper">{inst.publicIp ?? '—'}</td>
                        <td className="mono helper">
                          {inst.sshHost ? `${inst.sshHost}:${inst.sshPort ?? ''}` : '—'}
                        </td>
                        <td className="mono">${inst.pricePerHour.toFixed(3)}/hr</td>
                        <td>
                          <button type="button" className="btn-ghost danger-btn" disabled={busy} onClick={() => destroy(inst)}>
                            <Trash2 size={15} /> Destroy
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {provisionTarget ? (
        <div className="modal-overlay" onClick={() => !busy && setProvisionTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>Provision host</h2>
              <button type="button" className="modal-close" onClick={() => !busy && setProvisionTarget(null)}>
                ✕
              </button>
            </header>
            <p className="helper">
              {provisionTarget.gpuName} ×{provisionTarget.numGpus} · ${provisionTarget.pricePerHour.toFixed(3)}/hr ·{' '}
              {provisionTarget.region}
            </p>
            <label className="field">
              <span>Label (optional)</span>
              <input
                className="field-input"
                value={provisionLabel}
                onChange={(e) => setProvisionLabel(e.target.value)}
                placeholder="e.g. emulator-host-1"
              />
            </label>
            <label className="field">
              <span>Disk (GB)</span>
              <input
                className="field-input"
                type="number"
                value={provisionDisk}
                onChange={(e) => setProvisionDisk(e.target.value)}
                placeholder="32"
              />
            </label>
            <p className="helper">
              Provisioning rents a real server and incurs hourly charges on your Vast.ai account.
            </p>
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => setProvisionTarget(null)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={provision}>
                {busy ? 'Provisioning…' : 'Provision'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
