import { createHmac } from 'node:crypto';

export function signWebhook(payload: string, key: string): string {
  return createHmac('sha1', key).update(payload, 'utf8').digest('hex');
}
