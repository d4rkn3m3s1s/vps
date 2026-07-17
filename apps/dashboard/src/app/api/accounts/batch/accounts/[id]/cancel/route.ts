import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../../../lib/apiClient';

// Cancel a WhatsApp registration: the API marks the account FAILED and clears the
// device's WA-registration badge so the profile card unlocks. Used for terminal cases
// (number blocked / wall / wrong number) the operator can't resolve with a code.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall(`/accounts/batch/accounts/${id}/cancel`, { method: 'POST', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
