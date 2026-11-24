import { eq } from 'drizzle-orm';
import { users } from '@puls/db/schema';
import type { DB } from '~/lib/db';
import { normalizeAuthEmail } from './email-code.server';

/** Ensure a row exists for this e-mail; returns user id. */
export async function ensureUserByEmail(
  db: DB,
  emailRaw: string
): Promise<string> {
  const email = normalizeAuthEmail(emailRaw);
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing[0]?.id) return existing[0].id;

  const [created] = await db
    .insert(users)
    .values({ email })
    .returning({ id: users.id });
  if (!created?.id) throw new Error('failed to create user');
  return created.id;
}

/** Upsert user from Google OAuth (verified e-mail + OIDC sub). */
export async function ensureUserFromGoogle(
  db: DB,
  args: { email: string; googleSub: string }
): Promise<string> {
  const email = normalizeAuthEmail(args.email);

  const bySub = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.googleSub, args.googleSub))
    .limit(1);
  if (bySub[0]?.id) return bySub[0].id;

  const byEmail = await db
    .select({ id: users.id, googleSub: users.googleSub })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (byEmail[0]?.id) {
    if (!byEmail[0].googleSub) {
      await db
        .update(users)
        .set({ googleSub: args.googleSub })
        .where(eq(users.id, byEmail[0].id));
    }
    return byEmail[0].id;
  }

  const [created] = await db
    .insert(users)
    .values({ email, googleSub: args.googleSub })
    .returning({ id: users.id });

  if (!created?.id) throw new Error('failed to create user');
  return created.id;
}
