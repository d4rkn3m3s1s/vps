type ShellProps = {
  title: string;
  children: React.ReactNode;
};

export function Shell({ title, children }: ShellProps) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
