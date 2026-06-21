'use client';

import { useState } from 'react';
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
      flash({ kind: 'err', text: 'Ad ve adres zorunludur.' });
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
      flash({ kind: 'err', text: 'Sunucu kaydedilemedi.' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(h: Host) {
    if (!confirm(`"${h.name}" sunucusu kaldırılsın mı?`)) return;
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
        title="Sunucular"
        subtitle="Bulut telefonlarınızı çalıştıran KVM sunucuları. Bir sunucu kaydedin, ardından üzerinde install.sh dosyasını çalıştırın."
        actions={
          <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
            + Sunucu kaydet
          </button>
        }
      />

      {toast ? <div className={`toast toast-${toast.kind}`}>{toast.text}</div> : null}

      {hosts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-art">🖥</div>
          <h3>Kayıtlı sunucu yok</h3>
          <p>Bir KVM fiziksel sunucusu kaydedin, ardından bulut telefonları çevrimiçi yapmak için yükleyiciyi çalıştırın.</p>
          <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
            + Sunucu kaydet
          </button>
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
                <div><span className="helper">Telefonlar</span><strong>{h.runningPhones}/{h.capacity}</strong></div>
                <div><span className="helper">CPU</span><strong>{h.cpuCores ?? '—'}c</strong></div>
                <div><span className="helper">RAM</span><strong>{h.memoryGb ?? '—'}GB</strong></div>
                <div><span className="helper">KVM</span><strong>{h.kvm ? '✓' : '✕'}</strong></div>
              </div>
              <div className="row">
                <span className="helper">{h.region ?? 'kendi sunucunuz'} · son görülme {h.lastSeenAt ? new Date(h.lastSeenAt).toLocaleTimeString('tr-TR') : 'hiç'}</span>
                <button type="button" className="action-btn action-danger" onClick={() => remove(h)}>Kaldır</button>
              </div>
            </MotionItem>
          ))}
        </StaggerGrid>
      )}

      {open ? (
        <div className="modal-overlay" onClick={() => !busy && closeModal()}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>{agentKey ? 'Sunucu kaydedildi' : 'Sunucu kaydet'}</h2>
              <button type="button" className="modal-close" onClick={() => !busy && closeModal()}>✕</button>
            </header>

            {agentKey ? (
              <>
                <p className="helper">Bu aracı anahtarını şimdi kopyalayın — yalnızca bir kez gösterilir. Sunucuda <span className="mono">FLEET_HOST_KEY</span> olarak ayarlayın.</p>
                <div className="copy-row">
                  <input className="copy-input mono" readOnly value={agentKey} />
                  <button type="button" className="btn-primary" onClick={() => navigator.clipboard?.writeText(agentKey)}>Kopyala</button>
                </div>
                <pre className="job-pre">{`# KVM sunucunuzda:\ncd fleet/deploy/kvm-host\nexport FLEET_HOST_KEY=${agentKey}\nsudo bash install.sh`}</pre>
                <footer className="modal-foot">
                  <button type="button" className="btn-primary" onClick={closeModal}>Tamam</button>
                </footer>
              </>
            ) : (
              <>
                <label className="field">
                  <span>Sunucu adı</span>
                  <input className="field-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="hetzner-ax52-fra" />
                </label>
                <div className="field-row">
                  <label className="field">
                    <span>Adres (IP / sunucu)</span>
                    <input className="field-input mono" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="10.0.0.5" />
                  </label>
                  <label className="field">
                    <span>Bölge</span>
                    <input className="field-input" value={form.region} onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))} placeholder="eu-central" />
                  </label>
                </div>
                <div className="field-row">
                  <label className="field">
                    <span>Kapasite (telefon)</span>
                    <input className="field-input" type="number" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
                  </label>
                  <label className="field">
                    <span>CPU çekirdeği</span>
                    <input className="field-input" type="number" value={form.cpuCores} onChange={(e) => setForm((f) => ({ ...f, cpuCores: e.target.value }))} />
                  </label>
                  <label className="field">
                    <span>RAM (GB)</span>
                    <input className="field-input" type="number" value={form.memoryGb} onChange={(e) => setForm((f) => ({ ...f, memoryGb: e.target.value }))} />
                  </label>
                </div>
                <footer className="modal-foot">
                  <button type="button" className="btn-ghost" onClick={() => !busy && closeModal()}>İptal</button>
                  <button type="button" className="btn-primary" disabled={busy} onClick={register}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</button>
                </footer>
              </>
            )}
          </div>
        </div>
      ) : null}
    </PageMotion>
  );
}
