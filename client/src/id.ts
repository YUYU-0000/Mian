let fallbackCounter = 0;

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

export function createId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    try { return cryptoApi.randomUUID(); } catch { /* use a compatible fallback */ }
  }
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    try {
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      return bytesToUuid(bytes);
    } catch { /* restricted WebViews may expose crypto but reject calls */ }
  }
  fallbackCounter = (fallbackCounter + 1) >>> 0;
  return `local-${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
