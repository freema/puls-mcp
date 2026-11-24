import type { PlatformConnector, PlatformId } from '@puls/platform-core';
import { shoptetConnector } from '@puls/shoptet-client';
import { upgatesConnector } from '@puls/upgates-client';

/**
 * Connector registry pro web (install / webhook / cron). Zrcadlí registry
 * v mcp-serveru. JEDINÉ místo ve `apps/web`, které smí importovat connector
 * implementace (`@puls/shoptet-client`, `@puls/upgates-client`).
 */
const REGISTRY: Partial<Record<PlatformId, PlatformConnector>> = {
  shoptet: shoptetConnector,
  upgates: upgatesConnector,
};

export function getConnector(platform: PlatformId): PlatformConnector {
  const connector = REGISTRY[platform];
  if (!connector) {
    throw new Error(`No connector registered for platform '${platform}'`);
  }
  return connector;
}
