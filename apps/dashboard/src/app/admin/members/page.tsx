'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shield, Trash2, UserPlus } from 'lucide-react';

type Member = { id: string; userId: string; email: string; role: string };
type Workspace = {
  id: string;
  name: string;
  slug: string;
  role: string;
  members: number;
  devices: number;
};

const ROLES = ['admin', 'operator', 'viewer'] as const;

export default function MembersPage() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('operator');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadMembers = useCallback(async (wsId: string) => {
    const res = await fetch(`/api/workspaces/${wsId}/members`);
    const json = await res.json();
    if (Array.isArray(json.data)) setMembers(json.data as Member[]);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        // Target the ACTIVE workspace (fleet_workspace cookie), not the first one.
        const [wsRes, activeRes] = await Promise.all([
          fetch('/api/workspaces'),
          fetch('/api/workspaces/active')
        ]);
        const [wsJson, activeJson] = await Promise.all([wsRes.json(), activeRes.json()]);
        const list = (Array.isArray(wsJson.data) ? wsJson.data : []) as Workspace[];
        const activeId: string | null = activeJson?.data?.activeId ?? null;
        const ws = list.find((w) => w.id === activeId) ?? list[0];
        if (ws) {
          setWorkspace(ws);
          void loadMembers(ws.id);
        }
      } catch {
        /* ignore */
      }
    })();
  }, [loadMembers]);

  function flash(text: string) {
    setMsg(text);
    setTimeout(() => setMsg(null), 3000);
  }

  async function changeRole(member: Member, newRole: string) {
    if (!workspace || newRole === member.role) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/members/${member.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? 'Rol değiştirilemedi');
      flash(`${member.email} artık ${newRole}`);
      await loadMembers(workspace.id);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Rol değiştirilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(memberId: string, memberEmail: string) {
    if (!workspace) return;
    if (!confirm(`${memberEmail} kullanıcısı ${workspace.name} alanından çıkarılsın mı?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/members/${memberId}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Üye çıkarılamadı');
      }
      flash(`${memberEmail} çıkarıldı`);
      await loadMembers(workspace.id);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Üye çıkarılamadı');
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    if (!workspace || !email.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role: inviteRole })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? 'Davet başarısız oldu');
      flash(`${email.trim()} ${inviteRole} olarak eklendi`);
      setEmail('');
      await loadMembers(workspace.id);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Davet başarısız oldu');
    } finally {
      setBusy(false);
    }
  }

  const isAdmin = workspace?.role === 'admin';
  const adminCount = members.filter((m) => m.role === 'admin').length;

  return (
    <div className="panel-stack">
      <div className="panel">
        {workspace ? (
          <div className="row">
            <span className="helper">Çalışma alanı</span>
            <span className="mono">{workspace.name}</span>
          </div>
        ) : null}
        <div className="row">
          <span className="helper">
            {members.length} üye · {adminCount} yönetici
          </span>
        </div>

        {members.map((m) => (
          <div className="row" key={m.id}>
            <span className="mono">{m.email}</span>
            <span className="member-row-right">
              <span className={`role-badge role-${m.role}`}>
                <Shield size={12} style={{ marginRight: 4 }} />
                {m.role}
              </span>
              <select
                className="role-select"
                value={m.role}
                disabled={!isAdmin || busy}
                onChange={(e) => void changeRole(m, e.target.value)}
                aria-label={`${m.email} için rol`}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn"
                disabled={!isAdmin || busy}
                onClick={() => void removeMember(m.id, m.email)}
                aria-label={`${m.email} kullanıcısını çıkar`}
                title="Üyeyi çıkar"
              >
                <Trash2 size={14} />
              </button>
            </span>
          </div>
        ))}
      </div>

      {isAdmin ? (
        <div className="panel">
          <div className="member-invite">
            <input
              className="field-input"
              type="email"
              placeholder="ekip-uyesi@sirket.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select
              className="inline-select"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
            >
              <option value="admin">Yönetici</option>
              <option value="operator">Operatör</option>
              <option value="viewer">İzleyici</option>
            </select>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !email.trim()}
              onClick={() => void invite()}
            >
              <UserPlus size={15} /> Davet et
            </button>
          </div>
        </div>
      ) : (
        <p className="helper">Üyeleri yalnızca çalışma alanı yöneticileri yönetebilir.</p>
      )}

      {msg ? <p className="helper">{msg}</p> : null}
    </div>
  );
}
