// Barrel pro drizzle-kit (drizzle.config.ts → schema: './drizzle/schema.ts').
// Čistý pass-through @puls/db/schema — drizzle-kit si vytáhne tabulky/enumy,
// app vrstva přes něj dosáhne i na PlatformId/PLATFORM/isPlatform. Pass-through
// (ne ruční výčet) drží `typeof schema` identický s @puls/db, takže web `DB`
// zůstává přiřaditelný na `PulsDb` a žádné nové exporty se sem nemusí ručně dopisovat.
export * from '@puls/db/schema';
