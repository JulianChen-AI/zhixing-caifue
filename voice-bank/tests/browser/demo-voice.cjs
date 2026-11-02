// UI regression: device speech must never fall back to the first male voice.
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    for (const scenario of ['female-available', 'voices-load-later', 'male-only']) {
      const page = await browser.newPage();
      try {
        await page.addInitScript(scenario => {
          window.__spokenVoices = [];
          let loaded = scenario !== 'voices-load-later';
          let waiting = false;
          const voices = [{ name: 'Eddy (Chinese (China mainland))', lang: 'zh-CN' }];
          if (scenario !== 'male-only') voices.push({ name: 'Tingting', lang: 'zh-CN' });
          Object.defineProperty(speechSynthesis, 'getVoices', { value: () => {
            if (!loaded && !waiting) {
              waiting = true;
              setTimeout(() => { loaded = true; speechSynthesis.dispatchEvent(new Event('voiceschanged')); }, 100);
            }
            return loaded ? voices : [];
          } });
          Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: class { constructor(text) { this.text = text; } } });
          Object.defineProperty(speechSynthesis, 'speak', { value: utterance => window.__spokenVoices.push(utterance.voice?.name || 'system-default') });
        }, scenario);
        await page.goto(process.env.BANK_TEST_URL || 'http://127.0.0.1:5173/');
        const query = page.getByRole('button', { name: '看看我的余额', exact: true });
        await query.waitFor();
        await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent.includes('看看我的余额'))?.disabled);
        await query.click();
        if (scenario === 'male-only') {
          await page.getByText('未找到可用的系统中文女声', { exact: false }).waitFor();
          assert.deepEqual(await page.evaluate(() => window.__spokenVoices), []);
        } else {
          await page.waitForFunction(() => window.__spokenVoices.length > 0);
          assert.deepEqual(await page.evaluate(() => window.__spokenVoices), ['Tingting']);
        }
        console.log('PASS ' + scenario);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
