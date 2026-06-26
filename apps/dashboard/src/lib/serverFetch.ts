import { apiCall } from './apiClient';

// Server-side read helper for page server components. Routes through apiCall so
// every request carries the active workspace's scoped token (read from the
// fleet_workspace cookie) — giving pages true workspace isolation instead of the
// old raw x-api-key fetch that saw every workspace's data.
//
// Returns the API's `{ data }` envelope so existing pages can keep using
// `res?.data`.
export async function serverFetch<T>(path: string): Promise<{ data: T } | null> {
  const res = await apiCall<T>(path, { auth: true });
  if (!res.ok || res.data === null) return null;
  return { data: res.data };
}
