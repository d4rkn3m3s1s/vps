import { NextResponse } from 'next/server';
import { apiCall, apiResponse } from '../../../../../../../lib/apiClient';

// Cancel a WhatsApp registration: the API marks the account FAILED and clears the
// device's WA-registration badge so the profile card unlocks. Used for terminal cases
// (number blocked / wall / wrong number) the operator can't resolve with a code.
// ★2026-08-13 apiResponse: hata sebebi artık YUTULMUYOR (bkz. apiClient.ts).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall(`/accounts/batch/accounts/${id}/cancel`, { method: 'POST', auth: true });
  const out = apiResponse(res);
  return NextResponse.json(out.body, { status: out.status });
}
