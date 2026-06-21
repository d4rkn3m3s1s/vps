import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';
import { apiCall } from '../../lib/apiClient';
import { AccountsView } from './AccountsView';

export const metadata = { title: 'Hesap Üretici · VPS Fleet' };
export const dynamic = 'force-dynamic';

type ProviderStatus = {
  sms: { ok: boolean; detail: string };
  mail: { ok: boolean; detail: string };
  identity: { ok: boolean; detail: string };
};

export default async function AccountsPage() {
  const res = await apiCall<ProviderStatus>('/accounts/providers/status', { auth: true });
  const status = res.ok ? res.data : null;

  return (
    <PageMotion className="page">
      <PageHeader
        title="Hesap Üretici"
        subtitle="WhatsApp / Instagram / Facebook hesapları için tek seferlik numara, e-posta ve sahte kimlik hazırlayın."
      />
      <AccountsView initialStatus={status} />
    </PageMotion>
  );
}
