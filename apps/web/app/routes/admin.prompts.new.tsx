import { Link, redirect, useActionData, useLoaderData } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import type { Route } from './+types/admin.prompts.new';
import { getDb } from '~/lib/db';
import { requireSessionUser } from '~/lib/auth/session.server';
import { isAdminEmail } from '~/lib/auth/shops-for-user.server';
import { getAllTiers } from '~/lib/pricing.server';
import {
  createPrompt,
  listCategories,
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

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);
  if (!isAdminEmail(user.email)) {
    throw new Response('Forbidden', { status: 403 });
  }
  const [categories, tiers] = await Promise.all([
    listCategories(db),
    getAllTiers(db),
  ]);
  return {
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    tiers: tiers.map((t) => ({ id: t.id, name: t.name })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);
  if (!isAdminEmail(user.email)) {
    throw new Response('Forbidden', { status: 403 });
  }
  const form = await request.formData();
  const parsed = parsePromptForm(form);
  if (!parsed.ok) return { error: parsed.error };
  const id = await createPrompt(db, parsed.input, user.id);
  return redirect(`/admin/prompts/${id}`);
}

export default function AdminPromptNew() {
  const { categories, tiers } = useLoaderData<typeof loader>();
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
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: '0 0 24px' }}>
        Nový prompt
      </h1>
      <PromptForm
        values={{
          slug: '',
          title: '',
          summary: '',
          body: '',
          categoryId: null,
          requiredTools: [],
          requiredConsent: [],
          minTier: null,
          difficulty: 'easy',
          estMinutes: null,
          isPublished: false,
          isFeatured: false,
          sortOrder: 0,
        }}
        categories={categories}
        tiers={tiers}
        knownTools={KNOWN_TOOLS}
        submitLabel="Vytvořit"
        error={error}
      />
    </>
  );
}
