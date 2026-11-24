import { and, eq, gte, isNotNull, lte, lt } from 'drizzle-orm';
import { mcpToolCalls, pricingTiers, shops } from '@puls/db/schema';
import type { DB } from '~/lib/db';
import { getConfig } from '~/lib/config';
import { logger } from '~/lib/logger';
import { assignTier } from '~/lib/pricing.server';
import { sendTrialEmail } from '~/lib/email/send-trial-emails.server';
import {
  renderTrialDayMinus1Email,
  renderTrialDayMinus3Email,
  renderTrialExpiredEmail,
} from '~/lib/email/templates';

const DAY_MS = 24 * 60 * 60 * 1000;

function fmt(d: Date): string {
  return d.toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Najdi shopy v trialu, kterým vyprší trial v rozmezí D-(low) až D-(high) dní,
 * a kterým ještě reminder neposlal.
 *
 * Reminder dedupe je tady jednoduchý — pošleme každý den a počítáme s tím,
 * že nodemailer je idempotentní per-uvedeném subjectu jen v rámci dne.
 * Pro jednoduchost: spouštíme jednou denně přes externí scheduler.
 */
async function loadTrialsEnding(
  db: DB,
  fromDays: number,
  toDays: number
): Promise<{ shopId: string; domain: string; adminEmail: string | null; trialEndsAt: Date }[]> {
  const now = new Date();
  const lo = new Date(now.getTime() + fromDays * DAY_MS);
  const hi = new Date(now.getTime() + (toDays + 1) * DAY_MS);
  const rows = await db
    .select({
      shopId: shops.id,
      domain: shops.domain,
      adminEmail: shops.adminEmail,
      trialEndsAt: shops.trialEndsAt,
    })
    .from(shops)
    .where(
      and(
        eq(shops.tierId, 'trial'),
        eq(shops.status, 'ACTIVE'),
        isNotNull(shops.trialEndsAt),
        gte(shops.trialEndsAt, lo),
        lte(shops.trialEndsAt, hi)
      )
    );
  return rows
    .filter((r) => r.trialEndsAt !== null)
    .map((r) => ({
      shopId: r.shopId,
      domain: r.domain,
      adminEmail: r.adminEmail,
      trialEndsAt: r.trialEndsAt as Date,
    }));
}

export async function runTrialReminders(db: DB): Promise<{
  sentDayMinus3: number;
  sentDayMinus1: number;
}> {
  const now = new Date();

  const day3 = await loadTrialsEnding(db, 2, 3);
  const day1 = await loadTrialsEnding(db, 0, 1);

  let sent3 = 0;
  for (const t of day3) {
    if (!t.adminEmail) continue;
    const days = Math.max(
      1,
      Math.ceil((t.trialEndsAt.getTime() - now.getTime()) / DAY_MS)
    );
    try {
      await sendTrialEmail(
        t.adminEmail,
        renderTrialDayMinus3Email({
          shopDomain: t.domain,
          daysLeft: days,
          endsAt: fmt(t.trialEndsAt),
        })
      );
      sent3 += 1;
    } catch (err) {
      logger.error({ err, shopId: t.shopId }, 'trial-day-3 email send failed');
    }
  }

  let sent1 = 0;
  for (const t of day1) {
    if (!t.adminEmail) continue;
    try {
      await sendTrialEmail(
        t.adminEmail,
        renderTrialDayMinus1Email({
          shopDomain: t.domain,
          daysLeft: 1,
          endsAt: fmt(t.trialEndsAt),
        })
      );
      sent1 += 1;
    } catch (err) {
      logger.error({ err, shopId: t.shopId }, 'trial-day-1 email send failed');
    }
  }

  return { sentDayMinus3: sent3, sentDayMinus1: sent1 };
}

/**
 * Najdi shopy s vypršelým trialem a status=ACTIVE → přepni na PAUSED, pošli email.
 */
export async function expireTrials(db: DB): Promise<{ paused: number }> {
  const now = new Date();
  const rows = await db
    .select({
      shopId: shops.id,
      domain: shops.domain,
      adminEmail: shops.adminEmail,
    })
    .from(shops)
    .where(
      and(
        eq(shops.tierId, 'trial'),
        eq(shops.status, 'ACTIVE'),
        isNotNull(shops.trialEndsAt),
        lt(shops.trialEndsAt, now)
      )
    );

  for (const r of rows) {
    await db
      .update(shops)
      .set({ status: 'PAUSED', updatedAt: new Date() })
      .where(eq(shops.id, r.shopId));
    if (r.adminEmail) {
      try {
        await sendTrialEmail(
          r.adminEmail,
          renderTrialExpiredEmail({ shopDomain: r.domain })
        );
      } catch (err) {
        logger.error({ err, shopId: r.shopId }, 'trial-expired email send failed');
      }
    }
  }

  return { paused: rows.length };
}

/**
 * Activity log retention: smaž mcp_tool_calls starší než
 * `tier.activityRetentionDays` (per-tier, ne globálně).
 */
export async function pruneActivityLog(db: DB): Promise<{ deletedRows: number }> {
  const tiers = await db.select().from(pricingTiers);
  let total = 0;
  for (const t of tiers) {
    const cutoff = new Date(Date.now() - t.activityRetentionDays * DAY_MS);
    // Smaž záznamy shopů na tomto tieru se starším createdAt
    const shopRows = await db
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.tierId, t.id));
    if (shopRows.length === 0) continue;
    for (const s of shopRows) {
      const result = await db
        .delete(mcpToolCalls)
        .where(
          and(eq(mcpToolCalls.shopId, s.id), lt(mcpToolCalls.createdAt, cutoff))
        );
      const count = (result as unknown as { rowCount?: number }).rowCount ?? 0;
      total += count;
    }
  }
  return { deletedRows: total };
}

/**
 * Po expiraci trialu + GRACE_DAYS bez upgradu → smaz shop data
 * (obsah, ne řádek shop, ten zůstává pro audit a anti-freeride).
 * Defaultně 30 dní (CRON_TRIAL_GRACE_DAYS env).
 */
export async function pruneExpiredTrials(db: DB): Promise<{ purged: number }> {
  const env = getConfig();
  const cutoff = new Date(Date.now() - env.TRIAL_GRACE_DAYS * DAY_MS);

  const rows = await db
    .select({ shopId: shops.id })
    .from(shops)
    .where(
      and(
        eq(shops.tierId, 'trial'),
        eq(shops.status, 'PAUSED'),
        isNotNull(shops.trialEndsAt),
        lt(shops.trialEndsAt, cutoff)
      )
    );

  for (const r of rows) {
    // Soft-purge: smaz mcpToolCalls + označ shop jako uninstalled.
    await db.delete(mcpToolCalls).where(eq(mcpToolCalls.shopId, r.shopId));
    await db
      .update(shops)
      .set({ status: 'UNINSTALLED', uninstalledAt: new Date(), updatedAt: new Date() })
      .where(eq(shops.id, r.shopId));
  }
  return { purged: rows.length };
}

/** Suppress unused import warning — assignTier je import stub pro typovou kontrolu. */
void assignTier;
