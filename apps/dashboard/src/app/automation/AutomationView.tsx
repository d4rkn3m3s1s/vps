'use client';

import { useMemo, useState } from 'react';
import { Button, Input } from '@heroui/react';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion, StaggerGrid, MotionItem } from '../../components/Motion';

export type Template = {
  id: string;
  title: string;
  description: string;
  platform: string;
  color: string;
  recommended: boolean;
  uses: number;
};

export type AutoDevice = { id: string; name: string };

const TABS = ['Marketplace', 'Custom tasks', 'Logs'] as const;

function PlatformBadge({ platform, color }: { platform: string; color: string }) {
  return (
    <span className="tpl-badge" style={{ background: color }}>
      {platform.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function AutomationView({ templates, devices }: { templates: Template[]; devices: AutoDevice[] }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Marketplace');
  const [query, setQuery] = useState('');
  const [runTpl, setRunTpl] = useState<Template | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function flash(t: string) {
    setToast(t);
    setTimeout(() => setToast(null), 3000);
  }

  function openRun(t: Template) {
    setRunTpl(t);
    setPicked(new Set());
  }

  async function confirmRun() {
    if (!runTpl || picked.size === 0) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/catalog/templates/${runTpl.id}/use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceIds: Array.from(picked) })
      });
      if (!res.ok) throw new Error();
      flash(`Started "${runTpl.title}" on ${picked.size} phone(s)`);
      setRunTpl(null);
    } catch {
      flash(`Failed to start ${runTpl.title}`);
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(
    () => templates.filter((t) => t.title.toLowerCase().includes(query.trim().toLowerCase())),
    [templates, query]
  );
  const recommended = filtered.filter((t) => t.recommended);

  function TemplateCard({ t }: { t: Template }) {
    return (
      <MotionItem className="tpl-card">
        <div className="tpl-head">
          <PlatformBadge platform={t.platform} color={t.color} />
          <strong>{t.title}</strong>
        </div>
        <p className="helper">{t.description}</p>
        <div className="row" style={{ marginTop: 'auto' }}>
          {t.uses > 0 ? <span className="helper mono">{t.uses} runs</span> : <span />}
          <Button type="button" variant="ghost" className="btn-ghost tpl-run" onPress={() => openRun(t)}>
            Use template
          </Button>
        </div>
      </MotionItem>
    );
  }

  return (
    <PageMotion className="page">
      <PageHeader
        title="Automation"
        subtitle="Run no-code RPA templates across your cloud phones."
        actions={<Button type="button" variant="primary" className="btn-primary">+ New task</Button>}
      />

      <div className="tabs">
        {TABS.map((t) => (
          <Button key={t} type="button" variant="ghost" className={tab === t ? 'tab tab-active' : 'tab'} onPress={() => setTab(t)}>
            {t}
          </Button>
        ))}
      </div>

      {tab === 'Marketplace' ? (
        <>
          <div className="toolbar-row">
            <div className="search-box">
              <span className="search-icon">⌕</span>
              <Input type="text" placeholder="Template name" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>

          {recommended.length > 0 ? (
            <>
              <h3 className="section-label">★ Recommended</h3>
              <StaggerGrid className="tpl-grid">
                {recommended.map((t) => (
                  <TemplateCard t={t} key={t.id} />
                ))}
              </StaggerGrid>
            </>
          ) : null}

          <h3 className="section-label">▤ All templates</h3>
          <StaggerGrid className="tpl-grid">
            {filtered.map((t) => (
              <TemplateCard t={t} key={`all-${t.id}`} />
            ))}
          </StaggerGrid>
        </>
      ) : (
        <div className="empty-state">
          <div className="empty-art">⚙</div>
          <h3>{tab}</h3>
          <p>Nothing here yet.</p>
        </div>
      )}

      {runTpl ? (
        <div className="modal-overlay" onClick={() => !busy && setRunTpl(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>Run "{runTpl.title}"</h2>
              <Button type="button" isIconOnly variant="ghost" className="modal-close" onPress={() => !busy && setRunTpl(null)}>
                ✕
              </Button>
            </header>
            <p className="helper">{runTpl.description}</p>
            <div className="modal-section">
              <h3>Select target phones</h3>
              <div className="run-devices">
                {devices.length === 0 ? (
                  <span className="helper">No cloud phones available — create one first.</span>
                ) : (
                  devices.map((d) => (
                    <label className="field-check" key={d.id}>
                      <input
                        type="checkbox"
                        checked={picked.has(d.id)}
                        onChange={(e) =>
                          setPicked((prev) => {
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
              <span className="helper">{picked.size} selected</span>
              <Button type="button" variant="primary" className="btn-primary" isDisabled={Boolean(busy || picked.size === 0)} onPress={confirmRun}>
                {busy ? 'Starting…' : `Run on ${picked.size} phone(s)`}
              </Button>
            </footer>
          </div>
        </div>
      ) : null}

      {toast ? <div className="toast toast-ok">{toast}</div> : null}
    </PageMotion>
  );
}
