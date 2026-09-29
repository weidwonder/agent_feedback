// 提交脚本的 Node 版本门槛：低于 20 时不继续（脚本后续依赖 Node 20 的能力）。
// 本文件及其调用点之前只能用 Node 18 也有的 API。
const MIN_NODE_MAJOR = 20;

/** 版本串（如 "18.20.0"）的主版本低于最低要求返回 true；无法解析时返回 false，交给后续流程自然报错。 */
export function nodeTooOld(version: string): boolean {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isInteger(major) && major < MIN_NODE_MAJOR;
}
