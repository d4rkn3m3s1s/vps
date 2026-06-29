// Adapter registry — maps a CloudProviderKind to its adapter implementation.
// Add a new vendor by writing an adapter and registering it here; nothing else
// in the platform changes (the devices module + dashboard stay vendor-agnostic).

import type { CloudProviderAdapter, ProviderCreds } from './types';
import { GeeLarkAdapter } from './geelark.adapter';
import { VmosAdapter } from './vmos.adapter';

export type AdapterKind = 'GEELARK' | 'VMOS' | 'DUOPLUS' | 'UGPHONE';

// Factory per kind. DUOPLUS/UGPHONE are declared but not yet implemented — they
// throw on use so the UI can offer them while signalling "coming/configure".
const FACTORIES: Record<string, (creds: ProviderCreds) => CloudProviderAdapter> = {
  GEELARK: (c) => new GeeLarkAdapter(c),
  VMOS: (c) => new VmosAdapter(c)
};

export function getAdapter(kind: string, creds: ProviderCreds): CloudProviderAdapter {
  const factory = FACTORIES[kind];
  if (!factory) {
    throw new Error(`"${kind}" için adapter henüz uygulanmadı (GeeLark ve VMOS hazır).`);
  }
  return factory(creds);
}

export function isImplemented(kind: string): boolean {
  return Boolean(FACTORIES[kind]);
}
