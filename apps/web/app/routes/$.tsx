import type { Route } from './+types/$';

export function loader() {
  throw new Response('Not Found', { status: 404 });
}

export function meta(_: Route.MetaArgs) {
  return [
    { title: '404 · Puls MCP' },
    { name: 'robots', content: 'noindex' },
  ];
}

export default function NotFoundCatchAll() {
  return null;
}
