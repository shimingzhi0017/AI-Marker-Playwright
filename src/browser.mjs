import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const allowedChannels = ['chromium', 'msedge', 'chrome'];

function channels() {
  const requested = process.env.AI_MARKER_BROWSER_CHANNEL;
  if (requested && !allowedChannels.includes(requested)) {
    throw Error('AI_MARKER_BROWSER_CHANNEL 只能设置为 chromium、msedge 或 chrome。');
  }
  return requested ? [requested] : process.platform === 'win32' ? ['chromium', 'msedge'] : ['chromium'];
}

async function launch(factory, options) {
  const candidates = channels();
  const failures = [];
  for (const channel of candidates) {
    try { return await factory({ ...options, channel }); }
    catch (error) {
      failures.push(`${channel}: ${error.message}`);
      // A locked profile or a browser that crashes after starting needs investigation.
      if (!/Executable doesn't exist|executable doesn't exist|distribution .*not found|spawn UNKNOWN|spawn ENOENT/i.test(error.message)) throw error;
    }
  }
  throw Error(`浏览器无法启动。请运行“安装依赖.cmd”；Windows 也可安装 Microsoft Edge 后重试。\n${failures.join('\n')}`);
}

export function launchBrowser(options = {}) {
  return launch(opts => chromium.launch(opts), options);
}

export function launchPersistentBrowser(profile, options = {}) {
  return launch(opts => chromium.launchPersistentContext(profile, opts), options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const browser = await launch(async options => {
      const instance = await chromium.launch(options);
      console.log(options.channel);
      return instance;
    }, { headless: true });
    await browser.close();
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
