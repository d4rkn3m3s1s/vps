// Fake identity provider — generates a plausible person (name, address, DOB,
// gender) for seeding a new account's profile.
//
// We use randomuser.me: a free, no-auth, well-structured generator with country
// (`nat`) and gender filters. (fakeaddressgenerator.com was the original ask but
// it returns HTTP 403 to programmatic clients behind bot protection, so it isn't
// usable server-side; randomuser.me gives the same fields reliably. The shape is
// isolated here so a different source can be swapped in without touching callers.)
//
// Configure via env:
//   IDENTITY_BASE_URL  override base (default https://randomuser.me/api)

const DEFAULT_BASE = 'https://randomuser.me/api';

export type IdentityProviderConfig = {
  baseUrl?: string | undefined;
};

export type FakeIdentity = {
  firstName: string;
  lastName: string;
  fullName: string;
  gender: string;
  email: string;
  username: string;
  birthDate: string; // ISO date
  age: number;
  phone: string;
  street: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  countryCode: string; // 2-letter
};

type RandomUserResult = {
  results: Array<{
    gender: string;
    name: { first: string; last: string };
    login: { username: string };
    email: string;
    dob: { date: string; age: number };
    phone: string;
    cell: string;
    nat: string;
    location: {
      street: { number: number; name: string };
      city: string;
      state: string;
      country: string;
      postcode: string | number;
    };
  }>;
};

// Generate one identity. `country` is a 2-letter nat code (e.g. US, GB, TR);
// `gender` is "male" | "female" (omitted = random).
export async function generateIdentity(
  cfg: IdentityProviderConfig,
  opts?: { country?: string; gender?: 'male' | 'female' }
): Promise<FakeIdentity> {
  const base = (cfg.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  const params = new URLSearchParams({ noinfo: '' });
  if (opts?.country) params.set('nat', opts.country.toLowerCase());
  if (opts?.gender) params.set('gender', opts.gender);
  const url = `${base}/?${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`identity ${res.status}: ${text.slice(0, 200)}`);
    const body = JSON.parse(text) as RandomUserResult;
    const r = body.results?.[0];
    if (!r) throw new Error('identity provider returned no result');
    return {
      firstName: r.name.first,
      lastName: r.name.last,
      fullName: `${r.name.first} ${r.name.last}`,
      gender: r.gender,
      email: r.email,
      username: r.login.username,
      birthDate: r.dob.date.slice(0, 10),
      age: r.dob.age,
      phone: r.phone || r.cell || '',
      street: `${r.location.street.number} ${r.location.street.name}`,
      city: r.location.city,
      state: r.location.state,
      postcode: String(r.location.postcode),
      country: r.location.country,
      countryCode: (r.nat || opts?.country || '').toUpperCase()
    };
  } finally {
    clearTimeout(timer);
  }
}
