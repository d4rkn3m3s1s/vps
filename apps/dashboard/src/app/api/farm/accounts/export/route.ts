import { NextResponse } from 'next/server';
import { getAccessToken } from '../../../../../lib/apiClient';

// The API returns text/csv (not JSON), so we stream it through rather than using
// the JSON-parsing apiCall helper. The browser opens this URL directly.
export async function GET() {
  const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';
  const API_KEY = process.env.DEFAULT_API_KEY ?? '';
  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    return NextResponse.json({ message: 'Yetkilendirme başarısız' }, { status: 401 });
  }
  const res = await fetch(`${BASE_URL}/farm/accounts/export`, {
    cache: 'no-store',
    headers: { 'x-api-key': API_KEY, Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    return NextResponse.json({ message: 'Dışa aktarma başarısız' }, { status: res.status });
  }
  const csv = await res.text();
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="farm-accounts.csv"'
    }
  });
}
