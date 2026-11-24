import { describe, expect, it } from 'vitest';
import { PLATFORM, PLATFORMS, isPlatform } from '@puls/db/schema';

/**
 * Drift guard pro JEDINÝ zdroj pravdy identity platformy (@puls/db/schema).
 * Pokud někdo přidá platformu do pgEnum, ale zapomene na PLATFORM (nebo naopak),
 * nebo se rozejde pořadí/hodnoty oproti DB enumu (0010_multi_platform.sql),
 * tenhle test spadne dřív než produkce.
 */
describe('platform identity source of truth', () => {
  it('PLATFORMS matches the DB enum values exactly', () => {
    expect([...PLATFORMS]).toEqual(['shoptet', 'upgates']);
  });

  it('PLATFORM named constants cover every platform in PLATFORMS', () => {
    expect(Object.values(PLATFORM).sort()).toEqual([...PLATFORMS].sort());
    expect(PLATFORM.SHOPTET).toBe('shoptet');
    expect(PLATFORM.UPGATES).toBe('upgates');
  });

  it('isPlatform narrows known platforms and rejects others', () => {
    expect(isPlatform('shoptet')).toBe(true);
    expect(isPlatform('upgates')).toBe(true);
    expect(isPlatform('woocommerce')).toBe(false);
    expect(isPlatform(null)).toBe(false);
    expect(isPlatform(42)).toBe(false);
  });
});
