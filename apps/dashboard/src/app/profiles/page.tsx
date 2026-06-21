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

  const devices = devicesRes?.data ?? [];
  const groups = groupsRes?.data ?? [];
  const countries = countriesRes?.data ?? [];
  const proxies = proxiesRes?.data ?? [];
  const apps = appsRes?.data ?? [];

  return <ProfilesView devices={devices} groups={groups} countries={countries} proxies={proxies} apps={apps} />;
}
