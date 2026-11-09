import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const baseUrl = process.env.MATRIX_URL || 'http://127.0.0.1:4173';
const errors = []; page.on('pageerror', error => errors.push(error.message));
const bar = id => page.locator(`.team-bar[data-id="${id}"]`);
const config = () => page.evaluate(() => {
  const library = JSON.parse(localStorage.getItem('wuwa-matrix-plan-library-v1'));
  return library.plans.find(plan => plan.id === library.activePlanId).config;
});
const ids = async () => (await config()).teams.map(team => team.id);
async function newPlan(name) {
  await page.locator('#new-plan').click(); await page.locator('#plan-name').fill(name);
  await page.locator('#confirm-plan').click();
  return page.locator('#plan-select').inputValue();
}
async function exported() {
  const event = page.waitForEvent('download'); await page.locator('#export-button').click();
  const file = await event; return JSON.parse(await readFile(await file.path(), 'utf8'));
}
async function selectTeam(id) { await page.locator(`.team-card[data-id="${id}"]`).click(); }
async function deleteTeam(id) { await selectTeam(id); await page.locator('#delete-team').click(); }
async function manualPending() {
  await page.locator('#add-team').click();
  for (const name of ['今汐', '长离', '守岸人']) await page.getByRole('button', { name, exact: true }).click();
  assert.equal(await page.locator('#dialog-team-score').inputValue(), '');
  const before = await config();
  // Incomplete scientific notation must remain invalid rather than becoming a pending score.
  await page.locator('#dialog-team-score').pressSequentially('1e');
  assert.match(await page.locator('#dialog-team-score').inputValue(), /^1e(?:309)?$/);
  await page.locator('#confirm-characters').click();
  assert.equal(await page.locator('#character-dialog').isVisible(), true);
  assert.match(await page.locator('#character-feedback').innerText(), /大于 0/);
  assert.deepEqual(await config(), before);
  await page.locator('#dialog-team-score').fill('');
  await page.locator('#confirm-characters').click();
  assert.equal(await page.locator('#character-dialog').isVisible(), false);
  return (await config()).teams.at(-1).id;
}
async function assertContiguous() {
  const state = await config();
  const result = await page.locator('.team-bar').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.id, width: parseFloat(node.style.width), left: parseFloat(node.style.left), score: Number(node.dataset.axisScore) })));
  assert.deepEqual(result.map(item => item.id), state.teams.map(team => team.id));
  let cursor = 0;
  for (let index = 0; index < result.length; index++) {
    const item = result[index], expected = state.teams[index].needsScore ? 5000 : state.teams[index].score;
    assert.equal(item.score, expected);
    assert.ok(Math.abs(item.width - expected * state.pixelsPerPoint) < .001);
    assert.ok(Math.abs(item.left - (112 + cursor * state.pixelsPerPoint)) < .001);
    cursor += expected;
  }
}
async function dragToFront(id) {
  const bounds = await bar(id).boundingBox();
  const viewport = await page.locator('#timeline-viewport').boundingBox();
  const x = bounds.x + Math.min(70, bounds.width / 2), y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(viewport.x + 115, y, { steps: 15 }); await page.mouse.up();
}
try {
  await mkdir('outputs', { recursive: true });
  await page.goto(baseUrl); await page.locator('.team-bar').first().waitFor();
  const planA = await newPlan('待填预览与删除A');
  const manual = await manualPending();
  assert.equal(await page.locator('.pending-score-bar').count(), 1);
  assert.equal(await bar(manual).getAttribute('data-axis-score'), '5000');
  assert.match(await bar(manual).innerText(), /待填.*5,000.*预览/);
  await page.locator('#quick-team').click();
  for (const name of ['相里要', '吟霖', '维里奈', '椿', '丹瑾', '白芷']) await page.getByRole('button', { name, exact: true }).click();
  await page.locator('#confirm-characters').click();
  assert.equal(await page.locator('.pending-score-bar').count(), 3);
  const initial = await exported(), [quick1, quick2] = initial.teams.slice(1).map(team => team.id);
  for (const team of initial.teams) {
    assert.equal(team.score, 0); assert.equal(team.needsScore, true);
    for (const field of ['axisScore', 'axisStartScore', 'positionIsPreview']) assert.ok(!(field in team));
  }
  await assertContiguous();
  await selectTeam(manual);
  const beforeInvalidSidebarScore = await config();
  await page.locator('#team-score').pressSequentially('1e');
  assert.equal(await page.locator('#team-score').inputValue(), '1e');
  await page.locator('#apply-team').click();
  assert.deepEqual(await config(), beforeInvalidSidebarScore);
  assert.equal(await page.locator('#team-score').inputValue(), '1e');
  await bar(manual).dblclick();
  const beforeInvalidEdit = await config();
  await page.locator('#dialog-team-score').pressSequentially('1e309');
  assert.match(await page.locator('#dialog-team-score').inputValue(), /^1e(?:309)?$/);
  await page.locator('#confirm-characters').click();
  assert.equal(await page.locator('#character-dialog').isVisible(), true);
  assert.match(await page.locator('#character-feedback').innerText(), /大于 0/);
  assert.deepEqual(await config(), beforeInvalidEdit);
  await page.locator('#dialog-team-score').fill('7000'); await page.locator('#confirm-characters').click();
  assert.equal(await bar(manual).getAttribute('data-axis-score'), '7000');
  assert.equal(await bar(manual).evaluate(node => node.classList.contains('pending-score-bar')), false);
  assert.equal((await exported()).teams.find(team => team.id === manual).needsScore, undefined);
  await bar(quick1).focus(); await page.keyboard.press('ArrowLeft');
  assert.deepEqual(await ids(), [quick1, manual, quick2]);
  await selectTeam(manual); assert.match(await page.locator('#start-location').innerText(), /预览/);
  await dragToFront(quick2);
  assert.deepEqual(await ids(), [quick2, quick1, manual]);
  await assertContiguous();
  assert.equal((await config()).teams.find(team => team.id === manual).score, 7000);
  await page.locator('#fit-teams').click();
  const fitted = await page.locator('#timeline-viewport').boundingBox();
  const last = await bar(manual).boundingBox(); assert.ok(last.x + last.width <= fitted.x + fitted.width + 1);
  await page.screenshot({ path: 'outputs/pending-team-preview.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#fit-teams').click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: 'outputs/pending-team-preview-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1050 });

  // A third deletion drops only the oldest recovery entry.
  for (const id of [quick2, quick1, manual]) await deleteTeam(id);
  assert.equal((await ids()).length, 0);
  await page.locator('#undo-team-delete').click(); assert.deepEqual(await ids(), [manual]);
  await page.locator('#undo-team-delete').click(); assert.deepEqual(await ids(), [quick1, manual]);
  assert.equal(await page.locator('#undo-team-delete').isDisabled(), true);
  assert.equal(await bar(quick1).getAttribute('data-axis-score'), '5000');
  assert.equal((await config()).teams.find(team => team.id === quick1).score, 0);
  assert.equal((await config()).teams.find(team => team.id === quick1).needsScore, true);
  await page.locator('#redo-team-delete').click(); assert.deepEqual(await ids(), [manual]);
  await page.locator('#redo-team-delete').click(); assert.equal((await ids()).length, 0);
  assert.equal(await page.locator('#redo-team-delete').isDisabled(), true);
  await page.locator('#undo-team-delete').click(); await page.locator('#undo-team-delete').click();

  // Restoring a deleted pending team must preserve subsequent edits to a surviving team.
  await deleteTeam(quick1); assert.equal(await page.locator('#redo-team-delete').isDisabled(), true);
  await selectTeam(manual); await page.locator('#team-score').fill('9500'); await page.locator('#apply-team').click();
  await page.locator('#undo-team-delete').click();
  assert.equal((await config()).teams.find(team => team.id === manual).score, 9500);
  assert.equal((await config()).teams.find(team => team.id === quick1).score, 0);
  await page.locator('#redo-team-delete').click();
  const snapshotA = await config();
  assert.deepEqual(snapshotA.teams.map(team => team.id), [manual]);
  const planB = await newPlan('待填预览与删除B');
  assert.equal(await page.locator('#undo-team-delete').isDisabled(), true);
  assert.equal(await page.locator('#redo-team-delete').isDisabled(), true);
  const memberB = await manualPending(); await deleteTeam(memberB);
  await page.locator('#undo-team-delete').click();
  assert.equal(await page.locator('#redo-team-delete').isEnabled(), true);
  await page.locator('#plan-select').selectOption(planA);
  assert.deepEqual((await config()).teams, snapshotA.teams);
  assert.equal(await page.locator('#undo-team-delete').isEnabled(), true);
  assert.equal(await page.locator('#redo-team-delete').isDisabled(), true);
  await page.locator('#undo-team-delete').click(); assert.deepEqual(await ids(), [quick1, manual]);
  assert.equal(await page.locator('#redo-team-delete').isEnabled(), true);
  await page.screenshot({ path: 'outputs/team-deletion-history.png' });
  await deleteTeam(quick1); assert.equal(await page.locator('#redo-team-delete').isDisabled(), true);
  await page.locator('#plan-select').selectOption(planB);
  assert.deepEqual(await ids(), [memberB]);
  assert.equal(await page.locator('#redo-team-delete').isEnabled(), true);
  await page.locator('#load-example').click();
  assert.equal(await page.locator('#undo-team-delete').isDisabled(), true);
  assert.equal(await page.locator('#redo-team-delete').isDisabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.editor-heading').scrollIntoViewIfNeeded();
  const mobileActions = await page.locator('.team-delete-actions').boundingBox();
  assert.ok(mobileActions.x >= 0 && mobileActions.x + mobileActions.width <= 390);
  await page.screenshot({ path: 'outputs/team-deletion-history-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1050 });

  // Preview-only spans can extend beyond selected Boss coverage while real data stays unscored.
  const characters = JSON.parse(await readFile('data/characters.json', 'utf8')).entries.filter(character => !character.download_failed && !character.name.startsWith('漂泊者')).slice(0, 21);
  const fixture = { ...initial, planName: '超出R1的待填预览', maxRound: 1, scoreMarker: null, teams: Array.from({ length: 7 }, (_, index) => ({ id: `pending-overflow-${index}`, name: `待填${index + 1}`, nameMode: 'custom', characterIds: characters.slice(index * 3, index * 3 + 3).map(character => character.id), score: 0, needsScore: true, startScore: 0, color: '#e6bd79' })) };
  const beforeImport = await page.locator('#plan-select').inputValue();
  await page.locator('#import-file').setInputFiles({ name: 'overflow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.waitForFunction(id => document.getElementById('plan-select').value !== id, beforeImport);
  assert.equal(await page.locator('#max-round').inputValue(), '1');
  assert.equal(await page.locator('.pending-score-bar').count(), 7);
  await bar('pending-overflow-6').focus(); assert.match(await page.locator('#end-location').innerText(), /预览.*超出|超出.*预览/);
  await assertContiguous();
  assert.ok((await exported()).teams.every(team => team.score === 0 && team.needsScore));
  assert.deepEqual(errors, []);
  console.log('PASS: invalid optional numbers rejected without changing drafts; 5000-point manual/quick pending previews, clean JSON, fill/reorder/fit/overflow; two-step deletion undo/redo, edited survivor and pending recovery, isolated plan histories, reset and mobile.');
} finally { await browser.close(); }
