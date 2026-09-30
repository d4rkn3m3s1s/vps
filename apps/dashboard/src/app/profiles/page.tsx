import { serverFetch } from '../../lib/serverFetch';
import {
  ProfilesView,
  type DeviceProfile,
  type DeviceGroup,
  type Country,
  type ProxyOption,
  type AppOption
} from './ProfilesView';

export const metadata = {
  title: 'Profiles · VPS Fleet'
};

export const dynamic = 'force-dynamic';

export default async function ProfilesPage() {
  const [devicesRes, groupsRes, countriesRes, proxiesRes, appsRes] = await Promise.all([
    serverFetch<DeviceProfile[]>('/devices'),
    serverFetch<DeviceGroup[]>('/devices/groups'),
    serverFetch<Country[]>('/fingerprints/countries'),
    serverFetch<ProxyOption[]>('/proxies'),
    serverFetch<AppOption[]>('/catalog/apps')
  ]);

  // ★2026-10-01 SAYFA 911 kB → hafif: /devices her cihaza tam `host` nesnesini (aynı sunucu,
  // 155 kez, ~88 kB) ekliyordu ve bu görünüm onu HİÇ kullanmıyor. TS tipi çalışma zamanında
  // alan ATMAZ (26 Eyl dersi) → açıkça çıkarılır. fingerprint/metadata kullanılıyor, kalır.
  const devices = (devicesRes?.data ?? []).map((d) => {
    const { host: _host, ...rest } = d as DeviceProfile & { host?: unknown };
    return rest as DeviceProfile;
  });
  const groups = groupsRes?.data ?? [];
  const countries = countriesRes?.data ?? [];
  const proxies = proxiesRes?.data ?? [];
  const apps = appsRes?.data ?? [];

  return <ProfilesView devices={devices} groups={groups} countries={countries} proxies={proxies} apps={apps} />;
}
