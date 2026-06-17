'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button, Input } from '@heroui/react';
import { UserPlus, Shield, Trash2 } from 'lucide-react';

type Member = { id: string; userId: string; email: string; role: string };
type Workspace = { id: string; name: string; role: string };

export function WorkspaceMembers() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('operator');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadMembers = useCallback(async (wsId: string) => {
    const res = await fetch(`/api/workspaces/${wsId}/members`);
    const json = await res.json();
    if (Array.isArray(json.data)) setMembers(json.data);
  }, []);

  useEffect(() => {
    // Find the active workspace (first one for the service identity).
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

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 3000);
  }

  async function invite() {
    if (!workspace || !email.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Invite failed');
      flash(`${email.trim()} added as ${role}`);
      setEmail('');
      await loadMembers(workspace.id);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Invite failed');
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(memberId: string, memberEmail: string) {
    if (!workspace) return;
    if (!confirm(`Remove ${memberEmail} from ${workspace.name}?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/members/${memberId}`, { method: 'DELETE' });
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

  const isAdmin = workspace?.role === 'admin';

  return (
    <div className="panel-stack">
      {workspace ? (
        <div className="row">
          <span className="helper">Workspace</span>
          <span className="mono">{workspace.name}</span>
        </div>
      ) : null}

      {members.map((m) => (
        <div className="row" key={m.id}>
          <span className="mono">{m.email}</span>
          <span className="member-row-right">
            <span className={`role-badge role-${m.role}`}>
              <Shield size={12} style={{ marginRight: 4 }} />
              {m.role}
            </span>
            {isAdmin ? (
              <Button
                type="button"
                className="icon-btn"
                isIconOnly
                variant="ghost"
                isDisabled={Boolean(busy)}
                onPress={() => removeMember(m.id, m.email)}
                aria-label={`Remove ${m.email}`}
              >
                <Trash2 size={14} />
              </Button>
            ) : null}
          </span>
        </div>
      ))}

      {isAdmin ? (
        <div className="member-invite">
          <Input
            className="field-input"
            type="email"
            placeholder="teammate@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select className="inline-select" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="admin">Admin</option>
            <option value="operator">Operator</option>
            <option value="viewer">Viewer</option>
          </select>
          <Button type="button" variant="primary" className="btn-primary" isDisabled={Boolean(busy || !email.trim())} onPress={invite}>
            <UserPlus size={15} /> Invite
          </Button>
        </div>
      ) : (
        <p className="helper">Only workspace admins can invite members.</p>
      )}

      {msg ? <p className="helper">{msg}</p> : null}
    </div>
  );
}
