// Sdílená revert sémantika — JEDINÝ zdroj pravdy pro obnovu BEFORE stavu
// zalogovaného zápisu (`write_log`). Konzumují MCP nástroj `revert_write`
// (apps/mcp-server) i dashboard write-history (apps/web). Dřív byla logika
// zkopírovaná v obou a tiše divergovala (coercion prázdných stringů, vah,
// Number.isFinite) — to vedlo k odlišnému patchi pro stejný `before`.
import type { WriteLogRow } from '@puls/db/schema';
import type { PlatformConnector } from './connector.js';
import type { Shop, PulsDb } from './shop.js';
import type { ProductPatch, CategoryPatch, CategoryCreate } from './domain.js';

/**
 * Provede revert konkrétního zápisu podle `row.tool`. Vrací string chyby
 * (důvod, proč revert nelze) nebo `null` při úspěchu.
 *
 * Reverzibilní: update_order_status, update_product, update_stock,
 * set_action_price, create_voucher (DELETE /vouchers — kódy z result.codes),
 * create_product (DELETE /products), set_product_discount, kategorie/ceníky.
 * Nereverzibilní: create_customer_note, delete_voucher.
 */
export async function revertByTool(
  connector: PlatformConnector,
  shop: Shop,
  db: PulsDb,
  row: WriteLogRow
): Promise<string | null> {
  if (!connector.writes) {
    return 'Tato platforma neumí write operace — revert nelze provést.';
  }
  const writes = connector.writes;
  const before = (row.before ?? null) as Record<string, unknown> | null;
  const args = (row.args ?? {}) as Record<string, unknown>;

  switch (row.tool) {
    case 'update_order_status': {
      if (!before) {
        return 'Revert nelze: chybí původní stav objednávky (before).';
      }
      const code = asString(before.code) ?? asString(args.code);
      const status = asString(before.status);
      if (!code || !status) {
        return 'Revert nelze: v before chybí code nebo status objednávky.';
      }
      await writes.updateOrderStatus(shop, db, { code, status });
      return null;
    }

    case 'update_product': {
      if (!before) {
        return 'Revert nelze: chybí původní stav produktu (before).';
      }
      const guid = asString(before.guid) ?? asString(args.guid);
      if (!guid) {
        return 'Revert nelze: v before chybí guid produktu.';
      }
      const patch = mapBeforeToProductPatch(before);
      if (Object.keys(patch).length === 0) {
        return 'Revert nelze: z původního stavu produktu nelze sestavit žádné pole k obnově.';
      }
      await writes.updateProduct(shop, db, { guid, patch });
      return null;
    }

    case 'update_stock': {
      if (!before) {
        return 'Revert nelze: chybí původní stav produktu (before).';
      }
      const guid = asString(before.guid) ?? asString(args.guid);
      const stockId = asString(args.stockId);
      const quantity = asNumber(before.stock);
      if (!guid || !stockId) {
        return 'Revert nelze: v before/args chybí guid nebo stockId.';
      }
      if (quantity === null) {
        // Defenzivně: bez spolehlivého původního množství raději chyba než tichý no-op.
        return 'Revert nelze: původní skladové množství (before.stock) není k dispozici.';
      }
      await writes.updateStock(shop, db, { guid, stockId, quantity });
      return null;
    }

    case 'set_action_price': {
      if (!before) {
        return 'Revert nelze: chybí původní stav produktu (before).';
      }
      const guid = asString(before.guid) ?? asString(args.guid);
      const price = originalPrice(before);
      if (!guid) {
        return 'Revert nelze: v before chybí guid produktu.';
      }
      if (price === null) {
        return 'Revert nelze: původní cena produktu (before) není k dispozici.';
      }
      await writes.setActionPrice(shop, db, { guid, price });
      return null;
    }

    case 'create_customer_note':
      return 'Revert nelze: poznámku zákazníka nelze odebrat.';

    case 'delete_voucher':
      return 'Revert nelze: smazaný kupón nelze obnovit.';

    case 'set_product_discount': {
      // Revert = odebrat slevu (productDiscountPercent → 0). BEFORE stav %
      // slevy neneseme, takže revert znamená "bez slevy" (best-effort).
      const guid = asString(before?.guid) ?? asString(args.guid);
      if (!guid) {
        return 'Revert nelze: v záznamu chybí guid produktu.';
      }
      await writes.updateProduct(shop, db, {
        guid,
        patch: { productDiscountPercent: 0 },
      });
      return null;
    }

    case 'create_pricelist': {
      if (!writes.deletePricelist) {
        return 'Ceník nelze automaticky smazat — odeberte ho ručně v administraci.';
      }
      const id = asNumber((row.after as Record<string, unknown> | null)?.id);
      if (id === null) {
        return 'Revert nelze: v záznamu chybí id vytvořeného ceníku.';
      }
      await writes.deletePricelist(shop, db, { id });
      return null;
    }

    case 'delete_pricelist': {
      if (!writes.createPricelist) {
        return 'Ceník nelze automaticky obnovit — vytvořte ho ručně v administraci.';
      }
      const name = asString(before?.name);
      if (!name) {
        return 'Revert nelze: v záznamu chybí název smazaného ceníku.';
      }
      const percent = asNumber(before?.percent);
      await writes.createPricelist(shop, db, {
        name,
        ...(percent !== null ? { percent } : {}),
      });
      // Pozn.: nové id ceníku + ztráta přiřazení zákazníků (varování v UI/desc).
      return null;
    }

    case 'create_category': {
      if (!writes.deleteCategory) {
        return 'Kategorii nelze automaticky smazat — odeberte ji ručně v administraci.';
      }
      const after = (row.after as Record<string, unknown> | null) ?? {};
      const guid =
        asString(after.guid) ??
        asString(after.code) ??
        asString((args.category as Record<string, unknown> | undefined)?.code) ??
        asString(args.code);
      if (!guid) {
        return 'Revert nelze: v záznamu chybí identifikátor vytvořené kategorie.';
      }
      await writes.deleteCategory(shop, db, { guid });
      return null;
    }

    case 'update_category': {
      if (!writes.updateCategory) {
        return 'Kategorii nelze vrátit — platforma neumí update kategorie.';
      }
      if (!before) {
        return 'Revert nelze: chybí původní stav kategorie (before).';
      }
      const guid =
        asString(before.guid) ?? asString(before.code) ?? asString(args.guid);
      if (!guid) {
        return 'Revert nelze: v before chybí identifikátor kategorie.';
      }
      await writes.updateCategory(shop, db, {
        guid,
        patch: mapBeforeToCategoryPatch(before),
      });
      return null;
    }

    case 'delete_category': {
      if (!writes.createCategory) {
        return 'Kategorii nelze obnovit — platforma neumí create kategorie.';
      }
      if (!before) {
        return 'Revert nelze: chybí původní stav smazané kategorie (before).';
      }
      const code = asString(before.code) ?? asString(before.guid);
      const name = asString(before.name);
      if (!code || !name) {
        return 'Revert nelze: v before chybí code nebo name smazané kategorie.';
      }
      const patch = mapBeforeToCategoryPatch(before);
      const category: CategoryCreate = { code, name };
      if (patch.parentGuid !== undefined) category.parentGuid = patch.parentGuid;
      if (patch.position !== undefined) category.position = patch.position;
      if (patch.active !== undefined) category.active = patch.active;
      if (patch.showInMenu !== undefined) category.showInMenu = patch.showInMenu;
      await writes.createCategory(shop, db, { category });
      // VAROVÁNÍ: nové category_id; podstrom a produktové vazby se neobnoví.
      return null;
    }

    case 'create_voucher': {
      // Reálný revert přes DELETE /vouchers (Upgates). Kódy čteme z result.codes
      // (server-generated zdroj pravdy), fallback after.codes / after.code / args.
      if (!writes.deleteVoucher) {
        return 'Voucher nelze automaticky smazat — deaktivujte ho ručně v administraci.';
      }
      const codes =
        asStringArray((row.result as Record<string, unknown> | null)?.codes) ??
        asStringArray((row.after as Record<string, unknown> | null)?.codes) ??
        (() => {
          const single =
            asString((row.after as Record<string, unknown> | null)?.code) ??
            asString(args.code);
          return single ? [single] : null;
        })();
      if (!codes || codes.length === 0) {
        return 'Revert nelze: v záznamu chybí kód(y) voucheru.';
      }
      const res = await writes.deleteVoucher(shop, db, { codes });
      const anyDeleted = res.data.results.some((r) => r.deleted);
      if (!anyDeleted) {
        const msg = res.data.results
          .map((r) => r.message)
          .filter(Boolean)
          .join('; ');
        return `Revert se nezdařil: voucher(y) nelze smazat${msg ? ` (${msg})` : ''}.`;
      }
      return null;
    }

    case 'create_product': {
      // Revert založení produktu = smazat vytvořený produkt (DELETE /products).
      if (!writes.deleteProduct) {
        return 'Produkt nelze automaticky smazat — odeberte ho ručně v administraci.';
      }
      const code =
        asString((row.after as Record<string, unknown> | null)?.guid) ??
        asString((row.after as Record<string, unknown> | null)?.code) ??
        asString((args.product as Record<string, unknown> | undefined)?.code) ??
        asString(args.code);
      if (!code) {
        return 'Revert nelze: v záznamu chybí kód vytvořeného produktu.';
      }
      const res = await writes.deleteProduct(shop, db, { code });
      if (!res.data.deleted) {
        return 'Revert se nezdařil: produkt se nepodařilo smazat.';
      }
      return null;
    }

    default:
      return `Revert nelze: neznámý nástroj "${row.tool}".`;
  }
}

/**
 * Sestaví ProductPatch z BEFORE stavu produktu pro obnovu update_product.
 * addImageUrls/mainImageUrl jsou write-only — BEFORE stav URL obrázků nenese
 * jako patch, takže revert obrázků je manuální (viz UI/docs).
 */
export function mapBeforeToProductPatch(
  before: Record<string, unknown>
): ProductPatch {
  const patch: ProductPatch = {};
  const name = asString(before.name);
  if (name !== null) patch.name = name;
  const description = asString(before.description);
  if (description !== null) patch.description = description;
  const price = originalPrice(before);
  if (price !== null) patch.priceWithVat = price;
  if (typeof before.visible === 'boolean') {
    patch.visibility = before.visible ? 'visible' : 'hidden';
  }
  const ean = asString(before.ean);
  if (ean !== null) patch.ean = ean;
  const weight = asNumber(before.weight);
  if (weight !== null) patch.weight = weight;
  // Skladová zásoba — update_product ji nově umí měnit, revert ji obnoví.
  // Shoptet before `stock` nenese (mapper ho neplní) → pole se nepřidá a
  // jeho updateProduct tak nedostane nepodporovaný klíč.
  const stock = asNumber(before.stock);
  if (stock !== null) patch.stock = stock;
  const availabilityLabel = asString(before.availabilityLabel);
  if (availabilityLabel !== null) patch.availabilityLabel = availabilityLabel;
  const manufacturer = asString(before.manufacturer);
  if (manufacturer !== null) patch.manufacturer = manufacturer;
  return patch;
}

/** Sestaví CategoryPatch z BEFORE stavu kategorie. */
export function mapBeforeToCategoryPatch(
  before: Record<string, unknown>
): CategoryPatch {
  const patch: CategoryPatch = {};
  const name = asString(before.name);
  if (name !== null) patch.name = name;
  const parentGuid = asString(before.parentGuid);
  if (parentGuid !== null) patch.parentGuid = parentGuid;
  const position = asNumber(before.position);
  if (position !== null) patch.position = position;
  if (typeof before.visible === 'boolean') patch.active = before.visible;
  if (typeof before.showInMenu === 'boolean') patch.showInMenu = before.showInMenu;
  return patch;
}

/** Původní cena z BEFORE — preferuje priceWithVat, jinak číselné `price`. */
function originalPrice(before: Record<string, unknown>): number | null {
  const withVat = asNumber(before.priceWithVat);
  if (withVat !== null) return withVat;
  return asNumber(before.price);
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const arr = v.filter((x): x is string => typeof x === 'string' && x.length > 0);
  return arr.length > 0 ? arr : null;
}
