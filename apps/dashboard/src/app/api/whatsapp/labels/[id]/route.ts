import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Delete a conversation label (strips it from any threads that reference it).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall(`/whatsapp/labels/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
