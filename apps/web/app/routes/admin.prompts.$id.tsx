import { Link, redirect, useActionData, useLoaderData } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import type { Route } from './+types/admin.prompts.$id';
import { getDb } from '~/lib/db';
import { requireSessionUser } from '~/lib/auth/session.server';
import { isAdminEmail } from '~/lib/auth/shops-for-user.server';
import { getAllTiers } from '~/lib/pricing.server';
import {
  archivePrompt,
  getPromptForAdmin,
  listCategories,
  updatePrompt,
} from '~/lib/prompts.server';
import { parsePromptForm } from '~/lib/prompts-form.server';
import { PromptForm } from '~/components/admin/prompt-form';

const KNOWN_TOOLS = [
  'list_orders',
  'get_order',
  'list_products',
  'get_product',
  'list_customers',
  'get_customer',
  'list_stocks',
  'list_categories',
  'sales_summary',
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);
  if (!isAdminEmail(user.email)) {
    throw new Response('Forbidden', { status: 403 });
  }
  const id = params.id;
  if (!id) throw new Response('Not found', { status: 404 });
  const [prompt, categories, tiers] = await Promise.all([
    getPromptForAdmin(db, id),
    listCategories(db),
    getAllTiers(db),
  ]);
  if (!prompt) throw new Response('Not found', { status: 404 });
  return {
    prompt,
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    tiers: tiers.map((t) => ({ id: t.id, name: t.name })),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);
  if (!isAdminEmail(user.email)) {
    throw new Response('Forbidden', { status: 403 });
  }
  const id = params.id;
  if (!id) throw new Response('Not found', { status: 404 });

  const form = await request.formData();
  const intent = String(form.get('intent') ?? 'save');

  if (intent === 'archive') {
    await archivePrompt(db, id);
    return redirect('/admin/prompts');
  }

  const parsed = parsePromptForm(form);
  if (!parsed.ok) return { error: parsed.error };
  await updatePrompt(db, id, parsed.input);
  return null;
}

export default function AdminPromptEdit() {
  const { prompt, categories, tiers } = useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  const error = (data as { error?: string } | undefined)?.error;
  return (
    <>
      <Link
        to="/admin/prompts"
        className="row gap-6"
        style={{
          color: 'var(--ink-3)',
          textDecoration: 'none',
          fontSize: 12.5,
          marginBottom: 16,
          width: 'fit-content',
        }}
      >
        <ArrowLeft size={12} /> Prompty
      </Link>
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: '0 0 8px' }}>
        {prompt.title}
      </h1>
      <p
        className="muted"
        style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '0 0 24px' }}
      >
        Aktualizováno {new Date(prompt.updatedAt).toLocaleString('cs-CZ')} ·
        zobrazení: {prompt.views} · použití: {prompt.uses}
      </p>
      <PromptForm
        values={{
          slug: prompt.slug,
          title: prompt.title,
          summary: prompt.summary,
          body: prompt.body,
          categoryId: prompt.categoryId,
          requiredTools: (prompt.requiredTools as unknown as string[]) ?? [],
          requiredConsent: (prompt.requiredConsent as unknown as string[]) ?? [],
          minTier: prompt.minTier,
          difficulty: prompt.difficulty,
          estMinutes: prompt.estMinutes,
          isPublished: prompt.isPublished,
          isFeatured: prompt.isFeatured,
          sortOrder: prompt.sortOrder,
        }}
        categories={categories}
        tiers={tiers}
        knownTools={KNOWN_TOOLS}
        submitLabel="Uložit"
        showArchive={!prompt.archivedAt}
        error={error}
      />
    </>
  );
}
