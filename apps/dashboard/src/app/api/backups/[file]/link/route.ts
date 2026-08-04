import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Kısa ömürlü imzalı indirme bağlantısı üretir.
//
// Dönen adres MUTLAK ve doğrudan API'yi gösterir: 859 MB'lık dosya bu Next.js
// sürecinden GEÇMEZ (proxy'lemek bellek ve zaman aşımı riski olurdu). Tarayıcı
// dosyayı API'den doğrudan, akış hâlinde çeker.
const API_PUBLIC_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');

export async function POST(_request: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const res = await apiCall<{ url: string; expiresInSec: number; sizeBytes: number }>(
    `/backups/${encodeURIComponent(file)}/link`,
    { method: 'POST', auth: true },
  );
  if (!res.ok || !res.data) {
    return NextResponse.json({ data: null }, { status: res.status });
  }
  return NextResponse.json({ data: { ...res.data, url: `${API_PUBLIC_URL}${res.data.url}` } });
}
