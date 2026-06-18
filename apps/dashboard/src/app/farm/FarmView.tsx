'use client';

import { useEffect, useState } from 'react';
import { Sprout, Plus, Play, Pause, Trash2, Zap, Clock, Activity } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

type Flow = { id: string; name: string };
type Group = { id: string; name: string };
type Campaign = {
  id: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  rpaFlowId: string | null;
  groupId: string | null;
  minIntervalMin: number;
  maxIntervalMin: number;
  maxActionsPerDay: number;
  activeFromHour: number;
  activeToHour: number;
  jitterPct: number;
  runCount: number;
  lastRunAt: string | null;
  nextRunAt: string;
  deviceCount?: number;
  rpaFlow?: { id: string; name: string } | null;
  group?: { id: string; name: string } | null;
};
type Account = {
  id: string;
  deviceId: string;
  warmupStage: number;
  daysActive: number;
  actionsToday: number;
  totalActions: number;
  healthScore: number;
  lastActionAt: string | null;
  device?: { id: string; name: string; status: string } | null;
};

const STAGE_LABEL = ['—', 'Yeni', 'Isınıyor', 'Gelişiyor', 'Aktif', 'Olgun'];

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'aktif',
  PAUSED: 'duraklatıldı',
  COMPLETED: 'tamamlandı'
};

export function FarmView() {
  const [tab, setTab] = useState<'campaigns' | 'accounts'>('campaigns');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const [form, setForm] = useState({
    name: '',
    rpaFlowId: '',
    groupId: '',
    minIntervalMin: '45',
    maxIntervalMin: '180',
    maxActionsPerDay: '20',
    activeFromHour: '8',
    activeToHour: '23',
    jitterPct: '25'
  });

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 4000);
  }

  async function loadAll() {
    try {
      const [cRes, fRes, gRes, aRes] = await Promise.all([
        fetch('/api/farm/campaigns'),
        fetch('/api/rpa'),
        fetch('/api/groups'),
        fetch('/api/farm/accounts')
      ]);
      const [cJson, fJson, gJson, aJson] = await Promise.all([cRes.json(), fRes.json(), gRes.json(), aRes.json()]);
      if (Array.isArray(cJson.data)) setCampaigns(cJson.data);
      if (Array.isArray(fJson.data)) setFlows(fJson.data);
      if (Array.isArray(gJson.data)) setGroups(gJson.data);
      if (Array.isArray(aJson.data)) setAccounts(aJson.data);
    } catch {
      flash('Çiftlik verileri yüklenemedi.');
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function createCampaign() {
    if (!form.name.trim()) return flash('Kampanya adı gereklidir.');
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        rpaFlowId: form.rpaFlowId || undefined,
        groupId: form.groupId || undefined,
        minIntervalMin: Number(form.minIntervalMin),
        maxIntervalMin: Number(form.maxIntervalMin),
        maxActionsPerDay: Number(form.maxActionsPerDay),
        activeFromHour: Number(form.activeFromHour),
        activeToHour: Number(form.activeToHour),
        jitterPct: Number(form.jitterPct)
      };
      const res = await fetch('/api/farm/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Kampanya oluşturulamadı');
      setCreateOpen(false);
      setForm({ ...form, name: '' });
      flash('Kampanya oluşturuldu ve çalışıyor.');
      await loadAll();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Kampanya oluşturulamadı');
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(c: Campaign) {
    const status = c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setBusy(true);
    try {
      const res = await fetch(`/api/farm/campaigns/${c.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error('Güncellenemedi');
      await loadAll();
    } catch {
      flash('Kampanya güncellenemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Campaign) {
    if (!confirm(`"${c.name}" kampanyası silinsin mi?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/farm/campaigns/${c.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Silinemedi');
      flash('Kampanya silindi.');
      await loadAll();
    } catch {
      flash('Kampanya silinemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    setBusy(true);
    try {
      const res = await fetch('/api/farm/tick', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Motor çalıştırılamadı');
      flash(`Motor çalıştı: ${json.data?.campaigns ?? 0} kampanyada ${json.data?.dispatched ?? 0} işlem gönderildi.`);
      await loadAll();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Motor çalıştırılamadı');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageMotion className="page">
      <PageHeader
        title="Çiftlik"
        subtitle="Cihaz filonuzda insansı, zamanlanmış hesap ısıtma."
        actions={
          <>
            <button type="button" className="btn-ghost" disabled={busy} onClick={runNow} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Zap size={14} /> Motoru şimdi çalıştır
            </button>
            <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14} /> Yeni kampanya
            </button>
          </>
        }
      />

      <div className="tabs">
        <button type="button" className={tab === 'campaigns' ? 'tab tab-active' : 'tab'} onClick={() => setTab('campaigns')}>
          Kampanyalar ({campaigns.length})
        </button>
        <button type="button" className={tab === 'accounts' ? 'tab tab-active' : 'tab'} onClick={() => setTab('accounts')}>
          Isıtma hesapları ({accounts.length})
        </button>
      </div>

      {msg ? <p className="helper" style={{ marginBottom: '0.75rem' }}>{msg}</p> : null}

      {tab === 'campaigns' ? (
        campaigns.length === 0 ? (
          <div className="empty-state">
            <div className="empty-art">🌱</div>
            <h3>Henüz kampanya yok</h3>
            <p>Bir cihaz grubunda insansı bir zamanlamayla RPA akışı çalıştırmak için bir kampanya oluşturun.</p>
          </div>
        ) : (
          <div className="farm-grid">
            {campaigns.map((c) => (
              <article key={c.id} className="farm-card">
                <div className="farm-card-head">
                  <div>
                    <strong className="farm-card-title">{c.name}</strong>
                    <span className={`farm-status farm-status-${c.status.toLowerCase()}`}>{STATUS_LABEL[c.status] ?? c.status.toLowerCase()}</span>
                  </div>
                  <div className="farm-card-actions">
                    <button type="button" className="icon-btn" disabled={busy} onClick={() => toggleStatus(c)} title={c.status === 'ACTIVE' ? 'Duraklat' : 'Devam ettir'}>
                      {c.status === 'ACTIVE' ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                    <button type="button" className="icon-btn danger-btn" disabled={busy} onClick={() => remove(c)} title="Sil">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="farm-card-meta">
                  <span><Sprout size={12} /> {c.rpaFlow?.name ?? <em className="farm-warn">akış yok</em>}</span>
                  <span><Activity size={12} /> {c.group?.name ?? <em className="farm-warn">grup yok</em>} · {c.deviceCount ?? 0} telefon</span>
                  <span><Clock size={12} /> her {c.minIntervalMin}–{c.maxIntervalMin} dk · {c.activeFromHour}:00–{c.activeToHour}:00</span>
                  <span>≤ {c.maxActionsPerDay}/gün · ±%{c.jitterPct} sapma</span>
                  <span className="helper">{c.runCount} çalışma · sıradaki {new Date(c.nextRunAt).toLocaleTimeString('tr-TR')}</span>
                </div>
              </article>
            ))}
          </div>
        )
      ) : (
        accounts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-art">📈</div>
            <h3>Henüz ısıtma verisi yok</h3>
            <p>Bir kampanya cihazlarını işlemeye başladığında hesaplar burada otomatik olarak görünür.</p>
          </div>
        ) : (
          <div className="panel">
            <div className="health-table">
              <div className="health-row health-head" style={{ gridTemplateColumns: '1.4fr 1fr 0.8fr 0.8fr 1fr 0.9fr' }}>
                <span>Cihaz</span><span>Aşama</span><span>Gün</span><span>Bugün</span><span>Toplam</span><span>Sağlık</span>
              </div>
              {accounts.map((a) => (
                <div key={a.id} className="health-row" style={{ gridTemplateColumns: '1.4fr 1fr 0.8fr 0.8fr 1fr 0.9fr' }}>
                  <span className="health-name">{a.device?.name ?? a.deviceId.slice(0, 8)}</span>
                  <span><span className={`farm-stage farm-stage-${a.warmupStage}`}>{STAGE_LABEL[a.warmupStage] ?? a.warmupStage}</span></span>
                  <span>{a.daysActive}</span>
                  <span>{a.actionsToday}</span>
                  <span>{a.totalActions}</span>
                  <span className="health-usage">
                    <span className="health-bar health-bar-sm">
                      <span className={`health-bar-fill ${a.healthScore >= 70 ? 'bar-ok' : a.healthScore >= 40 ? 'bar-warn' : 'bar-bad'}`} style={{ width: `${a.healthScore}%` }} />
                    </span>
                    <span className="health-usage-num mono">{a.healthScore}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      )}

      {createOpen ? (
        <div className="modal-overlay" onClick={() => !busy && setCreateOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head"><h2>Yeni çiftlik kampanyası</h2></header>
            <div className="modal-body farm-form">
              <label className="distribute-field">
                <span className="helper">Kampanya adı</span>
                <input className="field-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="örn. TikTok ısıtma" />
              </label>
              <div className="farm-form-row">
                <label className="distribute-field">
                  <span className="helper">RPA akışı (işlemler)</span>
                  <select className="field-input" value={form.rpaFlowId} onChange={(e) => setForm({ ...form, rpaFlowId: e.target.value })}>
                    <option value="">— akış seçin —</option>
                    {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </label>
                <label className="distribute-field">
                  <span className="helper">Hedef cihaz grubu</span>
                  <select className="field-input" value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
                    <option value="">— grup seçin —</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </label>
              </div>
              <div className="farm-form-row">
                <label className="distribute-field"><span className="helper">Min aralık (dk)</span><input className="field-input" type="number" value={form.minIntervalMin} onChange={(e) => setForm({ ...form, minIntervalMin: e.target.value })} /></label>
                <label className="distribute-field"><span className="helper">Maks aralık (dk)</span><input className="field-input" type="number" value={form.maxIntervalMin} onChange={(e) => setForm({ ...form, maxIntervalMin: e.target.value })} /></label>
              </div>
              <div className="farm-form-row">
                <label className="distribute-field"><span className="helper">Maks işlem / gün</span><input className="field-input" type="number" value={form.maxActionsPerDay} onChange={(e) => setForm({ ...form, maxActionsPerDay: e.target.value })} /></label>
                <label className="distribute-field"><span className="helper">Sapma %</span><input className="field-input" type="number" value={form.jitterPct} onChange={(e) => setForm({ ...form, jitterPct: e.target.value })} /></label>
              </div>
              <div className="farm-form-row">
                <label className="distribute-field"><span className="helper">Başlangıç saati</span><input className="field-input" type="number" min={0} max={23} value={form.activeFromHour} onChange={(e) => setForm({ ...form, activeFromHour: e.target.value })} /></label>
                <label className="distribute-field"><span className="helper">Bitiş saati</span><input className="field-input" type="number" min={1} max={24} value={form.activeToHour} onChange={(e) => setForm({ ...form, activeToHour: e.target.value })} /></label>
              </div>
              <p className="helper">Motor, akışı her aralıkta uygun bir telefonda çalıştırır; günlük sınırı veya cihazın ısıtma aşaması limitini asla aşmaz ve yalnızca aktif saatler içinde çalışır.</p>
            </div>
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={() => setCreateOpen(false)} disabled={busy}>İptal</button>
              <button type="button" className="btn-primary" onClick={createCampaign} disabled={busy || !form.name.trim()}>
                {busy ? 'Oluşturuluyor…' : 'Kampanya oluştur'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </PageMotion>
  );
}
