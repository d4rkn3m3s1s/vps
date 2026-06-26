'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Cpu,
  Plus,
  Search,
  Sparkles,
  LayoutGrid,
  Workflow,
  ScrollText,
  Smartphone,
  Play,
  X,
  Activity,
  Star,
  Boxes
} from 'lucide-react';
import { HoloHeader, HoloPanel, HoloStat, HoloTabs, Holo3D, Reveal } from '../../components/hud';

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

const TAB_DEFS: { key: (typeof TABS)[number]; label: string; icon: React.ReactNode }[] = [
  { key: 'Pazar Yeri', label: 'Pazar Yeri', icon: <LayoutGrid size={14} /> },
  { key: 'Özel görevler', label: 'Özel görevler', icon: <Workflow size={14} /> },
  { key: 'Kayıtlar', label: 'Kayıtlar', icon: <ScrollText size={14} /> }
];

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
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);

  function flash(text: string, kind: 'ok' | 'err' = 'ok') {
    setToast({ text, kind });
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
      flash(`${runTpl.title} başlatılamadı`, 'err');
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(
    () => templates.filter((t) => t.title.toLowerCase().includes(query.trim().toLowerCase())),
    [templates, query]
  );
  const recommended = filtered.filter((t) => t.recommended);

  const totalTemplates = templates.length;
  const recommendedTotal = useMemo(() => templates.filter((t) => t.recommended).length, [templates]);
  const totalRuns = useMemo(() => templates.reduce((acc, t) => acc + (t.uses || 0), 0), [templates]);

  function TemplateCard({ t }: { t: Template }) {
    return (
      <Holo3D className="tpl-card holo-card-3d" max={7}>
        <div className="tpl-head">
          <PlatformBadge platform={t.platform} color={t.color} />
          <strong>{t.title}</strong>
          {t.recommended ? <Star size={13} className="mono" style={{ marginLeft: 'auto', opacity: 0.8 }} /> : null}
        </div>
        <p className="helper">{t.description}</p>
        <div className="row" style={{ marginTop: 'auto', alignItems: 'center' }}>
          {t.uses > 0 ? (
            <span className="status-chip mono">
              <Activity size={12} /> {t.uses} çalıştırma
            </span>
          ) : (
            <span />
          )}
          <button type="button" className="btn-ghost btn-xs tpl-run" onClick={() => openRun(t)}>
            <Play size={13} /> Şablonu kullan
          </button>
        </div>
      </Holo3D>
    );
  }

  return (
    <div className="page">
      <HoloHeader
        eyebrow="OTOMASYON"
        title="Otomasyon"
        subtitle="Bulut telefonlarınızda kodsuz RPA şablonlarını çalıştırın."
        actions={
          <Link
            href="/rpa"
            className="btn-primary icon-row"
            style={{ textDecoration: 'none' }}
          >
            <Plus size={15} /> Yeni görev
          </Link>
        }
      />

      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat
            label="Toplam şablon"
            value={<span className="mono">{totalTemplates}</span>}
            sub="Pazar yerinde"
            tone="cyan"
            icon={<Boxes size={16} />}
          />
          <HoloStat
            label="Önerilen"
            value={<span className="mono">{recommendedTotal}</span>}
            sub="Editör seçimi"
            tone="violet"
            icon={<Sparkles size={16} />}
          />
          <HoloStat
            label="Bağlı telefon"
            value={<span className="mono">{devices.length}</span>}
            sub="Hedeflenebilir"
            tone="info"
            icon={<Smartphone size={16} />}
          />
          <HoloStat
            label="Toplam çalıştırma"
            value={<span className="mono">{totalRuns}</span>}
            sub="Tüm şablonlar"
            tone="success"
            icon={<Activity size={16} />}
          />
        </div>
      </Reveal>

      <HoloTabs tabs={TAB_DEFS} active={tab} onChange={setTab} />

      {tab === 'Pazar Yeri' ? (
        <>
          <Reveal>
            <HoloPanel title="Şablon ara" icon={<Search size={15} />} scan={false}>
              <div className="toolbar-row">
                <div className="search-box">
                  <span className="search-icon">
                    <Search size={14} />
                  </span>
                  <input
                    type="text"
                    placeholder="Şablon adı"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
            </HoloPanel>
          </Reveal>

          {recommended.length > 0 ? (
            <Reveal>
              <HoloPanel title="Önerilen" icon={<Sparkles size={15} />}>
                <div className="holo-grid-auto">
                  {recommended.map((t) => (
                    <TemplateCard t={t} key={t.id} />
                  ))}
                </div>
              </HoloPanel>
            </Reveal>
          ) : null}

          <Reveal>
            <HoloPanel title="Tüm şablonlar" icon={<LayoutGrid size={15} />}>
              <div className="holo-grid-auto">
                {filtered.map((t) => (
                  <TemplateCard t={t} key={`all-${t.id}`} />
                ))}
              </div>
            </HoloPanel>
          </Reveal>
        </>
      ) : tab === 'Özel görevler' ? (
        <Reveal>
          <HoloPanel title="Özel görevler" icon={<Workflow size={15} />}>
            <div className="empty-state">
              <div className="empty-art">
                <Cpu size={36} />
              </div>
              <h3>Özel görevler</h3>
              <p>RPA Studio'da kendi kodsuz otomasyonlarınızı oluşturun ve yönetin.</p>
              <Link
                href="/rpa"
                className="btn-primary icon-row"
                style={{ textDecoration: 'none', marginTop: '0.75rem' }}
              >
                RPA Studio'yu aç →
              </Link>
            </div>
          </HoloPanel>
        </Reveal>
      ) : (
        <Reveal>
          <HoloPanel title="Kayıtlar" icon={<ScrollText size={15} />}>
            <div className="empty-state">
              <div className="empty-art">
                <ScrollText size={36} />
              </div>
              <h3>Kayıtlar</h3>
              <p>
                Her otomasyon çalıştırması bir iş olarak kaydedilir. Canlı durumu ve geçmişi İşler sayfasında
                görüntüleyin.
              </p>
              <Link
                href="/jobs"
                className="btn-primary icon-row"
                style={{ textDecoration: 'none', marginTop: '0.75rem' }}
              >
                İşleri görüntüle →
              </Link>
            </div>
          </HoloPanel>
        </Reveal>
      )}

      {runTpl ? (
        <div className="modal-overlay" onClick={() => !busy && setRunTpl(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>
                <Play size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                "{runTpl.title}" çalıştır
              </h2>
              <button type="button" className="modal-close" onClick={() => !busy && setRunTpl(null)}>
                <X size={16} />
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
                      <span>
                        <Smartphone size={13} style={{ verticalAlign: '-2px', marginRight: 4, opacity: 0.7 }} />
                        {d.name}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <footer className="modal-foot">
              <span className="helper mono">{picked.size} seçili</span>
              <button
                type="button"
                className="btn-primary"
                disabled={busy || picked.size === 0}
                onClick={confirmRun}
              >
                {busy ? 'Başlatılıyor…' : `${picked.size} telefonda çalıştır`}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {toast ? <div className={`toast toast-${toast.kind}`}>{toast.text}</div> : null}
    </div>
  );
}
