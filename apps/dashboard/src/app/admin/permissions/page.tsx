'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, Plus, Trash2, Users, KeyRound, Eye, Gamepad2, Trash } from 'lucide-react';
import { HoloPanel, HoloStat, Reveal } from '../../../components/hud';

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
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);

  function flash(t: string, kind: 'ok' | 'err' = 'err') {
    setMsg({ text: t, kind });
    setTimeout(() => setMsg(null), 3000);
  }

  useEffect(() => {
    void (async () => {
      try {
        // Scope the member list to the ACTIVE workspace (not every global user).
        const [wsRes, activeRes, gRes, dRes] = await Promise.all([
          fetch('/api/workspaces'),
          fetch('/api/workspaces/active'),
          fetch('/api/groups'),
          fetch('/api/devices')
        ]);
        const [wsJson, activeJson, gJson, dJson] = await Promise.all([
          wsRes.json(), activeRes.json(), gRes.json(), dRes.json()
        ]);
        const list = (Array.isArray(wsJson.data) ? wsJson.data : []) as { id: string }[];
        const activeId: string | null = activeJson?.data?.activeId ?? null;
        const ws = list.find((w) => w.id === activeId) ?? list[0];
        if (ws) {
          const mJson = await fetch(`/api/workspaces/${ws.id}/members`).then((r) => r.json()).catch(() => ({}));
          const members = (Array.isArray(mJson.data) ? mJson.data : []) as { userId: string; email: string; role: string }[];
          setUsers(members.map((m) => ({ id: m.userId, email: m.email, role: m.role })));
        }
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
      flash('Önce bir hedef seçin.');
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
      if (!res.ok) throw new Error(json.message ?? 'Erişim verilemedi');
      flash('Erişim verildi', 'ok');
      setTargetId('');
      setCanView(true);
      setCanControl(false);
      setCanDelete(false);
      await loadGrants(selectedUserId);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Erişim verilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(p: Permission) {
    const label = p.groupId
      ? `Grup: ${groupName(p.groupId)}`
      : p.deviceId
        ? `Cihaz: ${deviceName(p.deviceId)}`
        : 'bu yetki';
    if (!confirm(`${label} için erişim geri alınsın mı?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/permissions/${p.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Geri alınamadı');
      }
      flash('Yetki geri alındı', 'ok');
      await loadGrants(selectedUserId);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Geri alınamadı');
    } finally {
      setBusy(false);
    }
  }

  const selectedUser = users.find((u) => u.id === selectedUserId) ?? null;

  const viewCount = grants.filter((p) => p.canView).length;
  const controlCount = grants.filter((p) => p.canControl).length;
  const deleteCount = grants.filter((p) => p.canDelete).length;

  return (
    <section className="admin-stack">
      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat
            label="Çalışma alanı üyeleri"
            value={<span className="mono">{users.length}</span>}
            sub="aktif çalışma alanı"
            tone="cyan"
            icon={<Users size={16} />}
          />
          <HoloStat
            label="Aktif yetkiler"
            value={<span className="mono">{selectedUserId ? grants.length : 0}</span>}
            sub={selectedUser ? selectedUser.email : 'üye seçilmedi'}
            tone="violet"
            icon={<KeyRound size={16} />}
          />
          <HoloStat
            label="Hedefler"
            value={<span className="mono">{groups.length + devices.length}</span>}
            sub={`${groups.length} grup · ${devices.length} cihaz`}
            tone="info"
            icon={<ShieldCheck size={16} />}
          />
          <HoloStat
            label="İzin dağılımı"
            value={<span className="mono">{viewCount}/{controlCount}/{deleteCount}</span>}
            sub="görüntüle · kontrol · sil"
            tone="success"
            icon={<Eye size={16} />}
          />
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <HoloPanel title="Mevcut yetkiler" icon={<ShieldCheck size={16} />} tilt>
          <p className="helper helper--note">
            Bir üyeye, bir cihaz grubuna veya tek bir cihaza görüntüleme, kontrol etme veya silme erişimi verin.
          </p>

          <div className="admin-form" style={{ marginTop: '1rem' }}>
            <div className="admin-field">
              <label htmlFor="perm-user">Üye</label>
              <select
                id="perm-user"
                className="inline-select"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
              >
                <option value="">— Bir üye seçin —</option>
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
              Cihaz erişimini yönetmek için bir üye seçin.
            </p>
          ) : (
            <div className="panel-stack" style={{ marginTop: '1rem' }}>
              {grants.length === 0 ? (
                <p className="helper">
                  Kısıtlama yok — bu üye tüm çalışma alanını görebilir. Üyeyi belirli gruplara/cihazlara kısıtlamak için bir
                  yetki ekleyin. Yetkiler bir izin listesi gibi çalışır: bir üyenin en az bir yetkisi olduğunda, yalnızca
                  kendisine yetki verdiğiniz şeylere erişebilir.
                </p>
              ) : (
                grants.map((p) => (
                  <div className="row" key={p.id}>
                    <div>
                      <strong>
                        {p.groupId
                          ? `Grup: ${groupName(p.groupId)}`
                          : p.deviceId
                            ? `Cihaz: ${deviceName(p.deviceId)}`
                            : 'Bilinmeyen hedef'}
                      </strong>
                      <div className="scope-row">
                        {p.canView ? <span className="policy-tag policy-tag-on">Görüntüleme</span> : null}
                        {p.canControl ? <span className="policy-tag policy-tag-on">Kontrol</span> : null}
                        {p.canDelete ? <span className="policy-tag policy-tag-on">Silme</span> : null}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ minWidth: 40, minHeight: 40 }}
                      disabled={busy}
                      onClick={() => revoke(p)}
                      aria-label="Yetkiyi geri al"
                      title="Geri al"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {msg ? (
            <p className={`form-status ${msg.kind === 'ok' ? 'form-status--ok' : 'form-status--err'}`}>
              {msg.text}
            </p>
          ) : null}
        </HoloPanel>
      </Reveal>

      <Reveal delay={0.1}>
        <HoloPanel title="Erişim ver" icon={<KeyRound size={16} />}>
          {!selectedUserId ? (
            <p className="helper helper--note">
              Önce bir üye seçin.
            </p>
          ) : (
            <div className="admin-form">
              <p className="helper helper--note">
                <span className="mono">{selectedUser?.email}</span> kullanıcısına erişim veriliyor.
              </p>

              <div className="admin-field">
                <label htmlFor="perm-target-type">Hedef türü</label>
                <select
                  id="perm-target-type"
                  className="inline-select"
                  value={targetType}
                  onChange={(e) => {
                    setTargetType(e.target.value === 'device' ? 'device' : 'group');
                    setTargetId('');
                  }}
                >
                  <option value="group">Grup</option>
                  <option value="device">Cihaz</option>
                </select>
              </div>

              <div className="admin-field">
                <label htmlFor="perm-target">{targetType === 'group' ? 'Grup' : 'Cihaz'}</label>
                <select
                  id="perm-target"
                  className="inline-select"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                >
                  <option value="">— Bir {targetType === 'group' ? 'grup' : 'cihaz'} seçin —</option>
                  {(targetType === 'group' ? groups : devices).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="admin-field">
                <label>İzinler</label>
                <div className="scope-row">
                  <label className={`scope-chip${canView ? ' scope-chip-on' : ''}`}>
                    <input type="checkbox" checked={canView} onChange={(e) => setCanView(e.target.checked)} />
                    <Eye size={13} />
                    Görüntüleme
                  </label>
                  <label className={`scope-chip${canControl ? ' scope-chip-on' : ''}`}>
                    <input type="checkbox" checked={canControl} onChange={(e) => setCanControl(e.target.checked)} />
                    <Gamepad2 size={13} />
                    Kontrol
                  </label>
                  <label className={`scope-chip${canDelete ? ' scope-chip-on' : ''}`}>
                    <input type="checkbox" checked={canDelete} onChange={(e) => setCanDelete(e.target.checked)} />
                    <Trash size={13} />
                    Silme
                  </label>
                </div>
              </div>

              <button type="button" className="btn-primary" disabled={busy || !targetId} onClick={grant}>
                <Plus size={15} /> {busy ? 'Veriliyor…' : 'Yetki ver'}
              </button>
            </div>
          )}
        </HoloPanel>
      </Reveal>
    </section>
  );
}
