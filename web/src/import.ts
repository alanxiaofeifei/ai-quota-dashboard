import { ApiError } from './api';

export const MAX_SUMMARY_BYTES = 32 * 1024;

// This parser only bounds and decodes user-supplied JSON. The local API remains
// authoritative for the browser report contract and field allowlist.
export function parseSummaryText(text: string): unknown {
  if (new TextEncoder().encode(text).byteLength > MAX_SUMMARY_BYTES) throw new ApiError(400, 'body_too_large');
  try { return JSON.parse(text); }
  catch { throw new ApiError(400, 'invalid_json'); }
}

export function isProgramManifestFilename(name: string): boolean {
  return ['manifest.json', 'source_manifest.json', 'third_party_manifest.json', 'core-backup.json'].includes(name.toLowerCase());
}
