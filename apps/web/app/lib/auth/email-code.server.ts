import { createHash, randomInt } from 'node:crypto';
import { getRedis } from '~/lib/redis';

const CODE_TTL_S = 10 * 60;
const CODE_MAX_ATTEMPTS = 5;

interface LoginCodeRecord {
  email: string;
  codeHash: string;
  attempts: number;
  ip?: string;
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function emailKey(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

function codeRedisKey(email: string): string {
  return `puls:loginCode:${emailKey(email)}`;
}

export function normalizeAuthEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function generateLoginCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i += 1) out += alphabet[randomInt(0, alphabet.length)];
  return out;
}

export async function createEmailLoginCode(
  email: string,
  ip: string | undefined
): Promise<string> {
  const norm = normalizeAuthEmail(email);
  const code = generateLoginCode();
  const rec: LoginCodeRecord = {
    email: norm,
    codeHash: hashCode(code),
    attempts: 0,
    ip,
  };
  await getRedis().set(
    codeRedisKey(norm),
    JSON.stringify(rec),
    'EX',
    CODE_TTL_S
  );
  return code;
}

export async function consumeEmailLoginCode(
  email: string,
  code: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const norm = normalizeAuthEmail(email);
  const r = getRedis();
  const key = codeRedisKey(norm);
  const raw = await r.get(key);
  if (!raw) return { ok: false, reason: 'no_code' };

  let rec: LoginCodeRecord;
  try {
    rec = JSON.parse(raw) as LoginCodeRecord;
  } catch {
    await r.del(key);
    return { ok: false, reason: 'bad_record' };
  }

  if (rec.attempts >= CODE_MAX_ATTEMPTS) {
    await r.del(key);
    return { ok: false, reason: 'too_many_attempts' };
  }

  if (hashCode(code.trim().toUpperCase()) !== rec.codeHash) {
    rec.attempts += 1;
    const ttl = await r.ttl(key);
    await r.set(key, JSON.stringify(rec), 'EX', ttl > 0 ? ttl : CODE_TTL_S);
    return { ok: false, reason: 'wrong_code' };
  }

  await r.del(key);
  return { ok: true };
}

export function getClientIp(request: Request): string | undefined {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim();
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  return undefined;
}
