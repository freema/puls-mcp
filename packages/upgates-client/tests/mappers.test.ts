import { describe, expect, it } from 'vitest';
import {
  mapOrder,
  mapOrderDetail,
  mapProduct,
  mapProductDetail,
  mapCustomerDetail,
  mapCategory,
  mapVoucherSummary,
} from '../src/mappers.js';
import { pickLanguage } from '../src/lang.js';
import type {
  UpgatesOrderRaw,
  UpgatesProductRaw,
  UpgatesCustomerRaw,
  UpgatesCategoryRaw,
  UpgatesVoucherRaw,
} from '../src/types.js';

describe('mapOrder / mapOrderDetail', () => {
  const raw: UpgatesOrderRaw = {
    code: 'UPG-ORDER-001',
    status: 'Vyřízeno',
    paid_yn: 'Y',
    currency: 'CZK',
    total_price_with_vat: '1210.00',
    created_at: '2026-05-01T10:00:00+02:00',
    firstname: 'Jan',
    surname: 'Novák',
    email: 'jan@firma.cz',
    company: 'Firma s.r.o.',
    company_number: '12345678',
    vat_number: 'CZ12345678',
    products: [
      { code: 'P1', title: 'Tričko', quantity: 2, price_with_vat: '605.00' },
    ],
  };

  it('maps slim order with numeric total', () => {
    expect(mapOrder(raw)).toEqual({
      code: 'UPG-ORDER-001',
      status: 'Vyřízeno',
      totalPrice: 1210,
    });
  });

  it('maps B2B fields (IČO/DIČ) onto customer', () => {
    const detail = mapOrderDetail(raw);
    expect(detail.customer?.companyId).toBe('12345678');
    expect(detail.customer?.vatId).toBe('CZ12345678');
    expect(detail.customer?.company).toBe('Firma s.r.o.');
    expect(detail.customer?.name).toBe('Jan Novák');
  });

  it('maps order line items', () => {
    const detail = mapOrderDetail(raw);
    expect(detail.items).toEqual([
      { name: 'Tričko', amount: 2, unitPrice: 605 },
    ]);
  });

  it('PAID_YN: Y → paid true (and N → false, missing → false)', () => {
    expect(mapOrderDetail(raw).paid).toBe(true);
    expect(mapOrderDetail({ ...raw, paid_yn: 'N' }).paid).toBe(false);
    expect(mapOrderDetail({ ...raw, paid_yn: undefined }).paid).toBe(false);
  });

  it('maps fulfillment/accounting fields (invoice, VS, tracking) from real API', () => {
    const detail = mapOrderDetail({
      ...raw,
      invoice_number: '2026000123',
      variable_symbol: '1',
      tracking_code: 'CP123456789CZ',
      tracking_url: 'https://tracking.example/CP123456789CZ',
    });
    expect(detail.invoiceNumber).toBe('2026000123');
    expect(detail.variableSymbol).toBe('1');
    expect(detail.trackingCode).toBe('CP123456789CZ');
    expect(detail.trackingUrl).toBe('https://tracking.example/CP123456789CZ');
  });

  it('leaves fulfillment fields undefined when API sends null', () => {
    const detail = mapOrderDetail({
      ...raw,
      invoice_number: null,
      variable_symbol: null,
      tracking_code: null,
      tracking_url: null,
    });
    expect(detail.invoiceNumber).toBeUndefined();
    expect(detail.trackingCode).toBeUndefined();
  });
});

describe('pickLanguage + product multijazyčnost', () => {
  const raw: UpgatesProductRaw = {
    code: 'PROD-1',
    ean: '8590000000001',
    active_yn: 'Y',
    price_with_vat: '499',
    price_without_vat: '412.4',
    price_original: '599',
    price_sale: '449',
    vats: ['21', 12],
    availability: 'Skladem',
    currency: 'CZK',
    stock: '7',
    descriptions: [
      { language: 'cs', title: 'Tričko', description: 'Bavlněné tričko' },
      { language: 'en', title: 'T-shirt', description: 'Cotton t-shirt' },
    ],
    categories: [{ language: 'cs', name: 'Oblečení' }],
    variants: [
      { code: 'PROD-1-M', ean: '8590000000018', price_with_vat: '529', stock: '4' },
      { code: 'PROD-1-L', ean: '8590000000025', price_with_vat: 549, stock: 0 },
    ],
  };

  it('pickLanguage picks requested lang, falls back to cs, then first', () => {
    expect(pickLanguage(raw.descriptions, 'en')?.title).toBe('T-shirt');
    expect(pickLanguage(raw.descriptions, 'de')?.title).toBe('Tričko'); // fallback cs
    expect(pickLanguage(raw.descriptions, null)?.title).toBe('Tričko');
    expect(pickLanguage([], 'cs')).toBeUndefined();
  });

  it('maps product with localized title, ean, stock, visibility', () => {
    const p = mapProduct(raw, 'en');
    expect(p).toMatchObject({
      guid: 'PROD-1',
      name: 'T-shirt',
      code: 'PROD-1',
      ean: '8590000000001',
      price: 499,
      stock: 7,
      visible: true,
    });
  });

  it('maps product detail with localized category names', () => {
    const p = mapProductDetail(raw, 'cs');
    expect(p.description).toBe('Bavlněné tričko');
    expect(p.categories).toEqual(['Oblečení']);
  });

  it('active_yn N → visible false', () => {
    expect(mapProduct({ code: 'x', active_yn: 'N' }).visible).toBe(false);
  });

  it('maps the richer price structure (with/without VAT, original/sale) + vatRates + availability', () => {
    const p = mapProduct(raw, 'cs');
    expect(p.price).toBe(499); // with VAT
    expect(p.priceWithoutVat).toBe(412.4);
    expect(p.priceOriginal).toBe(599);
    expect(p.priceSale).toBe(449);
    expect(p.vatRates).toEqual([21, 12]);
    expect(p.availabilityLabel).toBe('Skladem');
  });

  it('omits price/vat/availability fields when raw is missing them', () => {
    const p = mapProduct({ code: 'bare', active_yn: 'Y', price_with_vat: '10' });
    expect(p.priceWithoutVat).toBeUndefined();
    expect(p.priceOriginal).toBeUndefined();
    expect(p.priceSale).toBeUndefined();
    expect(p.vatRates).toBeUndefined();
    expect(p.availabilityLabel).toBeUndefined();
  });

  it('maps variants as full products with own code/EAN/price/stock', () => {
    const p = mapProductDetail(raw, 'cs');
    expect(p.variants).toEqual([
      { code: 'PROD-1-M', ean: '8590000000018', priceWithVat: 529, stock: 4 },
      { code: 'PROD-1-L', ean: '8590000000025', priceWithVat: 549, stock: 0 },
    ]);
    // Varianta nese VLASTNÍ cenu/sklad, ne hodnoty z parent produktu.
    expect(p.variants?.[0]?.priceWithVat).not.toBe(p.price);
    expect(p.variants?.[1]?.stock).toBe(0);
  });

  it('omits variants when product has none', () => {
    const p = mapProductDetail({ code: 'novars', active_yn: 'Y' }, 'cs');
    expect(p.variants).toBeUndefined();
  });
});

describe('mapCustomerDetail / mapCategory', () => {
  it('maps B2B customer fields', () => {
    const raw: UpgatesCustomerRaw = {
      code: 'CUST-1',
      email: 'b2b@firma.cz',
      firstname: 'Eva',
      surname: 'Malá',
      company: 'Malá s.r.o.',
      company_number: '87654321',
      vat_number: 'CZ87654321',
      note: 'VIP zákazník',
    };
    expect(mapCustomerDetail(raw)).toEqual({
      guid: 'CUST-1',
      email: 'b2b@firma.cz',
      name: 'Eva Malá',
      company: 'Malá s.r.o.',
      companyId: '87654321',
      vatId: 'CZ87654321',
      note: 'VIP zákazník', // read-back poznámky pro audit create_customer_note
    });
  });

  it('maps category with parent and localized name', () => {
    const raw: UpgatesCategoryRaw = {
      id: 10,
      parent_id: 3,
      descriptions: [{ language: 'cs', name: 'Trička' }],
    };
    expect(mapCategory(raw, 'cs')).toEqual({
      guid: '10',
      name: 'Trička',
      parentGuid: '3',
    });
  });

  it('enriches category with code/position/showInMenu/visible (write fields)', () => {
    const raw: UpgatesCategoryRaw = {
      code: 'kava',
      category_id: 42,
      parent_id: null,
      position: 2,
      active_yn: true,
      show_in_menu_yn: false,
      descriptions: [{ language: 'cs', name: 'Káva' }],
    };
    expect(mapCategory(raw, 'cs')).toEqual({
      guid: 'kava', // preferuje code před category_id/id
      name: 'Káva',
      parentGuid: null,
      code: 'kava',
      position: 2,
      showInMenu: false,
      visible: true,
    });
  });
});

describe('mapVoucherSummary', () => {
  it('maps a percentage voucher with real-API booleans', () => {
    const raw: UpgatesVoucherRaw = {
      voucher_code: 'SLEVA10',
      active_yn: true,
      global_yn: false,
      type: 'percentage',
      currency_id: 'CZK',
      amount: '10',
      date_from: '2026-06-01',
      date_to: '2026-12-31',
      used_from: '500',
      note: 'léto',
      creation_time: '2026-06-01T08:00:00+02:00',
    };
    expect(mapVoucherSummary(raw)).toEqual({
      code: 'SLEVA10',
      active: true,
      reusable: false,
      discountType: 'percent',
      discountValue: 10,
      currency: 'CZK',
      validFrom: '2026-06-01',
      validUntil: '2026-12-31',
      minOrderValue: 500,
      note: 'léto',
      createdAt: '2026-06-01T08:00:00+02:00',
    });
  });

  it('maps voucher type aliases (price → amount, payment_shipment → free_shipping_payment)', () => {
    expect(mapVoucherSummary({ voucher_code: 'A', type: 'price' }).discountType).toBe(
      'amount'
    );
    expect(
      mapVoucherSummary({ voucher_code: 'B', type: 'payment_shipment' }).discountType
    ).toBe('free_shipping_payment');
    // Neznámý/chybějící typ → undefined (defenzivní).
    expect(mapVoucherSummary({ voucher_code: 'C' }).discountType).toBeUndefined();
  });
});
