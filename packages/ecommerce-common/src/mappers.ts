/**
 * Doménově neutrální mapper helpery. Platformy posílají čísla i jako string
 * (`"123.45"`) — kanonický model je vždy `number`. `toNumber` normalizuje
 * string|number|null|undefined na `number` s deterministickým fallbackem.
 */
export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return fallback;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}
