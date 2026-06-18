'use client';

import { useEffect, useState } from 'react';
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
      if (!res.ok) throw new Error(json.message ?? 'Eşitleme başarısız oldu');
      const r = json.data ?? {};
      flash(`${r.checked ?? 0} örnek eşitlendi · ${r.hostsUpdated ?? 0} ana makine güncellendi · ${r.devicesCreated ?? 0} telefon eklendi`);
      await loadInstances();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Eşitleme başarısız oldu');
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
      if (!res.ok) throw new Error(json.message ?? 'Bağlanılamadı');
      setConfigured(true);
      setApiKeyInput('');
      flash('Vast.ai bağlandı');
      await loadInstances();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Bağlanılamadı');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('Vast.ai hesabınızın bağlantısı kesilsin mi? Saklanan API anahtarı kaldırılacaktır.')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/vast/key', { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Bağlantı kesilemedi');
      }
      setConfigured(false);
      setOffers([]);
      setInstances([]);
      flash('Vast.ai bağlantısı kesildi');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Bağlantı kesilemedi');
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
      if (!res.ok) throw new Error(json.message ?? 'Teklifler yüklenemedi');
      setOffers(Array.isArray(json.data) ? json.data : []);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Teklifler yüklenemedi');
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
      if (!res.ok) throw new Error(json.message ?? 'Sağlanamadı');
      setProvisionTarget(null);
      flash(`Ana makine sağlanıyor… (örnek #${json.data?.instanceId})`);
      await loadInstances();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Sağlanamadı');
    } finally {
      setBusy(false);
    }
  }

  async function destroy(inst: Instance) {
    if (!confirm(`#${inst.id} örneği yok edilsin mi? Bu işlem geri alınamaz ve faturalandırmayı durdurur.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/vast/instances/${inst.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Yok edilemedi');
      }
      flash(`#${inst.id} örneği yok edildi`);
      await loadInstances();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Yok edilemedi');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="panel">
        <h2>
          <Cpu size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> GPU sunucuları (Vast.ai)
        </h2>
        <p className="helper" style={{ marginTop: '-0.25rem' }}>
          GPU tekliflerini aramak ve bir Android emülatör ana makinesi sağlamak için bir Vast.ai hesabı bağlayın.
        </p>

        {configured === null ? (
          <p className="helper" style={{ marginTop: '1rem' }}>Yükleniyor…</p>
        ) : configured ? (
          <div className="row" style={{ marginTop: '1rem' }}>
            <span className="status-chip">
              <span className="dot dot-online" />
              Bağlı
            </span>
            <button type="button" className="btn-ghost danger-btn" disabled={busy} onClick={disconnect}>
              <Power size={15} /> Bağlantıyı kes
            </button>
          </div>
        ) : (
          <div className="admin-form" style={{ marginTop: '1rem' }}>
            <div className="admin-field">
              <label htmlFor="vast-key">API anahtarı</label>
              <input
                id="vast-key"
                type="password"
                className="field-input mono"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="Vast.ai API anahtarı"
              />
            </div>
            <p className="helper">
              API anahtarınızı vast.ai → Account → API Keys bölümünden alın. Şifrelenmiş olarak saklanır ve bir daha gösterilmez.
            </p>
            <button type="button" className="btn-primary" disabled={busy || !apiKeyInput.trim()} onClick={connect}>
              <PlugZap size={15} /> {busy ? 'Bağlanıyor…' : 'Bağlan'}
            </button>
          </div>
        )}

        {msg ? <p className="helper" style={{ marginTop: '0.75rem' }}>{msg}</p> : null}
      </div>

      {configured ? (
        <section className="section-grid">
          <div className="panel">
            <h2>
              <Search size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Ara &amp; sağla
            </h2>
            <p className="helper" style={{ marginTop: '-0.25rem' }}>
              Sağlama işlemi gerçek bir sunucu kiralar ve Vast.ai hesabınızda saatlik ücret oluşturur.
            </p>

            <div className="row" style={{ marginTop: '1rem', gap: '0.5rem', flexWrap: 'wrap' }}>
              <input
                className="field-input"
                type="number"
                step="0.01"
                value={filters.maxPrice}
                onChange={(e) => setFilters((f) => ({ ...f, maxPrice: e.target.value }))}
                placeholder="0.50"
                aria-label="Saatlik maksimum fiyat"
              />
              <input
                className="field-input"
                type="number"
                value={filters.minGpus}
                onChange={(e) => setFilters((f) => ({ ...f, minGpus: e.target.value }))}
                placeholder="Min GPU"
                aria-label="Minimum GPU"
              />
              <button type="button" className="btn-primary" disabled={busy} onClick={searchOffers}>
                <Search size={15} /> {busy ? 'Aranıyor…' : 'Teklifleri ara'}
              </button>
            </div>

            <div className="profile-table-wrap" style={{ marginTop: '1rem' }}>
              <table className="profile-table">
                <thead>
                  <tr>
                    <th>GPU</th>
                    <th>CPU / RAM</th>
                    <th>Disk</th>
                    <th>Bölge</th>
                    <th>Güvenilirlik</th>
                    <th>Fiyat</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {offers.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <div className="table-empty">
                          <div className="empty-art">🖥</div>
                          <span>Kullanılabilir GPU sunucularını görmek için arama yapın.</span>
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
                        <td className="mono">${o.pricePerHour.toFixed(3)}/sa</td>
                        <td>
                          <button type="button" className="btn-ghost" disabled={busy} onClick={() => openProvision(o)}>
                            <Plus size={15} /> Sağla
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
              <h2 style={{ margin: 0 }}>Örnekler</h2>
              <button type="button" className="btn-ghost" disabled={busy} onClick={syncNow} title="Örnekleri ana makineler/cihazlarla eşitle">
                <RefreshCw size={14} /> Şimdi eşitle
              </button>
            </div>
            <p className="helper" style={{ marginTop: '0.35rem' }}>
              Vast.ai hesabınızda çalışan ve sağlanmakta olan ana makineler. Eşitleme, RUNNING durumundaki örnekleri filo ana
              makineleri olarak çevrimiçi hale getirir ve bulut telefonlarını otomatik olarak kaydeder.
            </p>

            <div className="profile-table-wrap" style={{ marginTop: '1rem' }}>
              <table className="profile-table">
                <thead>
                  <tr>
                    <th>Örnek</th>
                    <th>Durum</th>
                    <th>GPU</th>
                    <th>Genel IP</th>
                    <th>SSH</th>
                    <th>Fiyat/sa</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {instances.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <div className="table-empty">
                          <div className="empty-art">⇲</div>
                          <span>Henüz örnek yok.</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    instances.map((inst) => (
                      <tr key={inst.id}>
                        <td>
                          <strong>#{inst.id}</strong>
                          {inst.hostId ? <span className="policy-tag policy-tag-on" style={{ marginLeft: 6 }}>ana makine</span> : null}
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
                        <td className="mono">${inst.pricePerHour.toFixed(3)}/sa</td>
                        <td>
                          <button type="button" className="btn-ghost danger-btn" disabled={busy} onClick={() => destroy(inst)}>
                            <Trash2 size={15} /> Yok et
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
              <h2>Ana makine sağla</h2>
              <button type="button" className="modal-close" onClick={() => !busy && setProvisionTarget(null)}>
                ✕
              </button>
            </header>
            <p className="helper">
              {provisionTarget.gpuName} ×{provisionTarget.numGpus} · ${provisionTarget.pricePerHour.toFixed(3)}/sa ·{' '}
              {provisionTarget.region}
            </p>
            <label className="field">
              <span>Etiket (isteğe bağlı)</span>
              <input
                className="field-input"
                value={provisionLabel}
                onChange={(e) => setProvisionLabel(e.target.value)}
                placeholder="örn. emulator-host-1"
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
              Sağlama işlemi gerçek bir sunucu kiralar ve Vast.ai hesabınızda saatlik ücret oluşturur.
            </p>
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => setProvisionTarget(null)}>
                İptal
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={provision}>
                {busy ? 'Sağlanıyor…' : 'Sağla'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
