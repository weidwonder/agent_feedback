import { randomBytes } from 'node:crypto';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { mountAdmin } from './admin/index.ts';
import type { Config } from './config.ts';
import { createRouter, log, sendError } from './http.ts';
import { registerFeedbackApiRoutes } from './routes/feedback-api.ts';
import { registerHealthRoutes } from './routes/health.ts';
import { registerRegistryRoutes } from './routes/registry.ts';
import { registerSubmissionRoutes } from './routes/submissions.ts';

export interface AppContext {
  db: DatabaseSync;
  config: Config;
  dataDir: string;
  /** 当前时间；测试可注入 */
  now: () => Date;
}

export function createApp(ctx: AppContext): RequestListener {
  const router = createRouter();
  registerHealthRoutes(router);
  registerSubmissionRoutes(router, ctx);
  registerRegistryRoutes(router, ctx);
  registerFeedbackApiRoutes(router, ctx);
  mountAdmin(router, ctx);

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reqId = randomBytes(4).toString('hex');
    const started = Date.now();
    let route = 'unmatched';
    try {
      const matched = await router.handle(req, res);
      if (matched === null) {
        sendError(res, 404, 'not_found', '接口不存在');
      } else {
        route = matched;
      }
    } catch (err) {
      log('request_error', { level: 'error', reqId, message: err instanceof Error ? err.message : String(err) });
      sendError(res, 500, 'internal', '服务内部错误');
    }
    log('request', { reqId, route, status: res.statusCode, costMs: Date.now() - started });
  }

  return (req, res) => {
    void handle(req, res);
  };
}
