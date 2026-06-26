'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Webhook as WebhookIcon, Plus, Radio, Lock, Activity, AlertTriangle, History, Send, Pause, Play, Trash2, RefreshCw, X } from 'lucide-react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, Reveal } from '../../components/hud';

export type Webhook = {
  id: string;
  label: string;
  url: string;
  event: string;
  active: boolean;
  hasSecret: boolean;
  lastFiredAt: string | null;
  failCount: number;
};

type Toast = { kind: 'ok' | 'err'; text: string } | null;

type Delivery = {
  id: string;
  event: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  attempts: number;
  responseCode: number | null;
  error: string | null;
  createdAt: string;
  deliveredAt: string | null;
};

const EVENT_OPTIONS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'Tüm olaylar' },
  { value: 'JOB_COMPLETED', label: 'Görev tamamlandı' },
  { value: 'JOB_FAILED', label: 'Görev başarısız' },
  { value: 'DEVICE_ONLINE', label: 'Cihaz çevrimiçi' },
  { value: 'DEVICE_OFFLINE', label: 'Cihaz çevrimdışı' },
  { value: 'QUOTA_HIGH', label: 'Kota neredeyse dolu' },
  { value: 'ALERT_FIRED', label: 'Uyarı tetiklendi' }
];

export function WebhooksView({ webhooks }: { webhooks: Webhook[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [form, setForm] = useState({ label: '', url: '', event: 'ALL', secret: '' });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);

  function flash(t: Toast) {
    setToast(t);
    setTimeout(() => setToast(null), 3500);
  }

  async function loadDeliveries(hookId: string) {
    setLoadingDeliveries(true);
    try {
      const res = await fetch(`/api/webhooks/${hookId}/deliveries`);
      const json = await res.json();
      setDeliveries(Array.isArray(json.data) ? json.data : []);
    } catch {
      setDeliveries([]);
    } finally {
      setLoadingDeliveries(false);
    }
  }

  function toggleHistory(hookId: string) {
    if (expanded === hookId) {
      setExpanded(null);
      return;
    }
    setExpanded(hookId);
    void loadDeliveries(hookId);
  }

  async function sendTest(hook: Webhook) {
    setBusy(true);
    try {
      const res = await fetch(`/api/webhooks/${hook.id}/test`, { method: 'POST' });
      if (!res.ok) throw new Error(`Test başarısız (${res.status})`);
      flash({ kind: 'ok', text: `"${hook.label}" için test teslimatı kuyruğa alındı.` });
      if (expanded === hook.id) setTimeout(() => void loadDeliveries(hook.id), 800);
    } catch (err) {
      flash({ kind: 'err', text: err instanceof Error ? err.message : 'Test başarısız' });
    } finally {
      setBusy(false);
    }
  }

  async function redeliver(hookId: string, deliveryId: string) {
    try {
      const res = await fetch(`/api/webhooks/deliveries/${deliveryId}/redeliver`, { method: 'POST' });
      if (!res.ok) throw new Error(`Yeniden teslimat başarısız (${res.status})`);
      flash({ kind: 'ok', text: 'Teslimat yeniden kuyruğa alındı.' });
      setTimeout(() => void loadDeliveries(hookId), 800);
    } catch (err) {
      flash({ kind: 'err', text: err instanceof Error ? err.message : 'Yeniden teslimat başarısız' });
    }
  }

  async function create() {
    if (!form.label.trim() || !form.url.trim()) {
      flash({ kind: 'err', text: 'Etiket ve URL zorunludur.' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: form.label.trim(),
          url: form.url.trim(),
          event: form.event,
          ...(form.secret.trim() ? { secret: form.secret.trim() } : {})
        })
      });
      if (!res.ok) throw new Error(`Oluşturma başarısız (${res.status})`);
      setOpen(false);
      setForm({ label: '', url: '', event: 'ALL', secret: '' });
      flash({ kind: 'ok', text: 'Webhook oluşturuldu.' });
      router.refresh();
    } catch (err) {
      flash({ kind: 'err', text: err instanceof Error ? err.message : 'Oluşturma başarısız' });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(hook: Webhook) {
    await fetch(`/api/webhooks/${hook.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !hook.active })
    });
    router.refresh();
  }

  async function remove(hook: Webhook) {
    if (!confirm(`"${hook.label}" webhook'u silinsin mi?`)) return;
    await fetch(`/api/webhooks/${hook.id}`, { method: 'DELETE' });
    router.refresh();
  }

  const total = webhooks.length;
  const activeCount = webhooks.filter((h) => h.active).length;
  const signedCount = webhooks.filter((h) => h.hasSecret).length;
  const failingCount = webhooks.filter((h) => h.failCount > 0).length;

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="WEBHOOK MERKEZİ"
        title="Webhook'lar"
        subtitle="Görevler, cihazlar, kota veya uyarılar değiştiğinde kendi sunucunuzda bildirim alın. İmzalı, yeniden denenir ve teslimat geçmişi tutulur."
        actions={
          <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
            <Plus size={15} /> Yeni webhook
          </button>
        }
      />

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}

      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat label="Toplam kanca" value={<span className="mono">{total}</span>} tone="cyan" icon={<WebhookIcon size={16} />} />
          <HoloStat label="Etkin" value={<span className="mono">{activeCount}</span>} sub={`${total} kancadan`} tone="success" icon={<Radio size={16} />} />
          <HoloStat label="İmzalı (HMAC)" value={<span className="mono">{signedCount}</span>} tone="violet" icon={<Lock size={16} />} />
          <HoloStat label="Hatalı teslimat" value={<span className="mono">{failingCount}</span>} tone={failingCount > 0 ? 'error' : 'accent'} icon={<AlertTriangle size={16} />} />
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <HoloPanel title="Kayıtlı uç noktalar" icon={<Activity size={16} />}>
          <div className="profile-table-wrap">
            <table className="profile-table">
              <thead>
                <tr>
                  <th>Etiket</th>
                  <th>URL</th>
                  <th>Olay</th>
                  <th>İmzalı</th>
                  <th>Son tetiklenme</th>
                  <th>Durum</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {webhooks.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="table-empty">
                        <div className="empty-art">⇲</div>
                        <span>Henüz webhook yok</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  webhooks.map((h) => (
                    <Fragment key={h.id}>
                      <tr>
                        <td>
                          <strong>{h.label}</strong>
                        </td>
                        <td className="mono helper">{h.url}</td>
                        <td>{h.event}</td>
                        <td>{h.hasSecret ? <span className="status-chip"><Lock size={12} /> HMAC</span> : '—'}</td>
                        <td className="mono helper">{h.lastFiredAt ? new Date(h.lastFiredAt).toLocaleString('tr-TR') : 'hiç'}</td>
                        <td>
                          <span className="status-chip">
                            <span className={h.active ? 'dot dot-online' : 'dot dot-offline'} />
                            {h.active ? 'Etkin' : 'Duraklatıldı'}
                            {h.failCount > 0 ? <span className="helper"> · {h.failCount} başarısız</span> : null}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button type="button" className="action-btn" onClick={() => toggleHistory(h.id)}>
                              <History size={13} /> {expanded === h.id ? 'Gizle' : 'Geçmiş'}
                            </button>
                            <button type="button" className="action-btn" disabled={busy} onClick={() => sendTest(h)}>
                              <Send size={13} /> Test
                            </button>
                            <button type="button" className="action-btn" onClick={() => toggle(h)}>
                              {h.active ? <><Pause size={13} /> Duraklat</> : <><Play size={13} /> Sürdür</>}
                            </button>
                            <button type="button" className="action-btn action-danger" onClick={() => remove(h)}>
                              <Trash2 size={13} /> Sil
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded === h.id ? (
                        <tr className="delivery-row">
                          <td colSpan={7}>
                            <div className="delivery-panel">
                              <h4><Activity size={14} /> Son teslimatlar</h4>
                              {loadingDeliveries ? (
                                <p className="helper">Yükleniyor…</p>
                              ) : deliveries.length === 0 ? (
                                <p className="helper">Henüz teslimat yok. Bir tane göndermek için “Test” seçeneğini kullanın.</p>
                              ) : (
                                <table className="delivery-table">
                                  <thead>
                                    <tr>
                                      <th>Olay</th>
                                      <th>Durum</th>
                                      <th>Deneme</th>
                                      <th>Kod</th>
                                      <th>Zaman</th>
                                      <th />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {deliveries.map((d) => (
                                      <tr key={d.id}>
                                        <td className="mono">{d.event}</td>
                                        <td>
                                          <span className={`delivery-badge delivery-${d.status.toLowerCase()}`}>{d.status}</span>
                                        </td>
                                        <td className="mono">{d.attempts}</td>
                                        <td className="mono">{d.responseCode ?? (d.error ? '✕' : '—')}</td>
                                        <td className="mono helper">{new Date(d.createdAt).toLocaleString('tr-TR')}</td>
                                        <td>
                                          {d.status === 'FAILED' ? (
                                            <button type="button" className="action-btn" onClick={() => redeliver(h.id, d.id)}>
                                              <RefreshCw size={13} /> Yeniden teslim et
                                            </button>
                                          ) : null}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </HoloPanel>
      </Reveal>

      {open ? (
        <div className="modal-overlay" onClick={() => !busy && setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><WebhookIcon size={16} /> Yeni webhook</h2>
              <button type="button" className="modal-close" onClick={() => !busy && setOpen(false)}>
                <X size={16} />
              </button>
            </header>
            <label className="field">
              <span>Etiket</span>
              <input className="field-input" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="Sunucum" />
            </label>
            <label className="field">
              <span>Uç nokta URL'si</span>
              <input className="field-input mono" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://example.com/hook" />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Olay</span>
                <select className="field-input" value={form.event} onChange={(e) => setForm((f) => ({ ...f, event: e.target.value }))}>
                  {EVENT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>İmzalama gizli anahtarı (isteğe bağlı)</span>
                <input className="field-input mono" value={form.secret} onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))} placeholder="HMAC gizli anahtarı" />
              </label>
            </div>
            <p className="helper">Bir gizli anahtar ayarlanırsa, her istek bir <span className="mono">X-Fleet-Signature</span> HMAC-SHA256 başlığı içerir.</p>
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={() => !busy && setOpen(false)}>
                İptal
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={create}>
                {busy ? 'Oluşturuluyor…' : 'Webhook oluştur'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </PageMotion>
  );
}
