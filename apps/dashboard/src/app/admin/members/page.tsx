'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shield, Trash2, UserPlus, Users, Crown, Building2, Mail } from 'lucide-react';
import { HoloPanel, HoloStat, Reveal } from '../../../components/hud';

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
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgKind, setMsgKind] = useState<'ok' | 'err'>('ok');

  const loadMembers = useCallback(async (wsId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/workspaces/${wsId}/members`);
      const json = await res.json();
      if (Array.isArray(json.data)) setMembers(json.data as Member[]);
    } finally {
      setLoading(false);
    }
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
        } else {
          setLoading(false);
        }
      } catch {
        setLoading(false);
      }
    })();
  }, [loadMembers]);

  function flash(text: string, kind: 'ok' | 'err' = 'ok') {
    setMsg(text);
    setMsgKind(kind);
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
      flash(e instanceof Error ? e.message : 'Rol değiştirilemedi', 'err');
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
      flash(e instanceof Error ? e.message : 'Üye çıkarılamadı', 'err');
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
      const addr = email.trim();
      // Be honest about whether the invite email actually went out. Without SMTP
      // configured the member IS added but no email is sent — say so instead of
      // implying they were notified.
      const delivered = (json.data as { emailDelivered?: boolean } | undefined)?.emailDelivered;
      if (delivered === false) {
        flash(`${addr} ${inviteRole} olarak eklendi — ANCAK e-posta gönderilemedi (SMTP yapılandırılmadı). Davet bilgisini elle iletin.`, 'err');
      } else {
        flash(`${addr} ${inviteRole} olarak eklendi ve e-posta ile bilgilendirildi`);
      }
      setEmail('');
      await loadMembers(workspace.id);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Davet başarısız oldu', 'err');
    } finally {
      setBusy(false);
    }
  }

  const isAdmin = workspace?.role === 'admin';
  const adminCount = members.filter((m) => m.role === 'admin').length;

  return (
    <section className="admin-stack">
      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat
            label="Toplam üye"
            value={<span className="mono">{members.length}</span>}
            sub="aktif erişim"
            tone="cyan"
            icon={<Users size={16} />}
          />
          <HoloStat
            label="Yöneticiler"
            value={<span className="mono">{adminCount}</span>}
            sub="tam yetki"
            tone="violet"
            icon={<Crown size={16} />}
          />
          <HoloStat
            label="Bağlı cihaz"
            value={<span className="mono">{workspace?.devices ?? 0}</span>}
            sub="alan envanteri"
            tone="info"
            icon={<Shield size={16} />}
          />
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <HoloPanel
          title="Üye listesi"
          icon={<Users size={16} />}
          actions={
            <div className="filter-row">
              {workspace ? (
                <span className="status-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Building2 size={13} />
                  <span className="mono">{workspace.name}</span>
                </span>
              ) : null}
              <span className="helper mono">
                {members.length} üye · {adminCount} yönetici
              </span>
            </div>
          }
        >
          <div className="profile-table-wrap">
            <table className="profile-table">
              <thead>
                <tr>
                  <th>Kullanıcı</th>
                  <th>Rol</th>
                  <th>Atama</th>
                  <th style={{ textAlign: 'right' }}>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={`sk-${i}`}>
                      <td colSpan={4}>
                        <div className="skeleton skeleton-row" />
                      </td>
                    </tr>
                  ))
                ) : members.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty-cell">
                      Henüz üye yok
                    </td>
                  </tr>
                ) : (
                  members.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <span className="mono">{m.email}</span>
                      </td>
                      <td>
                        <span
                          className={`role-badge role-${m.role}`}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          <Shield size={12} />
                          {m.role}
                        </span>
                      </td>
                      <td>
                        <select
                          className="inline-select"
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
                      </td>
                      <td style={{ textAlign: 'right' }}>
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
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </HoloPanel>
      </Reveal>

      {isAdmin ? (
        <Reveal delay={0.1}>
          <HoloPanel title="Yeni üye davet et" icon={<UserPlus size={16} />}>
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
          </HoloPanel>
        </Reveal>
      ) : (
        <p className="helper">Üyeleri yalnızca çalışma alanı yöneticileri yönetebilir.</p>
      )}

      {msg ? (
        <p
          className={`form-status ${msgKind === 'ok' ? 'form-status--ok' : 'form-status--err'}`}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Mail size={13} />
          {msg}
        </p>
      ) : null}
    </section>
  );
}
