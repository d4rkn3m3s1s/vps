import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

export async function DELETE(_request: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const res = await apiCall(`/backups/${encodeURIComponent(file)}`, { method: 'DELETE', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
