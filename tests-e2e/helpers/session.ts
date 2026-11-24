import { randomBytes } from 'node:crypto';
import pg from 'pg';

/** Creates / refreshes a server session for Playwright (magic link bypass). */
export async function seedBrowserSession(args: {
  databaseUrl: string;
  email: string;
}): Promise<{ token: string }> {
  const client = new pg.Client({ connectionString: args.databaseUrl });
  await client.connect();
  try {
    const email = args.email.trim().toLowerCase();

    const existing = await client.query<{ id: string }>(
      `select id from users where email = $1`,
      [email]
    );
    let userId = existing.rows[0]?.id;
    if (!userId) {
      userId = randomBytes(16).toString('hex');
      await client.query(`insert into users (id, email) values ($1, $2)`, [
        userId,
        email,
      ]);
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await client.query(`delete from sessions where user_id = $1`, [userId]);
    await client.query(
      `insert into sessions (id, user_id, token, expires_at) values ($1, $2, $3, $4)`,
      [randomBytes(12).toString('hex'), userId, token, expiresAt]
    );

    return { token };
  } finally {
    await client.end();
  }
}
