import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { marked } from 'marked';
import { promptCategories, promptUses, prompts } from '@puls/db/schema';
import type { DB } from '~/lib/db';
import { getRedis } from '~/lib/redis';

marked.setOptions({ gfm: true, breaks: true });

export type Prompt = typeof prompts.$inferSelect;
export type PromptCategory = typeof promptCategories.$inferSelect;

export type PromptCard = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  categorySlug: string | null;
  categoryName: string | null;
  difficulty: string;
  estMinutes: number | null;
  isFeatured: boolean;
  minTier: string | null;
  requiredTools: string[];
  requiredConsent: string[];
  uses: number;
};

export type PromptDetail = PromptCard & {
  body: string;
  bodyHtml: string;
  views: number;
};

const CACHE_TTL_SECONDS = 60;
const CACHE_KEY_LIST = 'puls:prompts:public:list';
const CACHE_KEY_BY_SLUG = (slug: string) => `puls:prompts:public:slug:${slug}`;

function toCard(
  row: typeof prompts.$inferSelect & {
    categorySlug?: string | null;
    categoryName?: string | null;
  }
): PromptCard {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    categorySlug: row.categorySlug ?? null,
    categoryName: row.categoryName ?? null,
    difficulty: row.difficulty,
    estMinutes: row.estMinutes,
    isFeatured: row.isFeatured,
    minTier: row.minTier,
    requiredTools: (row.requiredTools as unknown as string[]) ?? [],
    requiredConsent: (row.requiredConsent as unknown as string[]) ?? [],
    uses: row.uses,
  };
}

export async function listPublishedPrompts(
  db: DB,
  opts: { categorySlug?: string; query?: string } = {}
): Promise<PromptCard[]> {
  const cacheable = !opts.categorySlug && !opts.query;
  const redis = getRedis();

  if (cacheable) {
    try {
      const cached = await redis.get(CACHE_KEY_LIST);
      if (cached) return JSON.parse(cached) as PromptCard[];
    } catch {
      // ignore
    }
  }

  const rows = await db
    .select({
      id: prompts.id,
      slug: prompts.slug,
      title: prompts.title,
      summary: prompts.summary,
      body: prompts.body,
      categoryId: prompts.categoryId,
      requiredTools: prompts.requiredTools,
      requiredConsent: prompts.requiredConsent,
      minTier: prompts.minTier,
      difficulty: prompts.difficulty,
      estMinutes: prompts.estMinutes,
      isPublished: prompts.isPublished,
      isFeatured: prompts.isFeatured,
      sortOrder: prompts.sortOrder,
      views: prompts.views,
      uses: prompts.uses,
      authorId: prompts.authorId,
      createdAt: prompts.createdAt,
      updatedAt: prompts.updatedAt,
      archivedAt: prompts.archivedAt,
      categorySlug: promptCategories.slug,
      categoryName: promptCategories.name,
    })
    .from(prompts)
    .leftJoin(promptCategories, eq(prompts.categoryId, promptCategories.id))
    .where(
      and(eq(prompts.isPublished, true), isNull(prompts.archivedAt))
    )
    .orderBy(desc(prompts.isFeatured), asc(prompts.sortOrder));

  let result = rows.map(toCard);

  if (opts.categorySlug) {
    result = result.filter((r) => r.categorySlug === opts.categorySlug);
  }
  if (opts.query) {
    const q = opts.query.toLowerCase();
    result = result.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.summary.toLowerCase().includes(q)
    );
  }

  if (cacheable) {
    try {
      await redis.set(
        CACHE_KEY_LIST,
        JSON.stringify(result),
        'EX',
        CACHE_TTL_SECONDS
      );
    } catch {
      // ignore
    }
  }

  return result;
}

export async function getPromptBySlug(
  db: DB,
  slug: string
): Promise<PromptDetail | null> {
  const redis = getRedis();
  try {
    const cached = await redis.get(CACHE_KEY_BY_SLUG(slug));
    if (cached) return JSON.parse(cached) as PromptDetail;
  } catch {
    // ignore
  }

  const [row] = await db
    .select({
      id: prompts.id,
      slug: prompts.slug,
      title: prompts.title,
      summary: prompts.summary,
      body: prompts.body,
      categoryId: prompts.categoryId,
      requiredTools: prompts.requiredTools,
      requiredConsent: prompts.requiredConsent,
      minTier: prompts.minTier,
      difficulty: prompts.difficulty,
      estMinutes: prompts.estMinutes,
      isPublished: prompts.isPublished,
      isFeatured: prompts.isFeatured,
      sortOrder: prompts.sortOrder,
      views: prompts.views,
      uses: prompts.uses,
      authorId: prompts.authorId,
      createdAt: prompts.createdAt,
      updatedAt: prompts.updatedAt,
      archivedAt: prompts.archivedAt,
      categorySlug: promptCategories.slug,
      categoryName: promptCategories.name,
    })
    .from(prompts)
    .leftJoin(promptCategories, eq(prompts.categoryId, promptCategories.id))
    .where(
      and(
        eq(prompts.slug, slug),
        eq(prompts.isPublished, true),
        isNull(prompts.archivedAt)
      )
    )
    .limit(1);

  if (!row) return null;

  const detail: PromptDetail = {
    ...toCard(row),
    body: row.body,
    bodyHtml: marked.parse(row.body) as string,
    views: row.views,
  };

  try {
    await redis.set(
      CACHE_KEY_BY_SLUG(slug),
      JSON.stringify(detail),
      'EX',
      CACHE_TTL_SECONDS
    );
  } catch {
    // ignore
  }
  return detail;
}

export async function listCategories(db: DB): Promise<PromptCategory[]> {
  return db
    .select()
    .from(promptCategories)
    .orderBy(asc(promptCategories.sortOrder));
}

export async function listAllPromptsForAdmin(db: DB): Promise<Prompt[]> {
  return db.select().from(prompts).orderBy(desc(prompts.updatedAt));
}

export async function getPromptForAdmin(
  db: DB,
  id: string
): Promise<Prompt | null> {
  const [row] = await db
    .select()
    .from(prompts)
    .where(eq(prompts.id, id))
    .limit(1);
  return row ?? null;
}

export type PromptInput = {
  slug: string;
  title: string;
  summary: string;
  body: string;
  categoryId: string | null;
  requiredTools: string[];
  requiredConsent: string[];
  minTier: string | null;
  difficulty: string;
  estMinutes: number | null;
  isPublished: boolean;
  isFeatured: boolean;
  sortOrder: number;
};

export async function createPrompt(
  db: DB,
  input: PromptInput,
  authorId: string
): Promise<string> {
  const [row] = await db
    .insert(prompts)
    .values({
      ...input,
      requiredTools: input.requiredTools as never,
      requiredConsent: input.requiredConsent as never,
      authorId,
    })
    .returning({ id: prompts.id });
  await invalidatePromptCache();
  return row!.id;
}

export async function updatePrompt(
  db: DB,
  id: string,
  patch: Partial<PromptInput>
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(patch)) {
    set[k] = v;
  }
  await db.update(prompts).set(set).where(eq(prompts.id, id));
  await invalidatePromptCache();
}

export async function archivePrompt(db: DB, id: string): Promise<void> {
  await db
    .update(prompts)
    .set({ archivedAt: new Date(), isPublished: false })
    .where(eq(prompts.id, id));
  await invalidatePromptCache();
}

export async function recordPromptUse(
  db: DB,
  args: { promptId: string; userId: string; shopId: string | null }
): Promise<void> {
  await db.insert(promptUses).values(args);
  await db
    .update(prompts)
    .set({ uses: sql`${prompts.uses} + 1` })
    .where(eq(prompts.id, args.promptId));
  await invalidatePromptCache();
}

async function invalidatePromptCache(): Promise<void> {
  const redis = getRedis();
  try {
    await redis.del(CACHE_KEY_LIST);
    // We don't have a list of slugs to invalidate one-by-one cheaply; rely
    // on the 60s TTL for detail pages.
  } catch {
    // ignore
  }
}
