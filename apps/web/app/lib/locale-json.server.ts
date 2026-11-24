import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const LOCALES_ROOT = path.join(process.cwd(), 'locales');

export function readLocaleJson(
  relPath: string
): Record<string, unknown> | null {
  const p = path.join(LOCALES_ROOT, relPath);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
}

/**
 * Deep-merge overlay onto base. Empty strings/undefined in overlay are
 * skipped (treated as missing translation).
 */
export function deepMergeRecords(
  base: Record<string, unknown>,
  over: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined || v === '') continue;
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      out[k] &&
      typeof out[k] === 'object' &&
      !Array.isArray(out[k])
    ) {
      out[k] = deepMergeRecords(
        out[k] as Record<string, unknown>,
        v as Record<string, unknown>
      );
    } else {
      out[k] = v;
    }
  }
  return out;
}
