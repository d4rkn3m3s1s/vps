'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal, Power, RotateCcw, Play, Square, Package, Trash2, ChevronRight } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

type Device = { id: string; name: string; status?: string };
type Line = { kind: 'cmd' | 'out' | 'err' | 'info'; text: string };

// Quick shell snippets surfaced as one-click buttons.
const QUICK_CMDS: { label: string; cmd: string }[] = [
  { label: 'Device model', cmd: 'getprop ro.product.model' },
  { label: 'Android version', cmd: 'getprop ro.build.version.release' },
  { label: 'Battery', cmd: 'dumpsys battery | grep level' },
  { label: 'IP address', cmd: 'ip addr show wlan0' },
  { label: 'Installed apps', cmd: 'pm list packages -3' },
  { label: 'Screen state', cmd: 'dumpsys power | grep "Display Power"' },
  { label: 'Uptime', cmd: 'uptime' },
  { label: 'Running procs', cmd: 'ps -A | head -20' }
];

export function ConsoleView() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [cmd, setCmd] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const termRef = useRef<HTMLDivElement | null>(null);

  const activeDevice = devices.find((d) => d.id === selected) ?? null;

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/devices');
        const json = await res.json();
        const ds: Device[] = Array.isArray(json.data) ? json.data : [];
        setDevices(ds);
        if (ds[0]) setSelected(ds[0].id);
      } catch {
        push({ kind: 'err', text: 'Could not load devices.' });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset the terminal when switching devices.
  useEffect(() => {
    if (!selected) return;
    setLines([{ kind: 'info', text: `Connected to "${activeDevice?.name ?? selected}". Type a command or use the toolbar.` }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // Auto-scroll to the newest line.
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [lines]);

  function push(line: Line) {
    setLines((prev) => [...prev, line]);
  }

  async function runShell(command: string) {
    const c = command.trim();
    if (!c || !selected) return;
    push({ kind: 'cmd', text: c });
    setHistory((h) => (h[h.length - 1] === c ? h : [...h, c]));
    setHistIdx(-1);
    setBusy(true);
    try {
      const res = await fetch(`/api/devices/${selected}/adb/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: c })
      });
      const json = await res.json();
      if (!res.ok) {
        push({ kind: 'err', text: json.message ?? `Error ${res.status}` });
        return;
      }
      const d = json.data ?? {};
      if (d.stdout) push({ kind: 'out', text: d.stdout.trimEnd() });
      if (d.stderr) push({ kind: 'err', text: d.stderr.trimEnd() });
      if (!d.stdout && !d.stderr) push({ kind: 'info', text: `(exit ${d.exitCode ?? 0}, no output)` });
    } catch {
      push({ kind: 'err', text: 'Request failed — the device may be offline.' });
    } finally {
      setBusy(false);
    }
  }

  // Fleet-wide quick action via the bulk job fan-out (executed by the host agent).
  async function quickAction(jobType: string, label: string, payload?: Record<string, unknown>) {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch('/api/bulk/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceIds: [selected], jobType, ...(payload ? { payload } : {}) })
      });
      const json = await res.json();
      if (!res.ok) {
        push({ kind: 'err', text: json.message ?? `${label} failed` });
        return;
      }
      const jobId = json.data?.jobIds?.[0];
      push({ kind: 'info', text: `${label} queued${jobId ? ` (job ${jobId.slice(0, 8)}…)` : ''} — the host agent will apply it.` });
    } catch {
      push({ kind: 'err', text: `${label} failed` });
    } finally {
      setBusy(false);
    }
  }

  async function reboot() {
    if (!selected) return;
    if (!confirm('Reboot this cloud phone?')) return;
    // Reboot is issued directly over the live ADB bridge (synchronous).
    await runShell('reboot');
  }

  function installApk() {
    const apkPath = prompt('APK path on the host (e.g. /data/apks/app.apk):');
    if (!apkPath || !apkPath.trim()) return;
    void quickAction('EMULATOR_INSTALL_APK', 'Install APK', { apkPath: apkPath.trim() });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      void runShell(cmd);
      setCmd('');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!history.length) return;
      const idx = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(idx);
      setCmd(history[idx] ?? '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx === -1) return;
      const idx = histIdx + 1;
      if (idx >= history.length) {
        setHistIdx(-1);
        setCmd('');
      } else {
        setHistIdx(idx);
        setCmd(history[idx] ?? '');
      }
    }
  }

  return (
    <PageMotion className="page">
      <PageHeader
        title="Device console"
        subtitle="Live shell and remote control for a single cloud phone — over the real ADB bridge."
        actions={
          <select className="field-input" value={selected ?? ''} onChange={(e) => setSelected(e.target.value)}>
            {devices.length === 0 ? <option value="">No devices</option> : null}
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.status ? ` · ${d.status.toLowerCase()}` : ''}
              </option>
            ))}
          </select>
        }
      />

      {/* Action toolbar */}
      <div className="console-toolbar">
        <button type="button" className="btn-ghost" disabled={busy || !selected} onClick={() => quickAction('EMULATOR_START', 'Start')}>
          <Play size={14} /> Start
        </button>
        <button type="button" className="btn-ghost" disabled={busy || !selected} onClick={() => quickAction('EMULATOR_STOP', 'Stop')}>
          <Square size={14} /> Stop
        </button>
        <button type="button" className="btn-ghost" disabled={busy || !selected} onClick={reboot}>
          <RotateCcw size={14} /> Reboot
        </button>
        <button type="button" className="btn-ghost" disabled={busy || !selected} onClick={installApk}>
          <Package size={14} /> Install APK
        </button>
        <span className="console-spacer" />
        <button type="button" className="btn-ghost" disabled={!lines.length} onClick={() => setLines([])}>
          <Trash2 size={14} /> Clear
        </button>
      </div>

      <div className="section-grid console-grid">
        {/* Terminal */}
        <div className="panel console-panel">
          <h2>
            <Terminal size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Shell
            {activeDevice ? <span className="console-target"> · {activeDevice.name}</span> : null}
          </h2>
          <div className="console-term mono" ref={termRef}>
            {lines.map((l, i) => (
              <div key={i} className={`console-line console-${l.kind}`}>
                {l.kind === 'cmd' ? <span className="console-prompt">$</span> : null}
                <pre className="console-text">{l.text}</pre>
              </div>
            ))}
            {busy ? <div className="console-line console-info"><pre className="console-text">…</pre></div> : null}
          </div>
          <div className="console-input-row">
            <ChevronRight size={16} className="console-input-icon" />
            <input
              className="field-input mono console-input"
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={selected ? 'Type a shell command and hit Enter…' : 'Select a device first'}
              disabled={busy || !selected}
              autoFocus
            />
          </div>
          <p className="helper console-hint">
            Live <span className="mono">adb shell</span> over the device bridge. ↑/↓ for history. Start/Stop/Install run
            through the host agent job queue.
          </p>
        </div>

        {/* Quick commands */}
        <div className="panel">
          <h2>Quick commands</h2>
          <div className="console-quick">
            {QUICK_CMDS.map((q) => (
              <button
                key={q.cmd}
                type="button"
                className="console-quick-btn"
                disabled={busy || !selected}
                onClick={() => runShell(q.cmd)}
                title={q.cmd}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </PageMotion>
  );
}
