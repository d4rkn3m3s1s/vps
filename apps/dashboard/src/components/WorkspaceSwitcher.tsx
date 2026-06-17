'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Check, ChevronsUpDown, Plus } from 'lucide-react';

type Workspace = { id: string; name: string; slug: string; role: string; members: number; devices: number };

export function WorkspaceSwitcher({ activeId }: { activeId?: string | undefined }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch('/api/workspaces')
      .then((r) => r.json())
      .then((j) => setWorkspaces(Array.isArray(j.data) ? j.data : []))
      .catch(() => {});
  }, [open]);

  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];

  async function switchTo(id: string) {
    if (id === active?.id) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await fetch('/api/workspaces/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: id })
      });
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() })
      });
      const json = await res.json();
      if (res.ok && json.data?.id) {
        await switchTo(json.data.id);
      }
      setNewName('');
      setCreating(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ws-switcher">
      <button type="button" className="ws-trigger" onClick={() => setOpen((v) => !v)}>
        <span className="ws-icon"><Building2 size={15} /></span>
        <span className="ws-name">{active?.name ?? 'Workspace'}</span>
        <ChevronsUpDown size={14} className="ws-chevron" />
      </button>

      {open ? (
        <div className="ws-menu">
          {workspaces.map((w) => (
            <button key={w.id} type="button" className="ws-item" disabled={busy} onClick={() => switchTo(w.id)}>
              <span className="ws-item-name">{w.name}</span>
              <span className="ws-item-meta">{w.devices} · {w.role}</span>
              {w.id === active?.id ? <Check size={14} className="ws-check" /> : null}
            </button>
          ))}

          {creating ? (
            <div className="ws-create">
              <input
                className="ws-create-input"
                placeholder="Workspace name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && create()}
              />
              <button type="button" className="ws-create-go" disabled={busy || !newName.trim()} onClick={create}>
                Create
              </button>
            </div>
          ) : (
            <button type="button" className="ws-add" onClick={() => setCreating(true)}>
              <Plus size={14} /> New workspace
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
