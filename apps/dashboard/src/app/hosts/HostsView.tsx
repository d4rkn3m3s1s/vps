'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Server, Plus, Trash2, Cpu, MemoryStick, Smartphone, ShieldCheck, MapPin, Activity, Copy, Terminal, X } from 'lucide-react';
import { HoloHeader, HoloPanel, HoloStat, Holo3D, Reveal } from '../../components/hud';

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

const STATUS_LABEL: Record<string, string> = { ONLINE: 'Çevrimiçi', DEGRADED: 'Sınırlı', OFFLINE: 'Çevrimdışı' };

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
  const [confirmHost, setConfirmHost] = useState<Host | null>(null);
  const [removing, setRemoving] = useState(false);
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

  async function confirmRemove() {
    if (!confirmHost) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/hosts/${confirmHost.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setConfirmHost(null);
      router.refresh();
    } catch {
      flash({ kind: 'err', text: 'Sunucu kaldırılamadı.' });
    } finally {
      setRemoving(false);
    }
  }

  function closeModal() {
    setOpen(false);
    setAgentKey(null);
  }

  const online = hosts.filter((h) => h.status === 'ONLINE').length;
  const totalCapacity = hosts.reduce((s, h) => s + (h.capacity || 0), 0);
  const totalRunning = hosts.reduce((s, h) => s + (h.runningPhones || 0), 0);

  return (
    <div className="page">
      <HoloHeader
        eyebrow="ALTYAPI · KVM FİLOSU"
        title="Sunucular"
        subtitle="Bulut telefonlarınızı çalıştıran KVM sunucuları. Bir sunucu kaydedin, ardından üzerinde install.sh dosyasını çalıştırın."
        actions={
          <button type="button" className="btn-primary" onClick={() => setOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Plus size={15} /> Sunucu kaydet
          </button>
        }
      />

      {toast ? <div className={`toast toast-${toast.kind}`}>{toast.text}</div> : null}

      <div className="holo-stats-grid">
        <HoloStat label="Sunucu" value={<span className="mono">{hosts.length}</span>} sub="kayıtlı toplam" tone="cyan" icon={<Server size={16} />} />
        <HoloStat label="Çevrimiçi" value={<span className="mono">{online}</span>} sub={`${hosts.length} sunucudan`} tone="success" icon={<Activity size={16} />} />
        <HoloStat label="Çalışan telefon" value={<span className="mono">{totalRunning}</span>} sub="aktif örnek" tone="cyan" icon={<Smartphone size={16} />} />
        <HoloStat label="Toplam kapasite" value={<span className="mono">{totalCapacity}</span>} sub="telefon yuvası" tone="violet" icon={<Cpu size={16} />} />
      </div>

      {hosts.length === 0 ? (
        <HoloPanel title="Kayıtlı sunucu yok" icon={<Server size={16} />} scan>
          <div className="empty-state">
            <div className="empty-art"><Server size={40} strokeWidth={1.4} /></div>
            <h3>Kayıtlı sunucu yok</h3>
            <p>Bir KVM fiziksel sunucusu kaydedin, ardından bulut telefonları çevrimiçi yapmak için yükleyiciyi çalıştırın.</p>
            <button type="button" className="btn-primary" onClick={() => setOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plus size={15} /> Sunucu kaydet
            </button>
          </div>
        </HoloPanel>
      ) : (
        <div className="holo-grid-auto">
          {hosts.map((h, i) => (
            <Reveal key={h.id} delay={i * 0.04}>
              <Holo3D className="holo-panel host-card" max={5}>
                <span className="holo-corner holo-corner-tl" aria-hidden />
                <span className="holo-corner holo-corner-tr" aria-hidden />
                <span className="holo-corner holo-corner-bl" aria-hidden />
                <span className="holo-corner holo-corner-br" aria-hidden />
                <div className="holo-panel-body">
                  <div className="row">
                    <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Server size={15} /> {h.name}</strong>
                    <span className="status-chip"><span className={statusDot(h.status)} /> {STATUS_LABEL[h.status] ?? h.status}</span>
                  </div>
                  <div className="helper mono">{h.address}</div>
                  <div className="host-stats">
                    <div><span className="helper"><Smartphone size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />Telefonlar</span><strong className="mono">{h.runningPhones}/{h.capacity}</strong></div>
                    <div><span className="helper"><Cpu size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />CPU</span><strong className="mono">{h.cpuCores ?? '—'}c</strong></div>
                    <div><span className="helper"><MemoryStick size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />RAM</span><strong className="mono">{h.memoryGb ?? '—'}GB</strong></div>
                    <div><span className="helper"><ShieldCheck size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />KVM</span><strong className={h.kvm ? 'form-status--ok' : 'form-status--err'}>{h.kvm ? 'Var' : 'Yok'}</strong></div>
                  </div>
                  <div className="row">
                    <span className="helper" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <MapPin size={11} /> {h.region ?? 'kendi sunucunuz'} · son görülme {h.lastSeenAt ? new Date(h.lastSeenAt).toLocaleTimeString('tr-TR') : 'hiç'}
                    </span>
                    <button type="button" className="action-btn action-danger" onClick={() => setConfirmHost(h)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <Trash2 size={13} /> Kaldır
                    </button>
                  </div>
                </div>
              </Holo3D>
            </Reveal>
          ))}
        </div>
      )}

      {open ? (
        <div className="modal-overlay" onClick={() => !busy && closeModal()}>
          <div className="modal holo-panel" onClick={(e) => e.stopPropagation()}>
            <span className="holo-corner holo-corner-tl" aria-hidden />
            <span className="holo-corner holo-corner-tr" aria-hidden />
            <span className="holo-corner holo-corner-bl" aria-hidden />
            <span className="holo-corner holo-corner-br" aria-hidden />
            <header className="modal-head">
              <h2 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {agentKey ? <ShieldCheck size={18} /> : <Server size={18} />}
                {agentKey ? 'Sunucu kaydedildi' : 'Sunucu kaydet'}
              </h2>
              <button type="button" className="modal-close" onClick={() => !busy && closeModal()}><X size={16} /></button>
            </header>

            {agentKey ? (
              <>
                <p className="helper">Bu aracı anahtarını şimdi kopyalayın — yalnızca bir kez gösterilir. Sunucuda <span className="mono">FLEET_HOST_KEY</span> olarak ayarlayın.</p>
                <div className="copy-row">
                  <input className="copy-input mono" readOnly value={agentKey} aria-label="Aracı anahtarı" />
                  <button type="button" className="btn-primary" onClick={() => navigator.clipboard?.writeText(agentKey)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Copy size={14} /> Kopyala
                  </button>
                </div>
                <pre className="job-pre"><Terminal size={13} style={{ verticalAlign: 'middle', marginRight: 6, opacity: 0.7 }} />{`# KVM sunucunuzda:\ncd fleet/deploy/kvm-host\nexport FLEET_HOST_KEY=${agentKey}\nsudo bash install.sh`}</pre>
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
                    <input className="field-input mono" type="number" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
                  </label>
                  <label className="field">
                    <span>CPU çekirdeği</span>
                    <input className="field-input mono" type="number" value={form.cpuCores} onChange={(e) => setForm((f) => ({ ...f, cpuCores: e.target.value }))} />
                  </label>
                  <label className="field">
                    <span>RAM (GB)</span>
                    <input className="field-input mono" type="number" value={form.memoryGb} onChange={(e) => setForm((f) => ({ ...f, memoryGb: e.target.value }))} />
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

      {confirmHost ? (
        <div className="modal-overlay" onClick={() => !removing && setConfirmHost(null)}>
          <div className="modal holo-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <span className="holo-corner holo-corner-tl" aria-hidden />
            <span className="holo-corner holo-corner-tr" aria-hidden />
            <span className="holo-corner holo-corner-bl" aria-hidden />
            <span className="holo-corner holo-corner-br" aria-hidden />
            <header className="modal-head">
              <h2 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Trash2 size={18} /> Sunucuyu kaldır
              </h2>
              <button type="button" className="modal-close" onClick={() => !removing && setConfirmHost(null)}><X size={16} /></button>
            </header>
            <p className="helper">&quot;{confirmHost.name}&quot; sunucusu kaldırılsın mı? Bu işlem geri alınamaz.</p>
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={() => !removing && setConfirmHost(null)}>İptal</button>
              <button type="button" className="btn-primary" disabled={removing} onClick={confirmRemove}>{removing ? 'Kaldırılıyor…' : 'Kaldır'}</button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
