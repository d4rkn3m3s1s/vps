type StatusPillProps = {
  status: string;
};

export function StatusPill({ status }: StatusPillProps) {
  const normalized = status.toLowerCase();
  const tone = normalized === 'running' || normalized === 'completed' ? 'success' : normalized === 'failed' ? 'danger' : 'warn';

  return <span className={`pill ${tone}`}>{status}</span>;
}
