'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shield, Trash2, UserPlus } from 'lucide-react';
import { Button, Input } from '@heroui/react';

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
    fetch('/api/workspaces')
      .then((r) => r.json())
      .then((j) => {
        const list = (Array.isArray(j.data) ? j.data : []) as Workspace[];
        if (list[0]) {
          setWorkspace(list[0]);
          void loadMembers(list[0].id);
        }
      })
      .catch(() => {});
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
      if (!res.ok) throw new Error(json.message ?? 'Could not change role');
      flash(`${member.email} is now ${newRole}`);
      await loadMembers(workspace.id);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not change role');
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(memberId: string, memberEmail: string) {
    if (!workspace) return;
    if (!confirm(`Remove ${memberEmail} from ${workspace.name}?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/members/${memberId}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Could not remove member');
      }
      flash(`${memberEmail} removed`);
      await loadMembers(workspace.id);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not remove member');
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
      if (!res.ok) throw new Error(json.message ?? 'Invite failed');
      flash(`${email.trim()} added as ${inviteRole}`);
      setEmail('');
      await loadMembers(workspace.id);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Invite failed');
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
            <span className="helper">Workspace</span>
            <span className="mono">{workspace.name}</span>
          </div>
        ) : null}
        <div className="row">
          <span className="helper">
            {members.length} member{members.length === 1 ? '' : 's'} · {adminCount} admin
            {adminCount === 1 ? '' : 's'}
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
                aria-label={`Role for ${m.email}`}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <Button
                isIconOnly
                variant="ghost"
                size="sm"
                isDisabled={!isAdmin || busy}
                onPress={() => void removeMember(m.id, m.email)}
                aria-label={`Remove ${m.email}`}
              >
                <Trash2 size={14} />
              </Button>
            </span>
          </div>
        ))}
      </div>

      {isAdmin ? (
        <div className="panel">
          <div className="member-invite">
            <Input
              type="email"
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select
              className="inline-select"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
            >
              <option value="admin">Admin</option>
              <option value="operator">Operator</option>
              <option value="viewer">Viewer</option>
            </select>
            <Button
              variant="primary"
              isDisabled={busy || !email.trim()}
              onPress={() => void invite()}
            >
              <UserPlus size={15} /> Invite
            </Button>
          </div>
        </div>
      ) : (
        <p className="helper">Only workspace admins can manage members.</p>
      )}

      {msg ? <p className="helper">{msg}</p> : null}
    </div>
  );
}
