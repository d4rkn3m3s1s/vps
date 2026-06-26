'use client';

import { useEffect, useState } from 'react';
import { Boxes, Plus, Trash2, Play, Square, RotateCcw, Pencil, Check, X, Layers, Smartphone, Activity } from 'lucide-react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, Holo3D } from '../../components/hud';

type Device = { id: string; name: string; status?: string; groupId?: string | null };
type Group = { id: string; name: string; description?: string | null; devices?: Device[] };

export function GroupsView() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const activeGroup = groups.find((g) => g.id === selected) ?? null;
  const inGroup = devices.filter((d) => d.groupId === selected);
  const ungrouped = devices.filter((d) => !d.groupId);

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 3500);
  }

  async function loadAll() {
    try {
      const [gRes, dRes] = await Promise.all([fetch('/api/groups'), fetch('/api/devices')]);
      const [gJson, dJson] = await Promise.all([gRes.json(), dRes.json()]);
      if (Array.isArray(gJson.data)) setGroups(gJson.data);
      if (Array.isArray(dJson.data)) setDevices(dJson.data);
    } catch {
      flash('Gruplar veya cihazlar yüklenemedi.');
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function createGroup() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Grup oluşturulamadı');
      setNewName('');
      flash('Grup oluşturuldu.');
      await loadAll();
      if (json.data?.id) setSelected(json.data.id);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Grup oluşturulamadı');
    } finally {
      setBusy(false);
    }
  }

  async function renameGroup(id: string) {
    if (!editName.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/groups/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Yeniden adlandırılamadı');
      }
      setEditingId(null);
      await loadAll();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Yeniden adlandırılamadı');
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup(id: string) {
    if (!confirm('Bu grup silinsin mi? Cihazlar silinmez, gruptan çıkarılır.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/groups/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Silinemedi');
      }
      if (selected === id) setSelected(null);
      flash('Grup silindi.');
      await loadAll();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Silinemedi');
    } finally {
      setBusy(false);
    }
  }

  async function moveDevice(deviceId: string, groupId: string | null) {
    setBusy(true);
    try {
      const res = await fetch(`/api/devices/${deviceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Cihaz taşınamadı');
      }
      await loadAll();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Cihaz taşınamadı');
    } finally {
      setBusy(false);
    }
  }

  // Run a bulk job across every device in the active group.
  async function groupAction(jobType: string, label: string) {
    if (!selected || inGroup.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch('/api/bulk/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceIds: inGroup.map((d) => d.id), jobType })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? `${label} başarısız`);
      flash(`${label} ${json.data?.created ?? inGroup.length} cihaz için sıraya alındı.`);
    } catch (e) {
      flash(e instanceof Error ? e.message : `${label} başarısız`);
    } finally {
      setBusy(false);
    }
  }

  const groupedCount = devices.filter((d) => d.groupId).length;

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="CİHAZ GRUPLARI"
        title="Cihaz grupları"
        subtitle="Filonuzu gruplara ayırın ve bir grubun tamamında aynı anda işlem çalıştırın."
      />

      <div className="holo-stats-grid">
        <HoloStat
          label="Toplam grup"
          value={<span className="mono">{groups.length}</span>}
          tone="info"
          icon={<Layers size={16} />}
        />
        <HoloStat
          label="Toplam cihaz"
          value={<span className="mono">{devices.length}</span>}
          sub={`${groupedCount} gruplandırılmış`}
          tone="cyan"
          icon={<Smartphone size={16} />}
        />
        <HoloStat
          label="Grupsuz cihaz"
          value={<span className="mono">{ungrouped.length}</span>}
          tone={ungrouped.length > 0 ? 'warning' : 'success'}
          icon={<Boxes size={16} />}
        />
        <HoloStat
          label="Aktif grupta"
          value={<span className="mono">{selected ? inGroup.length : '—'}</span>}
          sub={activeGroup ? activeGroup.name : 'Seçili grup yok'}
          tone="violet"
          icon={<Activity size={16} />}
        />
      </div>

      <div className="section-grid groups-grid">
        {/* Group list */}
        <HoloPanel title="Gruplar" icon={<Boxes size={16} />}>
          <div className="group-create-row">
            <input
              className="field-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Yeni grup adı"
              onKeyDown={(e) => { if (e.key === 'Enter') void createGroup(); }}
            />
            <button type="button" className="btn-primary" disabled={busy || !newName.trim()} onClick={createGroup}>
              <Plus size={14} />
            </button>
          </div>

          <div className="group-list">
            {groups.length === 0 ? (
              <p className="helper">Henüz grup yok. Yukarıdan bir tane oluşturun.</p>
            ) : (
              <div className="holo-grid-auto">
                {groups.map((g) => {
                  const count = devices.filter((d) => d.groupId === g.id).length;
                  return (
                    <Holo3D key={g.id} className={`holo-card group-item${selected === g.id ? ' group-item-active' : ''}`} max={5}>
                      {editingId === g.id ? (
                        <div className="group-edit-row">
                          <input
                            className="field-input"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            autoFocus
                            onKeyDown={(e) => { if (e.key === 'Enter') void renameGroup(g.id); }}
                          />
                          <button type="button" className="icon-btn" onClick={() => renameGroup(g.id)} title="Kaydet"><Check size={14} /></button>
                          <button type="button" className="icon-btn" onClick={() => setEditingId(null)} title="İptal"><X size={14} /></button>
                        </div>
                      ) : (
                        <>
                          <button type="button" className="group-item-main" onClick={() => setSelected(g.id)}>
                            <span className="group-name">{g.name}</span>
                            <span className="group-count status-chip"><span className="dot dot-cyan" /><span className="mono">{count}</span> cihaz</span>
                          </button>
                          <div className="holo-panel-actions">
                            <button type="button" className="icon-btn" onClick={() => { setEditingId(g.id); setEditName(g.name); }} title="Yeniden adlandır"><Pencil size={13} /></button>
                            <button type="button" className="icon-btn danger-btn" onClick={() => deleteGroup(g.id)} title="Sil"><Trash2 size={13} /></button>
                          </div>
                        </>
                      )}
                    </Holo3D>
                  );
                })}
              </div>
            )}
          </div>
        </HoloPanel>

        {/* Group detail */}
        <HoloPanel
          title={activeGroup ? activeGroup.name : 'Grup ayrıntısı'}
          icon={<Layers size={16} />}
          tilt
        >
          {!activeGroup ? (
            <p className="helper">Cihazlarını yönetmek için bir grup seçin.</p>
          ) : (
            <>
              {/* Group bulk actions */}
              <div className="group-actions">
                <button type="button" className="btn-ghost" disabled={busy || inGroup.length === 0} onClick={() => groupAction('EMULATOR_START', 'Başlatma')}>
                  <Play size={14} /> Tümünü başlat
                </button>
                <button type="button" className="btn-ghost" disabled={busy || inGroup.length === 0} onClick={() => groupAction('EMULATOR_STOP', 'Durdurma')}>
                  <Square size={14} /> Tümünü durdur
                </button>
                <button type="button" className="btn-ghost" disabled={busy || inGroup.length === 0} onClick={() => groupAction('EMULATOR_START', 'Yeniden başlatma')}>
                  <RotateCcw size={14} /> Tümünü yeniden başlat
                </button>
              </div>

              {/* Devices in group */}
              <h3 className="adb-subhead mono">Bu grupta ({inGroup.length})</h3>
              {inGroup.length === 0 ? (
                <p className="helper">Bu grupta henüz cihaz yok. Aşağıdan ekleyin.</p>
              ) : (
                <div className="group-device-list">
                  {inGroup.map((d) => (
                    <div key={d.id} className="group-device-row">
                      <span className={`dot ${
                        d.status === 'ONLINE' || d.status === 'RUNNING' ? 'dot-online'
                        : d.status === 'ERROR' ? 'dot-error'
                        : d.status === 'BUSY' || d.status === 'STARTING' || d.status === 'STOPPING' ? 'dot-busy'
                        : 'dot-offline'
                      }`} />
                      <span className="group-device-name">{d.name}</span>
                      {d.status ? <span className="fp-device-status status-chip mono">{d.status.toLowerCase()}</span> : null}
                      <button type="button" className="btn-ghost btn-xs group-move-btn" disabled={busy} onClick={() => moveDevice(d.id, null)}>Çıkar</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Ungrouped devices to add */}
              {ungrouped.length > 0 ? (
                <>
                  <h3 className="adb-subhead mono">Cihaz ekle ({ungrouped.length} grupsuz)</h3>
                  <div className="group-device-list">
                    {ungrouped.map((d) => (
                      <div key={d.id} className="group-device-row">
                        <span className={`dot ${
                          d.status === 'ONLINE' || d.status === 'RUNNING' ? 'dot-online'
                          : d.status === 'ERROR' ? 'dot-error'
                          : d.status === 'BUSY' || d.status === 'STARTING' || d.status === 'STOPPING' ? 'dot-busy'
                          : 'dot-offline'
                        }`} />
                        <span className="group-device-name">{d.name}</span>
                        <button type="button" className="btn-primary btn-xs group-move-btn" disabled={busy} onClick={() => moveDevice(d.id, activeGroup.id)}>Ekle</button>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}
          {msg ? <p className="helper" style={{ marginTop: '0.75rem' }}>{msg}</p> : null}
        </HoloPanel>
      </div>
    </PageMotion>
  );
}
