'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

export type RpaDevice = { id: string; name: string };

export type RpaStep = {
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
    setSteps(flow.steps);
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
    setSteps((s) => [...s, defaults[type]]);
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
      const body = { name: name.trim(), description: description.trim(), steps };
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

  return (
    <PageMotion className="page">
      <PageHeader
        title="RPA Studio"
        subtitle="Görsel otomasyon akışları oluşturun ve bunları bulut telefonlarınızda çalıştırın."
        actions={
          <button type="button" className="btn-primary" onClick={openNew}>
            + Yeni akış
          </button>
        }
      />

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}

      {flows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-art">⚙</div>
          <h3>Henüz otomasyon akışı yok</h3>
          <p>Dokun / yaz / kaydır / bekle adımlarından oluşan bir akış oluşturun ve telefonlarınıza gönderin.</p>
          <button type="button" className="btn-primary" onClick={openNew}>
            + Yeni akış
          </button>
        </div>
      ) : (
        <div className="app-grid">
          {flows.map((flow) => (
            <article className="flow-card" key={flow.id}>
              <div className="flow-card-head">
                <span className="app-icon">⚙</span>
                <div>
                  <strong>{flow.name}</strong>
                  <p className="helper">{flow.description || 'Açıklama yok'}</p>
                </div>
              </div>
              <span className="helper mono">{flow.steps.length} adım · {flow.runCount}× çalıştırıldı</span>
              <div className="row-actions flow-actions">
                <button type="button" className="action-btn" onClick={() => openEdit(flow)}>
                  Düzenle
                </button>
                <button type="button" className="action-btn" onClick={() => setRunFlow(flow)}>
                  Çalıştır
                </button>
                <button type="button" className="action-btn action-danger" onClick={() => remove(flow)}>
                  Sil
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing ? (
        <div className="modal-overlay" onClick={() => !busy && setEditing(null)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>{editing.id ? 'Akışı düzenle' : 'Yeni akış'}</h2>
              <button type="button" className="modal-close" onClick={() => !busy && setEditing(null)}>
                ✕
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
                <h3>Adımlar ({steps.length})</h3>
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
                    <li className="step-item" key={i}>
                      <span className="step-num">{i + 1}</span>
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
                        <button type="button" className="step-ctrl" onClick={() => moveStep(i, -1)} disabled={i === 0}>↑</button>
                        <button type="button" className="step-ctrl" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1}>↓</button>
                        <button type="button" className="step-ctrl step-del" onClick={() => removeStep(i)}>✕</button>
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
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>"{runFlow.name}" çalıştır</h2>
              <button type="button" className="modal-close" onClick={() => !busy && setRunFlow(null)}>
                ✕
              </button>
            </header>
            <p className="helper">{runFlow.steps.map(describeStep).join(' → ')}</p>
            <div className="modal-section">
              <h3>Hedef telefonları seçin</h3>
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
