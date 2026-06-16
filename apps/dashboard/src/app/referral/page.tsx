import { apiCall } from '../../lib/apiClient';
import { ReferralView } from './ReferralView';

export const metadata = { title: 'Referral · VPS Fleet' };
export const dynamic = 'force-dynamic';

type CurrentUser = { id: string; email: string };

// Deterministic, human-friendly referral code derived from the user id so it
// stays stable across reloads without needing a dedicated table yet.
function codeFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
}

export default async function ReferralPage() {
  const res = await apiCall<CurrentUser>('/auth/me', { auth: true });
  const code = res.data ? codeFor(res.data.id) : 'FLEET1';
  return <ReferralView code={code} />;
}
