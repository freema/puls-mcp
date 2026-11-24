import { eq, and } from 'drizzle-orm';
import type { PulsDb } from '@puls/platform-core';
import { shopMemory, shopMemoryItems, shops } from '@puls/db/schema';
import type {
  MemoryItem,
  MemoryItemInput,
  ShopMemoryData,
  CachedMemory,
} from './types.js';

const memoryCache = new Map<string, CachedMemory>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function isMemoryEnabledForShop(
  db: PulsDb,
  shopId: string
): Promise<boolean> {
  const [row] = await db
    .select({ memoryEnabled: shops.memoryEnabled })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  return row?.memoryEnabled ?? false;
}

export async function loadShopMemory(
  db: PulsDb,
  shopId: string
): Promise<ShopMemoryData | null> {
  const enabled = await isMemoryEnabledForShop(db, shopId);
  if (!enabled) return null;

  const [row] = await db
    .select()
    .from(shopMemory)
    .where(eq(shopMemory.shopId, shopId))
    .limit(1);

  if (!row) {
    const empty: ShopMemoryData = {
      systemContext: null,
      toolContexts: {},
      promptVersion: 0,
    };
    memoryCache.set(shopId, { data: empty, version: 0, loadedAt: new Date() });
    return empty;
  }

  const data: ShopMemoryData = {
    systemContext: row.systemContext,
    toolContexts: (row.toolContexts as Record<string, string>) ?? {},
    promptVersion: row.promptVersion,
  };
  memoryCache.set(shopId, {
    data,
    version: row.promptVersion,
    loadedAt: new Date(),
  });
  return data;
}

export function getCachedMemory(shopId: string): ShopMemoryData | null {
  const cached = memoryCache.get(shopId);
  if (!cached) return null;
  if (Date.now() - cached.loadedAt.getTime() > CACHE_TTL_MS) {
    memoryCache.delete(shopId);
    return null;
  }
  return cached.data;
}

export async function getOrLoadShopMemory(
  db: PulsDb,
  shopId: string
): Promise<ShopMemoryData | null> {
  return getCachedMemory(shopId) ?? (await loadShopMemory(db, shopId));
}

export function invalidateMemoryCache(shopId: string): void {
  memoryCache.delete(shopId);
}

export async function listMemoryItems(
  db: PulsDb,
  shopId: string
): Promise<MemoryItem[]> {
  const rows = await db
    .select()
    .from(shopMemoryItems)
    .where(
      and(
        eq(shopMemoryItems.shopId, shopId),
        eq(shopMemoryItems.isActive, true)
      )
    );
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    source: r.source,
    label: r.label,
    content: r.content,
    appliesToTools: (r.appliesToTools as string[] | null) ?? null,
    priority: r.priority,
    isActive: r.isActive,
    createdAt: r.createdAt,
  }));
}

/**
 * Recompile shop_memory.systemContext + toolContexts from active items.
 * Bumps promptVersion so the in-process cache invalidates.
 */
async function recompile(db: PulsDb, shopId: string): Promise<void> {
  const items = await listMemoryItems(db, shopId);
  const sorted = items.sort((a, b) => b.priority - a.priority);

  const systemLines: string[] = [];
  const toolBuckets: Record<string, string[]> = {};

  for (const item of sorted) {
    const line = item.label ? `- ${item.label}: ${item.content}` : `- ${item.content}`;
    if (!item.appliesToTools || item.appliesToTools.length === 0) {
      systemLines.push(line);
    } else {
      for (const tool of item.appliesToTools) {
        (toolBuckets[tool] ??= []).push(line);
      }
    }
  }

  const systemContext = systemLines.length > 0 ? systemLines.join('\n') : null;
  const toolContexts: Record<string, string> = {};
  for (const [tool, lines] of Object.entries(toolBuckets)) {
    toolContexts[tool] = lines.join('\n');
  }

  const [existing] = await db
    .select({ id: shopMemory.id, version: shopMemory.promptVersion })
    .from(shopMemory)
    .where(eq(shopMemory.shopId, shopId))
    .limit(1);

  if (existing) {
    await db
      .update(shopMemory)
      .set({
        systemContext,
        toolContexts,
        promptVersion: existing.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(shopMemory.id, existing.id));
  } else {
    await db.insert(shopMemory).values({
      shopId,
      systemContext,
      toolContexts,
      promptVersion: 1,
    });
  }

  invalidateMemoryCache(shopId);
}

export async function addMemoryItem(
  db: PulsDb,
  shopId: string,
  input: MemoryItemInput
): Promise<string> {
  const [row] = await db
    .insert(shopMemoryItems)
    .values({
      shopId,
      category: input.category ?? 'context',
      source: input.source ?? 'user',
      label: input.label ?? null,
      content: input.content,
      appliesToTools: input.appliesToTools ?? null,
      priority: input.priority ?? 0,
    })
    .returning({ id: shopMemoryItems.id });
  await recompile(db, shopId);
  return row!.id;
}

export async function deleteMemoryItem(
  db: PulsDb,
  shopId: string,
  itemId: string
): Promise<boolean> {
  const result = await db
    .delete(shopMemoryItems)
    .where(
      and(eq(shopMemoryItems.id, itemId), eq(shopMemoryItems.shopId, shopId))
    )
    .returning({ id: shopMemoryItems.id });
  if (result.length === 0) return false;
  await recompile(db, shopId);
  return true;
}

export async function clearAllMemory(
  db: PulsDb,
  shopId: string
): Promise<number> {
  const result = await db
    .delete(shopMemoryItems)
    .where(eq(shopMemoryItems.shopId, shopId))
    .returning({ id: shopMemoryItems.id });
  await recompile(db, shopId);
  return result.length;
}
