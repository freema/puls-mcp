export type PricingTier = {
  id: string;
  name: string;
  tagline: string | null;
  priceMonthly: number;
  priceYearly: number | null;
  yearlyDiscountPct: number;
  currency: string;
  callsPerDay: number;
  maxMemoryItems: number;
  activityRetentionDays: number;
  maxShopsPerAccount: number;
  maxConcurrentSessions: number;
  supportSla: string;
  unlocksTools: string[];
  isTrial: boolean;
  trialDays: number | null;
  isAssignableOnInstall: boolean;
  features: string[];
  isPublic: boolean;
  isHighlighted: boolean;
  badge: string | null;
  sortOrder: number;
};

export function formatPriceCZK(amount: number): string {
  return new Intl.NumberFormat('cs-CZ').format(amount);
}
