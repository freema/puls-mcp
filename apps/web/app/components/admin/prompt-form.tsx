import type { ChangeEvent } from 'react';
import { Form } from 'react-router';

export type PromptFormValues = {
  slug: string;
  title: string;
  summary: string;
  body: string;
  categoryId: string | null;
  requiredTools: string[];
  requiredConsent: string[];
  minTier: string | null;
  difficulty: 'easy' | 'medium' | 'advanced' | string;
  estMinutes: number | null;
  isPublished: boolean;
  isFeatured: boolean;
  sortOrder: number;
};

const CONSENT_OPTIONS = [
  'orders',
  'products',
  'customers',
  'catalog',
  'insights',
  'write',
  'memory',
];

export function PromptForm({
  values,
  categories,
  tiers,
  knownTools,
  submitLabel,
  showArchive,
  error,
}: {
  values: PromptFormValues;
  categories: { id: string; name: string }[];
  tiers: { id: string; name: string }[];
  knownTools: string[];
  submitLabel: string;
  showArchive?: boolean;
  error?: string;
}) {
  return (
    <Form method="post" style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
      <Row label="Title">
        <input
          type="text"
          name="title"
          required
          defaultValue={values.title}
          style={inputStyle}
          onChange={(e) => maybeAutogenSlug(e, !values.slug)}
          data-autoslug
        />
      </Row>
      <Row label="Slug">
        <input
          type="text"
          name="slug"
          required
          pattern="[a-z0-9-]+"
          defaultValue={values.slug}
          style={inputStyle}
          data-slug
        />
      </Row>
      <Row label="Summary (1 věta pro card)">
        <input
          type="text"
          name="summary"
          required
          maxLength={200}
          defaultValue={values.summary}
          style={inputStyle}
        />
      </Row>
      <Row label="Body (markdown)">
        <textarea
          name="body"
          rows={12}
          required
          defaultValue={values.body}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 13 }}
        />
      </Row>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Row label="Kategorie">
          <select
            name="category_id"
            defaultValue={values.categoryId ?? ''}
            style={inputStyle}
          >
            <option value="">— bez kategorie —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Min tier">
          <select
            name="min_tier"
            defaultValue={values.minTier ?? ''}
            style={inputStyle}
          >
            <option value="">— dostupné všem —</option>
            {tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Row>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        <Row label="Obtížnost">
          <select
            name="difficulty"
            defaultValue={values.difficulty}
            style={inputStyle}
          >
            <option value="easy">easy</option>
            <option value="medium">medium</option>
            <option value="advanced">advanced</option>
          </select>
        </Row>
        <Row label="Odhad min">
          <input
            type="number"
            name="est_minutes"
            min={1}
            defaultValue={values.estMinutes ?? ''}
            style={inputStyle}
          />
        </Row>
        <Row label="Sort order">
          <input
            type="number"
            name="sort_order"
            defaultValue={values.sortOrder}
            style={inputStyle}
          />
        </Row>
      </div>

      <Row label="Required consent kategorie">
        <div className="row gap-12" style={{ flexWrap: 'wrap' }}>
          {CONSENT_OPTIONS.map((c) => (
            <label
              key={c}
              className="row gap-6"
              style={{ fontSize: 13, alignItems: 'center' }}
            >
              <input
                type="checkbox"
                name="required_consent"
                value={c}
                defaultChecked={values.requiredConsent.includes(c)}
              />
              {c}
            </label>
          ))}
        </div>
      </Row>

      <Row label="Required tools (čárkou oddělené)">
        <input
          type="text"
          name="required_tools"
          defaultValue={values.requiredTools.join(', ')}
          placeholder={knownTools.slice(0, 3).join(', ')}
          style={inputStyle}
        />
        <p style={{ fontSize: 11, color: 'var(--ink-3)', margin: '4px 0 0' }}>
          Známé toolname namespace: {knownTools.length} (např. {knownTools[0]}).
        </p>
      </Row>

      <div className="row gap-20">
        <label
          className="row gap-8"
          style={{ fontSize: 13, alignItems: 'center' }}
        >
          <input
            type="checkbox"
            name="is_published"
            value="1"
            defaultChecked={values.isPublished}
          />
          Publikováno
        </label>
        <label
          className="row gap-8"
          style={{ fontSize: 13, alignItems: 'center' }}
        >
          <input
            type="checkbox"
            name="is_featured"
            value="1"
            defaultChecked={values.isFeatured}
          />
          Featured
        </label>
      </div>

      {error ? (
        <p style={{ color: '#ef4444', fontSize: 13, margin: 0 }}>{error}</p>
      ) : null}

      <div className="row gap-12">
        <button
          type="submit"
          name="intent"
          value="save"
          style={{
            background: 'var(--accent)',
            color: 'var(--bg)',
            padding: '10px 18px',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {submitLabel}
        </button>
        {showArchive ? (
          <button
            type="submit"
            name="intent"
            value="archive"
            style={{
              background: 'transparent',
              color: 'var(--ink)',
              padding: '10px 18px',
              border: '1px solid var(--line)',
              borderRadius: 8,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Archivovat
          </button>
        ) : null}
      </div>
    </Form>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: '8px 12px',
  color: 'var(--ink)',
  fontSize: 14,
  fontFamily: 'inherit',
};

function maybeAutogenSlug(
  e: ChangeEvent<HTMLInputElement>,
  shouldAutogen: boolean
) {
  if (!shouldAutogen) return;
  const slugInput = e.currentTarget
    .closest('form')
    ?.querySelector<HTMLInputElement>('input[data-slug]');
  if (!slugInput) return;
  if (slugInput.value && slugInput.dataset.touched === '1') return;
  slugInput.value = e.currentTarget.value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
