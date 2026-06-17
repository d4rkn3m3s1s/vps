'use client';

import { useEffect, useState } from 'react';
import { Terminal, Copy, Check, Wifi, WifiOff, ShieldAlert } from 'lucide-react';

type ConnectInfo = {
  deviceId: string;
  name: string;
  serial: string;
  exposed: boolean;
  publicHost?: string;
  publicPort?: number;
  allowlist: string[];
  commands: { connect: string; shell: string; scrcpy: string; disconnect: string };
};

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked */
    }
  }
  return (
    <div className="adb-cmd-row">
      <span className="helper adb-cmd-label">{label}</span>
      <code className="mono adb-cmd">{value}</code>
      <button type="button" className="icon-btn" onClick={copy} title="Copy" aria-label={`Copy ${label}`}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

export function AdbAccessPanel({ deviceId }: { deviceId: string }) {
  const [info, setInfo] = useState<ConnectInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Exec console.
  const [cmd, setCmd] = useState('getprop ro.product.model');
  const [output, setOutput] = useState<string | null>(null);

  // Expose form.
  const [publicHost, setPublicHost] = useState('');
  const [publicPort, setPublicPort] = useState('');
  const [allowlist, setAllowlist] = useState('');

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 3000);
  }

  async function load() {
    try {
      const res = await fetch(`/api/devices/${deviceId}/adb/connect-info`);
      const json = await res.json();
      if (res.ok && json.data) {
        setInfo(json.data as ConnectInfo);
        setPublicHost(json.data.publicHost ?? '');
        setPublicPort(json.data.publicPort ? String(json.data.publicPort) : '');
        setAllowlist((json.data.allowlist ?? []).join(', '));
      } else {
        flash(json.message ?? 'Could not load ADB info');
      }
    } catch {
      flash('Could not load ADB info');
    }
  }

  useEffect(() => {
    void load();
  }, [deviceId]);

  async function runExec() {
    if (!cmd.trim()) return;
    setBusy(true);
    setOutput(null);
    try {
      const res = await fetch(`/api/devices/${deviceId}/adb/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd.trim() })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Command failed');
      const d = json.data;
      setOutput([d.stdout, d.stderr].filter(Boolean).join('\n') || `(exit ${d.exitCode}, no output)`);
    } catch (e) {
      setOutput(e instanceof Error ? e.message : 'Command failed');
    } finally {
      setBusy(false);
    }
  }

  async function expose() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      if (publicHost.trim()) body.publicHost = publicHost.trim();
      if (publicPort.trim()) body.publicPort = Number(publicPort.trim());
      const list = allowlist.split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length) body.allowlist = list;
      const res = await fetch(`/api/devices/${deviceId}/adb/expose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Could not expose');
      flash('ADB port exposed');
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not expose');
    } finally {
      setBusy(false);
    }
  }

  async function unexpose() {
    if (!confirm('Stop exposing this device’s ADB port to the outside?')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/devices/${deviceId}/adb/expose`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Could not unexpose');
      }
      flash('ADB exposure disabled');
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not unexpose');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ marginTop: '1rem' }}>
      <h2>
        <Terminal size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> External ADB access
      </h2>
      <p className="helper" style={{ marginTop: '-0.25rem' }}>
        Connect to this cloud phone from your own machine with <span className="mono">adb</span> or{' '}
        <span className="mono">scrcpy</span>.
      </p>

      {info ? (
        <>
          <div className="adb-status-row">
            {info.exposed ? (
              <span className="status-chip"><Wifi size={13} /> Public ADB on {info.publicHost}:{info.publicPort}</span>
            ) : (
              <span className="status-chip"><WifiOff size={13} /> Host-network only (not publicly exposed)</span>
            )}
          </div>

          <div className="adb-cmd-block">
            <CopyRow label="Connect" value={info.commands.connect} />
            <CopyRow label="Shell" value={info.commands.shell} />
            <CopyRow label="Screen (scrcpy)" value={info.commands.scrcpy} />
          </div>

          {/* Exec console */}
          <div className="adb-exec">
            <label className="adb-cmd-label helper">Run a shell command</label>
            <div className="adb-exec-row">
              <input
                className="field-input mono"
                value={cmd}
                onChange={(e) => setCmd(e.target.value)}
                placeholder="getprop ro.product.model"
                onKeyDown={(e) => { if (e.key === 'Enter') void runExec(); }}
              />
              <button type="button" className="btn-primary" disabled={busy || !cmd.trim()} onClick={runExec}>
                {busy ? 'Running…' : 'Run'}
              </button>
            </div>
            {output !== null ? <pre className="adb-output mono">{output}</pre> : null}
          </div>

          {/* Expose controls */}
          <div className="adb-expose">
            <h3 className="adb-subhead">
              <ShieldAlert size={14} style={{ marginRight: 5, verticalAlign: 'middle' }} /> Public exposure
            </h3>
            <p className="helper">
              Opening a public ADB port grants full device control. Always set an IP allowlist. Admin only.
            </p>
            <div className="adb-expose-grid">
              <input className="field-input" value={publicHost} onChange={(e) => setPublicHost(e.target.value)} placeholder="Public host (default: device host)" />
              <input className="field-input" value={publicPort} onChange={(e) => setPublicPort(e.target.value)} placeholder="Public port" type="number" />
              <input className="field-input" value={allowlist} onChange={(e) => setAllowlist(e.target.value)} placeholder="Allowlist e.g. 1.2.3.4, 10.0.0.0/24" />
            </div>
            <div className="adb-expose-actions">
              <button type="button" className="btn-primary" disabled={busy} onClick={expose}>
                {info.exposed ? 'Update exposure' : 'Expose ADB port'}
              </button>
              {info.exposed ? (
                <button type="button" className="btn-ghost danger-btn" disabled={busy} onClick={unexpose}>
                  Stop exposing
                </button>
              ) : null}
            </div>
          </div>

          {msg ? <p className="helper" style={{ marginTop: '0.75rem' }}>{msg}</p> : null}
        </>
      ) : (
        <p className="helper">{msg ?? 'Loading ADB info…'}</p>
      )}
    </div>
  );
}
