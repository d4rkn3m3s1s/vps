import { apiCall } from '../../lib/apiClient';
import { ReferralView, type ReferralData } from './ReferralView';

export const metadata = { title: 'Referral · VPS Fleet' };
export const dynamic = 'force-dynamic';

export default async function ReferralPage() {
  // Real referral code + stats from the backend (creates the code on first visit).
  const res = await apiCall<ReferralData>('/referral', { auth: true });
  return <ReferralView data={res.data ?? null} />;
}
