import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, channel: 'chromium' });
try {
  const page = await browser.newPage();
  await page.setContent('<label>测试分数<input aria-label="测试分数" /></label><button>验证</button>');
  await page.getByRole('textbox', { name: '测试分数' }).fill('0');
  assert.equal(await page.getByRole('textbox', { name: '测试分数' }).inputValue(), '0');
  await page.getByRole('button', { name: '验证' }).click();
  console.log('验证通过：Chromium启动、控件定位、零分输入和按钮点击均正常。');
} finally {
  await browser.close();
}
