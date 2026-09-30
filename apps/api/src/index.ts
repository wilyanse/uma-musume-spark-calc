import { createApp } from './app.ts';

const app = createApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) return app.fetch(request, env, ctx);
    // Static requests normally never reach the Worker (assets.run_worker_first = ["/api/*"]);
    // this covers direct calls and local tooling.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
