import { emailBrand, escapeHtml, renderEmailLayout } from '../layout.server';

export interface LoginCodeVars {
  code: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderLoginCodeEmail(vars: LoginCodeVars): RenderedEmail {
  const code = vars.code.trim().toUpperCase();
  const subject = `Puls — přihlašovací kód: ${code}`;

  const codeChars = code
    .split('')
    .map(
      (ch) =>
        `<span style="display:inline-block;min-width:36px;padding:10px 4px;margin:0 3px;border:1px solid ${emailBrand.cardLine};border-radius:8px;background:#FAFAFA;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:24px;font-weight:600;color:${emailBrand.cardInk};letter-spacing:0;">${escapeHtml(ch)}</span>`
    )
    .join('');

  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:600;color:${emailBrand.cardInk};">
      Přihlašovací kód
    </h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:${emailBrand.cardMuted};">
      Vložte tento kód do přihlašovacího okna Pulsu. Platnost je 10 minut a kód lze použít jednou.
    </p>
    <div style="text-align:center;margin:8px 0 24px;">
      ${codeChars}
    </div>
    <div style="border-top:1px solid ${emailBrand.cardLine};padding-top:16px;font-size:12.5px;line-height:1.55;color:${emailBrand.cardMuted};">
      Pokud jste o přihlášení nežádali, e-mail klidně ignorujte — bez vložení kódu se nic nestane.
    </div>
  `;

  const html = renderEmailLayout({
    preview: `Váš přihlašovací kód: ${code}`,
    body,
  });

  const text = [
    `Váš kód pro přihlášení do Puls: ${code}`,
    '',
    'Platnost je 10 minut, kód lze použít jednou.',
    '',
    'Pokud jste o přihlášení nežádali, e-mail ignorujte.',
  ].join('\n');

  return { subject, html, text };
}
