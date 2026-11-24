import { describe, expect, it } from 'vitest';
import {
  PRODUCT_PATCH_FIELDS,
  SHOPTET_CAPABILITIES,
  type ProductPatchField,
} from '@puls/platform-core';
import { UPGATES_CAPABILITIES } from '@puls/upgates-client';
import {
  productPatchSchema,
  buildProductPatchSchema,
} from '../src/tools/writes.js';

/**
 * Kontrakt patch schématu po tester feedbacku: neznámé pole NESMÍ být tiše
 * stripnuto (klient si pak myslí, že se zapsalo) a `stock` je platné pole.
 */
describe('productPatchSchema', () => {
  it('accepts stock as a patch field', () => {
    const parsed = productPatchSchema.parse({ stock: 3 });
    expect(parsed).toEqual({ stock: 3 });
  });

  it('accepts stock combined with price (tester scenario: fix price + stock)', () => {
    const parsed = productPatchSchema.parse({ priceWithVat: 249, stock: 3 });
    expect(parsed).toEqual({ priceWithVat: 249, stock: 3 });
  });

  it('rejects unknown fields loudly instead of silently stripping them', () => {
    const res = productPatchSchema.safeParse({ priceWithVat: 249, stok: 3 });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(JSON.stringify(res.error.issues)).toContain('stok');
    }
  });

  it('rejects an empty patch', () => {
    expect(productPatchSchema.safeParse({}).success).toBe(false);
  });

  it('rejects negative stock', () => {
    expect(productPatchSchema.safeParse({ stock: -1 }).success).toBe(false);
  });
});

/**
 * Per-platform schéma: platforma deklaruje svou podmnožinu `productPatchFields`.
 * Schéma proto nesmí nabízet (a musí odmítnout) pole, která platforma neumí —
 * místo aby je pustilo dál a platforma je runtime odmítla / tiše zahodila.
 * Upgates umí celý ProductPatch; úzkou množinu ověřujeme generickým field setem.
 */
describe('buildProductPatchSchema (per-platform)', () => {
  // Generická úzká množina (např. budoucí platforma jen se základem) — ověřuje,
  // že builder reálně zúží schéma a hlasitě odmítne pole mimo deklaraci.
  const narrowFields: readonly ProductPatchField[] = [
    'name',
    'description',
    'priceWithVat',
    'visibility',
  ];
  const narrow = buildProductPatchSchema(narrowFields);
  const full = buildProductPatchSchema(PRODUCT_PATCH_FIELDS);

  it('úzká množina odmítne pole, které není deklarováno (weight)', () => {
    expect(narrow.safeParse({ weight: 250 }).success).toBe(false);
  });

  it('úzká množina odmítne parameters/manufacturer/images', () => {
    expect(narrow.safeParse({ parameters: [{ name: 'a', value: 'b' }] }).success).toBe(false);
    expect(narrow.safeParse({ manufacturer: 'Sony' }).success).toBe(false);
    expect(narrow.safeParse({ addImageUrls: ['https://x/y.jpg'] }).success).toBe(false);
  });

  it('úzká množina přijme základní pole', () => {
    expect(narrow.parse({ description: 'x' })).toEqual({ description: 'x' });
  });

  it('Upgates deklaruje plnou množinu polí', () => {
    expect([...(UPGATES_CAPABILITIES.productPatchFields ?? [])].sort()).toEqual(
      [...PRODUCT_PATCH_FIELDS].sort()
    );
  });

  it('plné (Upgates) schéma weight i parameters přijme', () => {
    expect(full.safeParse({ weight: 250 }).success).toBe(true);
    expect(
      full.safeParse({ parameters: [{ name: 'Původ', value: 'Etiopie' }] }).success
    ).toBe(true);
  });
});

/** Shoptet: update_product umí jen základní pole → užší schéma. */
describe('buildProductPatchSchema (Shoptet)', () => {
  const shoptetFields = SHOPTET_CAPABILITIES.productPatchFields!;
  const shoptet = buildProductPatchSchema(shoptetFields);

  it('Shoptet má úzkou množinu (name/description/price/visibility)', () => {
    expect([...shoptetFields].sort()).toEqual(
      ['description', 'name', 'priceWithVat', 'visibility'].sort()
    );
  });

  it('Shoptet schéma odmítne pole, které neumí (weight/parameters/stock)', () => {
    expect(shoptet.safeParse({ weight: 250 }).success).toBe(false);
    expect(shoptet.safeParse({ parameters: [{ name: 'a', value: 'b' }] }).success).toBe(false);
    expect(shoptet.safeParse({ stock: 3 }).success).toBe(false);
  });

  it('Shoptet schéma přijme základní pole', () => {
    expect(shoptet.parse({ description: 'x' })).toEqual({ description: 'x' });
  });
});
