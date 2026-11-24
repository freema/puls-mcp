import {
  renderLoginCodeEmail,
  type RenderedEmail,
} from './login-code.server';
import {
  renderTierUpgradedEmail,
  renderTrialDayMinus1Email,
  renderTrialDayMinus3Email,
  renderTrialExpiredEmail,
} from './trial-emails.server';

export interface EmailTemplate {
  id: string;
  name: string;
  description: string;
  render: () => RenderedEmail;
}

const SAMPLE_DOMAIN = 'demo-shop.cz';
const SAMPLE_END = '15. 5. 2026 23:59';

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'login-code',
    name: 'Přihlašovací kód',
    description:
      'Posílá se uživateli při přihlášení e-mailem. Obsahuje 6místný jednorázový kód.',
    render: () => renderLoginCodeEmail({ code: 'AB23CD' }),
  },
  {
    id: 'trial-day-minus-3',
    name: 'Trial — 3 dny do konce',
    description: 'Připomínka 3 dny před expirací trialu.',
    render: () =>
      renderTrialDayMinus3Email({
        shopDomain: SAMPLE_DOMAIN,
        daysLeft: 3,
        endsAt: SAMPLE_END,
      }),
  },
  {
    id: 'trial-day-minus-1',
    name: 'Trial — 1 den do konce',
    description: 'Poslední připomínka den před expirací.',
    render: () =>
      renderTrialDayMinus1Email({
        shopDomain: SAMPLE_DOMAIN,
        daysLeft: 1,
        endsAt: SAMPLE_END,
      }),
  },
  {
    id: 'trial-expired',
    name: 'Trial — vypršel',
    description: 'Notifikace po expiraci trialu, shop pozastaven.',
    render: () => renderTrialExpiredEmail({ shopDomain: SAMPLE_DOMAIN }),
  },
  {
    id: 'tier-upgraded',
    name: 'Tarif změněn',
    description: 'Potvrzení změny tarifu (upgrade/downgrade/admin override).',
    render: () =>
      renderTierUpgradedEmail({
        shopDomain: SAMPLE_DOMAIN,
        fromTier: 'Trial',
        toTier: 'Pro',
      }),
  },
];

export function getEmailTemplate(id: string): EmailTemplate | undefined {
  return EMAIL_TEMPLATES.find((t) => t.id === id);
}

export type { RenderedEmail };
export {
  renderTrialDayMinus3Email,
  renderTrialDayMinus1Email,
  renderTrialExpiredEmail,
  renderTierUpgradedEmail,
};
