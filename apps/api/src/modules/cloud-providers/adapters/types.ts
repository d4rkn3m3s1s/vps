// Cloud-phone provider adapter contract.
//
// One interface, many vendors. Each external cloud-phone vendor (GeeLark, VMOS,
// DuoPlus, UGPhone, …) gets an adapter that maps OUR canonical operations onto
// the vendor's HTTP API. The rest of the platform (devices module, dashboard)
// only ever talks to this interface, so we are never locked to one vendor — you
// can switch providers, or run several at once, without touching the panel.
//
// Credentials arrive already decrypted (the service decrypts the AES-GCM blobs
// from CloudPhoneProvider before constructing the adapter). Adapters are
// stateless and dependency-light (global fetch only); a missing/invalid key must
// surface as a clear thrown Error, never a silent success.

export type ProviderCreds = {
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  apiSecret?: string | undefined;
};

// A vendor phone, normalised to the fields our Device model needs.
export type RemotePhone = {
  externalId: string;             // vendor-side phone id (used for all control calls)
  name: string;
  status: 'ONLINE' | 'OFFLINE' | 'STARTING' | 'STOPPING' | 'ERROR' | 'UNKNOWN';
  androidVersion?: string | undefined;
  model?: string | undefined;
  region?: string | undefined;
};

export type CreatePhoneInput = {
  name: string;
  region?: string | undefined;
  androidVersion?: string | undefined;
  model?: string | undefined;
};

export type ProxyConfig = {
  type: 'HTTP' | 'HTTPS' | 'SOCKS5';
  host: string;
  port: number;
  username?: string | undefined;
  password?: string | undefined;
};

// The capability surface. Not every vendor supports every op; adapters throw a
// `NotSupportedError` for ones they can't do, so the UI can hide/disable them
// per provider rather than failing opaquely.
export interface CloudProviderAdapter {
  readonly kind: string;

  // Connectivity / credential check — cheap call (e.g. list 1 phone or balance).
  // Returns a short human detail for the providers admin page.
  check(): Promise<{ ok: boolean; detail: string }>;

  // Phone lifecycle.
  listPhones(): Promise<RemotePhone[]>;
  createPhone(input: CreatePhoneInput): Promise<RemotePhone>;
  startPhone(externalId: string): Promise<void>;
  stopPhone(externalId: string): Promise<void>;
  rebootPhone(externalId: string): Promise<void>;
  deletePhone(externalId: string): Promise<void>;

  // Control.
  installApp(externalId: string, apkUrlOrPackage: string): Promise<void>;
  runShell(externalId: string, command: string): Promise<{ output: string }>;
  setProxy(externalId: string, proxy: ProxyConfig | null): Promise<void>;

  // A current screenshot as a base64 PNG/JPEG (for the live tile / preview).
  screenshot(externalId: string): Promise<{ base64: string; mime: string }>;
}

// Thrown by adapters for operations a given vendor does not expose.
export class NotSupportedError extends Error {
  constructor(op: string, vendor: string) {
    super(`${vendor} sağlayıcısı "${op}" işlemini desteklemiyor`);
    this.name = 'NotSupportedError';
  }
}
