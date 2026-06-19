'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
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

const TABS = ['Pazar Yeri', 'Özel görevler', 'Kayıtlar'] as const;

function PlatformBadge({ platform, color }: { platform: string; color: string }) {
  return (
    <span className="tpl-badge" style={{ background: color }}>
      {platform.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function AutomationView({ templates, devices }: { templates: Template[]; devices: AutoDevice[] }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Pazar Yeri');
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
      flash(`"${runTpl.title}" ${picked.size} telefonda başlatıldı`);
      setRunTpl(null);
    } catch {
      flash(`${runTpl.title} başlatılamadı`);
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
          {t.uses > 0 ? <span className="helper mono">{t.uses} çalıştırma</span> : <span />}
          <button type="button" className="btn-ghost tpl-run" onClick={() => openRun(t)}>
            Şablonu kullan
          </button>
        </div>
      </MotionItem>
    );
  }

  return (
    <PageMotion className="page">
      <PageHeader
        title="Otomasyon"
        subtitle="Bulut telefonlarınızda kodsuz RPA şablonlarını çalıştırın."
        actions={
          <Link href="/rpa" className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            + Yeni görev
          </Link>
        }
      />

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} type="button" className={tab === t ? 'tab tab-active' : 'tab'} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Pazar Yeri' ? (
        <>
          <div className="toolbar-row">
            <div className="search-box">
              <span className="search-icon">⌕</span>
              <input type="text" placeholder="Şablon adı" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>

          {recommended.length > 0 ? (
            <>
              <h3 className="section-label">★ Önerilen</h3>
              <StaggerGrid className="tpl-grid">
                {recommended.map((t) => (
                  <TemplateCard t={t} key={t.id} />
                ))}
              </StaggerGrid>
            </>
          ) : null}

          <h3 className="section-label">▤ Tüm şablonlar</h3>
          <StaggerGrid className="tpl-grid">
            {filtered.map((t) => (
              <TemplateCard t={t} key={`all-${t.id}`} />
            ))}
          </StaggerGrid>
        </>
      ) : tab === 'Özel görevler' ? (
        <div className="empty-state">
          <div className="empty-art">⚙</div>
          <h3>Özel görevler</h3>
          <p>RPA Studio'da kendi kodsuz otomasyonlarınızı oluşturun ve yönetin.</p>
          <Link href="/rpa" className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', marginTop: '0.75rem' }}>
            RPA Studio'yu aç →
          </Link>
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-art">▤</div>
          <h3>Kayıtlar</h3>
          <p>Her otomasyon çalıştırması bir iş olarak kaydedilir. Canlı durumu ve geçmişi İşler sayfasında görüntüleyin.</p>
          <Link href="/jobs" className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', marginTop: '0.75rem' }}>
            İşleri görüntüle →
          </Link>
        </div>
      )}

      {runTpl ? (
        <div className="modal-overlay" onClick={() => !busy && setRunTpl(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>"{runTpl.title}" çalıştır</h2>
              <button type="button" className="modal-close" onClick={() => !busy && setRunTpl(null)}>
                ✕
              </button>
            </header>
            <p className="helper">{runTpl.description}</p>
            <div className="modal-section">
              <h3>Hedef telefonları seçin</h3>
              <div className="run-devices">
                {devices.length === 0 ? (
                  <span className="helper">Kullanılabilir bulut telefon yok — önce bir tane oluşturun.</span>
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
              <span className="helper">{picked.size} seçili</span>
              <button type="button" className="btn-primary" disabled={busy || picked.size === 0} onClick={confirmRun}>
                {busy ? 'Başlatılıyor…' : `${picked.size} telefonda çalıştır`}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {toast ? <div className="toast toast-ok">{toast}</div> : null}
    </PageMotion>
  );
}
