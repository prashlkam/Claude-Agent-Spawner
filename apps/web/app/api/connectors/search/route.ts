import { searchConnectors } from '@/lib/connector-registry.ts';
import { withUser } from '@/lib/route.ts';

export async function GET(request: Request) {
  return withUser(async () => {
    const query = new URL(request.url).searchParams.get('q') ?? '';
    return { connectors: await searchConnectors(query) };
  });
}
