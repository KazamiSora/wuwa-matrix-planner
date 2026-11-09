import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const source = JSON.parse(await readFile('data/characters.json', 'utf8')).entries;
const rovers = source.filter(character => character.name.startsWith('漂泊者'));
const template = JSON.parse(await readFile('config/demo.json', 'utf8'));
const icon = 'assets/characters/Rover_Combined_v1.png';
const current = () => page.evaluate(() => {
  const library = JSON.parse(localStorage.getItem('wuwa-matrix-plan-library-v1'));
  return library.plans.find(plan => plan.id === library.activePlanId).config;
});
try {
  await mkdir('outputs', { recursive: true });
  await page.goto(process.env.MATRIX_URL || 'http://127.0.0.1:4173');
  await page.locator('#quick-team').click();
  assert.equal(await page.locator('.character-choice').count(), source.filter(character => !character.download_failed).length - 4);
  await page.locator('#character-search').fill('pbz');
  assert.equal(await page.locator('.character-choice').count(), 4);
  assert.deepEqual(await page.locator('.character-choice').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), ['漂泊者·气动', '漂泊者·衍射', '漂泊者·导电', '漂泊者·湮灭']);
  await page.waitForFunction(() => [...document.querySelectorAll('.character-avatar img')].every(image => image.complete && image.naturalWidth > 0));
  assert.ok(await page.locator('.character-avatar img').evaluateAll(images => images.every(image => image.getAttribute('src') === 'assets/characters/Rover_Combined_v1.png')));
  await page.locator('#character-dialog').screenshot({ path: 'outputs/rover-merged-picker.png' });
  for (const name of ['导电', '气动', '衍射', '湮灭']) {
    await page.getByRole('button', { name, exact: true }).click();
    assert.equal(await page.locator('.character-choice').count(), 1);
  }
  await page.keyboard.press('Escape');
  for (const rover of rovers) {
    const imported = structuredClone(template);
    imported.teams = [imported.teams[0]];
    imported.teams[0].characterIds = [rover.id, ...template.teams[0].characterIds.slice(0, 2)];
    imported.teams[0].name = `旧阵容${rover.id}`; imported.teams[0].nameMode = 'custom';
    const oldPlanId = await page.locator('#plan-select').inputValue();
    await page.locator('#import-file').setInputFiles({ name: `legacy-${rover.id}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
    await page.waitForFunction(id => document.getElementById('plan-select').value !== id, oldPlanId);
    await page.locator('.character-slot').first().click();
    await page.locator('#character-search').fill(rover.id);
    const choice = page.getByRole('button', { name: rover.name, exact: true });
    assert.equal(await choice.count(), 1);
    assert.equal(await choice.getAttribute('aria-pressed'), 'true');
    assert.equal(await choice.locator('img').getAttribute('src'), icon);
    await page.locator('#confirm-characters').click();
    assert.deepEqual((await current()).teams[0].characterIds, imported.teams[0].characterIds, `legacy ID ${rover.id} must not be silently changed`);
    await page.reload(); await page.locator('.team-bar').first().waitFor();
    assert.deepEqual((await current()).teams[0].characterIds, imported.teams[0].characterIds);
    await page.locator('#quick-team').click(); await page.locator('#character-search').fill('pbz');
    assert.equal(await page.locator('.character-choice').count(), 4);
    assert.equal(await page.locator('.character-choice:disabled').count(), 4, 'all attributes still share stamina');
    await page.keyboard.press('Escape');
  }
  await page.locator('#new-plan').click(); await page.locator('#plan-name').fill('合并选项验证'); await page.locator('#confirm-plan').click();
  await page.locator('#quick-team').click(); await page.locator('#character-search').fill('pbzqd');
  await page.getByRole('button', { name: '漂泊者·气动', exact: true }).click();
  await page.locator('#character-search').fill('pbz');
  assert.equal(await page.locator('.character-choice:disabled').count(), 4);
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  console.log('PASS: four merged element options, exact approved icon, filters/pinyin/legacy-ID search, all eight legacy IDs preserved on edit/reload, shared stamina and same-team exclusion.');
} finally { await browser.close(); }
