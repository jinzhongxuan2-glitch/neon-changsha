/* playwright-core / chromium / 项目根目录的定位，集中一处。
 *
 * 为什么要有这个文件：
 *   以前每个探针头部都写 `require('C:/Users/<用户名>/.workbuddy/.../playwright-core')`
 *   和 `ROOT = 'C:/Users/<用户名>/Desktop/neon-changsha'`。这是本机绝对路径，
 *   进公开仓库等于把 Windows 用户名一起发出去，换台机器也跑不起来。
 *
 * 解析顺序（每一级都可以用环境变量顶掉）：
 *   ROOT  —— 永远是 `_build/..`，不需要猜
 *   PW    —— 环境变量 PW_CORE → .workbuddy 的全局 node_modules → 项目 node_modules
 *   EXE   —— 环境变量 PW_EXE  → %LOCALAPPDATA%/ms-playwright/<固定版本>
 *
 * 换机器时只要 playwright 装在默认位置、或者设好 PW_CORE / PW_EXE，一行都不用改。
 */
const path = require('path');

const LOCAL = process.env.LOCALAPPDATA ||
  path.join(process.env.HOME || process.env.USERPROFILE || '', 'AppData', 'Local');

/* %LOCALAPPDATA% = C:/Users/<user>/AppData/Local  →  上两级就是 C:/Users/<user> */
const HOME = path.resolve(LOCAL, '..', '..');
const WB_MODULES = process.env.WB_NODE_MODULES ||
  path.join(HOME, '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules');

function loadPlaywright(){
  const cands = [
    process.env.PW_CORE,
    path.join(WB_MODULES, 'playwright-core'),
    'playwright-core',
  ].filter(Boolean);
  const errs = [];
  for(const c of cands){
    try { return require(c); } catch(e){ errs.push(c + ': ' + e.message.split('\n')[0]); }
  }
  throw new Error('找不到 playwright-core。设 PW_CORE=<...>/node_modules/playwright-core\n  ' + errs.join('\n  '));
}

const ROOT = path.resolve(__dirname, '..');
const EXE = process.env.PW_EXE || path.join(
  LOCAL, 'ms-playwright', 'chromium_headless_shell-1194', 'chrome-win', 'headless_shell.exe');

module.exports = { chromium: loadPlaywright().chromium, ROOT, EXE, LOCAL, WB_MODULES };
