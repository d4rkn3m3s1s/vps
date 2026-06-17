import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';
import { AdminTabs } from './AdminTabs';

export const metadata = { title: 'Admin · VPS Fleet' };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageMotion className="page">
      <PageHeader title="Administration" subtitle="Workspace, team, infrastructure and billing controls." />
      <AdminTabs />
      {children}
    </PageMotion>
  );
}
