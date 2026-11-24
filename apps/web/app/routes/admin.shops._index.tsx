import { desc } from 'drizzle-orm';
import { Form, useActionData, useLoaderData, useNavigation } from 'react-router';
import type { Route } from './+types/admin.shops._index';
import { shops } from '@puls/db/schema';
import { getConfig } from '~/lib/config';
import { getDb } from '~/lib/db';
import { requireAdmin } from '~/lib/auth/admin.server';
import { getAllTiers } from '~/lib/pricing.server';
import {
  ProvisionError,
  provisionUpgatesShop,
} from '~/lib/admin/provision-shop.server';
import { ShopsTable } from '~/components/admin/shops-table';

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  const user = await requireAdmin(db, request);

  const [rows, tiers] = await Promise.all([
    db
      .select({
        id: shops.id,
        platform: shops.platform,
        platformAccountId: shops.platformAccountId,
        domain: shops.domain,
        name: shops.name,
        status: shops.status,
        installedAt: shops.installedAt,
      })
      .from(shops)
      .orderBy(desc(shops.installedAt))
      .limit(200),
    getAllTiers(db),
  ]);

  return {
    rows: rows.map((r) => ({
      ...r,
      installedAt: r.installedAt.toISOString(),
    })),
    tiers: tiers.map((t) => ({
      id: t.id,
      name: t.name,
      priceMonthly: t.priceMonthly,
      currency: t.currency,
      isTrial: t.isTrial,
    })),
    adminEmail: user.email,
  };
}

type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export async function action({
  request,
}: Route.ActionArgs): Promise<ActionResult> {
  const db = getDb();
  const user = await requireAdmin(db, request);
  const env = getConfig();

  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  if (intent !== 'provision-upgates') {
    return { ok: false, error: 'Neznámá akce.' };
  }

  try {
    const result = await provisionUpgatesShop(
      db,
      env,
      {
        apiUrl: String(form.get('apiUrl') ?? ''),
        apiUser: String(form.get('apiUser') ?? ''),
        apiKey: String(form.get('apiKey') ?? ''),
        adminEmail: String(form.get('adminEmail') ?? ''),
        tierId: String(form.get('tierId') ?? ''),
        token: String(form.get('token') ?? '') || null,
        name: String(form.get('name') ?? '') || null,
      },
      user.email
    );
    const ownerNote = result.ownerEmail
      ? ` Majitel eshopu dle Upgatesu: ${result.ownerEmail}.`
      : '';
    return {
      ok: true,
      message: `${result.isNew ? 'Vytvořen' : 'Aktualizován'} obchod ${
        result.domain
      } (tarif ${result.tierId}), připnut na ${String(
        form.get('adminEmail') ?? ''
      )
        .trim()
        .toLowerCase()}.${ownerNote} Připoj AI klienta na /mcp a v OAuth souhlasu vyber tento obchod.`,
    };
  } catch (err) {
    if (err instanceof ProvisionError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: `Provisioning selhal: ${
        err instanceof Error ? err.message : 'neznámá chyba'
      }`,
    };
  }
}

export default function AdminShopsIndex() {
  const { rows, tiers, adminEmail } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting =
    nav.state === 'submitting' &&
    nav.formData?.get('intent') === 'provision-upgates';

  const defaultTier =
    tiers.find((t) => t.id === 'pro')?.id ??
    tiers.find((t) => !t.isTrial)?.id ??
    tiers[0]?.id ??
    '';

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-50">Obchody</h1>
        <p className="text-sm text-zinc-500">Posledních 200 instalací.</p>
      </div>

      <ProvisionUpgatesCard
        tiers={tiers}
        defaultTier={defaultTier}
        defaultEmail={adminEmail}
        result={result}
        submitting={submitting}
      />

      <ShopsTable rows={rows} />
    </div>
  );
}

function ProvisionUpgatesCard({
  tiers,
  defaultTier,
  defaultEmail,
  result,
  submitting,
}: {
  tiers: {
    id: string;
    name: string;
    priceMonthly: number;
    currency: string;
    isTrial: boolean;
  }[];
  defaultTier: string;
  defaultEmail: string;
  result: ActionResult | undefined;
  submitting: boolean;
}) {
  return (
    <details
      style={{
        border: '1px solid var(--line)',
        borderRadius: 12,
        background: 'var(--bg-2)',
        padding: '14px 18px',
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--ink)',
          listStyle: 'revert',
        }}
      >
        Ručně připojit Upgates eshop (test, bez marketplace)
      </summary>

      <p
        className="muted"
        style={{ fontSize: 12.5, lineHeight: 1.6, margin: '10px 0 4px' }}
      >
        Interní testovací nástroj — obejde marketplace/registraci. Zadej API
        přihlašovací údaje z Upgates adminu (Doplňky → API). Klíč se uloží
        šifrovaně, interní secrety se vygenerují samy. Po vytvoření se obchod
        objeví v dashboardu zadaného uživatele a jde připojit přes OAuth na{' '}
        <code>/mcp</code>.
      </p>

      {result ? (
        <p
          style={{
            margin: '8px 0 0',
            padding: '10px 12px',
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.55,
            background: result.ok
              ? 'rgba(34,197,94,0.12)'
              : 'rgba(239,68,68,0.12)',
            color: result.ok ? '#22c55e' : '#ef4444',
            border: `1px solid ${
              result.ok ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'
            }`,
          }}
        >
          {result.ok ? result.message : result.error}
        </p>
      ) : null}

      <Form
        method="post"
        style={{
          display: 'grid',
          gap: 14,
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          maxWidth: 720,
          marginTop: 16,
        }}
      >
        <input type="hidden" name="intent" value="provision-upgates" />

        <Field label="API URL" hint="https://<eshop>.admin.upgates.com/api/v2">
          <input
            type="url"
            name="apiUrl"
            required
            placeholder="https://eshop.admin.upgates.com/api/v2"
            style={inputStyle}
          />
        </Field>

        <Field label="E-mail uživatele" hint="komu se shop připne (dashboard)">
          <input
            type="email"
            name="adminEmail"
            required
            defaultValue={defaultEmail}
            style={inputStyle}
          />
        </Field>

        <Field label="API login (apiUser)">
          <input
            type="text"
            name="apiUser"
            required
            autoComplete="off"
            style={inputStyle}
          />
        </Field>

        <Field label="API klíč (apiKey)" hint="uloží se šifrovaně">
          <input
            type="password"
            name="apiKey"
            required
            autoComplete="new-password"
            style={inputStyle}
          />
        </Field>

        <Field label="Tarif">
          <select name="tierId" defaultValue={defaultTier} style={inputStyle}>
            {tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.isTrial ? ' (trial — zápisy blokované)' : ''} ·{' '}
                {t.priceMonthly} {t.currency}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Název obchodu (volitelné)" hint="jinak z /owner">
          <input type="text" name="name" style={inputStyle} />
        </Field>

        <Field
          label="platform_account_id (volitelné)"
          hint="default = API login"
        >
          <input type="text" name="token" style={inputStyle} />
        </Field>

        <div style={{ gridColumn: '1 / -1' }}>
          <button
            type="submit"
            disabled={submitting}
            style={{
              background: 'var(--accent)',
              color: 'var(--bg)',
              padding: '10px 18px',
              border: 'none',
              borderRadius: 8,
              fontWeight: 600,
              cursor: submitting ? 'wait' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Ověřuji a vytvářím…' : 'Ověřit creds a vytvořit shop'}
          </button>
        </div>
      </Form>
    </details>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
        {label}
        {hint ? (
          <span style={{ color: 'var(--ink-4)' }}> — {hint}</span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: '8px 12px',
  color: 'var(--ink)',
  fontSize: 14,
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};
