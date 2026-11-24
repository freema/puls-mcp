# Ochrana OTP loginu proti zneužití (OTP bombing)

E-mailový login posílá jednorázový kód (OTP) na zadanou adresu. Bez ochran se dá
endpoint zneužít jako „OTP bomber" — útočník zadává cizí adresy a appka jim rozesílá
kódy. Poskytovatel SMTP pak může odesílací schránku zablokovat.

Aplikace posílá přes vlastní SMTP (žádný Resend/Postmark/SES). Veškerá ochrana
je na úrovni aplikace.

## Kde to žije

| Vrstva | Soubor |
| --- | --- |
| Login endpoint (`POST /login`) | `apps/web/app/routes/login.tsx` |
| Centrální guard (rate-limit, kill switch, globální pojistka) | `apps/web/app/lib/auth/otp-guard.server.ts` |
| Cloudflare Turnstile (CAPTCHA) | `apps/web/app/lib/auth/turnstile.server.ts` |
| Fixed-window čítač (Redis) | `apps/web/app/lib/rate-limit.server.ts` |
| Generování/uložení kódu (Redis, TTL 10 min, max 5 pokusů) | `apps/web/app/lib/auth/email-code.server.ts` |

Všechny čítače jsou v **Redis** (atomický `INCR` / `SET NX`) — žádné DB count dotazy,
takže to nemá race conditions.

## Limity (výchozí)

| Vrstva | Limit | Reakce |
| --- | --- | --- |
| per-IP krátké okno | 5 / 15 min | HTTP 429 |
| per-IP denní okno | 20 / 24 h | HTTP 429 |
| CAPTCHA (Turnstile) | musí projít | HTTP 400 |
| per-e-mail cooldown | min. 60 s mezi odesláními | redirect na /verify (nic se nepošle) |
| per-e-mail hodinový | 3 / h | redirect na /verify (nic se nepošle) |
| globální pojistka | `OTP_GLOBAL_HOURLY_MAX` / h (default 50) | auto-pauza 15 min + ALERT log |

Pořadí kontrol je fail-fast (od nejlevnější po nejdražší). Při výpadku Redis se
rozhoduje **fail-closed** — radši je login dočasně nedostupný, než rozeslat e-maily
bez limitu.

### Anti-enumeration

Odpověď nikdy neprozradí, jestli účet existuje. Úspěch i „měkké" bloky (cooldown,
hodinový limit) končí stejným redirectem na `/login/verify`. Login je passwordless
(signup i login zároveň), takže OTP se posílá i na nové adresy — primární obranou
proti bombingu jsou proto **CAPTCHA + rate-limity + globální pojistka**, ne kontrola
existence účtu.

## Kill switch (nouzové vypnutí)

Kdyby zase hrozil suspend schránky, jde odesílání OTP **okamžitě** vypnout:

1. **Přes env** (vyžaduje restart kontejneru):
   ```
   OTP_LOGIN_DISABLED=1
   ```
2. **Za běhu bez redeploye** (Redis flag — projeví se hned):
   ```bash
   # zapnout kill switch
   docker exec puls-redis redis-cli SET puls:otp:killswitch 1
   # vypnout zpět
   docker exec puls-redis redis-cli DEL puls:otp:killswitch
   ```

Když je kill switch aktivní, login e-mailem vrací generickou hlášku a doporučí Google.
Google login funguje dál.

### Globální auto-pauza

Při překročení `OTP_GLOBAL_HOURLY_MAX` se automaticky nastaví `puls:otp:autopause`
(TTL 15 min) a zaloguje se `ALERT`. Ručně zrušit:
```bash
docker exec puls-redis redis-cli DEL puls:otp:autopause
```

## Cloudflare Turnstile (CAPTCHA)

Zdarma, neposílá traffic přes Cloudflare. Nastavení:

1. dash.cloudflare.com → **Turnstile** → *Add widget*.
2. Hostnames: `pulsmcp.com`, `www.pulsmcp.com`, `localhost` (pro dev).
3. Widget Mode: **Managed**.
4. Zkopíruj **Site Key** (veřejný) a **Secret Key** (tajný) do env:
   ```
   TURNSTILE_SITE_KEY=0x4AAAA...
   TURNSTILE_SECRET_KEY=0x4AAAA...
   ```

Dokud `TURNSTILE_SECRET_KEY` **není** nastavený, CAPTCHA se **přeskakuje** (aby dev/E2E
nepadaly); v produkci se to zaloguje jako warning. Jakmile je secret nastavený,
ověření se vynutí server-side před jakýmkoli odesláním e-mailu.

## Monitoring

Guard loguje (pino) maskovaný e-mail + hash:
- `otp_send_ok` — kód odeslán
- `otp_send_blocked` (+ `reason`) — blok; u IP/globálních se přidává `alert: true`
- `otp_global_brake` — překročen globální strop (auto-pauza)

Filtr v logu: `grep otp_send_blocked` / `grep '"alert":true'`.

## Tuning

Limity jsou konstanty v `otp-guard.server.ts` (`IP_SHORT`, `IP_DAILY`, `EMAIL_HOURLY`,
`EMAIL_COOLDOWN_MS`). Globální strop je env `OTP_GLOBAL_HOURLY_MAX`.

## Možná rozšíření (zatím neimplementováno)

- Blocklist disposable domén / throttling nikdy neviděných domén (pozor na false
  positives u reálných zákazníků).
- Rate-limit i na `/login/verify` (dnes chrání jen 5-pokusový limit per kód).
