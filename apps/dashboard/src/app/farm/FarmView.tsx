'use client';

import { useEffect, useRef, useState } from 'react';
import { Sprout, Plus, Play, Pause, Trash2, Zap, Clock, Activity, Upload, ShieldAlert, RotateCw, KeyRound, FileDown, History, ShieldCheck, Search, TrendingUp, Globe, Copy, Tag, Siren, HeartPulse, Megaphone } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion, StaggerGrid, MotionItem, AnimatedNumber } from '../../components/Motion';

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
  rotateProxy: boolean;
  autoPauseThreshold: number;
  earlyFlowId: string | null;
  midFlowId: string | null;
  matureFlowId: string | null;
  runCount: number;
  lastRunAt: string | null;
  nextRunAt: string;
  deviceCount?: number;
  rpaFlow?: { id: string; name: string } | null;
  earlyFlow?: { id: string; name: string } | null;
  midFlow?: { id: string; name: string } | null;
  matureFlow?: { id: string; name: string } | null;
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
  paused: boolean;
  pausedReason: string | null;
  lastActionAt: string | null;
  platform: string | null;
  username: string | null;
  emailAddress: string | null;
  notes: string | null;
  tags: string[];
  hasPassword: boolean;
  hasEmailPassword: boolean;
  hasTotp: boolean;
  device?: { id: string; name: string; status: string } | null;
};
type ActionLog = {
  id: string;
  kind: string;
  detail: string | null;
  flowName: string | null;
  warmupStage: number;
  healthAfter: number | null;
  createdAt: string;
};
type Summary = {
  campaigns: { total: number; active: number };
  accounts: { total: number; paused: number; atRisk: number; avgHealth: number };
  actions: { today: number; total: number };
  proxies: { total: number; healthy: number; failed: number; unknown: number };
  stageDistribution: number[];
  risk: { high: number; medium: number };
  topActive: { deviceId: string; totalActions: number; healthScore: number }[];
  atRiskList: { deviceId: string; healthScore: number; paused: boolean; pausedReason: string | null }[];
};
type RiskFactor = { code: string; label: string; weight: number };
type Risk = {
  deviceId: string;
  deviceName: string | null;
  score: number;
  band: 'low' | 'medium' | 'high';
  factors: RiskFactor[];
  paused: boolean;
  healthScore: number;
  warmupStage: number;
};
type TrendPoint = { at: string; health: number; kind: string };

const STAGE_LABEL = ['—', 'Yeni', 'Isınıyor', 'Gelişiyor', 'Aktif', 'Olgun'];

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'aktif',
  PAUSED: 'duraklatıldı',
  COMPLETED: 'tamamlandı'
};

const KIND_LABEL: Record<string, string> = {
  dispatch: 'Akış gönderildi',
  success: 'Başarılı',
  failure: 'Başarısız',
  paused: 'Otomatik duraklatıldı',
  resumed: 'Devam ettirildi',
  proxy_rotated: 'Proxy döndürüldü',
  risk_alert: 'Ban riski uyarısı',
  manual: 'Manuel değişiklik'
};

// Circular ban-risk gauge. Pure SVG (no deps): a track ring + a band-coloured
// progress arc that fills proportional to the 0–100 score, with the number in
// the centre. The arc animates in via stroke-dashoffset (CSS transition).
function RiskGauge({ score, band, size = 46 }: { score: number; band: 'low' | 'medium' | 'high'; size?: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const stroke = size <= 48 ? 4 : 5;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - clamped / 100);
  return (
    <span className={`risk-gauge risk-gauge-${band}`} style={{ width: size, height: size }} title={`Risk skoru: ${clamped}/100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="risk-gauge-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className="risk-gauge-arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="risk-gauge-num">{clamped}</span>
    </span>
  );
}

// Larger health gauge for the overview hero metric. Higher = healthier, so the
// band flips vs. risk: green high, amber mid, red low.
function HealthGauge({ value, size = 92 }: { value: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const band = clamped >= 70 ? 'low' : clamped >= 40 ? 'medium' : 'high'; // reuse risk colour classes (low=green)
  const stroke = 7;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - clamped / 100);
  return (
    <span className={`risk-gauge risk-gauge-${band} health-gauge`} style={{ width: size, height: size }} title={`Ortalama sağlık: ${clamped}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="risk-gauge-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className="risk-gauge-arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="health-gauge-center">
        <strong><AnimatedNumber value={clamped} format={false} />%</strong>
        <span className="health-gauge-cap">sağlık</span>
      </span>
    </span>
  );
}

export function FarmView() {
  const [tab, setTab] = useState<'overview' | 'campaigns' | 'accounts'>('overview');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [risk, setRisk] = useState<Risk[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Credential / timeline drawer for a single account.
  const [acctOpen, setAcctOpen] = useState<Account | null>(null);
  const [acctLog, setAcctLog] = useState<ActionLog[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [totp, setTotp] = useState<{ code: string; secondsRemaining: number } | null>(null);
  const [cred, setCred] = useState({
    platform: '', username: '', emailAddress: '', password: '', emailPassword: '', totpSecret: '', notes: '', tags: ''
  });

  // Accounts filtering + bulk selection.
  const [filterText, setFilterText] = useState('');
  const [filterPlatform, setFilterPlatform] = useState('');
  const [filterHealth, setFilterHealth] = useState(''); // '' | 'risk' | 'paused' | 'healthy'
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTags, setBulkTags] = useState('');

  const [form, setForm] = useState({
    name: '',
    rpaFlowId: '',
    groupId: '',
    minIntervalMin: '45',
    maxIntervalMin: '180',
    maxActionsPerDay: '20',
    activeFromHour: '8',
    activeToHour: '23',
    jitterPct: '25',
    rotateProxy: false,
    autoPauseThreshold: '40',
    earlyFlowId: '',
    midFlowId: '',
    matureFlowId: ''
  });

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 4000);
  }

  async function loadAll() {
    try {
      const [cRes, fRes, gRes, aRes, sRes, rRes] = await Promise.all([
        fetch('/api/farm/campaigns'),
        fetch('/api/rpa'),
        fetch('/api/groups'),
        fetch('/api/farm/accounts'),
        fetch('/api/farm/summary'),
        fetch('/api/farm/risk')
      ]);
      const [cJson, fJson, gJson, aJson, sJson, rJson] = await Promise.all([cRes.json(), fRes.json(), gRes.json(), aRes.json(), sRes.json(), rRes.json()]);
      if (Array.isArray(cJson.data)) setCampaigns(cJson.data);
      if (Array.isArray(fJson.data)) setFlows(fJson.data);
      if (Array.isArray(gJson.data)) setGroups(gJson.data);
      if (Array.isArray(aJson.data)) setAccounts(aJson.data);
      if (sJson.data) setSummary(sJson.data as Summary);
      if (Array.isArray(rJson.data)) setRisk(rJson.data as Risk[]);
    } catch {
      flash('Çiftlik verileri yüklenemedi.');
    }
  }

  // Parse a simple CSV (name[,countryCode][,groupName]) and bulk-create devices.
  async function importCsv(file: File) {
    setBusy(true);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      // Skip an optional header row.
      const startsWithHeader = /name/i.test(lines[0] ?? '') && /group|country/i.test(lines[0] ?? '');
      const dataLines = startsWithHeader ? lines.slice(1) : lines;
      const rows = dataLines.map((l) => {
        const [name, countryCode, groupName] = l.split(',').map((c) => c.trim());
        return { name, countryCode: countryCode || undefined, groupName: groupName || undefined };
      }).filter((r) => r.name);
      if (rows.length === 0) return flash('CSV içinde geçerli satır bulunamadı.');
      const res = await fetch('/api/farm/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'İçe aktarma başarısız');
      flash(`${json.data?.created ?? 0} cihaz oluşturuldu, ${json.data?.skipped ?? 0} atlandı.`);
      await loadAll();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'İçe aktarma başarısız');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function resumeAccount(deviceId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/farm/accounts/${deviceId}/resume`, { method: 'POST' });
      if (!res.ok) throw new Error('Devam ettirilemedi');
      flash('Cihaz tekrar çalıştırıldı.');
      await loadAll();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Devam ettirilemedi');
    } finally {
      setBusy(false);
    }
  }

  // Download the account roster CSV (server streams text/csv).
  function exportCsv() {
    window.open('/api/farm/accounts/export', '_blank');
  }

  // Open the credential + timeline drawer for an account.
  async function openAccount(a: Account) {
    setAcctOpen(a);
    setCred({
      platform: a.platform ?? '',
      username: a.username ?? '',
      emailAddress: a.emailAddress ?? '',
      password: '',
      emailPassword: '',
      totpSecret: '',
      notes: a.notes ?? '',
      tags: (a.tags ?? []).join(', ')
    });
    setAcctLog([]);
    setTrend([]);
    setTotp(null);
    try {
      const [lr, tr] = await Promise.all([
        fetch(`/api/farm/accounts/${a.deviceId}/log?limit=100`),
        fetch(`/api/farm/accounts/${a.deviceId}/health-trend?limit=50`)
      ]);
      const [lj, tj] = await Promise.all([lr.json(), tr.json()]);
      if (Array.isArray(lj.data)) setAcctLog(lj.data);
      if (Array.isArray(tj.data)) setTrend(tj.data);
    } catch { /* ignore */ }
  }

  // Generate a live TOTP code from the stored 2FA seed.
  async function genTotp() {
    if (!acctOpen) return;
    try {
      const res = await fetch(`/api/farm/accounts/${acctOpen.deviceId}/totp`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Kod üretilemedi');
      setTotp(json.data);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Kod üretilemedi');
    }
  }

  function copyText(t: string) {
    try { void navigator.clipboard.writeText(t); flash('Panoya kopyalandı.'); } catch { /* ignore */ }
  }

  // Bulk action on selected accounts.
  async function runBulk(action: 'addTags' | 'removeTags' | 'pause' | 'resume', tags?: string[]) {
    if (selected.size === 0) return flash('Önce hesap seçin.');
    setBusy(true);
    try {
      const res = await fetch('/api/farm/accounts/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceIds: Array.from(selected), action, ...(tags ? { tags } : {}) })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Toplu işlem başarısız');
      flash(`${json.data?.affected ?? 0} hesap güncellendi.`);
      setSelected(new Set());
      setBulkTags('');
      await loadAll();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Toplu işlem başarısız');
    } finally {
      setBusy(false);
    }
  }

  function toggleSelect(deviceId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(deviceId)) next.delete(deviceId); else next.add(deviceId);
      return next;
    });
  }

  async function saveCredentials() {
    if (!acctOpen) return;
    setBusy(true);
    try {
      // Only send secret fields when the operator actually typed something
      // (empty string would clear them); always send the public fields.
      const body: Record<string, unknown> = {
        platform: cred.platform,
        username: cred.username,
        emailAddress: cred.emailAddress,
        notes: cred.notes,
        tags: cred.tags.split(',').map((t) => t.trim()).filter(Boolean)
      };
      if (cred.password) body.password = cred.password;
      if (cred.emailPassword) body.emailPassword = cred.emailPassword;
      if (cred.totpSecret) body.totpSecret = cred.totpSecret;
      const res = await fetch(`/api/farm/accounts/${acctOpen.deviceId}/credentials`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Kaydedilemedi');
      flash('Hesap kimlik bilgileri kaydedildi (şifreli).');
      setAcctOpen(null);
      await loadAll();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Kaydedilemedi');
    } finally {
      setBusy(false);
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
        jitterPct: Number(form.jitterPct),
        rotateProxy: form.rotateProxy,
        autoPauseThreshold: Number(form.autoPauseThreshold),
        earlyFlowId: form.earlyFlowId || undefined,
        midFlowId: form.midFlowId || undefined,
        matureFlowId: form.matureFlowId || undefined
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

  // Derived: filtered accounts + the platform options present in the data.
  const platformOptions = Array.from(new Set(accounts.map((a) => a.platform).filter(Boolean))) as string[];
  // Risk lookup by device for the per-row badge, and the high/medium-band slice
  // for the overview panel.
  const riskByDevice = new Map(risk.map((r) => [r.deviceId, r]));
  const flaggedRisk = risk.filter((r) => r.band !== 'low').slice(0, 12);
  const filteredAccounts = accounts.filter((a) => {
    if (filterPlatform && a.platform !== filterPlatform) return false;
    if (filterHealth === 'risk' && !(a.healthScore < 50 && !a.paused)) return false;
    if (filterHealth === 'paused' && !a.paused) return false;
    if (filterHealth === 'healthy' && !(a.healthScore >= 70 && !a.paused)) return false;
    if (filterText) {
      const q = filterText.toLowerCase();
      const hay = `${a.device?.name ?? ''} ${a.username ?? ''} ${a.emailAddress ?? ''} ${(a.tags ?? []).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <PageMotion className="page">
      <PageHeader
        title="Çiftlik"
        subtitle="Cihaz filonuzda insansı, zamanlanmış hesap ısıtma."
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f); }}
            />
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => fileRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Upload size={14} /> CSV içe aktar
            </button>
            <button type="button" className="btn-ghost" disabled={busy || accounts.length === 0} onClick={exportCsv} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <FileDown size={14} /> CSV indir
            </button>
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
        <button type="button" className={tab === 'overview' ? 'tab tab-active' : 'tab'} onClick={() => setTab('overview')}>
          Genel bakış
        </button>
        <button type="button" className={tab === 'campaigns' ? 'tab tab-active' : 'tab'} onClick={() => setTab('campaigns')}>
          Kampanyalar ({campaigns.length})
        </button>
        <button type="button" className={tab === 'accounts' ? 'tab tab-active' : 'tab'} onClick={() => setTab('accounts')}>
          Isıtma hesapları ({accounts.length})
        </button>
      </div>

      {msg ? <p className="helper" style={{ marginBottom: '0.75rem' }}>{msg}</p> : null}

      {tab === 'overview' ? (
        <>
          {/* Hero health gauge + animated KPI cards. */}
          <div className="farm-hero">
            <MotionItem className="metric farm-hero-gauge" lift={false}>
              <HealthGauge value={summary?.accounts.avgHealth ?? 0} />
              <div className="farm-hero-meta">
                <p className="metric-label"><HeartPulse size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Filo sağlığı</p>
                <p className="helper" style={{ margin: 0 }}>
                  {summary?.accounts.total ?? 0} hesap · {summary?.accounts.atRisk ?? 0} risk · {summary?.accounts.paused ?? 0} duraklatıldı
                </p>
              </div>
            </MotionItem>

            <StaggerGrid className="farm-kpis">
              <MotionItem className="metric ov-metric">
                <span className="metric-ico metric-ico-blue"><Megaphone size={18} /></span>
                <p className="metric-label">Aktif kampanya</p>
                <p className="metric-value"><AnimatedNumber value={summary?.campaigns.active ?? 0} format={false} /><span className="metric-sub"> / {summary?.campaigns.total ?? 0}</span></p>
              </MotionItem>
              <MotionItem className="metric ov-metric">
                <span className="metric-ico metric-ico-cyan"><Activity size={18} /></span>
                <p className="metric-label">Bugünkü aksiyon</p>
                <p className="metric-value"><AnimatedNumber value={summary?.actions.today ?? 0} format={false} /></p>
              </MotionItem>
              <MotionItem className="metric ov-metric">
                <span className="metric-ico metric-ico-green"><Globe size={18} /></span>
                <p className="metric-label">Proxy (sağlıklı / toplam)</p>
                <p className="metric-value">
                  <AnimatedNumber value={summary?.proxies.healthy ?? 0} format={false} /><span className="metric-sub"> / {summary?.proxies.total ?? 0}</span>
                  {(summary?.proxies.failed ?? 0) > 0 ? <span className="farm-proxy-bad"> · {summary?.proxies.failed} ölü</span> : null}
                </p>
              </MotionItem>
              <MotionItem className="metric ov-metric">
                <span className={`metric-ico ${(summary?.risk.high ?? 0) > 0 ? 'metric-ico-red' : 'metric-ico-violet'}`}><Siren size={18} /></span>
                <p className="metric-label">Ban riski (yüksek / orta)</p>
                <p className="metric-value">
                  <span className={(summary?.risk.high ?? 0) > 0 ? 'farm-proxy-bad' : ''}><AnimatedNumber value={summary?.risk.high ?? 0} format={false} /></span>
                  <span className="metric-sub"> / {summary?.risk.medium ?? 0}</span>
                </p>
              </MotionItem>
            </StaggerGrid>
          </div>

          <div className="section-grid">
            {/* Warmup-stage distribution */}
            <div className="panel">
              <h2>Isıtma aşaması dağılımı</h2>
              {(summary?.accounts.total ?? 0) === 0 ? (
                <p className="helper">Henüz ısıtma verisi yok.</p>
              ) : (
                <div className="farm-dist">
                  {(summary?.stageDistribution ?? []).map((count, i) => {
                    const total = summary?.accounts.total || 1;
                    const w = Math.round((count / total) * 100);
                    return (
                      <div className="farm-dist-row" key={i}>
                        <span className="farm-dist-label">{STAGE_LABEL[i + 1]}</span>
                        <span className="health-bar"><span className={`health-bar-fill farm-stage-bar-${i + 1}`} style={{ width: `${w}%` }} /></span>
                        <span className="farm-dist-num mono">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* At-risk devices */}
            <div className="panel">
              <h2><ShieldAlert size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Risk altındaki cihazlar</h2>
              {(summary?.atRiskList.length ?? 0) === 0 ? (
                <p className="helper">Risk altında cihaz yok — filo sağlıklı. 🎉</p>
              ) : (
                <div className="group-device-list">
                  {summary?.atRiskList.map((a) => (
                    <div key={a.deviceId} className="group-device-row">
                      <span className="group-device-name mono">{a.deviceId.slice(0, 10)}…</span>
                      <span className={`farm-health-pill ${a.healthScore < 30 ? 'tone-bad' : 'tone-warn'}`}>{a.healthScore}</span>
                      {a.paused ? <span className="farm-status farm-status-paused" title={a.pausedReason ?? ''}>duraklatıldı</span> : null}
                      {a.paused ? (
                        <button type="button" className="btn-ghost group-move-btn" disabled={busy} onClick={() => resumeAccount(a.deviceId)}>
                          <RotateCw size={12} /> Devam
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Proactive ban-risk: devices drifting toward a ban, with the
                leading-indicator reasons that raised each score. */}
            <div className="panel">
              <h2><Siren size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Ban riski (öngörücü)</h2>
              {flaggedRisk.length === 0 ? (
                <p className="helper">Yükselen ban riski yok — davranış sınırlar içinde. ✅</p>
              ) : (
                <div className="farm-risk-list">
                  {flaggedRisk.map((r) => (
                    <div key={r.deviceId} className={`farm-risk-row farm-risk-${r.band}`}>
                      <div className="farm-risk-head">
                        <RiskGauge score={r.score} band={r.band} />
                        <span className="group-device-name mono">{r.deviceName ?? `${r.deviceId.slice(0, 10)}…`}</span>
                        {r.paused ? <span className="farm-status farm-status-paused">duraklatıldı</span> : null}
                      </div>
                      <div className="farm-risk-factors">
                        {r.factors.length === 0 ? <span className="helper">—</span> : r.factors.map((f) => (
                          <span key={f.code} className="farm-risk-chip" title={`+${f.weight}`}>{f.label}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : tab === 'campaigns' ? (
        campaigns.length === 0 ? (
          <div className="empty-state">
            <div className="empty-art">🌱</div>
            <h3>Henüz kampanya yok</h3>
            <p>Bir cihaz grubunda insansı bir zamanlamayla RPA akışı çalıştırmak için bir kampanya oluşturun.</p>
          </div>
        ) : (
          <div className="farm-grid">
            {campaigns.map((c) => (
              <article key={c.id} className={`farm-card farm-card-${c.status.toLowerCase()}`}>
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
                  <span><ShieldAlert size={12} /> oto-duraklat &lt;{c.autoPauseThreshold} · {c.rotateProxy ? 'proxy rotasyonu açık' : 'proxy rotasyonu kapalı'}</span>
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
            {/* Filter bar */}
            <div className="farm-filter-bar">
              <span className="farm-search">
                <Search size={14} />
                <input className="field-input" placeholder="Cihaz, kullanıcı, e-posta veya etiket ara…" value={filterText} onChange={(e) => setFilterText(e.target.value)} />
              </span>
              <select className="field-input farm-filter-sel" value={filterPlatform} onChange={(e) => setFilterPlatform(e.target.value)}>
                <option value="">Tüm platformlar</option>
                {platformOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className="field-input farm-filter-sel" value={filterHealth} onChange={(e) => setFilterHealth(e.target.value)}>
                <option value="">Tüm durumlar</option>
                <option value="healthy">Sağlıklı (≥70)</option>
                <option value="risk">Risk (&lt;50)</option>
                <option value="paused">Duraklatılan</option>
              </select>
              <span className="helper farm-filter-count">{filteredAccounts.length} / {accounts.length}</span>
            </div>

            {/* Bulk action bar (shown when rows are selected) */}
            {selected.size > 0 ? (
              <div className="farm-bulk-bar">
                <span className="farm-bulk-count">{selected.size} seçili</span>
                <span className="farm-bulk-tags">
                  <Tag size={13} />
                  <input className="field-input" placeholder="etiket1, etiket2" value={bulkTags} onChange={(e) => setBulkTags(e.target.value)} />
                  <button type="button" className="btn-ghost" disabled={busy || !bulkTags.trim()} onClick={() => runBulk('addTags', bulkTags.split(',').map((t) => t.trim()).filter(Boolean))}>Ekle</button>
                  <button type="button" className="btn-ghost" disabled={busy || !bulkTags.trim()} onClick={() => runBulk('removeTags', bulkTags.split(',').map((t) => t.trim()).filter(Boolean))}>Çıkar</button>
                </span>
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => runBulk('pause')}><Pause size={13} /> Duraklat</button>
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => runBulk('resume')}><Play size={13} /> Devam ettir</button>
                <button type="button" className="btn-ghost" onClick={() => setSelected(new Set())}>Seçimi temizle</button>
              </div>
            ) : null}

            <div className="health-table">
              <div className="health-row health-head" style={{ gridTemplateColumns: '28px 1.3fr 0.9fr 0.85fr 0.45fr 0.45fr 0.55fr 0.9fr 0.95fr 0.75fr' }}>
                <span>
                  <input type="checkbox" aria-label="Tümünü seç"
                    checked={filteredAccounts.length > 0 && filteredAccounts.every((a) => selected.has(a.deviceId))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(filteredAccounts.map((a) => a.deviceId)) : new Set())} />
                </span>
                <span>Cihaz</span><span>Hesap</span><span>Aşama</span><span>Gün</span><span>Bugün</span><span>Toplam</span><span>Sağlık</span><span>Durum</span><span>Kimlik</span>
              </div>
              {filteredAccounts.map((a) => (
                <div key={a.id} className={`health-row ${selected.has(a.deviceId) ? 'farm-row-sel' : ''}`} style={{ gridTemplateColumns: '28px 1.3fr 0.9fr 0.85fr 0.45fr 0.45fr 0.55fr 0.9fr 0.95fr 0.75fr' }}>
                  <span><input type="checkbox" checked={selected.has(a.deviceId)} onChange={() => toggleSelect(a.deviceId)} /></span>
                  <span className="health-name">
                    {a.device?.name ?? a.deviceId.slice(0, 8)}
                    {(() => {
                      const r = riskByDevice.get(a.deviceId);
                      if (!r || r.band === 'low') return null;
                      const reasons = r.factors.map((f) => f.label).join(' · ');
                      return <span className={`farm-risk-badge farm-risk-${r.band}`} title={`Ban riski ${r.score}: ${reasons}`}><Siren size={10} /> {r.score}</span>;
                    })()}
                    {(a.tags ?? []).length > 0 ? <span className="farm-row-tags">{a.tags.map((t) => <span key={t} className="farm-tag-chip">{t}</span>)}</span> : null}
                  </span>
                  <span className="farm-acct-id">
                    {a.username ? (
                      <span title={a.platform ?? ''}>{a.platform ? <span className="farm-plat">{a.platform}</span> : null}@{a.username}</span>
                    ) : (
                      <em className="helper">—</em>
                    )}
                  </span>
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
                  <span>
                    {a.paused ? (
                      <button type="button" className="btn-ghost group-move-btn" disabled={busy} onClick={() => resumeAccount(a.deviceId)} title={a.pausedReason ?? 'Otomatik duraklatıldı'}>
                        <RotateCw size={12} /> Devam ettir
                      </button>
                    ) : (
                      <span className="farm-status farm-status-active">çalışıyor</span>
                    )}
                  </span>
                  <span>
                    <button type="button" className="btn-ghost group-move-btn" onClick={() => openAccount(a)} title="Kimlik bilgileri ve eylem günlüğü">
                      <KeyRound size={12} />{a.hasPassword ? <ShieldCheck size={12} className="farm-cred-ok" /> : null} Yönet
                    </button>
                  </span>
                </div>
              ))}
              {filteredAccounts.length === 0 ? <p className="helper" style={{ padding: '1rem' }}>Filtreye uyan hesap yok.</p> : null}
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

              {/* Stage-aware warmup: optional per-stage flows. Leave blank to use
                  the default RPA flow above at every stage. */}
              <p className="helper" style={{ marginTop: 4 }}>Aşamaya göre akış (opsiyonel): yeni hesaplar nazik, olgun hesaplar zengin davranış. Boş bırakılırsa her aşamada üstteki varsayılan akış kullanılır.</p>
              <div className="farm-form-row">
                <label className="distribute-field">
                  <span className="helper">Yeni / Isınıyor (1-2)</span>
                  <select className="field-input" value={form.earlyFlowId} onChange={(e) => setForm({ ...form, earlyFlowId: e.target.value })}>
                    <option value="">— varsayılan —</option>
                    {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </label>
                <label className="distribute-field">
                  <span className="helper">Gelişiyor (3)</span>
                  <select className="field-input" value={form.midFlowId} onChange={(e) => setForm({ ...form, midFlowId: e.target.value })}>
                    <option value="">— varsayılan —</option>
                    {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </label>
                <label className="distribute-field">
                  <span className="helper">Aktif / Olgun (4-5)</span>
                  <select className="field-input" value={form.matureFlowId} onChange={(e) => setForm({ ...form, matureFlowId: e.target.value })}>
                    <option value="">— varsayılan —</option>
                    {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
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
              <div className="farm-form-row">
                <label className="distribute-field">
                  <span className="helper">Oto-duraklatma eşiği (sağlık)</span>
                  <input className="field-input" type="number" min={0} max={100} value={form.autoPauseThreshold} onChange={(e) => setForm({ ...form, autoPauseThreshold: e.target.value })} />
                </label>
                <label className="distribute-field" style={{ justifyContent: 'flex-end' }}>
                  <span className="fp-check" style={{ marginTop: '1.5rem' }}>
                    <input type="checkbox" checked={form.rotateProxy} onChange={(e) => setForm({ ...form, rotateProxy: e.target.checked })} /> Her çalışmada proxy döndür
                  </span>
                </label>
              </div>
              <p className="helper">Ban savunması: sağlık skoru eşiğin altına düşen cihaz otomatik duraklatılır. Proxy rotasyonu açıksa her çalışmada havuzdan farklı bir proxy atanır (IP çeşitliliği).</p>
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

      {acctOpen ? (
        <div className="modal-overlay" onClick={() => !busy && setAcctOpen(null)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><KeyRound size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} /> {acctOpen.device?.name ?? acctOpen.deviceId.slice(0, 10)} — hesap</h2>
            </header>
            <div className="modal-body farm-acct-body">
              {/* ── Credentials (encrypted vault) ── */}
              <div className="farm-acct-col">
                <h3 className="farm-acct-h">Kimlik bilgileri</h3>
                <p className="helper">Şifreler AES-256-GCM ile şifreli saklanır, asla düz metin döndürülmez. Şifre alanlarını boş bırakırsanız mevcut değer korunur.</p>
                <div className="farm-form-row">
                  <label className="distribute-field">
                    <span className="helper">Platform</span>
                    <select className="field-input" value={cred.platform} onChange={(e) => setCred({ ...cred, platform: e.target.value })}>
                      <option value="">—</option>
                      <option value="x">X (Twitter)</option>
                      <option value="instagram">Instagram</option>
                      <option value="meta">Meta / Facebook</option>
                      <option value="tiktok">TikTok</option>
                      <option value="other">Diğer</option>
                    </select>
                  </label>
                  <label className="distribute-field"><span className="helper">Kullanıcı adı</span><input className="field-input" value={cred.username} onChange={(e) => setCred({ ...cred, username: e.target.value })} /></label>
                </div>
                <label className="distribute-field"><span className="helper">E-posta</span><input className="field-input" value={cred.emailAddress} onChange={(e) => setCred({ ...cred, emailAddress: e.target.value })} /></label>
                <div className="farm-form-row">
                  <label className="distribute-field"><span className="helper">Şifre {acctOpen.hasPassword ? '(kayıtlı ✓)' : ''}</span><input className="field-input" type="password" autoComplete="new-password" placeholder={acctOpen.hasPassword ? '•••••• (değiştirmek için yazın)' : ''} value={cred.password} onChange={(e) => setCred({ ...cred, password: e.target.value })} /></label>
                  <label className="distribute-field"><span className="helper">E-posta şifresi {acctOpen.hasEmailPassword ? '(kayıtlı ✓)' : ''}</span><input className="field-input" type="password" autoComplete="new-password" value={cred.emailPassword} onChange={(e) => setCred({ ...cred, emailPassword: e.target.value })} /></label>
                </div>
                <label className="distribute-field"><span className="helper">2FA (TOTP) gizli anahtarı {acctOpen.hasTotp ? '(kayıtlı ✓)' : ''}</span><input className="field-input" type="password" autoComplete="off" placeholder="JBSW Y3DP EHPK 3PXP" value={cred.totpSecret} onChange={(e) => setCred({ ...cred, totpSecret: e.target.value })} /></label>
                {/* Live 2FA code generation from the stored seed. */}
                {acctOpen.hasTotp ? (
                  <div className="farm-totp">
                    <button type="button" className="btn-ghost" onClick={genTotp}><KeyRound size={13} /> 2FA kodu üret</button>
                    {totp ? (
                      <span className="farm-totp-code" onClick={() => copyText(totp.code)} title="Kopyalamak için tıkla">
                        <span className="farm-totp-digits">{totp.code.slice(0, 3)} {totp.code.slice(3)}</span>
                        <span className="farm-totp-ttl">{totp.secondsRemaining}s</span>
                        <Copy size={12} />
                      </span>
                    ) : <span className="helper">Kasadaki anahtardan anlık kod üretir</span>}
                  </div>
                ) : null}
                <label className="distribute-field"><span className="helper">Etiketler (virgülle)</span><input className="field-input" placeholder="aged, us-geo, buyer" value={cred.tags} onChange={(e) => setCred({ ...cred, tags: e.target.value })} /></label>
                <label className="distribute-field"><span className="helper">Notlar</span><textarea className="field-input" rows={3} value={cred.notes} onChange={(e) => setCred({ ...cred, notes: e.target.value })} /></label>
              </div>

              {/* ── Health trend + action timeline ── */}
              <div className="farm-acct-col">
                <h3 className="farm-acct-h"><TrendingUp size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Sağlık trendi</h3>
                {trend.length < 2 ? (
                  <p className="helper">Grafik için yeterli veri yok (en az 2 ölçüm gerekir).</p>
                ) : (
                  <div className="farm-spark">
                    <Sparkline points={trend.map((t) => t.health)} />
                    <div className="farm-spark-meta">
                      <span>İlk: {trend[0]?.health}</span>
                      <span>Son: {trend[trend.length - 1]?.health}</span>
                      <span className={(trend[trend.length - 1]?.health ?? 0) >= (trend[0]?.health ?? 0) ? 'farm-trend-up' : 'farm-trend-down'}>
                        {((trend[trend.length - 1]?.health ?? 0) - (trend[0]?.health ?? 0)) >= 0 ? '▲' : '▼'} {Math.abs((trend[trend.length - 1]?.health ?? 0) - (trend[0]?.health ?? 0))}
                      </span>
                    </div>
                  </div>
                )}
                <h3 className="farm-acct-h" style={{ marginTop: '0.8rem' }}><History size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Eylem günlüğü</h3>
                {acctLog.length === 0 ? (
                  <p className="helper">Henüz kayıtlı eylem yok.</p>
                ) : (
                  <div className="farm-timeline">
                    {acctLog.map((l) => (
                      <div key={l.id} className={`farm-tl-row farm-tl-${l.kind}`}>
                        <span className={`farm-tl-dot farm-tl-dot-${l.kind}`} />
                        <div className="farm-tl-body">
                          <span className="farm-tl-kind">{KIND_LABEL[l.kind] ?? l.kind}</span>
                          {l.detail ? <span className="farm-tl-detail">{l.detail}</span> : null}
                          <span className="farm-tl-meta">
                            {new Date(l.createdAt).toLocaleString('tr-TR')}
                            {typeof l.healthAfter === 'number' ? ` · sağlık ${l.healthAfter}` : ''}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={() => setAcctOpen(null)} disabled={busy}>Kapat</button>
              <button type="button" className="btn-primary" onClick={saveCredentials} disabled={busy}>
                {busy ? 'Kaydediliyor…' : 'Kimlik bilgilerini kaydet'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </PageMotion>
  );
}

// Minimal dependency-free SVG sparkline for the health trend. Maps the series
// into a 0-100 viewBox so health values plot directly.
function Sparkline({ points }: { points: number[] }) {
  const w = 260;
  const h = 60;
  const n = points.length;
  if (n < 2) return null;
  const max = 100;
  const min = 0;
  const span = max - min || 1;
  const coords = points.map((p, i) => {
    const x = (i / (n - 1)) * w;
    const y = h - ((p - min) / span) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = points[n - 1] ?? 0;
  const stroke = last >= 70 ? '#34d399' : last >= 40 ? '#fbbf24' : '#f87171';
  const areaPath = `M0,${h} L${coords.join(' L')} L${w},${h} Z`;
  return (
    <svg className="farm-spark-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Sağlık trendi">
      <path d={areaPath} fill={stroke} fillOpacity={0.12} />
      <polyline points={coords.join(' ')} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
