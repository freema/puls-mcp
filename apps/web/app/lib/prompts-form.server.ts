import type { PromptInput } from '~/lib/prompts.server';

export function parsePromptForm(
  form: FormData
): { ok: true; input: PromptInput } | { ok: false; error: string } {
  const slug = String(form.get('slug') ?? '').trim();
  const title = String(form.get('title') ?? '').trim();
  const summary = String(form.get('summary') ?? '').trim();
  const body = String(form.get('body') ?? '');
  const categoryId = String(form.get('category_id') ?? '').trim() || null;
  const minTier = String(form.get('min_tier') ?? '').trim() || null;
  const difficulty = String(form.get('difficulty') ?? 'easy').trim();
  const estMinutesRaw = String(form.get('est_minutes') ?? '').trim();
  const sortOrderRaw = String(form.get('sort_order') ?? '0').trim();
  const requiredToolsRaw = String(form.get('required_tools') ?? '').trim();
  const consentValues = form.getAll('required_consent').map(String);

  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return { ok: false, error: 'Slug musí obsahovat jen [a-z0-9-].' };
  }
  if (!title) return { ok: false, error: 'Title je povinný.' };
  if (!summary) return { ok: false, error: 'Summary je povinné.' };
  if (!body.trim()) return { ok: false, error: 'Body je povinné.' };

  const requiredTools = requiredToolsRaw
    ? requiredToolsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const sortOrder = Number.isFinite(Number(sortOrderRaw))
    ? Number(sortOrderRaw)
    : 0;
  const estMinutes = estMinutesRaw ? Number(estMinutesRaw) : null;

  const input: PromptInput = {
    slug,
    title,
    summary,
    body,
    categoryId,
    requiredTools,
    requiredConsent: consentValues,
    minTier,
    difficulty,
    estMinutes: estMinutes != null && Number.isFinite(estMinutes) ? estMinutes : null,
    isPublished: form.get('is_published') === '1',
    isFeatured: form.get('is_featured') === '1',
    sortOrder,
  };
  return { ok: true, input };
}
