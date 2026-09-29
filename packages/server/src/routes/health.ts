import { sendText } from '../http.ts';
import type { Router } from '../http.ts';

export function registerHealthRoutes(router: Router): void {
  router.get('/healthz', (_req, res) => {
    sendText(res, 200, 'ok');
  });
}
