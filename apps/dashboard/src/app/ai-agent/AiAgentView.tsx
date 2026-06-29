'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bot, Play, Square, Compass, Smartphone, Activity, ShieldCheck,
  CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight, Network,
  Eye, MonitorPlay, Save, ImageIcon
} from 'lucide-react';
import { HoloHeader, HoloPanel, HoloStat } from '../../components/hud';
import { LiveScreen } from '../profiles/[id]/LiveScreen';
import { usePolling } from '../../lib/usePolling';

type Device = { id: string; name: string; status: string; online: boolean };

type StepResult = { ok?: boolean; error?: string };
type ToolCall = { name: string; input: Record<string, unknown> };
type RunStep = { id: string; index: number; screenTree: string; screenshot?: string | null; toolCalls: ToolCall[]; result?: StepResult | null };
type Run = {
  id: string;
  goal: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  stealth: boolean;
  useVision?: boolean;
  turnsUsed: number;
  maxTurns: number;
  success: boolean | null;
  summary: string | null;
  error: string | null;
  device?: { name: string | null };
  steps?: RunStep[];
};

type AppMapGraph = { screens?: Array<{ hash: string; label: string; nodeCount?: number }>; edges?: Array<{ from: string; to: string; viaLabel?: string }> };
type AppMap = { id: string; packageName: string; screenCount: number; graph: AppMapGraph; createdAt: string } | null;

const STATUS_TONE: Record<Run['status'], 'success' | 'error' | 'warning' | 'neutral'> = {
  RUNNING: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'error',
  CANCELLED: 'neutral'
};
const STATUS_LABEL: Record<Run['status'], string> = {
  RUNNING: 'ÇALIŞIYOR',
  SUCCEEDED: 'BAŞARILI',
  FAILED: 'BAŞARISIZ',
  CANCELLED: 'İPTAL'
};

// Map known backend error codes to a friendly Turkish sentence so the UI never
// surfaces a raw token like "AI_NOT_CONFIGURED".
const ERROR_MESSAGES: Record<string, string> = {
  AI_NOT_CONFIGURED: 'AI yapılandırılmadı: ANTHROPIC_API_KEY eksik. Sunucu .env dosyasına bir Anthropic API anahtarı ekleyip API\'yi yeniden başlatın.',
  DEVICE_OFFLINE: 'Cihaz çevrimdışı. Önce cihazı başlatın.',
  DEVICE_NOT_FOUND: 'Cihaz bulunamadı.'
};

function friendlyError(raw: string, fallback: string): string {
  const key = raw.trim();
  return ERROR_MESSAGES[key] ?? (key || fallback);
}

function errFromBody(body: unknown, fallback: string): string {
  const d = (body as { data?: unknown })?.data;
  if (d && typeof d === 'object') {
    const obj = d as { error?: unknown; message?: unknown; code?: unknown };
    // Prefer an explicit error code (maps to a friendly message), then message text.
    const code = typeof obj.code === 'string' ? obj.code : '';
    if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
    const m = obj.error ?? obj.message;
    if (typeof m === 'string' && m.trim()) return friendlyError(m, fallback);
  }
  const top = (body as { error?: unknown })?.error;
  if (typeof top === 'string' && top.trim()) return friendlyError(top, fallback);
  return fallback;
}

export function AiAgentView({ devices }: { devices: Device[] }) {
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? '');
  const [goal, setGoal] = useState('');
  const [stealth, setStealth] = useState(false);
  const [useVision, setUseVision] = useState(false);
  const [showLive, setShowLive] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openSteps, setOpenSteps] = useState<Set<number>>(new Set());
  const [savingRpa, setSavingRpa] = useState(false);
  const [rpaMsg, setRpaMsg] = useState<string | null>(null);
  // Whether the Anthropic key is present on the server. null = not yet checked.
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);

  // Probe AI availability once so we can gate the console + show a clear notice
  // instead of letting the user hit a raw AI_NOT_CONFIGURED on submit.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/ai-agent/status', { cache: 'no-store' });
        const json = await res.json();
        const conf = (json?.data as { configured?: boolean })?.configured;
        if (alive) setAiConfigured(typeof conf === 'boolean' ? conf : null);
      } catch { if (alive) setAiConfigured(null); }
    })();
    return () => { alive = false; };
  }, []);

  const selectedDevice = devices.find((d) => d.id === deviceId);

  // Explore
  const [pkg, setPkg] = useState('com.android.settings');
  const [exploreBusy, setExploreBusy] = useState(false);
  const [exploreMsg, setExploreMsg] = useState<string | null>(null);
  const [appMap, setAppMap] = useState<AppMap>(null);

  // Poll the active run every 2s until it leaves RUNNING (skips while hidden).
  usePolling(async () => {
    if (!run) return;
    try {
      const res = await fetch(`/api/ai-agent/runs/${run.id}`, { cache: 'no-store' });
      const json = await res.json();
      if (res.ok && json.data) setRun(json.data as Run);
    } catch { /* keep polling */ }
  }, 2000, !!run && run.status === 'RUNNING');

  async function start() {
    const g = goal.trim();
    if (!deviceId || g.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    setRun(null);
    setOpenSteps(new Set());
    setRpaMsg(null);
    try {
      const res = await fetch('/api/ai-agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, goal: g, stealth, useVision })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(errFromBody(json, 'Çalıştırma başlatılamadı.'));
      const runId = (json.data as { runId?: string })?.runId;
      if (!runId) throw new Error('Çalıştırma kimliği alınamadı.');
      // Seed a RUNNING run so the poller kicks in immediately.
      setRun({ id: runId, goal: g, status: 'RUNNING', stealth, useVision, turnsUsed: 0, maxTurns: 15, success: null, summary: null, error: null, steps: [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Çalıştırma başlatılamadı.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!run) return;
    try {
      await fetch(`/api/ai-agent/runs/${run.id}/cancel`, { method: 'POST' });
      setRun((r) => (r ? { ...r, status: 'CANCELLED' } : r));
    } catch { /* ignore */ }
  }

  async function saveAsRpa() {
    if (!run || savingRpa) return;
    setSavingRpa(true);
    setRpaMsg(null);
    try {
      const res = await fetch(`/api/ai-agent/runs/${run.id}/to-rpa`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const json = await res.json();
      if (!res.ok) throw new Error(errFromBody(json, 'RPA akışına dönüştürülemedi.'));
      const d = json.data as { flowId?: string; steps?: number };
      setRpaMsg(`RPA akışı oluşturuldu (${d?.steps ?? 0} adım). /rpa sayfasından çalıştırabilirsiniz.`);
    } catch (err) {
      setRpaMsg(err instanceof Error ? err.message : 'RPA akışına dönüştürülemedi.');
    } finally {
      setSavingRpa(false);
    }
  }

  async function explore() {
    if (!deviceId || !pkg.trim() || exploreBusy) return;
    setExploreBusy(true);
    setExploreMsg('Keşif başlatılıyor…');
    setAppMap(null);
    try {
      const res = await fetch('/api/ai-agent/explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, packageName: pkg.trim() })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(errFromBody(json, 'Keşif başlatılamadı.'));
      const jobId = (json.data as { jobId?: string })?.jobId;
      if (!jobId) throw new Error('İş kimliği alınamadı.');
      setExploreMsg('Uygulama taranıyor (bu birkaç dakika sürebilir)…');
      // Poll the job until COMPLETED/FAILED, then persist + load the map.
      const done = await pollJob(jobId);
      if (done === 'COMPLETED') {
        await fetch('/api/ai-agent/map', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId, jobId })
        });
        const mapRes = await fetch(`/api/ai-agent/map/${deviceId}`, { cache: 'no-store' });
        const mapJson = await mapRes.json();
        setAppMap((mapJson.data as AppMap) ?? null);
        setExploreMsg('Keşif tamamlandı.');
      } else {
        setExploreMsg('Keşif başarısız oldu.');
      }
    } catch (err) {
      setExploreMsg(err instanceof Error ? err.message : 'Keşif başarısız oldu.');
    } finally {
      setExploreBusy(false);
    }
  }

  async function pollJob(jobId: string): Promise<string> {
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: 'no-store' });
        const json = await res.json();
        const status = (json.data as { status?: string })?.status;
        if (status === 'COMPLETED' || status === 'FAILED') return status;
      } catch { /* keep polling */ }
    }
    return 'TIMEOUT';
  }

  function toggleStep(i: number) {
    setOpenSteps((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  const running = run?.status === 'RUNNING';
  const steps = run?.steps ?? [];

  return (
    <main className="page">
      <HoloHeader
        eyebrow="OTONOM CİHAZ SÜRÜCÜSÜ"
        title="AI Cihaz Ajanı"
        subtitle="Doğal dille bir hedef verin — Claude ekranı görüp telefonu tur tur kendisi sürsün."
        actions={
          <span className="status-chip">
            <span className={`dot ${running ? 'dot-online' : 'dot-offline'}`} />
            <span className="mono">{running ? 'SÜRÜYOR' : 'HAZIR'}</span>
          </span>
        }
      />

      <div className="holo-stats-grid">
        <HoloStat label="Cihaz" value={<span className="mono" style={{ fontSize: '0.95rem' }}>{devices.find((d) => d.id === deviceId)?.name ?? '—'}</span>} sub="Hedef cihaz" tone="cyan" icon={<Smartphone size={16} />} />
        <HoloStat label="Tur" value={<span className="mono">{run ? `${run.turnsUsed}/${run.maxTurns}` : '0/15'}</span>} sub="Kullanılan / azami" tone="info" icon={<Activity size={16} />} />
        <HoloStat label="Stealth" value={<span className="mono">{stealth ? 'AÇIK' : 'KAPALI'}</span>} sub="İnsan-temposu girdi" tone="violet" icon={<ShieldCheck size={16} />} />
        <HoloStat label="Durum" value={<span className="mono">{run ? STATUS_LABEL[run.status] : 'BEKLEME'}</span>} sub={run?.summary ? 'özet hazır' : 'senkron'} tone={run ? STATUS_TONE[run.status] : 'success'} icon={<Bot size={16} />} />
      </div>

      <HoloPanel title="Görev Konsolu" icon={<Play size={18} />} scan={false}>
        <div className="ai-stack" style={{ gap: '0.75rem' }}>
          {aiConfigured === false ? (
            <div className="ai-notice ai-notice-warn" role="status">
              <ShieldCheck size={16} style={{ flex: '0 0 auto', marginTop: 1 }} />
              <span>
                <strong>AI yapılandırılmadı.</strong> Otonom ajan için sunucuda bir <span className="mono">ANTHROPIC_API_KEY</span> gerekli.
                Anahtarı <span className="mono">apps/api/.env</span> dosyasına ekleyip API&apos;yi yeniden başlatın; ardından bu konsol çalışır.
              </span>
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <select className="inline-select" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={running}>
              {devices.length === 0 ? <option value="">Cihaz yok</option> : null}
              {devices.map((d) => (
                <option key={d.id} value={d.id}>{d.name} {d.status === 'ONLINE' ? '🟢' : '⚪'}</option>
              ))}
            </select>
            <label className="status-chip" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={stealth} onChange={(e) => setStealth(e.target.checked)} disabled={running} style={{ marginRight: 6 }} />
              <ShieldCheck size={13} style={{ verticalAlign: -2, marginRight: 4 }} /><span className="mono">STEALTH</span>
            </label>
            <label className="status-chip" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={useVision} onChange={(e) => setUseVision(e.target.checked)} disabled={running} style={{ marginRight: 6 }} />
              <Eye size={13} style={{ verticalAlign: -2, marginRight: 4 }} /><span className="mono">VISION</span>
            </label>
            <button type="button" className={showLive ? 'status-chip active' : 'status-chip'} style={{ cursor: 'pointer' }} onClick={() => setShowLive((s) => !s)}>
              <MonitorPlay size={13} style={{ verticalAlign: -2, marginRight: 4 }} /><span className="mono">CANLI EKRAN</span>
            </button>
          </div>
          <textarea
            className="ai-input"
            placeholder="Hedef: TikTok'u aç ve 3 video beğen"
            maxLength={1000}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            disabled={running}
          />
          {error ? <p className="field-error">{error}</p> : null}
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            {running ? (
              <button type="button" className="btn-secondary" onClick={cancel}>
                <Square size={16} style={{ marginRight: 6 }} /> İptal
              </button>
            ) : null}
            <button type="button" className="btn-primary" disabled={!deviceId || goal.trim().length < 3 || busy || running || aiConfigured === false} onClick={start}>
              {busy || running ? <Loader2 size={16} className="spin" style={{ marginRight: 6 }} /> : <Play size={16} style={{ marginRight: 6 }} />}
              {running ? 'Sürüyor…' : 'Çalıştır'}
            </button>
          </div>
        </div>
      </HoloPanel>

      {showLive && selectedDevice ? (
        <HoloPanel title="Canlı Ekran" icon={<MonitorPlay size={18} />} scan={false}>
          <p className="helper" style={{ marginBottom: '0.6rem' }}>Ajan telefonu sürerken canlı izleyin (gerektiğinde elle de müdahale edebilirsiniz).</p>
          <div style={{ maxWidth: 360, margin: '0 auto' }}>
            <LiveScreen deviceId={selectedDevice.id} online={selectedDevice.online} />
          </div>
        </HoloPanel>
      ) : null}

      {run ? (
        <HoloPanel
          title="Tur Zaman Çizelgesi"
          icon={<Activity size={18} />}
          actions={
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              {run.status !== 'RUNNING' && steps.length > 0 ? (
                <button type="button" className="btn-secondary" disabled={savingRpa} onClick={saveAsRpa} title="Bu çalıştırmayı tekrarlanabilir bir RPA akışına çevir">
                  {savingRpa ? <Loader2 size={14} className="spin" style={{ marginRight: 6 }} /> : <Save size={14} style={{ marginRight: 6 }} />}
                  RPA'ya kaydet
                </button>
              ) : null}
              <span className="status-chip mono">{STATUS_LABEL[run.status]}</span>
            </div>
          }
        >
          {run.summary ? <p className="helper" style={{ lineHeight: 1.5, marginBottom: '0.75rem' }}>{run.summary}</p> : null}
          {run.error ? <p className="field-error" style={{ marginBottom: '0.75rem' }}>{run.error}</p> : null}
          {rpaMsg ? <p className="helper" style={{ marginBottom: '0.75rem', color: 'var(--success, #22c55e)' }}>{rpaMsg}</p> : null}
          {steps.length === 0 ? (
            <p className="helper">{running ? 'Ajan düşünüyor ve ilk adımı planlıyor…' : 'Adım kaydı yok.'}</p>
          ) : (
            <div className="ai-stack" style={{ gap: '0.5rem' }}>
              {steps.map((s) => {
                const open = openSteps.has(s.index);
                const tool = s.toolCalls[0];
                const ok = s.result?.ok !== false;
                return (
                  <div key={s.id} style={{ border: '1px solid rgba(255,255,255,0.10)', borderRadius: 10, overflow: 'hidden' }}>
                    <button
                      type="button"
                      onClick={() => toggleStep(s.index)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.55rem 0.75rem', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}
                    >
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className="mono" style={{ opacity: 0.6, fontSize: '0.7rem' }}>#{s.index + 1}</span>
                      <span style={{ flex: 1 }}>
                        <strong className="mono" style={{ fontSize: '0.82rem' }}>{tool?.name ?? '—'}</strong>
                        {tool && Object.keys(tool.input).length > 0 ? (
                          <span className="helper" style={{ marginLeft: 8, fontSize: '0.75rem' }}>{JSON.stringify(tool.input)}</span>
                        ) : null}
                      </span>
                      {ok ? <CheckCircle2 size={14} style={{ color: 'rgba(34,197,94,0.85)' }} /> : <XCircle size={14} style={{ color: 'rgba(239,68,68,0.85)' }} />}
                    </button>
                    {open ? (
                      <div style={{ padding: '0 0.75rem 0.65rem' }}>
                        {s.result?.error ? <p className="field-error" style={{ fontSize: '0.75rem' }}>{s.result.error}</p> : null}
                        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                          {s.screenshot ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={`data:image/png;base64,${s.screenshot}`} alt={`Adım ${s.index + 1} ekran`} style={{ width: 140, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', flex: '0 0 auto' }} />
                          ) : null}
                          <pre className="mono" style={{ fontSize: '0.68rem', whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto', opacity: 0.75, margin: '0.4rem 0 0', padding: '0.5rem', background: 'rgba(0,0,0,0.25)', borderRadius: 8, flex: 1, minWidth: 200 }}>{s.screenTree || '(ekran yok)'}</pre>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </HoloPanel>
      ) : null}

      <HoloPanel title="Uygulama Keşfi (BFS)" icon={<Compass size={18} />} scan={false}>
        <p className="helper" style={{ marginBottom: '0.6rem' }}>Bir uygulamayı otomatik gezip ekran grafiğini çıkarın. Tek-kullanımlık/test cihazlarında çalıştırın.</p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            className="ai-input"
            style={{ minHeight: 'auto', flex: 1, minWidth: 220 }}
            placeholder="Paket adı, örn. com.instagram.android"
            value={pkg}
            onChange={(e) => setPkg(e.target.value)}
            disabled={exploreBusy}
          />
          <button type="button" className="btn-primary" disabled={!deviceId || !pkg.trim() || exploreBusy || aiConfigured === false} onClick={explore}>
            {exploreBusy ? <Loader2 size={16} className="spin" style={{ marginRight: 6 }} /> : <Compass size={16} style={{ marginRight: 6 }} />}
            Keşfet
          </button>
        </div>
        {exploreMsg ? <p className="helper" style={{ marginTop: '0.6rem' }}>{exploreMsg}</p> : null}
        {appMap ? (
          <div style={{ marginTop: '1rem' }}>
            <p className="helper mono" style={{ marginBottom: '0.5rem' }}>
              <Network size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
              {appMap.packageName} · {appMap.screenCount} ekran · {(appMap.graph.edges?.length ?? 0)} geçiş
            </p>
            <div className="ai-stack" style={{ gap: '0.35rem' }}>
              {(appMap.graph.screens ?? []).map((sc) => (
                <div key={sc.hash} className="ai-row" style={{ width: '100%' }}>
                  <span className="mono" style={{ opacity: 0.5, fontSize: '0.65rem', marginRight: 8 }}>{sc.hash.slice(0, 6)}</span>
                  {sc.label || '(etiketsiz)'}
                  {typeof sc.nodeCount === 'number' ? <span className="helper" style={{ marginLeft: 'auto', fontSize: '0.7rem' }}>{sc.nodeCount} düğüm</span> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </HoloPanel>
    </main>
  );
}
