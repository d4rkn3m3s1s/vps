// Identity provider — generates a plausible person (name, address, DOB, gender)
// for seeding a new account's profile.
//
// DEFAULT IS OFFLINE. Account farming must not depend on a third-party SaaS being
// reachable (randomuser.me / fakeaddressgenerator are frequently blocked from
// server networks, behind WSL NAT, or rate-limited → the whole farm stalls).
// So we generate identities locally from curated, per-country name/address pools.
// No network call, no API key, deterministic-but-varied output.
//
// A network source can still be opted into by setting IDENTITY_BASE_URL to a
// randomuser.me-compatible endpoint; if that call fails we transparently fall
// back to the offline generator so the farm never breaks.
//
// Configure via env:
//   IDENTITY_BASE_URL  optional randomuser.me-compatible base. If set, tried
//                      first; on any error we silently use the offline pool.

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
  password: string;
  birthDate: string; // ISO date
  age: number;
  phone: string;
  street: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  countryCode: string; // 2-letter
  source: 'offline' | 'network';
};

// ── Offline name + address pools, keyed by 2-letter country code. ──────────────
// Kept compact but realistic. Unknown country codes fall back to US.
type Pool = {
  country: string;
  male: string[];
  female: string[];
  last: string[];
  cities: Array<{ city: string; state: string }>;
  streets: string[];
  phonePrefix: string; // E.164-ish prefix used to synthesise a number
  postFmt: () => string; // postcode shape per country (varied per call via counter)
};

let seqCounter = 0;
// Deterministic-but-varied pseudo-random in [0,1) seeded by an incrementing
// counter mixed with the seed string. Math.random() is unavailable in some
// runtimes here, and we want reproducibility for the same seed anyway.
function rng(seed: string): () => number {
  let h = 2166136261 >>> 0;
  const mix = `${seed}:${(seqCounter += 1)}`;
  for (let i = 0; i < mix.length; i += 1) {
    h ^= mix.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    // xorshift32
    h ^= h << 13; h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5; h >>>= 0;
    return (h >>> 0) / 4294967296;
  };
}

function pick<T>(arr: T[], r: () => number): T {
  return arr[Math.floor(r() * arr.length)] ?? arr[0]!;
}

function digits(n: number, r: () => number): string {
  let s = '';
  for (let i = 0; i < n; i += 1) s += Math.floor(r() * 10);
  return s;
}

const POOLS: Record<string, Pool> = {
  US: {
    country: 'United States',
    male: ['James', 'Michael', 'Robert', 'John', 'David', 'William', 'Daniel', 'Joseph', 'Ethan', 'Logan', 'Mason', 'Lucas', 'Henry', 'Owen', 'Jack'],
    female: ['Mary', 'Jennifer', 'Linda', 'Emily', 'Olivia', 'Emma', 'Ava', 'Sophia', 'Isabella', 'Mia', 'Charlotte', 'Amelia', 'Harper', 'Grace', 'Chloe'],
    last: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore'],
    cities: [
      { city: 'Austin', state: 'Texas' }, { city: 'Denver', state: 'Colorado' },
      { city: 'Portland', state: 'Oregon' }, { city: 'Seattle', state: 'Washington' },
      { city: 'Phoenix', state: 'Arizona' }, { city: 'Columbus', state: 'Ohio' },
      { city: 'Nashville', state: 'Tennessee' }, { city: 'Raleigh', state: 'North Carolina' }
    ],
    streets: ['Maple Ave', 'Oak St', 'Pine Rd', 'Cedar Ln', 'Elm St', 'Sunset Blvd', 'Park Ave', 'Lake Dr', 'Hill St', 'River Rd'],
    phonePrefix: '+1',
    postFmt: () => ''
  },
  GB: {
    country: 'United Kingdom',
    male: ['Oliver', 'Harry', 'George', 'Jack', 'Charlie', 'Thomas', 'Oscar', 'William', 'James', 'Henry', 'Leo', 'Alfie', 'Joshua', 'Freddie', 'Archie'],
    female: ['Olivia', 'Amelia', 'Isla', 'Ava', 'Emily', 'Sophia', 'Grace', 'Mia', 'Poppy', 'Ella', 'Lily', 'Freya', 'Charlotte', 'Evie', 'Ruby'],
    last: ['Smith', 'Jones', 'Taylor', 'Brown', 'Williams', 'Wilson', 'Johnson', 'Davies', 'Patel', 'Robinson', 'Wright', 'Thompson', 'Evans', 'Walker', 'White'],
    cities: [
      { city: 'Manchester', state: 'England' }, { city: 'Leeds', state: 'England' },
      { city: 'Bristol', state: 'England' }, { city: 'Glasgow', state: 'Scotland' },
      { city: 'Birmingham', state: 'England' }, { city: 'Cardiff', state: 'Wales' },
      { city: 'Liverpool', state: 'England' }, { city: 'Sheffield', state: 'England' }
    ],
    streets: ['High St', 'Station Rd', 'Church Ln', 'Victoria Rd', 'Kings Rd', 'Queen St', 'Mill Ln', 'Park Rd', 'Green Ln', 'Manor Way'],
    phonePrefix: '+44',
    postFmt: () => ''
  },
  TR: {
    country: 'Türkiye',
    male: ['Yusuf', 'Mehmet', 'Ahmet', 'Mustafa', 'Emre', 'Berkay', 'Burak', 'Kerem', 'Mert', 'Eren', 'Arda', 'Kaan', 'Furkan', 'Baran', 'Efe'],
    female: ['Zeynep', 'Elif', 'Ayşe', 'Fatma', 'Merve', 'Ceren', 'Buse', 'Esra', 'Selin', 'Ece', 'Defne', 'İrem', 'Sıla', 'Naz', 'Yağmur'],
    last: ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Yıldırım', 'Öztürk', 'Aydın', 'Özdemir', 'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Çetin'],
    cities: [
      { city: 'İstanbul', state: 'Marmara' }, { city: 'Ankara', state: 'İç Anadolu' },
      { city: 'İzmir', state: 'Ege' }, { city: 'Bursa', state: 'Marmara' },
      { city: 'Antalya', state: 'Akdeniz' }, { city: 'Adana', state: 'Akdeniz' },
      { city: 'Konya', state: 'İç Anadolu' }, { city: 'Trabzon', state: 'Karadeniz' }
    ],
    streets: ['Atatürk Cd.', 'Cumhuriyet Cd.', 'İstiklal Cd.', 'Gül Sk.', 'Bahçe Sk.', 'Çınar Sk.', 'Menekşe Sk.', 'Zafer Cd.', 'Barış Sk.', 'Lale Sk.'],
    phonePrefix: '+90',
    postFmt: () => ''
  },
  DE: {
    country: 'Deutschland',
    male: ['Lukas', 'Leon', 'Paul', 'Felix', 'Jonas', 'Maximilian', 'Elias', 'Noah', 'Ben', 'Finn', 'Luis', 'Henry', 'Emil', 'Anton', 'Moritz'],
    female: ['Mia', 'Emma', 'Hannah', 'Sofia', 'Lina', 'Marie', 'Lena', 'Lea', 'Clara', 'Laura', 'Anna', 'Johanna', 'Frieda', 'Ida', 'Lara'],
    last: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann', 'Koch', 'Bauer', 'Richter', 'Klein', 'Wolf'],
    cities: [
      { city: 'München', state: 'Bayern' }, { city: 'Hamburg', state: 'Hamburg' },
      { city: 'Köln', state: 'NRW' }, { city: 'Frankfurt', state: 'Hessen' },
      { city: 'Stuttgart', state: 'BW' }, { city: 'Düsseldorf', state: 'NRW' },
      { city: 'Leipzig', state: 'Sachsen' }, { city: 'Dresden', state: 'Sachsen' }
    ],
    streets: ['Hauptstraße', 'Schulstraße', 'Gartenstraße', 'Bahnhofstraße', 'Lindenweg', 'Bergstraße', 'Birkenweg', 'Goethestraße', 'Schillerstraße', 'Mozartweg'],
    phonePrefix: '+49',
    postFmt: () => ''
  }
};

function poolFor(code?: string): { code: string; pool: Pool } {
  const c = (code || 'US').toUpperCase();
  return { code: POOLS[c] ? c : 'US', pool: POOLS[c] ?? POOLS.US! };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '');
}

// Build a complete identity locally — no network.
export function generateIdentityOffline(opts?: {
  country?: string;
  gender?: 'male' | 'female';
  seed?: string;
}): FakeIdentity {
  const seed = opts?.seed || `id-${seqCounter}`;
  const r = rng(seed);
  const { code, pool } = poolFor(opts?.country);
  const gender: 'male' | 'female' = opts?.gender ?? (r() < 0.5 ? 'male' : 'female');
  const firstName = pick(gender === 'male' ? pool.male : pool.female, r);
  const lastName = pick(pool.last, r);
  const loc = pick(pool.cities, r);
  const street = `${1 + Math.floor(r() * 220)} ${pick(pool.streets, r)}`;
  const postcode = digits(5, r);
  // Age 19–48 → birth year/month/day.
  const age = 19 + Math.floor(r() * 30);
  const year = 2026 - age;
  const month = 1 + Math.floor(r() * 12);
  const day = 1 + Math.floor(r() * 28);
  const birthDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const handleBase = `${slug(firstName)}${slug(lastName)}`;
  const username = `${handleBase}${digits(2 + Math.floor(r() * 2), r)}`;
  const phone = `${pool.phonePrefix}${digits(10, r)}`;
  // Strong-ish password: Capitalized name fragment + digits + symbol.
  const password = `${firstName}${digits(4, r)}!${slug(lastName).slice(0, 2)}`;
  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    gender,
    email: `${username}@`, // domain filled by caller (mail provider owns the domain)
    username,
    password,
    birthDate,
    age,
    phone,
    street,
    city: loc.city,
    state: loc.state,
    postcode,
    country: pool.country,
    countryCode: code,
    source: 'offline'
  };
}

type RandomUserResult = {
  results: Array<{
    gender: string;
    name: { first: string; last: string };
    login: { username: string; password?: string };
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

// Generate one identity. Offline by default; if IDENTITY_BASE_URL is configured
// we try the network source first and fall back to offline on any error.
// `country` is a 2-letter nat code (e.g. US, GB, TR); `gender` is "male"|"female".
export async function generateIdentity(
  cfg: IdentityProviderConfig,
  opts?: { country?: string; gender?: 'male' | 'female'; seed?: string }
): Promise<FakeIdentity> {
  // Offline-first: only attempt the network when an explicit base URL is set
  // AND it differs from the default (i.e. the operator opted into a source they
  // know is reachable). Otherwise generate locally — fast and never fails.
  const base = (cfg.baseUrl || '').replace(/\/+$/, '');
  const wantNetwork = base && base !== DEFAULT_BASE;
  if (!wantNetwork) {
    return generateIdentityOffline(opts);
  }
  try {
    const params = new URLSearchParams({ noinfo: '' });
    if (opts?.country) params.set('nat', opts.country.toLowerCase());
    if (opts?.gender) params.set('gender', opts.gender);
    const url = `${base}/?${params.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      const text = await res.text();
      if (!res.ok) throw new Error(`identity ${res.status}`);
      const body = JSON.parse(text) as RandomUserResult;
      const rr = body.results?.[0];
      if (!rr) throw new Error('no result');
      return {
        firstName: rr.name.first,
        lastName: rr.name.last,
        fullName: `${rr.name.first} ${rr.name.last}`,
        gender: rr.gender,
        email: rr.email,
        username: rr.login.username,
        password: rr.login.password || generateIdentityOffline(opts).password,
        birthDate: rr.dob.date.slice(0, 10),
        age: rr.dob.age,
        phone: rr.phone || rr.cell || '',
        street: `${rr.location.street.number} ${rr.location.street.name}`,
        city: rr.location.city,
        state: rr.location.state,
        postcode: String(rr.location.postcode),
        country: rr.location.country,
        countryCode: (rr.nat || opts?.country || '').toUpperCase(),
        source: 'network'
      };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Network source unreachable/blocked → never break the farm; go offline.
    return generateIdentityOffline(opts);
  }
}
