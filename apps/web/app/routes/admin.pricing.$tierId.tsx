import { eq } from 'drizzle-orm';
import { Form, redirect, useActionData, useLoaderData } from 'react-router';
import type { Route } from './+types/admin.pricing.$tierId';
import { pricingTiers } from '@puls/db/schema';
import { getDb } from '~/lib/db';
import { requireAdmin } from '~/lib/auth/admin.server';
import { getTier, invalidateTierCache } from '~/lib/pricing.server';

function parseInt0(form: FormData, key: string, fallback = 0): number {
  const raw = String(form.get(key) ?? '').trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function parseFeatures(raw: string): string[] {
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = getDb();
  await requireAdmin(db, request);
  const tier = await getTier(db, params.tierId);
  if (!tier) throw new Response('Not Found', { status: 404 });
  return { tier };
}

export async function action({ request, params }: Route.ActionArgs) {
  const db = getDb();
  await requireAdmin(db, request);

  const tier = await getTier(db, params.tierId);
  if (!tier) throw new Response('Not Found', { status: 404 });

  const form = await request.formData();
  const intent = String(form.get('intent') ?? 'save');

  if (intent === 'save') {
    const isTrialLocked = tier.isTrial;

    const updates = {
      name: String(form.get('name') ?? tier.name).trim() || tier.name,
      tagline: String(form.get('tagline') ?? '').trim() || null,
      // Trial má cenu vždy 0 (vymáhané v DB i tady)
      priceMonthly: isTrialLocked ? 0 : parseInt0(form, 'priceMonthly', tier.priceMonthly),
      priceYearly: isTrialLocked
        ? null
        : parseInt0(form, 'priceYearly', tier.priceYearly ?? 0) || null,
      yearlyDiscountPct: parseInt0(form, 'yearlyDiscountPct', tier.yearlyDiscountPct),
      callsPerDay: parseInt0(form, 'callsPerDay', tier.callsPerDay),
      maxMemoryItems: parseInt0(form, 'maxMemoryItems', tier.maxMemoryItems),
      activityRetentionDays: parseInt0(form, 'activityRetentionDays', tier.activityRetentionDays),
      maxShopsPerAccount: parseInt0(form, 'maxShopsPerAccount', tier.maxShopsPerAccount),
      maxConcurrentSessions: parseInt0(form, 'maxConcurrentSessions', tier.maxConcurrentSessions),
      supportSla: String(form.get('supportSla') ?? tier.supportSla),
      trialDays: isTrialLocked
        ? parseInt0(form, 'trialDays', tier.trialDays ?? 14) || 14
        : null,
      features: parseFeatures(String(form.get('features') ?? '')),
      isPublic: form.get('isPublic') === 'on',
      isHighlighted: form.get('isHighlighted') === 'on',
      badge: String(form.get('badge') ?? '').trim() || null,
      sortOrder: parseInt0(form, 'sortOrder', tier.sortOrder),
      updatedAt: new Date(),
    };

    await db.update(pricingTiers).set(updates).where(eq(pricingTiers.id, tier.id));
    await invalidateTierCache(tier.id);
    return redirect('/admin/pricing');
  }

  return { error: 'Neznámá akce.' };
}

export default function AdminTierEdit() {
  const { tier } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const errorMsg = actionData && 'error' in actionData ? actionData.error : null;

  return (
    <div className="col gap-16" style={{ maxWidth: 800 }}>
      <header className="col gap-4">
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.12em' }}>
          PRICING / {tier.id.toUpperCase()}
        </span>
        <h1 className="heading-2" style={{ margin: 0, fontSize: 22 }}>
          Upravit tier „{tier.name}“
        </h1>
        {tier.isTrial ? (
          <span className="muted" style={{ fontSize: 12 }}>
            Trial má zamčenou cenu na 0 Kč. Editovat lze jen{' '}
            <code>trialDays</code> a limity.
          </span>
        ) : null}
      </header>

      {errorMsg && (
        <div
          style={{
            border: '1px solid var(--err, #ef4444)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 12.5,
            color: 'var(--err, #ef4444)',
          }}
        >
          {errorMsg}
        </div>
      )}

      <Form method="post" className="col gap-12">
        <input type="hidden" name="intent" value="save" />

        <Field label="Název">
          <input name="name" defaultValue={tier.name} required />
        </Field>
        <Field label="Tagline">
          <input name="tagline" defaultValue={tier.tagline ?? ''} />
        </Field>

        {!tier.isTrial && (
          <div className="row gap-12">
            <Field label="Měsíční cena (Kč)">
              <input
                name="priceMonthly"
                type="number"
                min={0}
                defaultValue={tier.priceMonthly}
              />
            </Field>
            <Field label="Roční cena (Kč)">
              <input
                name="priceYearly"
                type="number"
                min={0}
                defaultValue={tier.priceYearly ?? ''}
              />
            </Field>
            <Field label="Roční sleva (%)">
              <input
                name="yearlyDiscountPct"
                type="number"
                min={0}
                max={100}
                defaultValue={tier.yearlyDiscountPct}
              />
            </Field>
          </div>
        )}

        {tier.isTrial && (
          <Field label="Délka trialu (dní)">
            <input
              name="trialDays"
              type="number"
              min={1}
              max={90}
              defaultValue={tier.trialDays ?? 14}
            />
          </Field>
        )}

        <h2 className="heading-3" style={{ margin: '8px 0 0', fontSize: 14 }}>
          Limity
        </h2>
        <div className="row gap-12">
          <Field label="Calls / den">
            <input name="callsPerDay" type="number" min={1} defaultValue={tier.callsPerDay} />
          </Field>
          <Field label="Memory items (-1 = ∞)">
            <input name="maxMemoryItems" type="number" defaultValue={tier.maxMemoryItems} />
          </Field>
          <Field label="Log retence (dní)">
            <input
              name="activityRetentionDays"
              type="number"
              min={1}
              defaultValue={tier.activityRetentionDays}
            />
          </Field>
        </div>
        <div className="row gap-12">
          <Field label="Max e-shopů / účet">
            <input
              name="maxShopsPerAccount"
              type="number"
              min={1}
              defaultValue={tier.maxShopsPerAccount}
            />
          </Field>
          <Field label="Concurrent sessions">
            <input
              name="maxConcurrentSessions"
              type="number"
              min={1}
              defaultValue={tier.maxConcurrentSessions}
            />
          </Field>
          <Field label="Support SLA">
            <select name="supportSla" defaultValue={tier.supportSla}>
              <option value="community">community</option>
              <option value="email_48h">email 48h</option>
              <option value="priority_24h">priority 24h</option>
            </select>
          </Field>
        </div>

        <h2 className="heading-3" style={{ margin: '8px 0 0', fontSize: 14 }}>
          Marketing
        </h2>
        <Field label="Features (1 řádek = 1 odrážka)">
          <textarea
            name="features"
            rows={6}
            defaultValue={(tier.features as string[]).join('\n')}
            style={{ fontFamily: 'inherit' }}
          />
        </Field>
        <div className="row gap-12">
          <Field label="Pořadí (sortOrder)">
            <input name="sortOrder" type="number" defaultValue={tier.sortOrder} />
          </Field>
          <Field label="Badge">
            <input name="badge" defaultValue={tier.badge ?? ''} placeholder="Nejoblíbenější" />
          </Field>
        </div>
        <div className="row gap-16">
          <label className="row gap-6" style={{ alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" name="isPublic" defaultChecked={tier.isPublic} />
            <span>Public (zobrazit v ceníku)</span>
          </label>
          <label className="row gap-6" style={{ alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" name="isHighlighted" defaultChecked={tier.isHighlighted} />
            <span>Highlighted</span>
          </label>
        </div>

        <div className="row gap-8" style={{ marginTop: 16 }}>
          <button type="submit" className="btn btn-primary btn-sm">
            Uložit
          </button>
          <a href="/admin/pricing" className="btn btn-soft btn-sm">
            Zrušit
          </a>
        </div>
      </Form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="col gap-4" style={{ flex: 1, minWidth: 180 }}>
      <span
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.10em',
          color: 'var(--ink-3)',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
      <div className="admin-pricing-input">{children}</div>
      <style>{`
        .admin-pricing-input input,
        .admin-pricing-input select,
        .admin-pricing-input textarea {
          width: 100%;
          padding: 8px 10px;
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 6px;
          color: var(--ink);
          font-size: 13px;
        }
      `}</style>
    </label>
  );
}
