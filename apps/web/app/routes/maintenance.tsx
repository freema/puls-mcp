import type { Route } from './+types/maintenance';
import { ErrorPage } from '~/components/error/error-page';

export function meta(_: Route.MetaArgs) {
  return [
    { title: '503 · Provádíme údržbu — Puls MCP' },
    { name: 'robots', content: 'noindex' },
  ];
}

export function headers() {
  return {
    'Cache-Control': 'no-store',
    'Retry-After': '600',
  };
}

export default function MaintenanceRoute() {
  return (
    <ErrorPage
      code={503}
      title="Provádíme údržbu."
      description="Jsme zpět za chvíli. Zkuste to prosím za pár minut."
      primary={{ to: '/', label: 'Na úvod' }}
      illustration="maintenance"
      tone="warn"
    />
  );
}
