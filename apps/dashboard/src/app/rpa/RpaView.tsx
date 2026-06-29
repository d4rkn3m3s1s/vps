'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, Holo3D, Reveal } from '../../components/hud';
import {
  Sparkles,
  Plus,
  Cpu,
  Workflow,
  Play,
  Pencil,
  Copy,
  Trash2,
  ArrowUp,
  ArrowDown,
  X,
  Layers,
  Activity,
  Smartphone,
  ListOrdered
} from 'lucide-react';

export type RpaDevice = { id: string; name: string };

export type RpaStep = {
  // Stable per-step id used as React key on the reorderable/deletable step list.
  // Not part of the persisted payload (stripped before save).
  _id?: string;
  type: 'tap' | 'type' | 'wait' | 'swipe' | 'openApp' | 'shell' | 'keyevent';
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  text?: string;
  ms?: number;
  packageName?: string;
  command?: string;
  keycode?: number;
};

export type RpaFlow = {
  id: string;
  name: string;
  description: string | null;
  steps: RpaStep[];
  runCount: number;
  lastRunAt: string | null;
};

const STEP_TYPES: RpaStep['type'][] = ['tap', 'type', 'wait', 'swipe', 'openApp', 'shell', 'keyevent'];

// One-click starting points so operators don't build common flows from scratch.
const TEMPLATES: Array<{ name: string; description: string; steps: RpaStep[] }> = [
  {
    name: 'Instagram ısınma',
    description: 'Uygulamayı aç, akışı kaydır, bekle',
    steps: [
      { type: 'openApp', packageName: 'com.instagram.android' },
      { type: 'wait', ms: 4000 },
      { type: 'swipe', x: 540, y: 1500, x2: 540, y2: 500 },
      { type: 'wait', ms: 2500 },
      { type: 'swipe', x: 540, y: 1500, x2: 540, y2: 500 },
      { type: 'wait', ms: 2500 }
    ]
  },
  {
    name: 'TikTok izleme',
    description: 'Uygulamayı aç, videoları geç',
    steps: [
      { type: 'openApp', packageName: 'com.zhiliaoapp.musically' },
      { type: 'wait', ms: 5000 },
      { type: 'swipe', x: 540, y: 1600, x2: 540, y2: 400 },
      { type: 'wait', ms: 6000 },
      { type: 'swipe', x: 540, y: 1600, x2: 540, y2: 400 },
      { type: 'wait', ms: 6000 }
    ]
  },
  {
    name: 'Uygulama başlat + ana ekran',
    description: 'Bir uygulamayı aç, bekle, ana ekrana dön',
    steps: [
      { type: 'openApp', packageName: 'com.android.chrome' },
      { type: 'wait', ms: 3000 },
      { type: 'keyevent', keycode: 3 }
    ]
  }
];

const STEP_ICON: Record<RpaStep['type'], string> = {
  tap: '⊙',
  type: '⌨',
  wait: '◷',
  swipe: '↕',
  openApp: '▤',
  shell: '>_',
  keyevent: '⎚'
};

type Toast = { kind: 'ok' | 'err'; text: string } | null;

let stepIdSeq = 0;
function newStepId(): string {
  stepIdSeq += 1;
  return `step-${Date.now().toString(36)}-${stepIdSeq}`;
}
// Attach a stable _id to each step (used as React key on the reorderable list).
function withStepIds(steps: RpaStep[]): RpaStep[] {
  return steps.map((s) => (s._id ? s : { ...s, _id: newStepId() }));
}

function describeStep(s: RpaStep): string {
  switch (s.type) {
    case 'tap':
      return `(${s.x ?? 0}, ${s.y ?? 0}) konumuna dokun`;
    case 'type':
      return `"${s.text ?? ''}" yaz`;
    case 'wait':
      return `${s.ms ?? 0} ms bekle`;
    case 'swipe':
      return `Kaydır (${s.x ?? 0},${s.y ?? 0}) → (${s.x2 ?? 0},${s.y2 ?? 0})`;
    case 'openApp':
      return `${s.packageName ?? ''} uygulamasını aç`;
    case 'shell':
      return `Shell: ${s.command ?? ''}`;
    case 'keyevent':
      return `Tuş olayı ${s.keycode ?? 0}`;
    default:
      return s.type;
  }
}

export function RpaView({ flows, devices }: { flows: RpaFlow[]; devices: RpaDevice[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<RpaFlow | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<RpaStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [runFlow, setRunFlow] = useState<RpaFlow | null>(null);
  const [runDevices, setRunDevices] = useState<Set<string>>(new Set());
  // AI flow builder (natural language → steps).
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);

  // Escape closes whichever modal is open (unless a request is in flight).
  useEffect(() => {
    if (!aiOpen && !editing && !runFlow) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (aiOpen && !aiBusy) setAiOpen(false);
      else if (editing && !busy) setEditing(null);
      else if (runFlow && !busy) setRunFlow(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aiOpen, editing, runFlow, aiBusy, busy]);

  function flash(t: Toast) {
    setToast(t);
    setTimeout(() => setToast(null), 3500);
  }

  function openNew() {
    setEditing({ id: '', name: '', description: null, steps: [], runCount: 0, lastRunAt: null });
    setName('');
    setDescription('');
    setSteps([]);
  }

  function openEdit(flow: RpaFlow) {
    setEditing(flow);
    setName(flow.name);
    setDescription(flow.description ?? '');
    setSteps(withStepIds(flow.steps));
  }

  // Seed the editor from a template (still requires Save — operator can tweak first).
  function openTemplate(t: (typeof TEMPLATES)[number]) {
    setEditing({ id: '', name: '', description: null, steps: [], runCount: 0, lastRunAt: null });
    setName(t.name);
    setDescription(t.description);
    setSteps(withStepIds(t.steps.map((s) => ({ ...s }))));
  }

  // Clone an existing flow into a new draft.
  function duplicate(flow: RpaFlow) {
    setEditing({ id: '', name: '', description: null, steps: [], runCount: 0, lastRunAt: null });
    setName(`${flow.name} (kopya)`);
    setDescription(flow.description ?? '');
    setSteps(withStepIds(flow.steps.map(({ _id, ...rest }) => ({ ...rest }))));
  }

  function addStep(type: RpaStep['type']) {
    const defaults: Record<RpaStep['type'], RpaStep> = {
      tap: { type: 'tap', x: 540, y: 1000 },
      type: { type: 'type', text: '' },
      wait: { type: 'wait', ms: 1000 },
      swipe: { type: 'swipe', x: 540, y: 1500, x2: 540, y2: 500 },
      openApp: { type: 'openApp', packageName: 'com.instagram.android' },
      shell: { type: 'shell', command: '' },
      keyevent: { type: 'keyevent', keycode: 4 }
    };
    setSteps((s) => [...s, { ...defaults[type], _id: newStepId() }]);
  }

  function updateStep(i: number, patch: Partial<RpaStep>) {
    setSteps((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));
  }

  function removeStep(i: number) {
    setSteps((s) => s.filter((_, idx) => idx !== i));
  }

  function moveStep(i: number, dir: -1 | 1) {
    setSteps((s) => {
      const next = [...s];
      const j = i + dir;
      if (j < 0 || j >= next.length) return s;
      [next[i], next[j]] = [next[j] as RpaStep, next[i] as RpaStep];
      return next;
    });
  }

  async function save() {
    if (!name.trim()) {
      flash({ kind: 'err', text: 'Akış adı gereklidir.' });
      return;
    }
    setBusy(true);
    try {
      const cleanSteps = steps.map(({ _id, ...rest }) => rest);
      const body = { name: name.trim(), description: description.trim(), steps: cleanSteps };
      const isNew = !editing?.id;
      const res = await fetch(isNew ? '/api/rpa' : `/api/rpa/${editing!.id}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`Kaydetme başarısız (${res.status})`);
      setEditing(null);
      flash({ kind: 'ok', text: 'Akış kaydedildi.' });
      router.refresh();
    } catch (err) {
      flash({ kind: 'err', text: err instanceof Error ? err.message : 'Kaydetme başarısız' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(flow: RpaFlow) {
    if (!confirm(`"${flow.name}" akışı silinsin mi?`)) return;
    await fetch(`/api/rpa/${flow.id}`, { method: 'DELETE' });
    router.refresh();
  }

  async function dispatch() {
    if (!runFlow || runDevices.size === 0) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/rpa/${runFlow.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceIds: Array.from(runDevices) })
      });
      if (!res.ok) throw new Error(`Çalıştırma başarısız (${res.status})`);
      setRunFlow(null);
      setRunDevices(new Set());
      flash({ kind: 'ok', text: `${runDevices.size} cihaza gönderildi.` });
      router.refresh();
    } catch (err) {
      flash({ kind: 'err', text: err instanceof Error ? err.message : 'Çalıştırma başarısız' });
    } finally {
      setBusy(false);
    }
  }

  // Generate a flow draft from a natural-language prompt, then open it in the
  // editor pre-filled so the operator can review/tweak before saving.
  async function generateWithAi() {
    if (aiPrompt.trim().length < 3) {
      flash({ kind: 'err', text: 'Lütfen ne yapılacağını yazın.' });
      return;
    }
    setAiBusy(true);
    try {
      const res = await fetch('/api/ai/generate-flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt.trim() })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.data?.message ?? json?.message ?? `Üretim başarısız (${res.status})`);
      const draft = json.data as { name: string; description: string; steps: RpaStep[] };
      setEditing({ id: '', name: '', description: null, steps: [], runCount: 0, lastRunAt: null });
      setName(draft.name);
      setDescription(draft.description ?? '');
      setSteps(withStepIds(draft.steps));
      setAiOpen(false);
      setAiPrompt('');
      flash({ kind: 'ok', text: `AI ${draft.steps.length} adımlık akış oluşturdu — gözden geçirip kaydedin.` });
    } catch (err) {
      flash({ kind: 'err', text: err instanceof Error ? err.message : 'Üretim başarısız' });
    } finally {
      setAiBusy(false);
    }
  }

  // Derived summary metrics (presentation only).
  const totalSteps = flows.reduce((acc, f) => acc + f.steps.length, 0);
  const totalRuns = flows.reduce((acc, f) => acc + f.runCount, 0);

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="RPA STÜDYOSU"
        title="RPA Studio"
        subtitle="Görsel otomasyon akışları oluşturun ve bunları bulut telefonlarınızda çalıştırın."
        actions={
          <>
            <button type="button" className="btn-ghost" onClick={() => setAiOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={15} /> AI ile oluştur
            </button>
            <button type="button" className="btn-primary" onClick={openNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plus size={15} /> Yeni akış
            </button>
          </>
        }
      />

      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat label="Otomasyon akışı" value={<span className="mono">{flows.length}</span>} sub="Kayıtlı akış" tone="info" icon={<Workflow size={16} />} />
          <HoloStat label="Toplam adım" value={<span className="mono">{totalSteps}</span>} sub="Tüm akışlar" tone="cyan" icon={<ListOrdered size={16} />} />
          <HoloStat label="Çalıştırma" value={<span className="mono">{totalRuns}</span>} sub="Kümülatif tetikleme" tone="violet" icon={<Activity size={16} />} />
          <HoloStat label="Hedef cihaz" value={<span className="mono">{devices.length}</span>} sub="Kullanılabilir telefon" tone="success" icon={<Smartphone size={16} />} />
        </div>
      </Reveal>

      {aiOpen ? (
        <div className="modal-overlay" onClick={() => !aiBusy && setAiOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Sparkles size={18} /> AI ile akış oluştur</h2>
              <button type="button" className="modal-close" aria-label="Kapat" onClick={() => !aiBusy && setAiOpen(false)}>
                <X size={16} />
              </button>
            </header>
            <div className="modal-body">
              <p className="helper">Telefonda ne yapılmasını istediğinizi doğal dille yazın; AI bunu çalıştırılabilir adımlara çevirir.</p>
              <textarea
                className="field-input"
                rows={4}
                placeholder="örn. Instagram'ı aç, ana akışı 5 kez kaydır ve ilk 3 gönderiyi beğen"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
              />
              <p className="helper" style={{ marginTop: 8 }}>Üretilen akış otomatik kaydedilmez — editörde açılır, düzenleyip kaydedebilirsiniz.</p>
            </div>
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={() => setAiOpen(false)} disabled={aiBusy}>İptal</button>
              <button type="button" className="btn-primary" onClick={generateWithAi} disabled={aiBusy || aiPrompt.trim().length < 3}>
                {aiBusy ? 'Oluşturuluyor…' : 'Oluştur'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}

      <Reveal delay={0.04}>
        <HoloPanel title="Hızlı şablonlar" icon={<Sparkles size={16} />}>
          <p className="helper" style={{ marginBottom: 12 }}>Hazır bir akışla başlayın — editörde açılır, düzenleyip kaydedin.</p>
          <div className="rpa-template-row">
            {TEMPLATES.map((t) => (
              <button key={t.name} type="button" className="rpa-template" onClick={() => openTemplate(t)}>
                <span className="rpa-template-ico"><Workflow size={16} /></span>
                <span className="rpa-template-body">
                  <strong>{t.name}</strong>
                  <span className="helper">{t.description}</span>
                  <span className="rpa-template-meta mono">{t.steps.length} adım</span>
                </span>
              </button>
            ))}
          </div>
        </HoloPanel>
      </Reveal>

      {flows.length === 0 ? (
        <Reveal>
          <HoloPanel title="Otomasyon akışları" icon={<Workflow size={16} />}>
            <div className="empty-state">
              <div className="empty-art">⚙</div>
              <h3>Henüz otomasyon akışı yok</h3>
              <p>Dokun / yaz / kaydır / bekle adımlarından oluşan bir akış oluşturun ve telefonlarınıza gönderin.</p>
              <button type="button" className="btn-primary" onClick={openNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Plus size={15} /> Yeni akış
              </button>
            </div>
          </HoloPanel>
        </Reveal>
      ) : (
        <Reveal>
          <div className="holo-grid-auto">
            {flows.map((flow) => (
              <Holo3D className="holo-card" key={flow.id} max={6}>
                <div className="flow-card-head">
                  <span className="app-icon"><Workflow size={18} /></span>
                  <div>
                    <strong>{flow.name}</strong>
                    <p className="helper">{flow.description || 'Açıklama yok'}</p>
                  </div>
                </div>
                <div className="status-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span className="dot dot-cyan" />
                  <span className="helper mono">{flow.steps.length} adım · {flow.runCount}× çalıştırıldı</span>
                </div>
                <div className="row-actions flow-actions" style={{ marginTop: 'auto' }}>
                  <button type="button" className="btn-ghost btn-xs" onClick={() => openEdit(flow)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Pencil size={13} /> Düzenle
                  </button>
                  <button type="button" className="btn-primary btn-xs" onClick={() => setRunFlow(flow)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Play size={13} /> Çalıştır
                  </button>
                  <button type="button" className="btn-ghost btn-xs" onClick={() => duplicate(flow)} title="Çoğalt" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Copy size={13} /> Çoğalt
                  </button>
                  <button type="button" className="btn-ghost btn-xs action-danger" onClick={() => remove(flow)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Trash2 size={13} /> Sil
                  </button>
                </div>
              </Holo3D>
            ))}
          </div>
        </Reveal>
      )}

      {editing ? (
        <div className="modal-overlay" onClick={() => !busy && setEditing(null)}>
          <div className="modal modal-wide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Workflow size={18} />{editing.id ? 'Akışı düzenle' : 'Yeni akış'}
              </h2>
              <button type="button" className="modal-close" onClick={() => !busy && setEditing(null)}>
                <X size={16} />
              </button>
            </header>

            <div className="field-row">
              <label className="field">
                <span>Akış adı</span>
                <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="örn. IG ısınma" />
              </label>
              <label className="field">
                <span>Açıklama</span>
                <input className="field-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="isteğe bağlı" />
              </label>
            </div>

            <div className="modal-section">
              <div className="row">
                <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Layers size={15} /> Adımlar ({steps.length})</h3>
                <div className="step-add">
                  {STEP_TYPES.map((t) => (
                    <button key={t} type="button" className="step-add-btn" onClick={() => addStep(t)} title={`${t} ekle`}>
                      {STEP_ICON[t]} {t}
                    </button>
                  ))}
                </div>
              </div>

              <ol className="step-list">
                {steps.length === 0 ? (
                  <li className="helper">Henüz adım yok — yukarıdan bir tane ekleyin.</li>
                ) : (
                  steps.map((step, i) => (
                    <li className="step-item" key={step._id ?? i}>
                      <span className="step-num mono">{i + 1}</span>
                      <span className="step-ico">{STEP_ICON[step.type]}</span>
                      <div className="step-fields">
                        <span className="step-type">{step.type}</span>
                        {step.type === 'tap' && (
                          <span className="step-inputs">
                            <input className="mini-input" type="number" value={step.x ?? 0} onChange={(e) => updateStep(i, { x: Number(e.target.value) })} placeholder="x" />
                            <input className="mini-input" type="number" value={step.y ?? 0} onChange={(e) => updateStep(i, { y: Number(e.target.value) })} placeholder="y" />
                          </span>
                        )}
                        {step.type === 'type' && (
                          <input className="mini-input wide" value={step.text ?? ''} onChange={(e) => updateStep(i, { text: e.target.value })} placeholder="yazılacak metin" />
                        )}
                        {step.type === 'wait' && (
                          <input className="mini-input" type="number" value={step.ms ?? 0} onChange={(e) => updateStep(i, { ms: Number(e.target.value) })} placeholder="ms" />
                        )}
                        {step.type === 'swipe' && (
                          <span className="step-inputs">
                            <input className="mini-input" type="number" value={step.x ?? 0} onChange={(e) => updateStep(i, { x: Number(e.target.value) })} placeholder="x1" />
                            <input className="mini-input" type="number" value={step.y ?? 0} onChange={(e) => updateStep(i, { y: Number(e.target.value) })} placeholder="y1" />
                            <input className="mini-input" type="number" value={step.x2 ?? 0} onChange={(e) => updateStep(i, { x2: Number(e.target.value) })} placeholder="x2" />
                            <input className="mini-input" type="number" value={step.y2 ?? 0} onChange={(e) => updateStep(i, { y2: Number(e.target.value) })} placeholder="y2" />
                          </span>
                        )}
                        {step.type === 'openApp' && (
                          <input className="mini-input wide mono" value={step.packageName ?? ''} onChange={(e) => updateStep(i, { packageName: e.target.value })} placeholder="com.app.package" />
                        )}
                        {step.type === 'shell' && (
                          <input className="mini-input wide mono" value={step.command ?? ''} onChange={(e) => updateStep(i, { command: e.target.value })} placeholder="adb shell command" />
                        )}
                        {step.type === 'keyevent' && (
                          <input className="mini-input" type="number" value={step.keycode ?? 0} onChange={(e) => updateStep(i, { keycode: Number(e.target.value) })} placeholder="keycode" />
                        )}
                      </div>
                      <div className="step-ctrls">
                        <button type="button" className="step-ctrl" onClick={() => moveStep(i, -1)} disabled={i === 0}><ArrowUp size={13} /></button>
                        <button type="button" className="step-ctrl" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1}><ArrowDown size={13} /></button>
                        <button type="button" className="step-ctrl step-del" onClick={() => removeStep(i)}><X size={13} /></button>
                      </div>
                    </li>
                  ))
                )}
              </ol>
            </div>

            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={() => !busy && setEditing(null)}>
                İptal
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={save}>
                {busy ? 'Kaydediliyor…' : 'Akışı kaydet'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {runFlow ? (
        <div className="modal-overlay" onClick={() => !busy && setRunFlow(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Play size={18} /> "{runFlow.name}" çalıştır</h2>
              <button type="button" className="modal-close" onClick={() => !busy && setRunFlow(null)}>
                <X size={16} />
              </button>
            </header>
            <p className="helper">{runFlow.steps.map(describeStep).join(' → ')}</p>
            <div className="modal-section">
              <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Cpu size={15} /> Hedef telefonları seçin</h3>
              <div className="run-devices">
                {devices.length === 0 ? (
                  <span className="helper">Kullanılabilir cihaz yok.</span>
                ) : (
                  devices.map((d) => (
                    <label className="field-check" key={d.id}>
                      <input
                        type="checkbox"
                        checked={runDevices.has(d.id)}
                        onChange={(e) =>
                          setRunDevices((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(d.id);
                            else next.delete(d.id);
                            return next;
                          })
                        }
                      />
                      <span>{d.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={() => !busy && setRunFlow(null)}>
                İptal
              </button>
              <button type="button" className="btn-primary" disabled={busy || runDevices.size === 0} onClick={dispatch}>
                {busy ? 'Gönderiliyor…' : `${runDevices.size} telefonda çalıştır`}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </PageMotion>
  );
}
