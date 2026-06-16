import { ProfilesView, type DeviceProfile, type DeviceGroup, type Country } from './ProfilesView';

type ApiResponse<T> = { data: T };

async function fetchJson<T>(path: string): Promise<T | null> {
  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      cache: 'no-store',
      headers: {
        'x-api-key': process.env.DEFAULT_API_KEY ?? 'replace-with-a-long-random-api-key'
      }
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export const metadata = {
  title: 'Profiles · VPS Fleet'
};

export const dynamic = 'force-dynamic';

export default async function ProfilesPage() {
  const [devicesRes, groupsRes, countriesRes] = await Promise.all([
    fetchJson<ApiResponse<DeviceProfile[]>>('/devices'),
    fetchJson<ApiResponse<DeviceGroup[]>>('/devices/groups'),
    fetchJson<ApiResponse<Country[]>>('/fingerprints/countries')
  ]);

  const devices = devicesRes?.data ?? [];
  const groups = groupsRes?.data ?? [];
  const countries = countriesRes?.data ?? [];

  return <ProfilesView devices={devices} groups={groups} countries={countries} />;
}
