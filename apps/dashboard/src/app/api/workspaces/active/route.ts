import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// Returns the active workspace id from the httpOnly fleet_workspace cookie so
// client components (e.g. admin pages) can target the SAME workspace the
// switcher selected, instead of defaulting to the first one.
export async function GET() {
  const activeId = (await cookies()).get('fleet_workspace')?.value ?? null;
  return NextResponse.json({ data: { activeId } });
}
