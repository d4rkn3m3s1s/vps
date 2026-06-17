'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, Plus, Trash2 } from 'lucide-react';
import { Button } from '@heroui/react';

type User = { id: string; email: string; role: string };
type Group = { id: string; name: string };
type Device = { id: string; name: string };
type Permission = {
  id: string;
  userId: string;
  groupId: string | null;
  deviceId: string | null;
  canView: boolean;
  canControl: boolean;
  canDelete: boolean;
  createdAt: string;
};

export default function PermissionsPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [grants, setGrants] = useState<Permission[]>([]);

  const [targetType, setTargetType] = useState<'group' | 'device'>('group');
  const [targetId, setTargetId] = useState('');
  const [canView, setCanView] = useState(true);
  const [canControl, setCanControl] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 3000);
  }

  useEffect(() => {
    void (async () => {
      try {
        const [uRes, gRes, dRes] = await Promise.all([
          fetch('/api/users'),
          fetch('/api/groups'),
          fetch('/api/devices')
        ]);
        const [uJson, gJson, dJson] = await Promise.all([uRes.json(), gRes.json(), dRes.json()]);
        if (Array.isArray(uJson.data)) setUsers(uJson.data);
        if (Array.isArray(gJson.data)) setGroups(gJson.data);
        if (Array.isArray(dJson.data)) setDevices(dJson.data);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  async function loadGrants(userId: string) {
    if (!userId) {
      setGrants([]);
      return;
    }
    try {
      const res = await fetch(`/api/permissions?userId=${encodeURIComponent(userId)}`);
      const json = await res.json();
      setGrants(Array.isArray(json.data) ? json.data : []);
    } catch {
      setGrants([]);
    }
  }

  useEffect(() => {
    void loadGrants(selectedUserId);
  }, [selectedUserId]);

  function groupName(id: string): string {
    return groups.find((g) => g.id === id)?.name ?? id;
  }

  function deviceName(id: string): string {
    return devices.find((d) => d.id === id)?.name ?? id;
  }

  async function grant() {
    if (!selectedUserId) return;
    if (!targetId) {
      flash('Pick a target first.');
      return;
    }
    setBusy(true);
    try {
      const body: {
        userId: string;
        groupId?: string;
        deviceId?: string;
        canView: boolean;
        canControl: boolean;
        canDelete: boolean;
      } = { userId: selectedUserId, canView, canControl, canDelete };
      if (targetType === 'group') body.groupId = targetId;
      else body.deviceId = targetId;

      const res = await fetch('/api/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Could not grant access');
      flash('Access granted');
      setTargetId('');
      setCanView(true);
      setCanControl(false);
      setCanDelete(false);
      await loadGrants(selectedUserId);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not grant access');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(p: Permission) {
    const label = p.groupId
      ? `Group: ${groupName(p.groupId)}`
      : p.deviceId
        ? `Device: ${deviceName(p.deviceId)}`
        : 'this grant';
    if (!confirm(`Revoke access to ${label}?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/permissions/${p.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Could not revoke');
      }
      flash('Grant revoked');
      await loadGrants(selectedUserId);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not revoke');
    } finally {
      setBusy(false);
    }
  }

  const selectedUser = users.find((u) => u.id === selectedUserId) ?? null;

  return (
    <section className="section-grid">
      <div className="panel">
        <h2>
          <ShieldCheck size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Member permissions
        </h2>
        <p className="helper" style={{ marginTop: '-0.25rem' }}>
          Grant a member view, control or delete access to a device group or a single device.
        </p>

        <div className="admin-form" style={{ marginTop: '1rem' }}>
          <div className="admin-field">
            <label htmlFor="perm-user">Member</label>
            <select
              id="perm-user"
              className="inline-select"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
            >
              <option value="">— Select a member —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email} ({u.role})
                </option>
              ))}
            </select>
          </div>
        </div>

        {!selectedUserId ? (
          <p className="helper" style={{ marginTop: '1rem' }}>
            Select a member to manage their device access.
          </p>
        ) : (
          <div className="panel-stack" style={{ marginTop: '1rem' }}>
            {grants.length === 0 ? (
              <p className="helper">
                No restrictions — this member can see the whole workspace. Add a grant to restrict them to specific
                groups/devices. Grants act as an allowlist: once a member has at least one grant, they can only access
                what you have granted.
              </p>
            ) : (
              grants.map((p) => (
                <div className="row" key={p.id}>
                  <div>
                    <strong>
                      {p.groupId
                        ? `Group: ${groupName(p.groupId)}`
                        : p.deviceId
                          ? `Device: ${deviceName(p.deviceId)}`
                          : 'Unknown target'}
                    </strong>
                    <div className="scope-row" style={{ marginTop: '0.35rem' }}>
                      {p.canView ? <span className="policy-tag policy-tag-on">View</span> : null}
                      {p.canControl ? <span className="policy-tag policy-tag-on">Control</span> : null}
                      {p.canDelete ? <span className="policy-tag policy-tag-on">Delete</span> : null}
                    </div>
                  </div>
                  <Button
                    isIconOnly
                    variant="ghost"
                    size="sm"
                    isDisabled={busy}
                    onPress={() => revoke(p)}
                    aria-label="Revoke grant"
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              ))
            )}
          </div>
        )}

        {msg ? (
          <p className="helper" style={{ marginTop: '0.75rem' }}>
            {msg}
          </p>
        ) : null}
      </div>

      <div className="panel">
        <h2>Grant access</h2>
        {!selectedUserId ? (
          <p className="helper" style={{ marginTop: '-0.25rem' }}>
            Pick a member first.
          </p>
        ) : (
          <div className="admin-form">
            <p className="helper" style={{ marginTop: '-0.25rem' }}>
              Granting access to <span className="mono">{selectedUser?.email}</span>.
            </p>

            <div className="admin-field">
              <label htmlFor="perm-target-type">Target type</label>
              <select
                id="perm-target-type"
                className="inline-select"
                value={targetType}
                onChange={(e) => {
                  setTargetType(e.target.value === 'device' ? 'device' : 'group');
                  setTargetId('');
                }}
              >
                <option value="group">Group</option>
                <option value="device">Device</option>
              </select>
            </div>

            <div className="admin-field">
              <label htmlFor="perm-target">{targetType === 'group' ? 'Group' : 'Device'}</label>
              <select
                id="perm-target"
                className="inline-select"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
              >
                <option value="">— Select a {targetType} —</option>
                {(targetType === 'group' ? groups : devices).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="admin-field">
              <label>Permissions</label>
              <div className="scope-row">
                <label className={`scope-chip${canView ? ' scope-chip-on' : ''}`}>
                  <input type="checkbox" checked={canView} onChange={(e) => setCanView(e.target.checked)} />
                  View
                </label>
                <label className={`scope-chip${canControl ? ' scope-chip-on' : ''}`}>
                  <input type="checkbox" checked={canControl} onChange={(e) => setCanControl(e.target.checked)} />
                  Control
                </label>
                <label className={`scope-chip${canDelete ? ' scope-chip-on' : ''}`}>
                  <input type="checkbox" checked={canDelete} onChange={(e) => setCanDelete(e.target.checked)} />
                  Delete
                </label>
              </div>
            </div>

            <Button variant="primary" isDisabled={busy || !targetId} onPress={grant}>
              <Plus size={15} /> {busy ? 'Granting…' : 'Grant'}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
