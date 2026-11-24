const BRAND = {
  bg: '#09090B',
  surface: '#18181B',
  card: '#FFFFFF',
  cardInk: '#18181B',
  cardMuted: '#52525B',
  cardLine: '#E4E4E7',
  accent: '#FF7A3D',
  accentDeep: '#FF5A1F',
  accentInk: '#1A0E06',
  faint: '#71717A',
};

const PULSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${BRAND.accentInk}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="display:block"><polyline points="3 12 7 12 10 5 14 19 17 12 21 12"></polyline></svg>`;

export interface EmailLayoutInput {
  preview: string;
  body: string;
  footNote?: string;
}

export function renderEmailLayout({
  preview,
  body,
  footNote,
}: EmailLayoutInput): string {
  const previewHidden = `<div style="display:none;font-size:1px;color:${BRAND.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preview)}</div>`;

  return `<!doctype html>
<html lang="cs">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <title>Puls</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:${BRAND.cardInk};">
    ${previewHidden}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg};padding:32px 16px 48px;">
      <tr>
        <td align="center">
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;">
            <tr>
              <td style="padding:0 4px 20px 4px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding-right:10px;vertical-align:middle;">
                      <div style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,${BRAND.accent},${BRAND.accentDeep});display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px -6px rgba(255,122,61,0.55);">
                        ${PULSE_SVG}
                      </div>
                    </td>
                    <td style="vertical-align:middle;">
                      <span style="color:#FAFAFA;font-weight:600;font-size:17px;letter-spacing:-0.02em;">Puls</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background:${BRAND.card};border:1px solid ${BRAND.cardLine};border-radius:14px;padding:32px 32px 28px;">
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 4px 0 4px;color:${BRAND.faint};font-size:12px;line-height:1.55;">
                ${footNote ?? 'Tento e-mail vám poslal Puls — AI asistent pro váš e-shop. Pokud jste o něj nežádali, ignorujte ho.'}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return c;
    }
  });
}

export const emailBrand = BRAND;
