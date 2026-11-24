import { emailBrand, escapeHtml, renderEmailLayout } from '../layout.server';
import type { RenderedEmail } from './login-code.server';

const PRICING_URL = 'https://pulsmcp.com/dashboard';

function ctaButton(label: string, url: string) {
  return `<div style="text-align:center;margin:24px 0;">
    <a href="${url}" style="display:inline-block;padding:12px 22px;background:linear-gradient(135deg,${emailBrand.accent},${emailBrand.accentDeep});color:${emailBrand.accentInk};text-decoration:none;border-radius:10px;font-weight:600;font-size:14px;">
      ${escapeHtml(label)}
    </a>
  </div>`;
}

export interface TrialReminderVars {
  shopDomain: string;
  daysLeft: number;
  endsAt: string;
}

export function renderTrialDayMinus3Email(vars: TrialReminderVars): RenderedEmail {
  const subject = `Puls — trial vyprší za ${vars.daysLeft} dny`;
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:600;color:${emailBrand.cardInk};">
      Trial Pulsu vyprší za ${vars.daysLeft} dny
    </h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:${emailBrand.cardMuted};">
      Tvůj e-shop <strong>${escapeHtml(vars.shopDomain)}</strong> má zkušební období
      Puls aktivní ještě ${vars.daysLeft} dny — končí <strong>${escapeHtml(vars.endsAt)}</strong>.
    </p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:${emailBrand.cardMuted};">
      Aby AI asistent pokračoval bez přerušení, vyber tarif včas. Po expiraci
      se MCP volání pozastaví, ale data ti držíme dalších 30 dní.
    </p>
    ${ctaButton('Vybrat tarif', PRICING_URL)}
    <div style="border-top:1px solid ${emailBrand.cardLine};padding-top:16px;font-size:12.5px;line-height:1.55;color:${emailBrand.cardMuted};">
      Trial je jednorázový a vázaný na <code>eshopId</code> — opakovaná instalace
      nového trialu pro stejný e-shop už není možná.
    </div>
  `;
  return {
    subject,
    html: renderEmailLayout({
      preview: `Trial vyprší za ${vars.daysLeft} dny — vyber tarif.`,
      body,
    }),
    text: [
      `Trial Pulsu pro ${vars.shopDomain} vyprší ${vars.endsAt} (${vars.daysLeft} dní).`,
      '',
      `Vyber tarif: ${PRICING_URL}`,
      '',
      'Trial je jednorázový a nelze ho pro stejný e-shop opakovat.',
    ].join('\n'),
  };
}

export function renderTrialDayMinus1Email(vars: TrialReminderVars): RenderedEmail {
  const subject = `Puls — trial končí zítra`;
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:600;color:${emailBrand.cardInk};">
      Zítra ti vyprší trial Pulsu
    </h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:${emailBrand.cardMuted};">
      E-shop <strong>${escapeHtml(vars.shopDomain)}</strong> má trial aktivní jen
      do <strong>${escapeHtml(vars.endsAt)}</strong>. Po půlnoci se MCP volání
      pozastaví.
    </p>
    ${ctaButton('Aktivovat tarif teď', PRICING_URL)}
    <div style="border-top:1px solid ${emailBrand.cardLine};padding-top:16px;font-size:12.5px;line-height:1.55;color:${emailBrand.cardMuted};">
      Po expiraci ti data držíme 30 dní pro případnou reaktivaci.
    </div>
  `;
  return {
    subject,
    html: renderEmailLayout({
      preview: 'Trial Pulsu vyprší zítra — aktivuj tarif teď.',
      body,
    }),
    text: [
      `Trial Pulsu pro ${vars.shopDomain} vyprší zítra (${vars.endsAt}).`,
      '',
      `Aktivuj tarif: ${PRICING_URL}`,
    ].join('\n'),
  };
}

export interface TrialExpiredVars {
  shopDomain: string;
}

export function renderTrialExpiredEmail(vars: TrialExpiredVars): RenderedEmail {
  const subject = `Puls — trial vypršel, shop je pozastaven`;
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:600;color:${emailBrand.cardInk};">
      Trial vypršel
    </h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:${emailBrand.cardMuted};">
      Tvůj e-shop <strong>${escapeHtml(vars.shopDomain)}</strong> má pozastavená
      MCP volání, protože zkušební období Puls skončilo.
    </p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:${emailBrand.cardMuted};">
      Aktivuj placený tarif a pokračujeme tam, kde jsme skončili. Data ti
      držíme 30 dní pro případnou reaktivaci, pak je smažeme podle DPA.
    </p>
    ${ctaButton('Aktivovat tarif', PRICING_URL)}
  `;
  return {
    subject,
    html: renderEmailLayout({
      preview: 'Trial Pulsu skončil — aktivuj tarif a pokračuj.',
      body,
    }),
    text: [
      `Trial Pulsu pro ${vars.shopDomain} vypršel — shop je pozastaven.`,
      '',
      `Aktivuj tarif: ${PRICING_URL}`,
      '',
      'Data držíme 30 dní pro reaktivaci.',
    ].join('\n'),
  };
}

export interface TierUpgradedVars {
  shopDomain: string;
  fromTier: string;
  toTier: string;
}

export function renderTierUpgradedEmail(vars: TierUpgradedVars): RenderedEmail {
  const subject = `Puls — tarif změněn na ${vars.toTier}`;
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:600;color:${emailBrand.cardInk};">
      Tarif změněn
    </h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:${emailBrand.cardMuted};">
      E-shop <strong>${escapeHtml(vars.shopDomain)}</strong> teď běží na tarifu
      <strong>${escapeHtml(vars.toTier)}</strong> (změna z ${escapeHtml(vars.fromTier)}).
      Nové limity platí okamžitě.
    </p>
    <div style="border-top:1px solid ${emailBrand.cardLine};padding-top:16px;font-size:12.5px;line-height:1.55;color:${emailBrand.cardMuted};">
      Při downgrade se data nad nový limit (memory items, log retence) smažou
      do 7 dnů.
    </div>
  `;
  return {
    subject,
    html: renderEmailLayout({
      preview: `Tarif změněn na ${vars.toTier}.`,
      body,
    }),
    text: [
      `Tarif Pulsu pro ${vars.shopDomain}: ${vars.fromTier} → ${vars.toTier}.`,
      '',
      'Nové limity platí okamžitě.',
    ].join('\n'),
  };
}
