'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  BrainCircuit,
  MessageSquare,
  Bot,
  User,
  Send,
  Cpu,
  Wand2,
  Workflow,
  HelpCircle,
  Activity,
  Layers,
  Lightbulb,
  Search,
  AlertTriangle,
  CheckCircle2
} from 'lucide-react';
import { HoloHeader, HoloPanel, HoloStat, Holo3D } from '../../components/hud';

const AIGC = [
  { title: 'Görüntüden Videoya', desc: 'Tek bir görselden kısa videolar oluşturun.', prompt: 'Görüntüden videoya bir üretim planlamama yardım et: bir ürün görselini bulut telefonlarım için kısa bir tanıtım videosuna dönüştürmek için hangi araçları ve adımları kullanmalıyım?' },
  { title: 'Metinden Videoya', desc: 'Bir komutu yayına hazır videoya dönüştürün.', prompt: 'Metinden videoya bir reklam için kısa, etkili bir senaryo ve çekim listesi yaz. Konu: ' },
  { title: 'Görsel Oluştur', desc: 'Gönderileriniz için markaya uygun görseller oluşturun.', prompt: 'Şunun için sosyal medya grafikleri üretmek üzere kullanabileceğim markaya uygun görsel komutları (stil, renkler, kompozisyon ile) öner: ' }
];

const AUTOMATION = [
  { title: 'TikTok video paylaşımı', icon: 'TT', color: '#111', prompt: 'Bir bulut telefondan TikTok\'a video paylaşmak için adım adım bir RPA otomasyon akışı taslağı çıkar (uygulamayı aç, yükle, açıklama, etiketler, yayınla).' },
  { title: 'TikTok carousel paylaşımı', icon: 'TT', color: '#111', prompt: 'Bir bulut telefondan TikTok\'a fotoğraf carousel\'i paylaşmak için adım adım bir RPA otomasyon akışı taslağı çıkar.' },
  { title: 'Facebook\'ta içerik paylaş', icon: 'FB', color: '#1877f2', prompt: 'Bir bulut telefondan Facebook\'ta bir gönderi yayınlamak için adım adım bir RPA otomasyon akışı taslağı çıkar.' },
  { title: 'YouTube Shorts yayınla', icon: 'YT', color: '#ff0000', prompt: 'Bir bulut telefondan YouTube Short yüklemek için adım adım bir RPA otomasyon akışı taslağı çıkar.' },
  { title: 'Instagram\'da Reels paylaş', icon: 'IG', color: '#d6249f', prompt: 'Bir bulut telefondan Instagram Reel paylaşmak için adım adım bir RPA otomasyon akışı taslağı çıkar.' },
  { title: 'Reddit\'te video yayınla', icon: 'R', color: '#ff4500', prompt: 'Bir bulut telefondan bir subreddit\'e video yayınlamak için adım adım bir RPA otomasyon akışı taslağı çıkar.' }
];

const ASK = ['Faturalandırma nasıl çalışır?', 'RPA nasıl kullanılır?', 'Proxy nasıl yapılandırılır?', 'Nasıl plan seçilir?'];

const MODELS = ['Claude Opus 4.8', 'Claude Sonnet 4.6', 'Claude Haiku 4.5'];

type ChatMessage = { role: 'user' | 'assistant'; text: string };

type Tab = 'chat' | 'insights' | 'query';

type Severity = 'low' | 'medium' | 'high';
type Insights = {
  anomalies: Array<{ title: string; severity: Severity; description: string }>;
  recommendations: Array<{ action: string; priority: Severity; reason: string }>;
  summary: string;
};
type FleetQueryResult = { type: string; message: string; result: Array<Record<string, unknown>> };

// The proxy returns { data } where data may be the error envelope ({error}) on
// failure (apiClient folds a no-`data` body into `data`). Pull a friendly string.
function errFromBody(body: unknown, fallback: string): string {
  const d = (body as { data?: unknown })?.data;
  if (d && typeof d === 'object') {
    const m = (d as { error?: unknown; message?: unknown }).error ?? (d as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  const top = (body as { error?: unknown })?.error;
  if (typeof top === 'string' && top.trim()) return top;
  return fallback;
}

const SEVERITY_COLOR: Record<Severity, string> = {
  high: 'rgba(239, 68, 68, 0.85)',
  medium: 'rgba(245, 158, 11, 0.85)',
  low: 'rgba(56, 189, 248, 0.85)'
};
const SEVERITY_BG: Record<Severity, string> = {
  high: 'rgba(239, 68, 68, 0.10)',
  medium: 'rgba(245, 158, 11, 0.10)',
  low: 'rgba(56, 189, 248, 0.10)'
};
const SEVERITY_LABEL: Record<Severity, string> = { high: 'YÜKSEK', medium: 'ORTA', low: 'DÜŞÜK' };

function severityCard(sev: Severity): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.5rem',
    padding: '0.65rem 0.75rem',
    width: '100%',
    borderRadius: 10,
    border: `1px solid ${SEVERITY_COLOR[sev]}`,
    background: SEVERITY_BG[sev],
    color: 'inherit'
  };
}

export function AiView() {
  const [tab, setTab] = useState<Tab>('chat');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(MODELS[0]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // İçgörüler
  const [insights, setInsights] = useState<Insights | null>(null);
  const [insightsBusy, setInsightsBusy] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  // Filoya Sor
  const [fleetQuery, setFleetQuery] = useState('');
  const [queryResult, setQueryResult] = useState<FleetQueryResult | null>(null);
  const [queryBusy, setQueryBusy] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);

  async function loadInsights() {
    if (insightsBusy) return;
    setInsightsBusy(true);
    setInsightsError(null);
    try {
      const res = await fetch('/api/ai/insights', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const json = await res.json();
      if (!res.ok) throw new Error(errFromBody(json, 'İçgörüler alınamadı.'));
      setInsights(json.data as Insights);
    } catch (err) {
      setInsightsError(err instanceof Error ? err.message : 'İçgörüler alınamadı.');
    } finally {
      setInsightsBusy(false);
    }
  }

  async function runFleetQuery() {
    const q = fleetQuery.trim();
    if (q.length < 3 || queryBusy) return;
    setQueryBusy(true);
    setQueryError(null);
    try {
      const res = await fetch('/api/ai/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(errFromBody(json, 'Sorgu başarısız oldu.'));
      setQueryResult(json.data as FleetQueryResult);
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : 'Sorgu başarısız oldu.');
      setQueryResult(null);
    } finally {
      setQueryBusy(false);
    }
  }

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  async function send() {
    const text = prompt.trim();
    if (!text || busy) return;
    setMessages((m) => [...m, { role: 'user', text }]);
    setPrompt('');
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, model })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'AI isteği başarısız oldu.');
      setMessages((m) => [...m, { role: 'assistant', text: json.data.text }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI isteği başarısız oldu.');
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const hasChat = messages.length > 0;
  const userTurns = messages.filter((m) => m.role === 'user').length;
  const assistantTurns = messages.filter((m) => m.role === 'assistant').length;
  const templateCount = AIGC.length + AUTOMATION.length + ASK.length;

  return (
    <main className="page ai-page">
      <HoloHeader
        eyebrow="AI AKIŞ MİMARI"
        title="Fleet AI"
        subtitle="Doğal dilden RPA akışlarına, içerik ve otomasyon planlarına — holografik komuta güvertesi."
        actions={
          <span className="status-chip">
            <span className={`dot ${busy ? 'dot-online' : 'dot-offline'}`} />
            <span className="mono">{busy ? 'İŞLİYOR' : 'HAZIR'}</span>
          </span>
        }
      />

      <div className="seg-tabs" role="tablist" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'chat'}
          className={tab === 'chat' ? 'ai-row active' : 'ai-row'}
          style={{ width: 'auto', flex: '0 0 auto' }}
          onClick={() => setTab('chat')}
        >
          <span className="ai-row-ico" aria-hidden><MessageSquare size={14} /></span>
          Sohbet
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'insights'}
          className={tab === 'insights' ? 'ai-row active' : 'ai-row'}
          style={{ width: 'auto', flex: '0 0 auto' }}
          onClick={() => { setTab('insights'); if (!insights && !insightsBusy) void loadInsights(); }}
        >
          <span className="ai-row-ico" aria-hidden><Lightbulb size={14} /></span>
          İçgörüler
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'query'}
          className={tab === 'query' ? 'ai-row active' : 'ai-row'}
          style={{ width: 'auto', flex: '0 0 auto' }}
          onClick={() => setTab('query')}
        >
          <span className="ai-row-ico" aria-hidden><Search size={14} /></span>
          Filoya Sor
        </button>
      </div>

      {tab === 'insights' ? (
        <HoloPanel
          title="AI İçgörüleri"
          icon={<Lightbulb size={18} />}
          actions={
            <button type="button" className="btn-secondary" disabled={insightsBusy} onClick={() => void loadInsights()}>
              {insightsBusy ? 'Analiz ediliyor…' : 'Yenile'}
            </button>
          }
        >
          {insightsError ? (
            <p className="field-error">{insightsError}</p>
          ) : insightsBusy && !insights ? (
            <p className="helper">Fleet AI filo sinyallerini analiz ediyor…</p>
          ) : !insights ? (
            <p className="helper">İçgörü oluşturmak için “Yenile”ye basın.</p>
          ) : (
            <div className="ai-stack" style={{ gap: '1rem' }}>
              {insights.summary ? <p className="helper" style={{ lineHeight: 1.5 }}>{insights.summary}</p> : null}

              <div>
                <h3 className="mono" style={{ fontSize: '0.8rem', opacity: 0.7, margin: '0 0 0.5rem' }}>ANOMALİLER</h3>
                {insights.anomalies.length === 0 ? (
                  <p className="helper">Anomali bulunamadı.</p>
                ) : (
                  <div className="ai-stack" style={{ gap: '0.5rem' }}>
                    {insights.anomalies.map((a, i) => (
                      <div key={i} style={severityCard(a.severity)}>
                        <AlertTriangle size={14} style={{ marginTop: 2, flex: '0 0 auto', color: SEVERITY_COLOR[a.severity] }} />
                        <span>
                          <strong>{a.title}</strong>
                          <span className="mono" style={{ fontSize: '0.65rem', marginLeft: 6, opacity: 0.8 }}>[{SEVERITY_LABEL[a.severity]}]</span>
                          <br />
                          <span className="helper">{a.description}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="mono" style={{ fontSize: '0.8rem', opacity: 0.7, margin: '0 0 0.5rem' }}>ÖNERİLER</h3>
                {insights.recommendations.length === 0 ? (
                  <p className="helper">Öneri yok.</p>
                ) : (
                  <div className="ai-stack" style={{ gap: '0.5rem' }}>
                    {insights.recommendations.map((r, i) => (
                      <div key={i} style={severityCard(r.priority)}>
                        <CheckCircle2 size={14} style={{ marginTop: 2, flex: '0 0 auto', color: SEVERITY_COLOR[r.priority] }} />
                        <span>
                          <strong>{r.action}</strong>
                          <span className="mono" style={{ fontSize: '0.65rem', marginLeft: 6, opacity: 0.8 }}>[{SEVERITY_LABEL[r.priority]}]</span>
                          <br />
                          <span className="helper">{r.reason}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </HoloPanel>
      ) : null}

      {tab === 'query' ? (
        <HoloPanel title="Filoya Sor" icon={<Search size={18} />}>
          <div className="ai-input-card">
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                className="ai-input"
                style={{ minHeight: 'auto' }}
                placeholder="Örn: en sağlıksız 10 hesabı göster"
                maxLength={500}
                value={fleetQuery}
                onChange={(e) => setFleetQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runFleetQuery(); } }}
              />
              <button type="button" className="ai-send btn-primary" disabled={fleetQuery.trim().length < 3 || queryBusy} onClick={() => void runFleetQuery()}>
                <Search size={16} />
              </button>
            </div>
            {queryError ? <p className="field-error">{queryError}</p> : null}
          </div>

          {queryBusy ? (
            <p className="helper" style={{ marginTop: '1rem' }}>Sorgu çalıştırılıyor…</p>
          ) : queryResult ? (
            <div style={{ marginTop: '1rem' }}>
              <p className="helper mono" style={{ marginBottom: '0.5rem' }}>{queryResult.message}</p>
              {queryResult.result.length === 0 ? (
                <p className="helper">Sonuç yok.</p>
              ) : (
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr>
                        {Object.keys(queryResult.result[0] ?? {}).map((k) => (
                          <th key={k} className="mono" style={{ textAlign: 'left', padding: '0.4rem 0.6rem', borderBottom: '1px solid rgba(255,255,255,0.12)', opacity: 0.7, fontSize: '0.7rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {queryResult.result.map((row, i) => (
                        <tr key={i}>
                          {Object.keys(queryResult.result[0] ?? {}).map((k) => (
                            <td key={k} className="mono" style={{ padding: '0.4rem 0.6rem', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>{row[k] === null || row[k] === undefined ? '—' : String(row[k])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </HoloPanel>
      ) : null}

      {tab !== 'chat' ? null : (
      <>
      <div className="holo-stats-grid">
        <HoloStat
          label="Aktif Model"
          value={<span className="mono" style={{ fontSize: '0.95rem' }}>{model}</span>}
          sub="Anthropic Messages"
          tone="cyan"
          icon={<Cpu size={16} />}
        />
        <HoloStat
          label="Diyalog Turu"
          value={<span className="mono">{messages.length}</span>}
          sub={`${userTurns} sorgu · ${assistantTurns} yanıt`}
          tone="info"
          icon={<MessageSquare size={16} />}
        />
        <HoloStat
          label="Hazır Şablon"
          value={<span className="mono">{templateCount}</span>}
          sub="AIGC · Otomasyon · Soru"
          tone="violet"
          icon={<Layers size={16} />}
        />
        <HoloStat
          label="Çekirdek Durumu"
          value={<span className="mono">{busy ? 'ANALİZ' : 'BEKLEME'}</span>}
          sub={error ? 'Son istek hatalı' : 'Senkron'}
          tone={error ? 'error' : busy ? 'warning' : 'success'}
          icon={<Activity size={16} />}
        />
      </div>

      <HoloPanel
        title={hasChat ? 'Diyalog Akışı' : 'Sinyal Yok'}
        icon={<BrainCircuit size={18} />}
        actions={hasChat ? <span className="status-chip mono">{messages.length} mesaj</span> : null}
      >
        {!hasChat ? (
          <div className="ai-hero">
            <div className="ai-logo"><Sparkles size={32} /></div>
            <h1>Bugün senin için ne yapabilirim?</h1>
            <p className="helper">Komut girin veya aşağıdaki holografik şablonlardan birini etkinleştirin.</p>
          </div>
        ) : (
          <div className="ai-thread" ref={threadRef}>
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'ai-msg ai-msg-user' : 'ai-msg ai-msg-assistant'}>
                <span className="ai-msg-ico" aria-hidden>
                  {m.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                </span>
                <span className="ai-msg-body">{m.text}</span>
              </div>
            ))}
            {busy ? (
              <div className="ai-msg ai-msg-assistant helper">
                <span className="ai-msg-ico" aria-hidden><Bot size={14} /></span>
                <span className="ai-msg-body">Fleet AI düşünüyor…</span>
              </div>
            ) : null}
          </div>
        )}
      </HoloPanel>

      <HoloPanel title="Komut Konsolu" icon={<Send size={18} />} scan={false}>
        <div className="ai-input-card">
          <textarea
            className="ai-input"
            placeholder="Fleet AI'ya sorun…"
            maxLength={2000}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {error ? <p className="field-error">{error}</p> : null}
          <div className="ai-input-foot">
            <select className="inline-select" value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <div className="ai-foot-right">
              <span className="helper mono">{prompt.length} / 2000</span>
              <button type="button" className="ai-send btn-primary" disabled={prompt.trim().length === 0 || busy} onClick={send}>
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      </HoloPanel>

      <div className="holo-grid-3">
        <HoloPanel title="AIGC" icon={<Wand2 size={18} />}>
          <div className="holo-grid-auto">
            {AIGC.map((item) => (
              <Holo3D key={item.title} className="ai-card-3d">
                <button type="button" className="ai-card" disabled={busy} onClick={() => setPrompt(item.prompt)}>
                  <span className="ai-card-ico" aria-hidden><Sparkles size={16} /></span>
                  <strong>{item.title}</strong>
                  <span className="helper">{item.desc}</span>
                </button>
              </Holo3D>
            ))}
          </div>
        </HoloPanel>

        <HoloPanel title="AI Otomasyonu" icon={<Workflow size={18} />}>
          <div className="ai-stack">
            {AUTOMATION.map((item) => (
              <button type="button" className="ai-row" key={item.title} disabled={busy} onClick={() => setPrompt(item.prompt)}>
                <span className="tpl-badge" style={{ background: item.color }}>
                  {item.icon}
                </span>
                {item.title}
              </button>
            ))}
          </div>
        </HoloPanel>

        <HoloPanel title="AI'ya Sor" icon={<HelpCircle size={18} />}>
          <div className="ai-stack">
            {ASK.map((q) => (
              <button type="button" className="ai-row" key={q} disabled={busy} onClick={() => { setPrompt(q); }}>
                <span className="ai-row-ico" aria-hidden><MessageSquare size={14} /></span>
                {q}
              </button>
            ))}
          </div>
        </HoloPanel>
      </div>
      </>
      )}
    </main>
  );
}
