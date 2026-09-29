import type { AppContext } from '../app.ts';
import type { Router } from '../http.ts';
import { registerAdminRoutes } from './routes.ts';

/** 挂载管理界面（服务端渲染，会话 cookie 鉴权）。 */
export function mountAdmin(router: Router, ctx: AppContext): void {
  registerAdminRoutes(router, ctx);
}
