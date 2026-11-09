import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
async function choose(name) { await page.locator('#character-search').fill(name); await page.getByRole('button', { name, exact: true }).click(); }
try {
  await mkdir('outputs', { recursive: true });
  await page.goto(process.env.MATRIX_URL || 'http://127.0.0.1:4173');
  await page.locator('#quick-team').click();
  assert.deepEqual(await page.locator('.character-choice').evaluateAll(nodes => nodes.slice(0, 7).map(node => node.getAttribute('aria-label'))), ['守岸人','莫宁','穗穗','莉莉','维里奈','卜灵','白芷']);
  const lily = page.getByRole('button', { name: '莉莉', exact: true });
  await lily.locator('img').evaluate(image => image.decode());
  assert.equal(await lily.getAttribute('data-element'), '5');
  assert.match(await lily.locator('.availability').innerText(), /2\/2/);
  assert.match(await lily.locator('img').getAttribute('src'), /Lily_UserPortrait_v1.png$/);
  await page.locator('#character-dialog').screenshot({ path: 'outputs/lily-picker.png' });
  for (const query of ['Lily','lili','li li']) {
    await page.locator('#character-search').fill(query);
    assert.equal(await page.locator('.character-choice').count(), 1);
    assert.equal(await lily.count(), 1);
  }
  await page.getByRole('button', { name: '衍射', exact: true }).click(); assert.equal(await lily.count(), 1);
  await page.getByRole('button', { name: '热熔', exact: true }).click(); assert.equal(await lily.count(), 0);
  await page.getByRole('button', { name: '全部', exact: true }).click();
  for (const name of ['莉莉','心','锁暝','莉莉','散华','炽霞']) await choose(name);
  await page.locator('#character-search').fill('lili');
  assert.ok(await lily.isDisabled()); assert.match(await lily.locator('.availability').innerText(), /0\/2/);
  await page.locator('#confirm-characters').click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('wuwa-matrix-demo-v1')));
  assert.equal(stored.teams.filter(team => team.characterIds.includes('1512')).length, 2);
  await page.reload(); await page.locator('.team-card').first().waitFor();
  await page.locator('#stamina-season').selectOption('s2-phase4');
  assert.equal(await page.locator('#stamina-season').inputValue(), 's2-phase4');
  assert.equal(await page.locator('#stamina-conflict-panel').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('PASS: Lily portrait, Spectro filter, pinyin/English search, position after Suisui, two-team stamina limit and both seasons.');
} finally { await browser.close(); }
