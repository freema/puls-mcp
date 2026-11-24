// @puls/platform-core — kontrakty a typy multi-platform vrstvy.
// `@puls/db` zůstává Drizzle zdrojem pravdy schématu; PlatformId/PLATFORM
// re-exportujeme odsud, ať app/connector vrstva nemusí sahat do @puls/db.

export type { Shop, PulsDb } from './shop.js';
export { PLATFORM, PLATFORMS, isPlatform } from '@puls/db/schema';

export * from './domain.js';

export type {
  PlatformCapabilities,
  ProductPatchField,
} from './capabilities.js';
export { SHOPTET_CAPABILITIES, PRODUCT_PATCH_FIELDS } from './capabilities.js';

export type {
  PlatformConnector,
  PlatformWrites,
  PlatformInstallInput,
  NormalizedShop,
  NormalizedWebhook,
} from './connector.js';

export { encryptSecret, decryptSecret, isEncrypted } from './crypto.js';

export {
  revertByTool,
  mapBeforeToProductPatch,
  mapBeforeToCategoryPatch,
} from './revert.js';

export {
  runWithInteractiveBudget,
  getInteractiveWaitRemaining,
  chargeInteractiveWait,
  isRateLimitError,
  DEFAULT_INTERACTIVE_WAIT_BUDGET_MS,
} from './request-context.js';
