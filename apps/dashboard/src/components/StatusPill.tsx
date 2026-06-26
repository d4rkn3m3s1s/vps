type StatusPillProps = {
  status: string;
};

export function StatusPill({ status }: StatusPillProps) {
  const normalized = status.toLowerCase();
  // Semantic: completed/done/active/online = green; failed/error = red;
  // running/pending/queued/in-progress = amber; everything else neutral-warn.
  const tone =
    ['completed', 'done', 'active', 'online', 'success', 'connected'].includes(normalized)
      ? 'success'
      : ['failed', 'error', 'offline', 'banned', 'canceled', 'cancelled'].includes(normalized)
        ? 'danger'
        : 'warn';

  return <span className={`pill ${tone}`}>{status}</span>;
}
