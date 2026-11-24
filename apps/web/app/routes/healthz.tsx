import type { Route } from './+types/healthz';
import { runHealthChecks } from '~/lib/health';

export async function loader({ request }: Route.LoaderArgs) {
  void request;
  const body = await runHealthChecks();
  return Response.json(body, { status: body.ok ? 200 : 503 });
}
