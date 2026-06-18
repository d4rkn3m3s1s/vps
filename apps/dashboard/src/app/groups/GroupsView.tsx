'use client';

import { useEffect, useState } from 'react';
import { Boxes, Plus, Trash2, Play, Square, RotateCcw, Pencil, Check, X } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

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
      flash('Could not load groups or devices.');
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
      if (!res.ok) throw new Error(json.message ?? 'Could not create group');
      setNewName('');
      flash('Group created.');
      await loadAll();
      if (json.data?.id) setSelected(json.data.id);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not create group');
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
        throw new Error(j.message ?? 'Could not rename');
      }
      setEditingId(null);
      await loadAll();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not rename');
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup(id: string) {
    if (!confirm('Delete this group? Devices will be ungrouped, not deleted.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/groups/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Could not delete');
      }
      if (selected === id) setSelected(null);
      flash('Group deleted.');
      await loadAll();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not delete');
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
        throw new Error(j.message ?? 'Could not move device');
      }
      await loadAll();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not move device');
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
      if (!res.ok) throw new Error(json.message ?? `${label} failed`);
      flash(`${label} queued for ${json.data?.created ?? inGroup.length} device(s).`);
    } catch (e) {
      flash(e instanceof Error ? e.message : `${label} failed`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageMotion className="page">
      <PageHeader
        title="Device groups"
        subtitle="Organize your fleet into groups and run actions across a whole group at once."
      />

      <div className="section-grid groups-grid">
        {/* Group list */}
        <div className="panel">
          <h2>
            <Boxes size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Groups
          </h2>
          <div className="group-create-row">
            <input
              className="field-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New group name"
              onKeyDown={(e) => { if (e.key === 'Enter') void createGroup(); }}
            />
            <button type="button" className="btn-primary" disabled={busy || !newName.trim()} onClick={createGroup}>
              <Plus size={14} />
            </button>
          </div>

          <div className="group-list">
            {groups.length === 0 ? (
              <p className="helper">No groups yet. Create one above.</p>
            ) : (
              groups.map((g) => {
                const count = devices.filter((d) => d.groupId === g.id).length;
                return (
                  <div key={g.id} className={`group-item${selected === g.id ? ' group-item-active' : ''}`}>
                    {editingId === g.id ? (
                      <div className="group-edit-row">
                        <input
                          className="field-input"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => { if (e.key === 'Enter') void renameGroup(g.id); }}
                        />
                        <button type="button" className="icon-btn" onClick={() => renameGroup(g.id)} title="Save"><Check size={14} /></button>
                        <button type="button" className="icon-btn" onClick={() => setEditingId(null)} title="Cancel"><X size={14} /></button>
                      </div>
                    ) : (
                      <>
                        <button type="button" className="group-item-main" onClick={() => setSelected(g.id)}>
                          <span className="group-name">{g.name}</span>
                          <span className="group-count">{count} device{count === 1 ? '' : 's'}</span>
                        </button>
                        <button type="button" className="icon-btn" onClick={() => { setEditingId(g.id); setEditName(g.name); }} title="Rename"><Pencil size={13} /></button>
                        <button type="button" className="icon-btn danger-btn" onClick={() => deleteGroup(g.id)} title="Delete"><Trash2 size={13} /></button>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Group detail */}
        <div className="panel">
          {!activeGroup ? (
            <>
              <h2>Group detail</h2>
              <p className="helper">Select a group to manage its devices.</p>
            </>
          ) : (
            <>
              <h2>{activeGroup.name}</h2>
              {/* Group bulk actions */}
              <div className="group-actions">
                <button type="button" className="btn-ghost" disabled={busy || inGroup.length === 0} onClick={() => groupAction('EMULATOR_START', 'Start')}>
                  <Play size={14} /> Start all
                </button>
                <button type="button" className="btn-ghost" disabled={busy || inGroup.length === 0} onClick={() => groupAction('EMULATOR_STOP', 'Stop')}>
                  <Square size={14} /> Stop all
                </button>
                <button type="button" className="btn-ghost" disabled={busy || inGroup.length === 0} onClick={() => groupAction('EMULATOR_START', 'Reboot')}>
                  <RotateCcw size={14} /> Restart all
                </button>
              </div>

              {/* Devices in group */}
              <h3 className="adb-subhead">In this group ({inGroup.length})</h3>
              {inGroup.length === 0 ? (
                <p className="helper">No devices in this group yet. Add some below.</p>
              ) : (
                <div className="group-device-list">
                  {inGroup.map((d) => (
                    <div key={d.id} className="group-device-row">
                      <span className="group-device-name">{d.name}</span>
                      {d.status ? <span className="fp-device-status">{d.status.toLowerCase()}</span> : null}
                      <button type="button" className="btn-ghost group-move-btn" disabled={busy} onClick={() => moveDevice(d.id, null)}>Remove</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Ungrouped devices to add */}
              {ungrouped.length > 0 ? (
                <>
                  <h3 className="adb-subhead">Add devices ({ungrouped.length} ungrouped)</h3>
                  <div className="group-device-list">
                    {ungrouped.map((d) => (
                      <div key={d.id} className="group-device-row">
                        <span className="group-device-name">{d.name}</span>
                        <button type="button" className="btn-primary group-move-btn" disabled={busy} onClick={() => moveDevice(d.id, activeGroup.id)}>Add</button>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}
          {msg ? <p className="helper" style={{ marginTop: '0.75rem' }}>{msg}</p> : null}
        </div>
      </div>
    </PageMotion>
  );
}
