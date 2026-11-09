import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const data = JSON.parse(await readFile('data/characters.json', 'utf8')).entries;
const pinyin = JSON.parse(await readFile('data/character_search.json', 'utf8')).pinyin;
for (const character of data) assert.match(pinyin[character.name] || '', /^[a-z]+(?: [a-z]+)*$/, `missing pinyin: ${character.name}`);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const names = () => page.locator('.character-choice').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
try {
  await page.goto(process.env.MATRIX_URL || 'http://127.0.0.1:4173');
  await page.locator('#quick-team').click();
  for (const [query, expected] of [['jinxi', '今汐'], ['JX', '今汐'], ['jīn xī', '今汐'], ['shou an ren', '守岸人'], ['sar', '守岸人'], ['kelaita', '珂莱塔'], ['klt', '珂莱塔'], ['xiangliyao', '相里要'], ['xly', '相里要'], ['changli', '长离'], ['qiu yuan', '仇远'], ['luhesi', '陆·赫斯'], ['qianxiao', '千咲'], ['Shorekeeper', '守岸人'], ['今汐', '今汐']]) {
    await page.locator('#character-search').fill(query);
    assert.ok((await names()).includes(expected), `${query} should find ${expected}`);
  }
  await page.locator('#character-search').fill('jinxi');
  assert.ok(await page.getByRole('button', { name: '今汐', exact: true }).isDisabled(), 'search must not bypass stamina');
  await page.getByRole('button', { name: '冷凝', exact: true }).click();
  assert.deepEqual(await names(), []);
  await page.locator('#character-search').fill('klt');
  assert.deepEqual(await names(), ['珂莱塔']);
  await page.getByRole('button', { name: '珂莱塔', exact: true }).click();
  assert.match(await page.locator('#picked-count').innerText(), /1 人/);
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await page.locator('#character-search').fill('pbzqd');
  assert.deepEqual(await names(), ['漂泊者·气动']);
  await page.locator('#character-search').fill('not-a-character-xyz'); assert.deepEqual(await names(), []);
  await page.locator('#character-search').fill('');
  assert.equal((await names()).length, new Set(data.filter(character => !character.download_failed).map(character => character.name.startsWith('漂泊者') ? `rover-${character.element}` : character.id)).size);
  await page.keyboard.press('Escape');
  await page.locator('.character-slot').first().click();
  await page.locator('#character-search').fill('jx');
  assert.ok((await names()).includes('今汐'));
  assert.ok((await names()).includes('鉴心'));
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  console.log('PASS: full roster pinyin coverage, full/initial/tone/case/space search, Chinese/English, Rover forms, filters and stamina in quick/normal pickers.');
} finally { await browser.close(); }
