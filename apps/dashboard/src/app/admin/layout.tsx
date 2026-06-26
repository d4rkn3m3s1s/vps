import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';
import { AdminTabs } from './AdminTabs';

export const metadata = { title: 'Yönetim · VPS Fleet' };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageMotion className="page">
      <PageHeader title="Yönetim" subtitle="Çalışma alanı, ekip, altyapı ve faturalama denetimleri." />
      <AdminTabs />
      {children}
    </PageMotion>
  );
}
