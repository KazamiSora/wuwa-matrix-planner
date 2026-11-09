import { visibleWaves, locateScore, packTeams, reorderTeams, nearestTeamSlot, characterIdentity, validateConfig, staminaLimits, staminaConflicts, defaultTeamName, splitQuickTeams, axisTickStep, matrixInfo, bossScoreAtRemainingHp, layoutTeamPreviews, PENDING_TEAM_SCORE, createTeamDeletionHistory, deleteTeamWithHistory, undoTeamDeletion, redoTeamDeletion, MIN_ZOOM, MAX_ZOOM } from './score-axis.js';
import { normalizePlanLibrary, createPlanLibrary, addPlan, copyPlan, renamePlan, updatePlan, activatePlan, deletePlan } from './plan-library.js';
import { parseScoreInput } from './score-axis.js';
import { seasonDefinitions, getSeason, seasonStaminaRules, buildSeasonScores } from './season-config.js';

const $ = id => document.getElementById(id);
const LABEL = 112;
const COLORS = ['#e6bd79', '#79c8c6', '#a9a1e6', '#e39599', '#8fb78c', '#82b2db'];
const STORAGE = 'wuwa-matrix-demo-v1';
const LIBRARY_STORAGE = 'wuwa-matrix-plan-library-v1';
const nf = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
const fmt = value => nf.format(value);
const gapNumberFormat = new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: 15 });
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const [characterData, example, elementData, alternateExample, characterSearchData, characterOrder] = await Promise.all(['data/characters.json', 'config/demo.json', 'data/elements.json', 'config/alternate-demo.json', 'data/character_search.json', 'config/character_order.json'].map(async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法加载 ${url}`);
  return response.json();
}));
const characters = characterData.entries.filter(entry => !entry.download_failed).map(entry =>
  characterIdentity(entry) === '漂泊者' ? { ...entry, icon_file: 'assets/characters/Rover_Combined_v1.png' } : entry);
// Keep every original ID valid for saved plans; only the picker merges same-element forms.
const pickerChoiceGroups = new Map();
for (const entry of characters) {
  const key = characterIdentity(entry) === '漂泊者' ? `rover-${entry.element}` : entry.id;
  if (!pickerChoiceGroups.has(key)) pickerChoiceGroups.set(key, { ...entry, memberIds: [] });
  pickerChoiceGroups.get(key).memberIds.push(entry.id);
}
const pickerCharacters = [...pickerChoiceGroups.values()];
const DISABLED_CHARACTERS_STORAGE = 'wuwa-matrix-disabled-characters-v1';
const pickerChoiceIdByMember = new Map(pickerCharacters.flatMap(choice => choice.memberIds.map(id => [id, choice.id])));
const alwaysAvailableChoices = new Set(pickerCharacters.filter(choice => characterIdentity(choice) === '漂泊者' || ['炽霞', '秧秧', '白芷'].includes(choice.name)).map(choice => choice.id));
const disableableCharacters = pickerCharacters.filter(choice => !alwaysAvailableChoices.has(choice.id));
let disabledCharacters = new Set(), legacyDisabledCharacters = new Set(), disabledCharacterDraft = new Set(), disabledCharactersLoadError = '';
try {
  const stored = JSON.parse(localStorage.getItem(DISABLED_CHARACTERS_STORAGE) || '[]');
  if (!Array.isArray(stored) || stored.some(id => typeof id !== 'string')) throw new Error('格式无效');
  legacyDisabledCharacters = new Set(stored.map(id => pickerChoiceIdByMember.get(id)).filter(id => id && !alwaysAvailableChoices.has(id)));
} catch { disabledCharactersLoadError = '原禁用设置未能读取，保存后将以本次选择为准。'; }
const orderedNames = [...characterOrder.front, ...characterOrder.groups.flat()];
const pickerNameRank = new Map(orderedNames.map((name, index) => [name, index]));
const quickPickerCharacters = pickerCharacters.map((entry, index) => ({ entry, rank: characterIdentity(entry) === '漂泊者' ? 2000 + characterOrder.roverElements.indexOf(entry.element) : pickerNameRank.get(entry.name) ?? 1000 + index }))
  .sort((a, b) => a.rank - b.rank).map(item => item.entry);
function normalizeCharacterSearch(text) {
  return String(text).replace(/ü/gi, 'v').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[\s·:：'’_-]+/g, '');
}
const characterSearchKeys = new Map(characters.map(character => {
  const syllables = (characterSearchData.pinyin[character.name] || '').split(/\s+/).filter(Boolean);
  return [character.id, [character.name, character.name_en || '', character.id, syllables.join(''), syllables.map(part => part[0]).join('')].map(normalizeCharacterSearch).filter(Boolean)];
}));
const characterMap = new Map(characters.map(entry => [entry.id, entry]));
const characterIds = new Set(characterMap.keys());
const identityById = new Map(characters.map(entry => [entry.id, characterIdentity(entry)]));
const staminaRules = seasonStaminaRules();
const scoreTables = new Map(seasonDefinitions.map(season => [season.id, buildSeasonScores(season.id)]));
let scores = scoreTables.get(example.matrixSeason);
let bossMap = new Map();
function validatePlan(value, options = {}) {
  return validateConfig(value, characterIds, scoreTables.get(matrixInfo(value).id).records, identityById, staminaRules, options);
}
function restorePlan(value) {
  const restored = structuredClone(value);
  const records = scoreTables.get(matrixInfo(restored).id).records;
  const markerRemoved = Number.isFinite(restored.scoreMarker) && restored.scoreMarker > records.at(-1).cumulative_points_after;
  if (markerRemoved) restored.scoreMarker = null;
  if (Array.isArray(restored.teams) && Number.isInteger(restored.maxRound) && restored.maxRound >= 1) {
    const required = restored.teams.reduce((sum, team) => sum + team.score, 0);
    const sufficient = records.find(wave => wave.cumulative_points_after >= required);
    if (sufficient) restored.maxRound = Math.max(restored.maxRound, sufficient.round);
  }
  return { config: validatePlan(restored, { allowStaminaConflicts: true }), markerRemoved };
}
function syncSeasonRuntime() {
  const season = getSeason(state);
  disabledCharacters = new Set((state.disabledCharacterIds || []).map(id => pickerChoiceIdByMember.get(id)).filter(id => id && !alwaysAvailableChoices.has(id)));
  state.disabledCharacterIds = [...disabledCharacters];
  scores = scoreTables.get(season.id);
  bossMap = new Map(season.bosses.map(boss => [boss.name, boss]));
}
let state = structuredClone(example);
let repairedRosters = false;
let removedOutOfRangeMarker = false;
let restoreError = null;
let originalStoredPlan = null;
try {
  const saved = localStorage.getItem(STORAGE);
  if (saved) {
    originalStoredPlan = saved;
    try { localStorage.setItem(`${STORAGE}-restore-backup`, saved); } catch { /* The in-memory backup remains downloadable. */ }
    if (!localStorage.getItem(`${STORAGE}-before-connected-v2`)) localStorage.setItem(`${STORAGE}-before-connected-v2`, saved);
    const previous = JSON.parse(saved);
    for (const team of previous.teams || []) {
      const roster = [];
      const own = new Set();
      for (const id of team.characterIds || []) {
        const identity = identityById.get(id);
        if (!identity || own.has(identity)) { repairedRosters = true; continue; }
        own.add(identity); roster.push(id);
      }
      team.characterIds = roster;
      if (roster.length < 3) team.needsCharacters = true;
    }
    const restored = restorePlan(previous);
    state = restored.config; removedOutOfRangeMarker = restored.markerRemoved;
  }
} catch (error) { restoreError = error.message; }
state.teams = packTeams(state.teams);
let planLibrary = createPlanLibrary(state, '我的排布', 'plan-main');
let existingLibraryLoaded = false;
let libraryRecoveryLocked = false;
let recoveryBackupExported = false;
try {
  const savedLibrary = localStorage.getItem(LIBRARY_STORAGE);
  if (savedLibrary) {
    try { localStorage.setItem(`${LIBRARY_STORAGE}-restore-backup`, savedLibrary); } catch { }
    try {
      let libraryMarkerRemoved = false;
      planLibrary = normalizePlanLibrary(JSON.parse(savedLibrary), value => {
        const restored = restorePlan(value);
        libraryMarkerRemoved ||= restored.markerRemoved;
        return restored.config;
      });
      existingLibraryLoaded = true;
      state = structuredClone(planLibrary.plans.find(plan => plan.id === planLibrary.activePlanId).config);
      restoreError = null; repairedRosters = false; removedOutOfRangeMarker = libraryMarkerRemoved;
    } catch (error) {
      libraryRecoveryLocked = true;
      try {
        if (!localStorage.getItem(`${LIBRARY_STORAGE}-failed-restore-backup`)) localStorage.setItem(`${LIBRARY_STORAGE}-failed-restore-backup`, savedLibrary);
      } catch { }
      originalStoredPlan = savedLibrary;
      restoreError = `排布库未能载入：${error.message}`;
    }
  }
} catch (error) { restoreError = error.message; }
if (!existingLibraryLoaded && !planLibrary.plans.some(plan => plan.id === 'plan-demo-b') && planLibrary.plans.length < 100) {
  const previousActive = planLibrary.activePlanId;
  planLibrary = addPlan(planLibrary, '示例B · 椿丹白先手', validatePlan(alternateExample), 'plan-demo-b');
  planLibrary = activatePlan(planLibrary, previousActive);
}
let disabledIsolationNotice = '';
if (!restoreError && !libraryRecoveryLocked && !planLibrary.plans.some(plan => Object.hasOwn(plan.config, 'disabledCharacterIds'))) {
  try {
    const priorRaw = localStorage.getItem(`${LIBRARY_STORAGE}-before-character-disable`);
    let prior = null;
    try { if (priorRaw) prior = normalizePlanLibrary(JSON.parse(priorRaw)); } catch { /* Keep an invalid backup untouched. */ }
    const ownerId = prior && planLibrary.plans.some(plan => plan.id === prior.activePlanId) ? prior.activePlanId : planLibrary.activePlanId;
    const next = structuredClone(planLibrary);
    let recovered = 0;
    for (const plan of next.plans) {
      const original = prior?.plans.find(item => item.id === plan.id);
      if (plan.id !== ownerId && original && legacyDisabledCharacters.size) {
        const filtered = packTeams(original.config.teams.filter(team => !teamUsesDisabledCharacter(team, legacyDisabledCharacters)));
        const oldSettings = { ...original.config, teams: [] }, currentSettings = { ...plan.config, teams: [] };
        // Restore only an exact footprint of the old cross-plan deletion, never later user edits.
        if (filtered.length < original.config.teams.length && JSON.stringify(filtered) === JSON.stringify(plan.config.teams) && JSON.stringify(oldSettings) === JSON.stringify(currentSettings)) {
          try {
            const restored = restorePlan(original.config).config;
            recovered += restored.teams.length - plan.config.teams.length;
            plan.config = restored;
          } catch { /* Preserve the backup if it cannot be safely restored. */ }
        }
      }
      plan.config.disabledCharacterIds = plan.id === ownerId ? [...legacyDisabledCharacters] : [];
    }
    if (legacyDisabledCharacters.size || recovered) {
      if (!localStorage.getItem(`${LIBRARY_STORAGE}-before-disabled-isolation`)) localStorage.setItem(`${LIBRARY_STORAGE}-before-disabled-isolation`, JSON.stringify(planLibrary));
      disabledIsolationNotice = recovered ? `禁用设置已按方案独立保存，已从备份恢复其他方案中误删的 ${recovered} 支队伍。` : '旧禁用设置已归入原操作方案，其他方案不再共用。';
    }
    planLibrary = next;
    state = structuredClone(planLibrary.plans.find(plan => plan.id === planLibrary.activePlanId).config);
  } catch { disabledCharactersLoadError = '旧禁用设置未能迁移，原数据和备份已保留。'; }
}
let planAction = null;
let planStorageError = false;
let selectedId = state.teams[0]?.id;
let picked = [];
let toastTimer;
let dragging = false;
let pendingTeam = null;
let activeElement = 0;
let dialogAutoName = true;
let suppressDoubleClickUntil = 0;
let quickSession = null;
let pendingStaminaSeason = null;
let conflictTeamIds = new Set();
let deletingPlanId = null;
let lastMatrixContent = null;
const teamDeletionHistories = new Map();
syncSeasonRuntime();
const quickSequence = () => quickSession.history[quickSession.cursor];
const current = () => state.teams.find(team => team.id === selectedId);
const hasBloodline = () => matrixInfo(state).scoreReady;
const waves = () => hasBloodline() ? visibleWaves(scores.records, state.maxRound) : [];
const total = () => hasBloodline() ? waves().at(-1).cumulative_points_after : Math.max(10000, state.scoreMarker || 0, state.teams.reduce((sum, team) => sum + team.score, 0));
const axisTeams = () => layoutTeamPreviews(state.teams);
const axisEntry = team => axisTeams().find(item => item.id === team.id);
const axisTeamPoints = () => axisTeams().reduce((sum, team) => sum + team.axisScore, 0);
const axisExtent = () => Math.max(total(), axisTeamPoints());

function currentTeamDeletionHistory() {
  return teamDeletionHistories.get(planLibrary.activePlanId) || createTeamDeletionHistory();
}

function renderTeamDeletionControls() {
  const history = currentTeamDeletionHistory();
  $('undo-team-delete').disabled = history.undo.length === 0;
  $('redo-team-delete').disabled = history.redo.length === 0;
  $('undo-team-delete').title = `撤回队伍删除（可撤回 ${history.undo.length} 次，最多 2 次）`;
  $('redo-team-delete').title = `重新执行已撤回的删除（可恢复 ${history.redo.length} 次）`;
}

function changeTeamDeletion(action) {
  const history = currentTeamDeletionHistory();
  const record = (action === 'undo' ? history.undo : history.redo).at(-1);
  if (action !== 'delete' && !record) return;
  const team = action === 'delete' ? current() : record.team;
  if (!team) return;
  try {
    const result = action === 'undo' ? undoTeamDeletion(state.teams, history) : action === 'redo' ? redoTeamDeletion(state.teams, history) : deleteTeamWithHistory(state.teams, team.id, history);
    const candidate = { ...structuredClone(state), teams: result.teams };
    const actualTotal = candidate.teams.reduce((sum, item) => sum + item.score, 0);
    const required = scores.records.find(wave => wave.cumulative_points_after >= actualTotal);
    if (hasBloodline() && !required) throw new Error('队伍总分超出 R15 范围，请先调整已有队伍分数。');
    if (required) candidate.maxRound = Math.max(candidate.maxRound, required.round);
    state = validatePlan(candidate, { allowStaminaConflicts: true });
    teamDeletionHistories.set(planLibrary.activePlanId, result.history);
    selectedId = action === 'undo' ? team.id : state.teams.some(item => item.id === selectedId) ? selectedId : state.teams[0]?.id;
    persist(); renderAll();
    toast(action === 'undo' ? `已撤回删除：${team.name}` : action === 'redo' ? `已恢复删除操作：${team.name}` : `已删除 ${team.name}，可撤回最近 2 次队伍删除。`);
  } catch (error) {
    toast(`操作未完成：${error.message} 队伍与撤回记录已保留。`);
  }
}

function normalizeTeamNames() {
  const formerExamples = { 'team-1': '今汐队', 'team-2': '相里要队', 'team-3': '椿队' };
  for (const team of state.teams) {
    const generated = defaultTeamName(team.characterIds, characterMap);
    if (!team.nameMode) team.nameMode = team.name === generated || team.name === formerExamples[team.id] || /^队伍\s*\d+$/.test(team.name) ? 'auto' : 'custom';
    if (team.nameMode === 'auto' && generated) team.name = generated;
  }
}

function toast(message) {
  const dialog = $('character-dialog');
  (dialog.open ? dialog : document.body).append($('toast'));
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3500);
}

function persist() {
  state.disabledCharacterIds = [...new Set((state.disabledCharacterIds || []).map(id => pickerChoiceIdByMember.get(id)).filter(id => id && !alwaysAvailableChoices.has(id)))];
  normalizeTeamNames();
  planLibrary = updatePlan(planLibrary, planLibrary.activePlanId, state);
  if (libraryRecoveryLocked) { planStorageError = true; updateSaveStatus(); return; }
  try {
    localStorage.setItem(LIBRARY_STORAGE, JSON.stringify(planLibrary));
    planStorageError = false;
    try { localStorage.setItem(STORAGE, JSON.stringify(state)); } catch { /* Legacy mirror is optional; the plan library is authoritative. */ }
  } catch {
    planStorageError = true;
  }
  updateSaveStatus();
}

function updateSaveStatus() {
  $('save-state').textContent = libraryRecoveryLocked ? '原排布库已保留，请先导出备份' : planStorageError ? '请导出 JSON 保存配置' : '配置自动保存在此浏览器';
  $('plan-save-status').textContent = libraryRecoveryLocked ? '恢复待处理，当前修改尚未保存' : planStorageError ? '保存失败，请导出 JSON' : `${planLibrary.plans.length} 套排布 · 自动保存`;
}

function activePlan() {
  return planLibrary.plans.find(plan => plan.id === planLibrary.activePlanId);
}

function uniquePlanName(base) {
  const stem = base.trim().slice(0, 40) || '排布';
  let name = stem, index = 2;
  while (planLibrary.plans.some(plan => plan.name === name)) {
    const suffix = `（${index++}）`;
    name = `${stem.slice(0, 40 - suffix.length)}${suffix}`;
  }
  return name;
}

function renderPlanControls() {
  $('plan-select').replaceChildren();
  for (const plan of planLibrary.plans) {
    const option = element('option', '', plan.name); option.value = plan.id;
    $('plan-select').append(option);
  }
  $('plan-select').value = planLibrary.activePlanId;
  updateSaveStatus();
}

function enterActivePlan() {
  state = structuredClone(activePlan().config);
  syncSeasonRuntime();
  delete state.planName;
  selectedId = state.teams[0]?.id;
  pendingStaminaSeason = null; pendingTeam = null; quickSession = null;
  $('disabled-removal-notice').hidden = true;
  if (!libraryRecoveryLocked) restoreError = null;
  renderRestoreWarning(); persist(); renderAll(); $('timeline-viewport').scrollLeft = 0;
}

function openPlanDialog(action) {
  if (!restoreError) persist();
  planAction = action;
  $('plan-dialog-title').textContent = action === 'new' ? '新建排布' : action === 'copy' ? '复制排布' : '重命名排布';
  $('plan-name').value = action === 'new' ? uniquePlanName(`排布 ${planLibrary.plans.length + 1}`) : action === 'copy' ? uniquePlanName(`${activePlan().name} 副本`) : activePlan().name;
  $('plan-season-field').hidden = action !== 'new';
  $('plan-season').value = matrixInfo(state).id; renderNewPlanSeasonNote();
  $('plan-dialog-error').textContent = '';
  $('plan-dialog').showModal(); $('plan-name').select();
}

function configForSharing() {
  const matrix = matrixInfo(state);
  return { ...structuredClone(state), matrixSeason: matrix.id, matrixVersion: matrix.name, planName: activePlan().name };
}

function downloadPlanConfig(config, name) {
  const matrix = matrixInfo(config);
  const text = JSON.stringify({ ...structuredClone(config), matrixSeason: matrix.id, matrixVersion: matrix.name, planName: name }, null, 2) + '\n';
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = element('a'); link.href = url; link.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openDeletePlan() {
  if (!restoreError) persist();
  deletingPlanId = planLibrary.activePlanId;
  $('delete-plan-summary').textContent = `即将删除“${activePlan().name}”，其中包含 ${activePlan().config.teams.length} 支队伍。${planLibrary.plans.length === 1 ? '删除后会新建一套空白排布。' : ''}`;
  $('delete-plan-backup-note').textContent = '可以先导出 JSON 备份，再确认永久删除。';
  $('delete-plan-error').textContent = libraryRecoveryLocked ? '请先完成原排布库的备份与恢复处理。' : '';
  $('confirm-delete-plan').textContent = '永久删除';
  $('confirm-delete-plan').disabled = libraryRecoveryLocked;
  $('export-delete-plan').disabled = libraryRecoveryLocked;
  $('delete-plan-dialog').showModal(); $('cancel-delete-plan').focus();
}

function confirmDeletePlan() {
  if (!deletingPlanId || libraryRecoveryLocked) return;
  try {
    const fallback = { ...structuredClone(state), teams: [], scoreMarker: null };
    const next = deletePlan(planLibrary, deletingPlanId, fallback);
    // Commit the deletion before changing the visible selection; failure leaves the plan intact.
    localStorage.setItem(LIBRARY_STORAGE, JSON.stringify(next));
    teamDeletionHistories.delete(deletingPlanId);
    planLibrary = next; deletingPlanId = null;
    $('delete-plan-dialog').close(); enterActivePlan(); toast('排布方案已永久删除。');
  } catch (error) { $('delete-plan-error').textContent = `删除未完成，方案仍保留：${error.message}`; }
}

function renderNewPlanSeasonNote() {
  const season = getSeason($('plan-season').value);
  $('plan-season-note').textContent = `${season.name} · R1—R${season.maxRound}。${season.scoring.basis}`;
}

function renderMatrixDetails() {
  const matrix = matrixInfo(state);
  const season = getSeason(state);
  document.querySelector('.stage-label').textContent = `${matrix.name} · ${season.modeName}`;
  $('matrix-stamina-note').textContent = `体力规则独立选择；矩阵数据对应 ${matrix.name}。`;
  $('matrix-data-note').textContent = `${matrix.name}：${season.scoring.basis} 剩余分数包含未获得的击杀奖励。双击队伍色条可编辑。`;
  $('max-round').disabled = !matrix.scoreReady; $('fit-bloodline').disabled = !matrix.scoreReady;
  if (lastMatrixContent === matrix.towerId) return;
  lastMatrixContent = matrix.towerId;
  const content = season;
  $('matrix-details-title').textContent = `${matrix.name} · 矩阵增益`;
  $('matrix-details-source').href = content.source;
  $('circuit-buffs').open = false;
  $('matrix-circuits').replaceChildren();
  for (const circuit of content.circuits) {
    const card = element('article', 'matrix-circuit');
    const heading = element('div', 'matrix-circuit-heading');
    if (circuit.icon_file) {
      const icon = element('img', 'matrix-circuit-icon');
      icon.src = circuit.icon_file; icon.alt = ''; icon.loading = 'lazy'; icon.draggable = false;
      heading.append(icon);
    }
    heading.append(element('h4', '', circuit.name));
    card.append(heading, element('p', '', circuit.description)); $('matrix-circuits').append(card);
  }
  $('matrix-enhancements').replaceChildren();
  $('matrix-stamina-enhancements').replaceChildren();
  $('other-enhancements').open = false;
  const enhancements = content.characters.map(character => ({
    ...character,
    enhancements: character.enhancements.filter(effect => effect.kind !== 'stamina-bonus' && !/^角色拥有额外疲劳值/.test(effect.description)),
  })).filter(character => character.enhancements.length > 0);
  for (const id of season.stamina.bonusCharacterIds) {
    let character = enhancements.find(item => item.id === id);
    if (!character) { character = { ...characterMap.get(id), enhancements: [] }; enhancements.push(character); }
    character.enhancements.push({ kind: 'stamina-bonus', description: `角色拥有额外${season.stamina.extraStamina}点体力（${season.name}限定）。` });
  }
  for (const character of enhancements) {
    const card = element('article', 'matrix-character-enhancement');
    card.dataset.characterId = character.id;
    const heading = element('div', 'enhancement-character');
    heading.append(portrait(character.id), element('h4', '', character.name)); card.append(heading);
    for (const effect of character.enhancements) card.append(element('p', effect.kind === 'stamina-bonus' ? 'stamina-bonus-description' : '', effect.description));
    const persistent = season.stamina.bonusCharacterIds.includes(character.id);
    $(persistent ? 'matrix-stamina-enhancements' : 'matrix-enhancements').append(card);
  }
  $('other-enhancements-count').textContent = `（${$('matrix-enhancements').children.length}）`;
}

function renderBossPropertiesText(container, boss) {
  container.replaceChildren();
  const properties = boss.specialProperties || [];
  if (!properties.length) container.append(element('p', 'muted', '暂无特殊性质说明。'));
  else for (const description of properties) container.append(element('p', '', description));
}

let bossSeasonFilter = 'all';
const bossKeywordFilters = new Set();
const bossPropertyKeywords = ['同奏', '效应', '声骸', '护盾', '谐度'];
function renderBossPropertyFilters() {
  $('boss-season-filters').replaceChildren(element('span', 'muted', '赛季'));
  for (const [value, label] of [['all', '全部'], ...seasonDefinitions.map(season => [`${season.season}-${season.stage}`, `${season.season}-${season.stage}`])]) {
    const button = element('button', 'boss-filter-button', label); button.type = 'button';
    button.setAttribute('aria-pressed', String(bossSeasonFilter === value));
    button.addEventListener('click', () => { bossSeasonFilter = value; renderBossPropertyFilters(); renderBossPropertiesCatalog(); });
    $('boss-season-filters').append(button);
  }
  $('boss-keyword-filters').replaceChildren(element('span', 'muted', '关键词'));
  for (const word of ['全部', ...bossPropertyKeywords]) {
    const active = word === '全部' ? !bossKeywordFilters.size : bossKeywordFilters.has(word);
    const button = element('button', 'boss-filter-button', word); button.type = 'button'; button.setAttribute('aria-pressed', String(active));
    button.addEventListener('click', () => {
      if (word === '全部') bossKeywordFilters.clear();
      else if (bossKeywordFilters.has(word)) bossKeywordFilters.delete(word); else bossKeywordFilters.add(word);
      renderBossPropertyFilters(); renderBossPropertiesCatalog();
    });
    $('boss-keyword-filters').append(button);
  }
  $('boss-keyword-filters').append(element('small', 'muted', '可多选，匹配任一关键词'));
}
function renderBossPropertiesCatalog() {
  const catalog = new Map();
  for (const season of seasonDefinitions) {
    for (const boss of season.bosses) {
      if (!boss.specialProperties?.some(text => text.trim())) continue;
      const key = `${boss.id}:${JSON.stringify(boss.specialProperties || [])}`;
      if (!catalog.has(key)) catalog.set(key, { boss, seasons: [] });
      catalog.get(key).seasons.push(`${season.season}-${season.stage}`);
    }
  }
  const entries = [...catalog.values()];
  const query = $('boss-properties-search').value.trim().toLowerCase();
  const matches = entries.filter(({ boss, seasons }) => (bossSeasonFilter === 'all' || seasons.includes(bossSeasonFilter)) &&
    (!bossKeywordFilters.size || [...bossKeywordFilters].some(word => boss.specialProperties.some(text => text.includes(word)))) &&
    [boss.name, boss.alias, ...seasons, ...boss.specialProperties].join(' ').toLowerCase().includes(query));
  $('boss-properties-count').textContent = `（${entries.length}）`;
  $('boss-properties-results').textContent = `${matches.length} / ${entries.length} 只 Boss`;
  $('boss-properties-list').replaceChildren();
  for (const { boss, seasons } of matches) {
    const card = element('article', 'boss-property-card');
    card.dataset.bossId = boss.id;
    const heading = element('div', 'boss-property-heading');
    const image = element('img'); image.src = boss.icon_file; image.alt = ''; image.loading = 'lazy';
    const title = element('div');
    title.append(element('h4', '', boss.name), element('span', 'muted', seasons.join(' · ')));
    heading.append(image, title);
    const copy = element('div', 'boss-properties-copy');
    renderBossPropertiesText(copy, boss); card.append(heading, copy);
    $('boss-properties-list').append(card);
  }
  if (!matches.length) $('boss-properties-list').append(element('p', 'boss-property-empty muted', '没有找到匹配的 Boss，试试名称、简称或性质关键词。'));
}

let inspectedBossWave = null;
function renderBossScoreCalculation() {
  if (!inspectedBossWave) return;
  const input = $('boss-hp-percent');
  const text = input.value.trim();
  const percentage = Number(text);
  const valid = text !== '' && Number.isFinite(percentage) && percentage >= 0 && percentage <= 100;
  input.setAttribute('aria-invalid', String(!valid));
  $('boss-percent-error').textContent = valid ? '' : '请输入 0—100 之间的剩余血量百分比。';
  if (!valid) {
    $('boss-earned-points').textContent = '—'; $('boss-remaining-points').textContent = '—';
    return;
  }
  const result = bossScoreAtRemainingHp(inspectedBossWave, percentage);
  $('boss-earned-points').textContent = `${fmt(result.earnedPoints)} 分`;
  $('boss-remaining-points').textContent = `${fmt(result.remainingPoints)} 分`;
  $('boss-calculation-note').textContent = inspectedBossWave.kill_bonus
    ? `按本只 Boss 从满血计算；剩余 0% 时获得 ${fmt(inspectedBossWave.kill_bonus)} 分击杀奖励。`
    : '按本只 Boss 从满血计算，不包含前面 Boss 的累计分数。';
}

function openBossDetails(wave) {
  hideTeamTooltip();
  inspectedBossWave = wave;
  const season = getSeason(state), boss = bossMap.get(wave.name);
  $('boss-dialog-title').textContent = `R${wave.round} ${wave.name}`;
  $('boss-dialog-season').textContent = season.name;
  $('boss-dialog-portrait').src = boss.icon_file;
  $('boss-total-points').textContent = `${fmt(wave.full_kill_points)} 分`;
  $('boss-total-points-label').textContent = `总分数${wave.provisional ? '（暂定）' : wave.estimated ? '（推算）' : ''}`;
  $('boss-total-hp-label').textContent = `总血量${wave.hp_status === 'provisional' ? '（暂定）' : wave.hp_status === 'inferred' ? '（推算）' : ''}`;
  $('boss-total-hp').textContent = wave.max_hp == null ? '待确认' : fmt(wave.max_hp);
  const notes = [];
  if (['inferred', 'provisional'].includes(wave.hp_status) || wave.max_hp == null || wave.source_label === '同位次类比') notes.push(season.scoring.hpBasis || '本轮总血量尚未实测。');
  if (wave.provisional) notes.push(season.scoring.basis);
  if (wave.points_per_damage != null) {
    const coefficient = wave.points_per_damage.toLocaleString('zh-CN', { maximumFractionDigits: 12 });
    notes.push(`计分：每 1 伤害 = ${coefficient} 分${wave.kill_bonus ? `，击杀额外 ${fmt(wave.kill_bonus)} 分` : ''}。`);
  }
  if (wave.score_rounding === 'floor-per-boss') notes.push('整只 Boss 的分数向下取整后，再累计相加。');
  $('boss-data-basis').textContent = notes.join(' ');
  $('boss-data-basis').hidden = notes.length === 0;
  $('boss-resistances').replaceChildren();
  const resistances = boss.resistances;
  for (const attribute of elementData.entries) {
    const item = element('div', 'boss-resistance');
    item.classList.toggle('high-resistance', resistances?.highElement === attribute.id);
    const icon = element('img'); icon.src = attribute.icon_file; icon.alt = ''; icon.width = 28; icon.height = 28;
    const value = resistances?.values?.[attribute.id];
    const amount = element('strong', value == null ? 'muted' : '', value == null ? '待确认' : `${fmt(value)}%`);
    item.append(icon, element('span', '', attribute.name), amount);
    $('boss-resistances').append(item);
  }
  $('boss-resistance-note').textContent = resistances?.note ?? '本模式抗性百分比待确认。';
  $('boss-resistance-note').hidden = !$('boss-resistance-note').textContent;
  const source = $('boss-resistance-source');
  source.href = resistances?.source || season.source;
  renderBossPropertiesText($('boss-special-properties-copy'), boss);
  $('boss-hp-percent').value = '100';
  renderBossScoreCalculation();
  $('boss-dialog').showModal();
}

async function copyPlanConfig() {
  const text = JSON.stringify(configForSharing(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    toast(`已复制“${activePlan().name}”的 JSON 配置。`);
  } catch {
    $('copy-config-text').value = text; $('copy-config-dialog').showModal();
    $('copy-config-text').select();
  }
}

function characterUsage(excludeTeamId) {
  const used = new Map();
  for (const team of state.teams) {
    if (team.id === excludeTeamId) continue;
    for (const id of team.characterIds) {
      const identity = identityById.get(id);
      if (!used.has(identity)) used.set(identity, []);
      used.get(identity).push(team.name);
    }
  }
  return used;
}

function renderStaminaSeason() {
  const selected = staminaRules.seasons.find(season => season.id === state.staminaSeason);
  $('stamina-season').value = selected.id;
  $('stamina-season').title = `${selected.name}（仅体力规则）`;
  const bonusNames = selected.bonusCharacterIds.map(id => characterMap.get(id).name).join('、');
  const baseEntries = Object.entries(selected.baseStamina).filter(([, value]) => value > selected.defaultStamina);
  $('stamina-season-note').textContent = `${bonusNames} 临时 +${selected.extraStamina} 体；${baseEntries.length} 名多体力角色`;
  $('stamina-season-note').title = `${baseEntries.map(([id, count]) => `${characterMap.get(id).name} ${count}体`).join('、')}。切换此项仅改变体力规则，矩阵期数为${matrixInfo(state).name}。`;
}

function renderStaminaConflict() {
  const panel = $('stamina-conflict-panel');
  const currentConflicts = staminaConflicts(state.teams, staminaRules, state.staminaSeason, identityById);
  const targetId = pendingStaminaSeason || (currentConflicts.length ? state.staminaSeason : null);
  panel.replaceChildren(); conflictTeamIds = new Set();
  panel.hidden = !targetId;
  if (!targetId) return;
  const target = staminaRules.seasons.find(item => item.id === targetId);
  const active = staminaRules.seasons.find(item => item.id === state.staminaSeason);
  const conflicts = staminaConflicts(state.teams, staminaRules, targetId, identityById);
  conflicts.forEach(item => item.teams.forEach(team => conflictTeamIds.add(team.id)));
  panel.classList.toggle('resolved', conflicts.length === 0);
  const title = conflicts.length ? pendingStaminaSeason ? '体力冲突，尚未切换版本' : '当前排布存在体力冲突' : '冲突已解决，可以切换体力版本';
  panel.append(element('h2', '', title));
  panel.append(element('p', 'conflict-description', pendingStaminaSeason ? `目标：${target.name}。当前仍使用${active.name}，队伍与分数已保留。` : `${active.name}：已保留原阵容与分数，请调整以下队伍。`));
  const list = element('div', 'conflict-list');
  for (const item of conflicts) {
    const row = element('div', 'conflict-row');
    const identity = element('div', 'conflict-character');
    identity.append(portrait(item.characterId), element('strong', '', characterMap.get(item.characterId).name));
    const summary = element('span', 'conflict-summary', `已用 ${item.used} 次 / 上限 ${item.limit} 次，超出 ${item.excess} 队`);
    const teams = element('div', 'conflict-team-links');
    for (const affected of item.teams) {
      const button = element('button', '', `编辑第 ${affected.number} 队 · ${affected.name}`);
      button.type = 'button'; button.dataset.teamId = affected.id;
      button.addEventListener('click', () => editAxisTeam(affected.id));
      teams.append(button);
    }
    row.append(identity, summary, teams); list.append(row);
  }
  panel.append(list);
  if (pendingStaminaSeason) {
    const actions = element('div', 'conflict-actions');
    const apply = element('button', 'primary', '应用该体力版本'); apply.id = 'apply-stamina-season';
    apply.disabled = conflicts.length > 0;
    apply.addEventListener('click', () => tryChangeStaminaSeason(targetId));
    const cancel = element('button', 'quiet', '取消切换'); cancel.id = 'cancel-stamina-change';
    cancel.addEventListener('click', () => { pendingStaminaSeason = null; renderAll(); });
    actions.append(apply, cancel); panel.append(actions);
  }
}

function tryChangeStaminaSeason(id) {
  const conflicts = staminaConflicts(state.teams, staminaRules, id, identityById);
  if (conflicts.length) {
    pendingStaminaSeason = id; $('stamina-season').value = state.staminaSeason;
    renderAll();
    toast(`${conflicts.map(item => characterMap.get(item.characterId).name).join('、')}体力不足，具体队伍见冲突清单。`);
    return;
  }
  state.staminaSeason = id; pendingStaminaSeason = null; persist(); renderAll();
}

function renderRestoreWarning() {
  const panel = $('restore-warning');
  panel.hidden = !restoreError; panel.replaceChildren();
  if (!restoreError) return;
  panel.append(element('h2', '', '原排布未能载入，原始数据已保留'));
  panel.append(element('p', '', libraryRecoveryLocked ? `原因：${restoreError}。原排布库仍保留，当前修改只在本次会话有效。请先导出原始备份，再决定是否以当前排布重建。` : `原因：${restoreError}。当前显示可用排布，启动过程没有覆盖原始存储。可先导出备份再检查配置。`));
  if (originalStoredPlan) {
    const download = element('button', '', libraryRecoveryLocked ? '导出原始排布库备份' : '导出原始排布备份'); download.id = 'download-restore-backup';
    download.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([originalStoredPlan], { type: 'application/json' }));
      const link = element('a'); link.href = url; link.download = '原始排布备份.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      recoveryBackupExported = true; renderRestoreWarning();
    });
    panel.append(download);
  }
  if (libraryRecoveryLocked) {
    const rebuild = element('button', '', '以当前排布重建排布库'); rebuild.id = 'rebuild-plan-library';
    rebuild.disabled = !recoveryBackupExported;
    rebuild.addEventListener('click', () => {
      libraryRecoveryLocked = false; persist();
      if (planStorageError) libraryRecoveryLocked = true;
      else restoreError = null;
      renderRestoreWarning(); renderPlanControls();
    });
    panel.append(rebuild);
  }
}

function portrait(id, className = 'portrait') {
  const entry = characterMap.get(id);
  const image = element('img', className);
  image.src = entry.icon_file;
  image.alt = entry.name;
  image.title = entry.name;
  image.draggable = false;
  return image;
}

function renderList() {
  renderTeamDeletionControls();
  $('team-list').replaceChildren();
  $('team-count').textContent = state.teams.length;
  for (const team of state.teams) {
    const button = element('button', `team-card${team.id === selectedId ? ' active' : ''}`);
    button.style.setProperty('--team-color', team.color);
    button.dataset.id = team.id;
    button.classList.toggle('stamina-conflicted', conflictTeamIds.has(team.id));
    button.setAttribute('aria-label', `选择${team.name}`);
    const main = element('div', 'team-card-main');
    main.append(element('div', 'team-card-title', team.name + (team.needsCharacters ? ' · 待补选' : '')));
    const images = element('div', 'tiny-portraits');
    team.characterIds.forEach(id => images.append(portrait(id)));
    main.append(images);
    button.append(main, element('span', 'team-card-score', team.needsScore ? '待填分数' : `${fmt(team.score)} 分`));
    button.addEventListener('pointerdown', event => startSidebarDrag(event, team, button));
    button.addEventListener('click', () => { if (Date.now() < suppressSidebarClickUntil) return; selectedId = team.id; renderList(); renderEditor(); renderPositions(); });
    $('team-list').append(button);
  }
  if (!state.teams.length) $('team-list').append(element('div', 'empty-list', '新建一支队伍开始排布'));
}

let suppressSidebarClickUntil = 0;
function startSidebarDrag(event, team, card) {
  if (event.button !== 0) return;
  const list = $('team-list');
  const nodes = [...list.querySelectorAll('.team-card')];
  const bounds = list.getBoundingClientRect();
  const entries = nodes.map(node => ({ id: node.dataset.id, node, top: node.getBoundingClientRect().top - bounds.top + list.scrollTop, height: node.getBoundingClientRect().height }));
  const original = entries.find(item => item.id === team.id);
  const gap = parseFloat(getComputedStyle(list).gap) || 0;
  const initialY = event.clientY, initialScroll = list.scrollTop;
  let target = state.teams.findIndex(item => item.id === team.id), moved = false, finished = false;
  card.setPointerCapture(event.pointerId);
  const move = pointer => {
    if (!moved && Math.abs(pointer.clientY - initialY) < 5) return;
    if (!moved) {
      moved = true; dragging = true; selectedId = team.id; hideTeamTooltip();
      renderEditor(); renderPositions();
      list.classList.add('sidebar-drag-preview'); card.classList.add('sidebar-is-dragging');
    }
    const visible = list.getBoundingClientRect();
    if (pointer.clientY < visible.top + 24) list.scrollTop -= 14;
    if (pointer.clientY > visible.bottom - 24) list.scrollTop += 14;
    const desired = original.top + pointer.clientY - initialY + list.scrollTop - initialScroll;
    const others = entries.filter(item => item.id !== team.id);
    const slots = [entries[0].top];
    for (const item of others) slots.push(slots.at(-1) + item.height + gap);
    target = slots.reduce((best, value, index) => Math.abs(value - desired) < Math.abs(slots[best] - desired) ? index : best, 0);
    const order = [...others]; order.splice(target, 0, original);
    let top = entries[0].top;
    for (const item of order) { item.node.style.transform = `translateY(${top - item.top}px)`; top += item.height + gap; }
    const display = axisTeams().map(item => ({ ...item, score: item.axisScore }));
    const preview = reorderTeams(display, team.id, target);
    const lane = document.querySelector('.team-lane'); lane.classList.add('drag-preview-active');
    for (const item of preview) {
      const bar = [...lane.querySelectorAll('.team-bar')].find(node => node.dataset.id === item.id);
      bar.style.left = `${LABEL + item.startScore * state.pixelsPerPoint}px`;
      bar.classList.toggle('is-reordering', item.id === team.id);
    }
    const selected = preview.find(item => item.id === team.id);
    for (const guide of document.querySelectorAll('.axis-guide')) {
      guide.classList.add('drag-preview-guide');
      guide.style.left = `${LABEL + (selected.startScore + (guide.classList.contains('end') ? selected.score : 0)) * state.pixelsPerPoint}px`;
    }
    $('coverage-note').textContent = `松开后排为第 ${target + 1} 队 · 按 Esc 取消`;
  };
  const finish = pointer => {
    if (finished) return;
    finished = true; dragging = false;
    card.removeEventListener('pointermove', move); card.removeEventListener('pointerup', finish); card.removeEventListener('pointercancel', cancel); card.removeEventListener('lostpointercapture', cancel);
    document.removeEventListener('keydown', escape, true); window.removeEventListener('resize', cancel);
    if (card.hasPointerCapture(event.pointerId)) card.releasePointerCapture(event.pointerId);
    if (!moved) return;
    suppressSidebarClickUntil = Date.now() + 250;
    const beforeList = new Map(nodes.map(node => [node.dataset.id, node.getBoundingClientRect().top]));
    const beforeAxis = new Map([...document.querySelectorAll('.team-bar')].map(node => [node.dataset.id, node.getBoundingClientRect().left]));
    const scroll = list.scrollTop;
    list.classList.remove('sidebar-drag-preview');
    if (pointer.type !== 'pointercancel') { state.teams = reorderTeams(state.teams, team.id, target); persist(); }
    renderAll(); list.scrollTop = scroll;
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const node of list.querySelectorAll('.team-card')) {
        const delta = beforeList.get(node.dataset.id) - node.getBoundingClientRect().top;
        if (Math.abs(delta) > .5) node.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: 180, easing: 'ease-out' });
      }
      for (const node of document.querySelectorAll('.team-bar')) {
        const delta = beforeAxis.get(node.dataset.id) - node.getBoundingClientRect().left;
        if (Math.abs(delta) > .5) node.animate([{ transform: `translateX(${delta}px)` }, { transform: 'translateX(0)' }], { duration: 180, easing: 'ease-out' });
      }
    }
  };
  const cancel = () => finish({ type: 'pointercancel' });
  const escape = key => { if (key.key === 'Escape') { key.preventDefault(); key.stopImmediatePropagation(); cancel(); } };
  card.addEventListener('pointermove', move); card.addEventListener('pointerup', finish); card.addEventListener('pointercancel', cancel); card.addEventListener('lostpointercapture', cancel);
  document.addEventListener('keydown', escape, true); window.addEventListener('resize', cancel);
}

function renderEditor() {
  const team = current();
  $('team-form').inert = !team;
  $('team-form').style.opacity = team ? '1' : '.4';
  $('delete-team').disabled = !team;
  $('team-name').value = team?.name || '';
  $('team-score').value = team?.needsScore ? '' : team?.score ?? '';
  $('team-start').value = team ? Math.round(axisEntry(team).axisStartScore * 100) / 100 : '';
  $('team-start-mode').textContent = team && axisEntry(team).positionIsPreview ? '预览起点' : '自动衔接';
  $('selected-characters').replaceChildren();
  for (let slot = 0; slot < (team ? 3 : 0); slot++) {
    const id = team.characterIds[slot];
    const button = element('button', 'character-slot');
    button.type = 'button';
    if (id) button.append(portrait(id), element('span', '', characterMap.get(id).name));
    else button.append(element('div', 'empty-portrait', '＋'), element('span', '', '选择角色'));
    button.addEventListener('click', openCharacters);
    $('selected-characters').append(button);
  }
}

function locationText(position) {
  const name = `${position.wave.name}${position.wave.provisional ? position.wave.estimated ? '（暂定·推算）' : '（分数暂定）' : position.wave.estimated ? '（推算）' : ''}`;
  if (position.inBonus) return `R${position.wave.round} ${name} · 击杀奖励区 · 剩余 ${fmt(position.remainingPoints)} 分`;
  if (position.completed) return `R${position.wave.round} ${name} · 已击败 · 剩余 0 分`;
  return `R${position.wave.round} ${name} · 剩余 ${(position.remainingHp * 100).toFixed(1)}% · 剩余分数 ${fmt(position.remainingPoints)} 分`;
}

function renderLocation(node, position) {
  const text = locationText(position);
  const value = `${fmt(position.remainingPoints)} 分`;
  const offset = text.lastIndexOf(value);
  node.replaceChildren(document.createTextNode(text.slice(0, offset)), element('span', 'remaining-score-value', value));
}

function renderAxisLocation(node, score, preview) {
  if (!hasBloodline()) node.textContent = 'Boss 血线待配置';
  else if (score > total() + 1e-7) node.textContent = '超出当前显示血线';
  else renderLocation(node, locateScore(Math.min(score, total()), waves()));
  if (preview) node.prepend(element('span', 'axis-preview-tag', '预览 · '));
}

function renderTargetScoreGap() {
  const input = $('target-score'), output = $('target-score-gap');
  const text = input.value.trim(), target = parseScoreInput(text);
  output.replaceChildren();
  output.hidden = input.validity.badInput || !text || !Number.isFinite(target) || target < 0;
  if (output.hidden) { delete output.dataset.status; return; }
  if (target > 10_000_000_000) {
    output.dataset.status = 'easter-egg';
    output.textContent = '这个目标分数你确定？哪怕开隧者进矩阵都拿不到！';
    return;
  }
  const actual = state.teams.reduce((sum, team) => sum + (team.needsScore ? 0 : team.score), 0);
  const pending = state.teams.filter(team => team.needsScore).length;
  const difference = target - actual;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(target), Math.abs(actual)) * Math.max(1, state.teams.length);
  if (Math.abs(difference) <= tolerance) {
    output.dataset.status = 'reached';
    output.textContent = '已达到目标分数';
  } else {
    output.dataset.status = difference > 0 ? 'shortfall' : 'exceeded';
    output.append(document.createTextNode(difference > 0 ? '距离目标分数还差 ' : '已超出目标分数 '), element('strong', '', gapNumberFormat.format(Math.abs(difference))), document.createTextNode(' 分'));
  }
  if (pending) output.append(element('small', 'gap-pending-note', `${pending} 队待填分数，未计入`));
}

function renderScoreMarker() {
  $('score-marker')?.remove();
  const value = state.scoreMarker;
  $('clear-score-marker').disabled = value == null;
  $('target-score').value = value ?? '';
  renderTargetScoreGap();
  if (value == null) { $('target-score-location').textContent = '输入目标总分，定位到对应 Boss 并标记。'; return; }
  if (hasBloodline()) renderLocation($('target-score-location'), locateScore(value, waves()));
  else $('target-score-location').textContent = `${matrixInfo(state).name} · 累计 ${fmt(value)} 分，Boss 血线待配置`;
  const marker = element('div', 'score-marker');
  marker.id = 'score-marker'; marker.dataset.score = value;
  marker.style.left = `${LABEL + value * state.pixelsPerPoint}px`;
  const flag = element('span', `score-marker-label${value > total() / 2 ? ' align-end' : ''}`, `目标 ${fmt(value)} 分`);
  marker.append(flag); $('axis-sheet').append(marker);
}

function scrollToScore(value) {
  const viewport = $('timeline-viewport');
  viewport.scrollTo({ left: Math.max(0, value * state.pixelsPerPoint - (viewport.clientWidth - LABEL) / 2), behavior: 'smooth' });
}

function editAxisTeam(id) {
  selectedId = id; pendingTeam = null;
  renderList(); renderEditor(); renderPositions(); openCharacters();
}

function hideTeamTooltip() {
  $('team-tooltip').hidden = true;
}

function positionTeamTooltip(x, y) {
  const tooltip = $('team-tooltip');
  const bounds = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.max(12, Math.min(x + 15, window.innerWidth - bounds.width - 12))}px`;
  const top = y + 17 + bounds.height > window.innerHeight - 12 ? y - bounds.height - 14 : y + 17;
  tooltip.style.top = `${Math.max(12, Math.min(top, window.innerHeight - bounds.height - 12))}px`;
}

function showTeamTooltip(team, x, y) {
  if (dragging) return;
  const tooltip = $('team-tooltip');
  tooltip.replaceChildren();
  tooltip.style.setProperty('--team-color', team.color);
  const title = element('div', 'tooltip-title', team.name);
  const display = axisEntry(team);
  title.append(element('strong', '', team.needsScore ? `待填分数 · ${fmt(PENDING_TEAM_SCORE)} 分预览` : `${fmt(team.score)} 分`));
  const roster = element('div', 'tooltip-roster');
  team.characterIds.forEach(id => {
    const member = element('div', 'tooltip-member');
    member.append(portrait(id), element('span', '', characterMap.get(id).name));
    roster.append(member);
  });
  if (team.needsCharacters) roster.append(element('span', 'muted', '阵容待补选'));
  tooltip.append(title, roster);
  for (const [label, score] of [['起点', display.axisStartScore], ['终点', display.axisStartScore + display.axisScore]]) {
    const detail = element('div', 'tooltip-detail');
    const location = element('strong');
    renderAxisLocation(location, score, display.positionIsPreview);
    detail.append(element('span', 'muted', label), location, element('small', '', `${display.positionIsPreview ? '预览累计' : '累计'} ${fmt(score)} 分`));
    tooltip.append(detail);
  }
  tooltip.hidden = false;
  positionTeamTooltip(x, y);
}

function renderInspector() {
  // Keep a first click from shortening the page and moving a pending team before its second click.
  const inspector = document.querySelector('.inspector');
  inspector.style.minHeight = `${inspector.getBoundingClientRect().height}px`;
  const team = current();
  $('selection-name').textContent = team?.name || '尚未选择队伍';
  $('selection-roster').replaceChildren();
  for (const id of team?.characterIds || []) {
    const member = element('div', 'selection-member');
    member.append(portrait(id), element('span', '', characterMap.get(id).name));
    $('selection-roster').append(member);
  }
  if (team?.needsCharacters) $('selection-roster').append(element('span', 'muted', '阵容待补选'));
  $('selection-score').replaceChildren();
  if (!team) {
    for (const id of ['start-location', 'end-location', 'start-points', 'end-points', 'endpoint-note']) $(id).textContent = '—';
    return;
  }
  $('selection-dot').style.background = team.color;
  $('selection-score').style.color = team.color;
  if (team.needsScore) $('selection-score').textContent = `待填分数 · ${fmt(PENDING_TEAM_SCORE)} 分预览`;
  else $('selection-score').append(document.createTextNode(fmt(team.score)), element('small', '', '分'));
  const display = axisEntry(team);
  const begin = display.axisStartScore, finish = begin + display.axisScore;
  const start = hasBloodline() && begin <= total() ? locateScore(begin, waves()) : null;
  const end = hasBloodline() && finish <= total() ? locateScore(finish, waves()) : null;
  renderAxisLocation($('start-location'), begin, display.positionIsPreview);
  renderAxisLocation($('end-location'), finish, display.positionIsPreview);
  const cumulativeLabel = display.positionIsPreview ? '预览累计' : '累计';
  $('start-points').textContent = `${cumulativeLabel} ${fmt(begin)} 分`;
  $('end-points').textContent = `${cumulativeLabel} ${fmt(finish)} 分`;
  const bonus = Boolean(start?.inBonus || end?.inBonus);
  $('endpoint-note').textContent = team.needsScore ? `本队暂按 ${fmt(PENDING_TEAM_SCORE)} 分预览。双击队伍或在左侧填写实际分数后，血线长度会重新计算。` : display.positionIsPreview ? `前序队伍有待填分数，起止位置按每队 ${fmt(PENDING_TEAM_SCORE)} 分占位预览。` : bonus ? '端点落在矩阵奇藏奖励区，此区间没有可停留的血线。调整本队或前序队伍得分可改变终点。' : '第一队从 0 分开始，队伍之间首尾相接。拖动色条或按左右键调整出场顺序。';
  $('endpoint-note').parentElement.classList.toggle('warning', bonus);
}

function renderPositions() {
  const layout = axisTeams();
  for (const bar of document.querySelectorAll('.team-bar')) {
    const team = layout.find(item => item.id === bar.dataset.id);
    bar.style.left = `${LABEL + team.axisStartScore * state.pixelsPerPoint}px`;
    bar.classList.toggle('is-selected', team.id === selectedId);
    bar.setAttribute('aria-valuenow', team.axisStartScore.toFixed(2));
    bar.setAttribute('aria-valuetext', `${team.positionIsPreview ? '预览，' : ''}起点 ${fmt(team.axisStartScore)} 分，终点 ${fmt(team.axisStartScore + team.axisScore)} 分${team.needsScore ? '，待填实际分数' : ''}`);
  }
  const team = current();
  for (const card of document.querySelectorAll('.pending-team')) card.classList.toggle('active', card.dataset.id === selectedId);
  for (const guide of document.querySelectorAll('.axis-guide')) {
    guide.hidden = !team;
    if (team) {
      const display = layout.find(item => item.id === team.id);
      guide.classList.toggle('preview', display.positionIsPreview);
      guide.style.left = `${LABEL + (display.axisStartScore + (guide.classList.contains('end') ? display.axisScore : 0)) * state.pixelsPerPoint}px`;
      guide.style.setProperty('--guide-color', team.color);
    }
  }
  if (team && !document.activeElement?.closest('#team-form')) $('team-start').value = Math.round(axisEntry(team).axisStartScore * 100) / 100;
  renderInspector();
}

function startDrag(event, team, bar) {
  if (event.button !== 0) return;
  event.preventDefault();
  selectedId = team.id;
  dragging = true;
  hideTeamTooltip();
  renderList(); renderEditor(); renderPositions();
  const initialX = event.clientX;
  const displayTeams = axisTeams().map(item => ({ ...item, score: item.axisScore, startScore: item.axisStartScore }));
  const initialStart = displayTeams.find(item => item.id === team.id).startScore;
  const initialIndex = state.teams.findIndex(item => item.id === team.id);
  let targetIndex = initialIndex;
  let moved = false;
  let finished = false;
  const lane = bar.closest('.team-lane');
  function previewOrder(index) {
    const proposed = reorderTeams(displayTeams, team.id, index);
    lane.classList.add('drag-preview-active');
    bar.classList.add('is-reordering');
    for (const item of proposed) {
      const node = [...lane.querySelectorAll('.team-bar')].find(node => node.dataset.id === item.id);
      node.style.left = `${LABEL + item.startScore * state.pixelsPerPoint}px`;
      node.dataset.dragPreviewIndex = proposed.indexOf(item);
    }
    const moving = proposed.find(item => item.id === team.id);
    for (const guide of document.querySelectorAll('.axis-guide')) {
      guide.classList.add('drag-preview-guide');
      guide.style.left = `${LABEL + (moving.startScore + (guide.classList.contains('end') ? moving.score : 0)) * state.pixelsPerPoint}px`;
    }
    return moving;
  }
  const viewport = $('timeline-viewport');
  const initialScroll = viewport.scrollLeft;
  bar.focus({ preventScroll: true });
  bar.setPointerCapture(event.pointerId);
  const move = moveEvent => {
    if (!moved && Math.abs(moveEvent.clientX - initialX) < 4) return;
    moved = true;
    const bounds = viewport.getBoundingClientRect();
    if (moveEvent.clientX > bounds.right - 38) viewport.scrollLeft += 16;
    if (moveEvent.clientX < bounds.left + LABEL + 20) viewport.scrollLeft -= 16;
    const deltaX = moveEvent.clientX - initialX + viewport.scrollLeft - initialScroll;
    targetIndex = nearestTeamSlot(displayTeams, team.id, initialStart + deltaX / state.pixelsPerPoint);
    const proposed = previewOrder(targetIndex);
    $('team-drop-marker').hidden = false;
    $('team-drop-marker').style.left = `${LABEL + proposed.startScore * state.pixelsPerPoint}px`;
    $('team-drop-marker').textContent = `第 ${targetIndex + 1} 队`;
    $('coverage-note').textContent = `松开后排为第 ${targetIndex + 1} 队 · 首尾自动吸附`;
  };
  const finish = finishEvent => {
    if (finished) return;
    finished = true;
    dragging = false;
    bar.removeEventListener('pointermove', move);
    bar.removeEventListener('pointerup', finish);
    bar.removeEventListener('pointercancel', finish);
    bar.removeEventListener('lostpointercapture', cancel);
    document.removeEventListener('keydown', escapeDrag, true);
    if (bar.hasPointerCapture(event.pointerId)) bar.releasePointerCapture(event.pointerId);
    if (!moved) return;
    const before = new Map([...lane.querySelectorAll('.team-bar')].map(node => [node.dataset.id, node.getBoundingClientRect().left]));
    suppressDoubleClickUntil = Date.now() + 300;
    if (finishEvent.type !== 'pointercancel') { state.teams = reorderTeams(state.teams, team.id, targetIndex); persist(); }
    renderAll();
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const node of document.querySelectorAll('.team-bar')) {
        const delta = before.get(node.dataset.id) - node.getBoundingClientRect().left;
        if (Number.isFinite(delta) && Math.abs(delta) > .5) node.animate([{ transform: `translateX(${delta}px)` }, { transform: 'translateX(0)' }], { duration: 180, easing: 'ease-out' });
      }
    }
  };
  const cancel = () => finish({ type: 'pointercancel' });
  const escapeDrag = keyEvent => { if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); keyEvent.stopImmediatePropagation(); cancel(); } };
  bar.addEventListener('pointermove', move);
  bar.addEventListener('pointerup', finish);
  bar.addEventListener('pointercancel', finish);
  bar.addEventListener('lostpointercapture', cancel);
  document.addEventListener('keydown', escapeDrag, true);
}

function renderTimeline() {
  hideTeamTooltip();
  const sheet = $('axis-sheet');
  sheet.replaceChildren();
  sheet.style.width = `${LABEL + axisExtent() * state.pixelsPerPoint + 24}px`;
  const ruler = element('div', 'score-ruler');
  ruler.append(element('div', 'axis-label', '累计积分'));
  sheet.append(ruler);
  const lane = element('div', 'team-lane shared-team-lane');
  const laneLabel = element('div', 'axis-label', '队伍排布');
  laneLabel.append(element('small', '', '悬停查看 · 拖动排序'));
  lane.append(laneLabel);
  axisTeams().forEach(team => {
    const width = team.axisScore * state.pixelsPerPoint;
    const bar = element('button', `team-bar${width < 150 ? ' narrow' : ''}${team.needsScore ? ' pending-score-bar' : ''}`);
    bar.dataset.id = team.id;
    bar.dataset.preview = String(Boolean(team.needsScore));
    bar.dataset.axisScore = team.axisScore;
    bar.dataset.estimatedPosition = String(team.positionIsPreview);
    bar.classList.toggle('stamina-conflicted', conflictTeamIds.has(team.id));
    bar.style.width = `${width}px`;
    if (width < 40) bar.style.paddingInline = '0';
    if (width < 4) bar.style.borderWidth = '0';
    bar.style.setProperty('--team-color', team.color);
    bar.setAttribute('role', 'slider');
    bar.setAttribute('aria-orientation', 'horizontal');
    bar.setAttribute('aria-description', '双击或按回车编辑队伍；拖动或使用左右键调整顺序');
    bar.setAttribute('aria-describedby', 'team-tooltip');
    bar.setAttribute('aria-label', `${team.name}分数条`);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', Math.max(0, axisExtent() - team.axisScore));
    const portraits = element('div', 'bar-portraits');
    team.characterIds.forEach(id => portraits.append(portrait(id)));
    const text = element('div');
    text.append(element('strong', '', team.name), element('div', 'bar-score', team.needsScore ? `待填 · ${fmt(PENDING_TEAM_SCORE)} 分预览` : `${fmt(team.score)} 分`));
    bar.append(portraits, text, element('span', 'bar-grip', '⠿'));
    bar.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') showTeamTooltip(team, event.clientX, event.clientY); });
    bar.addEventListener('pointermove', event => { if (!dragging && !$('team-tooltip').hidden) positionTeamTooltip(event.clientX, event.clientY); });
    bar.addEventListener('pointerleave', hideTeamTooltip);
    bar.addEventListener('blur', hideTeamTooltip);
    bar.addEventListener('focus', () => {
      if (bar.matches(':focus-visible')) {
        const bounds = bar.getBoundingClientRect();
        showTeamTooltip(team, Math.max(LABEL, bounds.left), bounds.bottom);
      }
    });
    bar.addEventListener('pointerdown', event => startDrag(event, team, bar));
    bar.addEventListener('dblclick', event => {
      event.preventDefault();
      if (!dragging && Date.now() >= suppressDoubleClickUntil) editAxisTeam(team.id);
    });
    bar.addEventListener('focus', () => { if (selectedId !== team.id && !dragging) { selectedId = team.id; renderList(); renderEditor(); renderPositions(); } });
    bar.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); editAxisTeam(team.id); return; }
      if (event.key === 'Escape') hideTeamTooltip();
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      selectedId = team.id;
      const index = state.teams.findIndex(item => item.id === team.id);
      state.teams = reorderTeams(state.teams, team.id, index + (event.key === 'ArrowRight' ? 1 : -1));
      persist(); renderAll();
      [...document.querySelectorAll('.team-bar')].find(node => node.dataset.id === team.id)?.focus({ preventScroll: true });
    });
    lane.append(bar);
  });
  if (!state.teams.length) lane.append(element('div', 'lane-empty', '新建队伍后，在此显示血线长度'));
  const dropMarker = element('div', 'team-drop-marker');
  dropMarker.id = 'team-drop-marker'; dropMarker.hidden = true;
  lane.append(dropMarker); sheet.append(lane);
  const roundRow = element('div', 'round-row');
  roundRow.append(element('div', 'axis-label', '轮次'));
  const grouped = Map.groupBy(waves(), wave => wave.round);
  for (const [round, records] of grouped) {
    const bracket = element('div', 'round-bracket', `R${round}`);
    bracket.style.left = `${LABEL + records[0].cumulative_points_before * state.pixelsPerPoint}px`;
    const width = records.reduce((sum, wave) => sum + wave.full_kill_points, 0) * state.pixelsPerPoint;
    bracket.style.width = `${width}px`;
    bracket.classList.toggle('compact', width < 100);
    bracket.append(element('small', '', `${records.length} 个 Boss`)); roundRow.append(bracket);
  }
  sheet.append(roundRow);
  const bossRow = element('div', 'boss-row');
  const bossLabel = element('div', 'axis-label', 'BOSS 血线');
  bossLabel.append(element('small', '', '100% → 0%')); bossRow.append(bossLabel);
  for (const wave of waves()) {
    const width = wave.damage_points_at_full_hp * state.pixelsPerPoint;
    const segment = element('button', `boss-segment tone-${wave.boss_position}`);
    segment.type = 'button';
    segment.setAttribute('aria-label', `R${wave.round} ${wave.name}，查看 Boss 详情`);
    segment.addEventListener('click', () => openBossDetails(wave));
    segment.dataset.wave = wave.wave_index;
    segment.style.left = `${LABEL + wave.cumulative_points_before * state.pixelsPerPoint}px`;
    segment.style.width = `${width}px`;
    segment.classList.toggle('overview-boss', width < 85);
    segment.classList.toggle('projected-boss', Boolean(wave.estimated));
    segment.classList.toggle('provisional-boss', Boolean(wave.provisional));
    segment.dataset.estimated = Boolean(wave.estimated);
    segment.dataset.provisional = Boolean(wave.provisional);
    const reference = getSeason(wave.score_reference_season);
    segment.title = `R${wave.round} ${wave.name}${wave.provisional ? `（暂按${reference.season}-${reference.stage}相同出场位次计分）` : wave.estimated ? `（按${wave.source_label === '原表' ? '原表' : '最新表'}规律推算）` : `（${wave.source_label}）`}：伤害积分 ${fmt(wave.damage_points_at_full_hp)}${wave.kill_bonus ? '，击杀额外 1000 分' : ''}`;
    const art = element('img', 'boss-art'); art.src = bossMap.get(wave.name).icon_file; art.alt = ''; art.loading = 'lazy';
    const name = element('div', 'boss-name', `R${wave.round} ${wave.name}${wave.provisional ? '（暂定）' : wave.estimated ? '（推算）' : ''}`);
    name.append(element('span', '', `${fmt(wave.damage_points_at_full_hp)} 分`));
    segment.append(art, element('div', 'boss-art-shade'), name, element('div', 'hp-line'));
    const percentages = width > 180 ? [100, 75, 50, 25, 0] : width > 125 ? [100, 50, 0] : width > 55 ? [100, 0] : [];
    for (const hp of percentages) {
      const tick = element('div', 'hp-tick');
      tick.style.left = `${Math.min(width - 1, width * (1 - hp / 100))}px`;
      const caption = element('span', '', `${hp}%`);
      if (hp === 100) caption.style.transform = 'translateX(5px)';
      if (hp === 0) caption.style.transform = 'translateX(calc(-100% - 5px))';
      tick.append(caption); segment.append(tick);
    }
    bossRow.append(segment);
    if (wave.kill_bonus) {
      const bonus = element('div', 'bonus-segment', '+1000');
      bonus.style.left = `${LABEL + (wave.cumulative_points_before + wave.damage_points_at_full_hp) * state.pixelsPerPoint}px`;
      bonus.style.width = `${wave.kill_bonus * state.pixelsPerPoint}px`;
      bonus.classList.toggle('overview-bonus', wave.kill_bonus * state.pixelsPerPoint < 18);
      bonus.title = '矩阵奇藏击杀奖励：没有对应的可停留血线'; bossRow.append(bonus);
    }
  }
  if (!hasBloodline()) bossRow.append(element('p', 'bloodline-unavailable', `${matrixInfo(state).name} 的 Boss 血量分数表待配置。`));
  sheet.append(bossRow, element('div', 'axis-guide start'), element('div', 'axis-guide end'));
  const projected = waves().filter(wave => wave.estimated).length;
  const season = getSeason(state);
  const reference = getSeason(season.scoring.basedOnSeason);
  const sourceLabel = season.scoring.sourceLabel ? `${season.scoring.sourceLabel}数据` : '原表';
  $('coverage-note').textContent = hasBloodline() ? matrixInfo(state).provisional ? `R1—R${state.maxRound} · ${waves().length} 条暂定分数（按${reference.season}-${reference.stage}同位次）` : `R1—R${state.maxRound} · ${waves().length - projected} 条${sourceLabel}${projected ? `＋${projected} 条推算` : ''}` : `${matrixInfo(state).name} · 仅队伍分数轴`;
  renderPositions();
  renderScoreMarker();
  renderRulerTicks();
}

function renderRulerTicks() {
  const ruler = document.querySelector('.score-ruler');
  if (!ruler) return;
  ruler.querySelectorAll('.ruler-tick').forEach(node => node.remove());
  const viewport = $('timeline-viewport');
  const step = axisTickStep(state.pixelsPerPoint);
  const first = Math.max(0, Math.floor((viewport.scrollLeft - 180) / state.pixelsPerPoint / step) * step);
  const last = Math.min(axisExtent(), (viewport.scrollLeft + viewport.clientWidth - LABEL + 180) / state.pixelsPerPoint);
  for (let value = first; value <= last; value += step) {
    const tick = element('div', 'ruler-tick');
    tick.style.left = `${LABEL + value * state.pixelsPerPoint}px`;
    const unit = value >= 1_000_000 ? 1_000_000 : 1000;
    const digits = Math.min(6, Math.max(0, Math.ceil(Math.log10(unit / step))));
    const caption = value ? `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(value / unit)}${unit === 1_000_000 ? 'm' : 'k'}` : '0';
    tick.append(element('span', '', caption));
    ruler.append(tick);
  }
  const visibleLeft = viewport.scrollLeft + LABEL;
  const visibleRight = viewport.scrollLeft + viewport.clientWidth;
  document.querySelectorAll('.boss-segment').forEach(segment => {
    const left = parseFloat(segment.style.left), width = parseFloat(segment.style.width);
    if (left + width < visibleLeft || left > visibleRight) return;
    const padding = width < 85 ? 4 : 11;
    const nameLeft = Math.min(Math.max(padding, visibleLeft - left + padding), Math.max(padding, width - 100));
    const name = segment.querySelector('.boss-name');
    name.style.left = `${nameLeft}px`;
    name.style.maxWidth = `${Math.max(0, Math.min(width - nameLeft - 6, viewport.clientWidth - LABEL - 22))}px`;
  });
  document.querySelectorAll('.round-bracket').forEach(bracket => {
    const left = parseFloat(bracket.style.left), width = parseFloat(bracket.style.width);
    if (left + width < visibleLeft || left > visibleRight) return;
    const padding = width < 100 ? 3 : 13;
    bracket.style.paddingLeft = `${Math.min(Math.max(padding, visibleLeft - left + padding), Math.max(padding, width - 35))}px`;
  });
}

function renderAll() {
  syncSeasonRuntime();
  normalizeTeamNames();
  renderRoundOptions();
  renderPlanControls();
  renderStaminaSeason();
  renderMatrixDetails();
  renderStaminaConflict();
  $('max-round').value = state.maxRound;
  updateZoomControls();
  $('zoom-out').disabled = state.pixelsPerPoint <= MIN_ZOOM;
  $('zoom-in').disabled = state.pixelsPerPoint >= MAX_ZOOM;
  renderList(); renderEditor(); renderPendingTeams(); renderTimeline();
}

function renderPendingTeams() {
  const container = $('pending-teams');
  const pending = state.teams.filter(team => team.needsScore);
  container.hidden = pending.length === 0;
  container.replaceChildren();
  if (!pending.length) return;
  container.append(element('p', 'pending-title', `待填分数 · ${pending.length} 队（轴上按每队 ${fmt(PENDING_TEAM_SCORE)} 分预览，双击补分）`));
  const list = element('div', 'pending-team-list');
  for (const team of pending) {
    const card = element('button', `pending-team${team.id === selectedId ? ' active' : ''}`);
    card.classList.toggle('stamina-conflicted', conflictTeamIds.has(team.id));
    card.dataset.id = team.id; card.style.setProperty('--team-color', team.color);
    const roster = element('div', 'tiny-portraits'); team.characterIds.forEach(id => roster.append(portrait(id)));
    card.append(element('strong', '', `第 ${state.teams.indexOf(team) + 1} 队 · ${team.name}`), roster, element('small', 'muted', '待填分数'));
    card.addEventListener('click', () => { selectedId = team.id; renderList(); renderEditor(); renderPositions(); });
    card.addEventListener('dblclick', () => editAxisTeam(team.id));
    list.append(card);
  }
  container.append(list);
}

function renderTeamOverview(container) {
  container.replaceChildren();
  state.teams.forEach((team, index) => {
    const card = element('article', 'team-overview-card');
    card.dataset.id = team.id; card.style.setProperty('--team-color', team.color);
    const heading = element('div', 'team-overview-card-header');
    heading.append(element('span', 'team-overview-number', `第 ${index + 1} 队`), element('h3', '', team.name));
    const score = element('span', 'team-overview-score', team.needsScore ? '待填分数' : `${fmt(team.score)} 分`);
    const roster = element('div', 'team-overview-roster');
    for (let slot = 0; slot < 3; slot++) {
      const member = element('div', 'team-overview-member');
      const id = team.characterIds[slot];
      if (id) member.append(portrait(id), element('span', '', characterMap.get(id).name));
      else member.append(element('span', 'quick-empty-slot', '＋'), element('span', 'muted', '待补选'));
      roster.append(member);
    }
    card.append(heading, score, roster); container.append(card);
  });
  if (!state.teams.length) container.append(element('p', 'team-overview-empty muted', '还没有已组好的队伍。'));
}

function openTeamOverview() {
  const pending = state.teams.filter(team => team.needsScore).length;
  $('team-overview-summary').textContent = `${activePlan().name} · 共 ${state.teams.length} 队${pending ? ` · ${pending} 队待填分数` : ''} · 按出场顺序排列`;
  renderTeamOverview($('team-overview-list'));
  $('team-overview-dialog').showModal();
}

const pickerFlights = new Set();
function clearPickerFlights() {
  for (const flight of pickerFlights) { flight.animation.cancel(); flight.image.remove(); }
  pickerFlights.clear();
  document.querySelectorAll('.picker-awaiting-arrival').forEach(node => node.classList.remove('picker-awaiting-arrival'));
}

function pickerFlightFrames(from, to) {
  const dx = to.left - from.left, dy = to.top - from.top;
  const sx = to.width / from.width, sy = to.height / from.height;
  return [
    { transform: 'translate(0,0) scale(1)', opacity: .95 },
    { transform: `translate(${dx * .48}px,${dy * .48 - 32}px) scale(${(1 + sx) / 2},${(1 + sy) / 2})`, opacity: 1, offset: .5 },
    { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})`, opacity: 1 },
  ];
}

function syncPickerFlights() {
  for (const flight of pickerFlights) {
    const target = flight.target();
    if (!target) continue;
    target.classList.add('picker-awaiting-arrival');
    flight.animation.effect.setKeyframes(pickerFlightFrames(flight.from, target.getBoundingClientRect()));
  }
}

function animatePickedCharacter(id, from, target) {
  if (!from || !target || !$('character-dialog').open || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const to = target.getBoundingClientRect();
  if (!from.width || !to.width) return;
  const image = portrait(id, 'picker-flying-portrait');
  image.alt = ''; image.setAttribute('aria-hidden', 'true');
  Object.assign(image.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
  $('character-dialog').append(image);
  const slot = target.dataset.pickerSlot;
  const resolveTarget = slot !== undefined
    ? () => $('quick-team-preview').querySelector(`[data-picker-slot="${slot}"]`)
    : () => $('picker-selected-roster').querySelector(`[data-character-id="${id}"]`);
  target.classList.add('picker-awaiting-arrival');
  const animation = image.animate(pickerFlightFrames(from, to), { duration: 430, easing: 'cubic-bezier(.22,.65,.3,1)', fill: 'forwards' });
  const flight = { image, animation, from, target: resolveTarget }; pickerFlights.add(flight);
  animation.finished.then(() => {
    if (!pickerFlights.has(flight)) return;
    const destination = resolveTarget();
    destination?.classList.remove('picker-awaiting-arrival');
    if (destination) destination.animate([{ boxShadow: '0 0 0 4px #e6bd79aa' }, { boxShadow: '0 0 0 0 #e6bd7900' }], { duration: 220 });
  }).catch(() => {}).finally(() => {
    image.remove();
    if (pickerFlights.has(flight)) { resolveTarget()?.classList.remove('picker-awaiting-arrival'); pickerFlights.delete(flight); }
  });
}

function renderPickedRoster() {
  $('picker-selected-roster').replaceChildren();
  for (const id of picked) {
    const image = portrait(id); image.dataset.characterId = id;
    $('picker-selected-roster').append(image);
  }
  syncPickerFlights();
}

function teamUsesDisabledCharacter(team, disabled) {
  return team.characterIds.some(id => { const choiceId = pickerChoiceIdByMember.get(id); return !alwaysAvailableChoices.has(choiceId) && disabled.has(choiceId); });
}

function disabledCharacterImpact(disabled) {
  const next = updatePlan(planLibrary, planLibrary.activePlanId, state);
  const removed = [];
  for (const plan of next.plans) {
    if (plan.id !== next.activePlanId) continue;
    plan.config.disabledCharacterIds = [...disabled];
    const affected = plan.config.teams.filter(team => teamUsesDisabledCharacter(team, disabled));
    if (!affected.length) continue;
    removed.push({ planId: plan.id, planName: plan.name, teams: affected });
    plan.config.teams = packTeams(plan.config.teams.filter(team => !teamUsesDisabledCharacter(team, disabled)));
  }
  return { library: next, removed, count: removed.reduce((sum, item) => sum + item.teams.length, 0) };
}

function saveDisabledCharacterSettings() {
  if (libraryRecoveryLocked) { $('disabled-character-feedback').textContent = '请先完成原排布库的恢复处理，再保存禁用设置。'; return; }
  disabledCharacterDraft = new Set([...disabledCharacterDraft].filter(id => !alwaysAvailableChoices.has(id)));
  const changes = [];
  try {
    const impact = disabledCharacterImpact(disabledCharacterDraft);
    const nextState = structuredClone(impact.library.plans.find(plan => plan.id === impact.library.activePlanId).config);
    const updates = [];
    if (impact.count) updates.push([`${LIBRARY_STORAGE}-before-character-disable`, JSON.stringify(updatePlan(planLibrary, planLibrary.activePlanId, state))]);
    updates.push([LIBRARY_STORAGE, JSON.stringify(impact.library)], [STORAGE, JSON.stringify(nextState)]);
    for (const [key, value] of updates) {
      const previous = localStorage.getItem(key);
      localStorage.setItem(key, value); changes.push([key, previous]);
    }
    disabledCharacters = new Set(disabledCharacterDraft); disabledCharactersLoadError = '';
    planLibrary = impact.library; state = nextState; planStorageError = false;
    if (!state.teams.some(team => team.id === selectedId)) selectedId = state.teams[0]?.id;
    for (const [id, history] of teamDeletionHistories) {
      if (id !== planLibrary.activePlanId) continue;
      if (impact.removed.some(item => item.planId === id) || [...history.undo, ...history.redo].some(record => teamUsesDisabledCharacter(record.team, disabledCharacters))) teamDeletionHistories.delete(id);
    }
    const names = impact.removed.flatMap(item => item.teams.map(team => team.name));
    const message = impact.count ? `已从当前方案删除 ${impact.count} 支含禁用角色的队伍：${names.slice(0, 3).join('、')}${names.length > 3 ? '等' : ''}。` : `当前方案已保存，${disabledCharacters.size} 位角色在选人时隐藏。`;
    $('disabled-removal-notice').textContent = impact.count ? message : '';
    $('disabled-removal-notice').hidden = !impact.count;
    $('disabled-characters-dialog').close(); renderAll(); toast(message);
  } catch {
    let restored = true;
    for (const [key, previous] of changes.reverse()) {
      try { if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous); } catch { restored = false; }
    }
    $('disabled-character-feedback').textContent = restored ? '设置未能保存，队伍和禁用设置未更改，请重试。' : '设置未能完整保存，请保留当前页面并导出排布备份后重试。';
  }
}

function renderDisabledCharacterSettings() {
  const query = normalizeCharacterSearch($('disabled-character-search').value);
  $('disabled-character-grid').replaceChildren();
  for (const choice of quickPickerCharacters.filter(item => !alwaysAvailableChoices.has(item.id) && item.memberIds.some(id => characterSearchKeys.get(id).some(key => key.includes(query))))) {
    const disabled = disabledCharacterDraft.has(choice.id);
    const button = element('button', `availability-choice${disabled ? ' is-disabled' : ''}`); button.type = 'button';
    button.setAttribute('aria-label', `禁用${choice.name}`); button.setAttribute('aria-pressed', String(disabled));
    button.append(portrait(choice.id), element('span', '', choice.name), element('small', '', disabled ? '已禁用' : '可选'));
    button.addEventListener('click', () => { if (disabledCharacterDraft.has(choice.id)) disabledCharacterDraft.delete(choice.id); else disabledCharacterDraft.add(choice.id); renderDisabledCharacterSettings(); });
    $('disabled-character-grid').append(button);
  }
  $('disabled-character-count').textContent = `已禁用 ${disabledCharacterDraft.size} / ${disableableCharacters.length} 位角色`;
  const impact = disabledCharacterImpact(disabledCharacterDraft);
  $('disabled-removal-preview').textContent = impact.count ? `保存后将删除当前方案中的 ${impact.count} 支队伍，其他方案不受影响。` : '';
}

function configurePickerMode(quick) {
  clearPickerFlights();
  $('picker-selected-roster').hidden = quick;
  $('character-dialog').classList.toggle('quick-mode', quick);
  document.querySelector('.dialog-team-fields').hidden = quick;
  $('quick-team-panel').hidden = !quick;
  $('quick-team-overview').hidden = !quick;
  if (quick) renderTeamOverview($('quick-team-overview-list'));
}

function updateQuickSequence(sequence) {
  quickSession.history = quickSession.history.slice(0, quickSession.cursor + 1);
  quickSession.history.push([...sequence]); quickSession.cursor++;
  $('character-feedback').textContent = '';
  renderCharacters();
  $('quick-team-preview').lastElementChild?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  syncPickerFlights();
}

function renderQuickPreview() {
  const sequence = quickSequence();
  const groups = splitQuickTeams(sequence);
  $('quick-undo').disabled = quickSession.cursor === 0;
  $('quick-redo').disabled = quickSession.cursor === quickSession.history.length - 1;
  $('quick-reset').disabled = sequence.length === 0;
  $('quick-team-preview').replaceChildren();
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const card = element('div', 'quick-preview-team');
    card.append(element('strong', '', `第 ${state.teams.length + index + 1} 队 · ${defaultTeamName(group, characterMap)}`));
    const roster = element('div', 'quick-preview-roster');
    for (let slot = 0; slot < 3; slot++) {
      const member = element('div', 'quick-preview-member');
      member.append(element('small', '', `${index * 3 + slot + 1}`));
      const slotPortrait = group[slot] ? portrait(group[slot]) : element('span', 'quick-empty-slot', '＋');
      if (group[slot]) slotPortrait.dataset.pickerSlot = index * 3 + slot;
      member.append(slotPortrait);
      member.append(element('span', 'quick-preview-character-name', group[slot] ? characterMap.get(group[slot]).name : '待选择'));
      roster.append(member);
    }
    card.append(roster); $('quick-team-preview').append(card);
  }
  if (!groups.length) $('quick-team-preview').append(element('p', 'muted', '点击角色，按顺序填入第 1、2、3 位……'));
  $('picked-count').textContent = `${sequence.length} 人 / ${Math.floor(sequence.length / 3)} 队`;
  $('picked-names').textContent = '自动生成队名，分数稍后填写。重置仅清空本次选择，可撤回。';
  $('confirm-characters').textContent = `加入 ${Math.floor(sequence.length / 3)} 支队伍`;
  $('confirm-characters').disabled = sequence.length === 0 || sequence.length % 3 !== 0;
  if (sequence.length % 3) $('character-feedback').textContent = `当前队伍还差 ${3 - sequence.length % 3} 位角色。`;
  syncPickerFlights();
}

function openQuickTeams() {
  if (state.teams.length >= 40) { toast('最多支持 40 支队伍'); return; }
  pendingTeam = null; hideTeamTooltip();
  quickSession = { history: [[]], cursor: 0 };
  activeElement = 0; $('character-search').value = ''; $('character-feedback').textContent = '';
  configurePickerMode(true); $('dialog-title').textContent = '快捷组队';
  renderCharacters(); $('character-dialog').showModal();
}

function openCharacters() {
  quickSession = null; configurePickerMode(false);
  const team = pendingTeam || current();
  if (!team) return;
  hideTeamTooltip();
  dialogAutoName = Boolean(pendingTeam) || team.nameMode === 'auto';
  $('dialog-team-name').value = pendingTeam ? '' : team.name;
  $('dialog-team-score').value = pendingTeam || team.needsScore ? '' : team.score;
  $('dialog-team-score').placeholder = pendingTeam || team.needsScore ? '可稍后填写（5,000分预览）' : '填写本队分数';
  $('dialog-title').textContent = pendingTeam ? '新建队伍' : '编辑队伍';
  $('confirm-characters').textContent = pendingTeam ? '创建队伍' : '保存队伍';
  picked = [...team.characterIds];
  activeElement = 0;
  $('character-feedback').textContent = '';
  $('character-search').value = '';
  renderCharacters();
  $('character-dialog').showModal();
  if (pendingTeam) $('dialog-team-name').select();
}

function renderElementFilters() {
  $('element-filters').replaceChildren();
  for (const attribute of [{ id: 0, name: '全部' }, ...elementData.entries]) {
    const button = element('button', 'element-filter');
    button.type = 'button';
    button.dataset.element = attribute.id;
    button.setAttribute('aria-label', attribute.name);
    if (attribute.icon_file) {
      const icon = element('img');
      icon.src = attribute.icon_file;
      icon.alt = '';
      icon.draggable = false;
      button.append(icon);
    }
    button.append(element('span', '', attribute.name));
    button.addEventListener('click', () => { activeElement = attribute.id; renderCharacters(); });
    $('element-filters').append(button);
  }
}

function renderCharacters() {
  if (!quickSession && dialogAutoName) $('dialog-team-name').value = defaultTeamName(picked, characterMap);
  const search = normalizeCharacterSearch($('character-search').value);
  $('character-grid').replaceChildren();
  const team = quickSession ? null : pendingTeam || current();
  const sequence = quickSession ? quickSequence() : [];
  const currentPicked = quickSession ? sequence.slice(Math.floor(sequence.length / 3) * 3) : picked;
  const owners = characterUsage(team?.id);
  if (quickSession) {
    for (let index = 0; index < Math.floor(sequence.length / 3) * 3; index++) {
      const identity = identityById.get(sequence[index]);
      if (!owners.has(identity)) owners.set(identity, []);
      owners.get(identity).push(`快捷第 ${state.teams.length + Math.floor(index / 3) + 1} 队`);
    }
  }
  const limits = staminaLimits(staminaRules, state.staminaSeason, identityById);
  const season = staminaRules.seasons.find(item => item.id === state.staminaSeason);
  $('picker-stamina-note').textContent = `${season.name} · ${season.bonusCharacterIds.map(id => characterMap.get(id).name).join('、')} +${season.extraStamina} 体`;
  const selectedIdentities = new Set(currentPicked.map(id => identityById.get(id)));
  for (const button of $('element-filters').children) {
    const active = Number(button.dataset.element) === activeElement;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active);
  }
  const candidates = quickSession && activeElement === 0 ? quickPickerCharacters : pickerCharacters;
  const matches = candidates.filter(item => (!disabledCharacters.has(item.id) || (!quickSession && item.memberIds.some(id => currentPicked.includes(id)))) &&
    (activeElement === 0 || item.element === activeElement) && item.memberIds.some(id => characterSearchKeys.get(id).some(key => key.includes(search))));
  $('character-result-count').textContent = `${matches.length} 位角色`;
  for (const choice of matches) {
    const selectedMember = currentPicked.find(id => choice.memberIds.includes(id));
    const entry = characterMap.get(selectedMember || choice.id);
    const selected = currentPicked.includes(entry.id);
    const button = element('button', `character-choice${selected ? ' selected' : ''}`);
    button.setAttribute('aria-label', entry.name);
    button.setAttribute('aria-pressed', selected);
    button.dataset.element = entry.element;
    const owner = owners.get(identityById.get(entry.id)) || [];
    const limit = limits.get(identityById.get(entry.id)) || 1;
    const exhausted = owner.length >= limit;
    const sameFamily = selectedIdentities.has(identityById.get(entry.id)) && !selected;
    button.disabled = quickSession ? exhausted || selectedIdentities.has(identityById.get(entry.id)) : (!selected && exhausted) || sameFamily;
    button.classList.toggle('unavailable', button.disabled);
    button.title = `${entry.name}：可上阵 ${limit} 队，其他队伍已使用 ${owner.length} 次${owner.length ? `（${owner.join('、')}）` : ''}`;
    if (disabledCharacters.has(choice.id)) button.title += '；已自主禁用，本队原有角色仍可取消选择';
    const image = portrait(entry.id, ''); image.loading = 'lazy';
    const avatar = element('div', 'character-avatar');
    avatar.append(image);
    const remaining = Math.max(0, limit - owner.length - (selected ? 1 : 0));
    avatar.append(element('small', 'availability', disabledCharacters.has(choice.id) ? '本队已有·已禁用' : sameFamily ? '同一角色已选' : `剩余 ${remaining}/${limit} 体`));
    if (limit > 1) avatar.append(element('small', `stamina-badge${season.bonusCharacterIds.includes(entry.id) ? ' temporary' : ''}`, `${limit}体`));
    button.append(avatar, element('span', 'character-choice-name', entry.name));
    button.addEventListener('click', () => {
      const from = image.getBoundingClientRect();
      if (quickSession) {
        if (sequence.length >= (40 - state.teams.length) * 3) { $('character-feedback').textContent = '已达到 40 支队伍上限。'; return; }
        updateQuickSequence([...sequence, entry.id]);
        animatePickedCharacter(entry.id, from, $('quick-team-preview').querySelectorAll('.quick-preview-member img')[sequence.length]);
        return;
      }
      const removing = picked.includes(entry.id);
      if (removing) { clearPickerFlights(); picked = picked.filter(id => id !== entry.id); }
      else if (picked.length < 3) picked.push(entry.id);
      else { $('character-feedback').textContent = '每队最多 3 位角色，请先取消一位已选角色。'; return; }
      $('character-feedback').textContent = '';
      renderCharacters();
      if (!removing) animatePickedCharacter(entry.id, from, $('picker-selected-roster').querySelector(`[data-character-id="${entry.id}"]`));
    });
    $('character-grid').append(button);
  }
  if (!matches.length) $('character-grid').append(element('p', 'empty-character-results', disabledCharacters.size ? '没有匹配的可选角色，请检查搜索、属性或“自主禁用角色”设置。' : '没有匹配的角色，试试其他属性或清空搜索。'));
  if (quickSession) { renderQuickPreview(); return; }
  renderPickedRoster();
  $('picked-count').textContent = `${picked.length} / 3`;
  $('picked-names').textContent = picked.map(id => characterMap.get(id).name).join(' · ');
  $('confirm-characters').disabled = picked.length !== 3;
  if (pendingStaminaSeason && team) {
    const affected = staminaConflicts(state.teams, staminaRules, pendingStaminaSeason, identityById).filter(item => item.teams.some(affectedTeam => affectedTeam.id === team.id) && picked.some(id => identityById.get(id) === item.identity));
    if (affected.length && (!$('character-feedback').textContent || $('character-feedback').textContent.startsWith('切换 '))) {
      const version = staminaRules.seasons.find(item => item.id === pendingStaminaSeason).name.match(/S\d+-\d+/)?.[0] || '目标版本';
      $('character-feedback').textContent = `切换 ${version} 需调整：${affected.map(item => characterMap.get(item.characterId).name).join('、')}。也可以返回后编辑其他冲突队伍。`;
    } else if (!affected.length && $('character-feedback').textContent.startsWith('切换 ')) $('character-feedback').textContent = '';
  }
}

$('team-form').addEventListener('submit', event => {
  event.preventDefault();
  const team = current(); if (!team) return;
  const score = parseScoreInput($('team-score').value);
  const name = $('team-name').value.trim();
  if (!name || !Number.isFinite(score) || score <= 0) { toast('请输入队名与正数得分'); return; }
  if (hasBloodline() && state.teams.reduce((sum, item) => sum + (item.id === team.id ? score : item.score), 0) > total() + 1e-7) { toast('队伍总分超出当前轴，请先增加显示轮次'); return; }
  Object.assign(team, { name, score, nameMode: name === defaultTeamName(team.characterIds, characterMap) ? 'auto' : 'custom' });
  delete team.needsScore;
  state.teams = packTeams(state.teams);
  persist(); renderAll(); toast('已更新分数条');
});
$('add-team').addEventListener('click', () => {
  if (state.teams.length >= 40) { toast('Demo 最多支持 40 支队伍'); return; }
  const end = state.teams.reduce((sum, team) => sum + team.score, 0);
  pendingTeam = { id: crypto.randomUUID(), name: '', nameMode: 'auto', characterIds: [], score: 0, startScore: end, color: COLORS[state.teams.length % COLORS.length] };
  openCharacters();
});
$('delete-team').addEventListener('click', () => changeTeamDeletion('delete'));
$('undo-team-delete').addEventListener('click', () => changeTeamDeletion('undo'));
$('redo-team-delete').addEventListener('click', () => changeTeamDeletion('redo'));
$('confirm-characters').addEventListener('click', () => {
  if (quickSession) {
    const sequence = quickSequence();
    if (!sequence.length || sequence.length % 3) return;
    const groups = splitQuickTeams(sequence);
    if (state.teams.length + groups.length > 40) { $('character-feedback').textContent = '最多支持 40 支队伍。'; return; }
    const added = groups.map((group, index) => ({ id: crypto.randomUUID(), name: defaultTeamName(group, characterMap), nameMode: 'auto', characterIds: group, score: 0, needsScore: true, startScore: 0, color: COLORS[(state.teams.length + index) % COLORS.length] }));
    const next = { ...state, teams: packTeams([...state.teams, ...added]) };
    try { state = validatePlan(next); }
    catch (error) { $('character-feedback').textContent = error.message; return; }
    selectedId = added[0].id; quickSession = null;
    persist(); renderAll(); $('character-dialog').close(); toast(`已追加 ${added.length} 支队伍，分数待填。`);
    return;
  }
  if (picked.length !== 3) return;
  const team = pendingTeam || current();
  if (!team) return;
  const name = $('dialog-team-name').value.trim() || defaultTeamName(picked, characterMap);
  const scoreText = $('dialog-team-score').value.trim();
  const awaitingScore = (Boolean(pendingTeam) || team.needsScore === true) && !scoreText;
  const score = awaitingScore ? 0 : parseScoreInput(scoreText);
  if (!name || name.length > 30) { $('character-feedback').textContent = '请填写 1—30 个字符的队伍名称。'; $('dialog-team-name').focus(); return; }
  if ($('dialog-team-score').validity.badInput || (!awaitingScore && (!scoreText || !Number.isFinite(score) || score <= 0))) { $('character-feedback').textContent = '请填写大于 0 的队伍分数。'; $('dialog-team-score').focus(); return; }
  const required = state.teams.filter(other => other.id !== team.id).reduce((sum, other) => sum + other.score, score);
  const sufficient = scores.records.find(wave => wave.cumulative_points_after >= required);
  if (hasBloodline() && !sufficient) { $('character-feedback').textContent = '队伍总分超出已导入的血线数据范围，请调整分数。'; return; }
  const used = characterUsage(team.id);
  const limits = staminaLimits(staminaRules, state.staminaSeason, identityById);
  if (picked.some(id => (used.get(identityById.get(id)) || []).length >= (limits.get(identityById.get(id)) || 1))) { $('character-feedback').textContent = '所选角色体力不足，请重新选择。'; renderCharacters(); return; }
  Object.assign(team, { name, score, nameMode: dialogAutoName ? 'auto' : 'custom', characterIds: [...picked] }); delete team.needsCharacters;
  if (awaitingScore) team.needsScore = true;
  else delete team.needsScore;
  if (hasBloodline()) state.maxRound = Math.max(state.maxRound, sufficient.round);
  if (pendingTeam) { state.teams.push(team); selectedId = team.id; pendingTeam = null; }
  state.teams = packTeams(state.teams);
  persist(); renderAll(); $('character-dialog').close();
});
$('character-dialog').addEventListener('close', () => { clearPickerFlights(); pendingTeam = null; quickSession = null; document.body.append($('toast')); $('toast').classList.remove('visible'); });
$('quick-team').addEventListener('click', openQuickTeams);
$('manage-disabled-characters').addEventListener('click', () => {
  $('disabled-characters-title').textContent = `自主禁用角色 · ${activePlan().name}`;
  disabledCharacterDraft = new Set(disabledCharacters); $('disabled-character-search').value = '';
  $('disabled-character-feedback').textContent = disabledCharactersLoadError;
  renderDisabledCharacterSettings(); $('disabled-characters-dialog').showModal();
});
$('disabled-character-search').addEventListener('input', renderDisabledCharacterSettings);
$('close-disabled-characters').addEventListener('click', () => $('disabled-characters-dialog').close());
$('enable-all-characters').addEventListener('click', () => { disabledCharacterDraft.clear(); renderDisabledCharacterSettings(); });
$('save-disabled-characters').addEventListener('click', saveDisabledCharacterSettings);
$('team-overview').addEventListener('click', openTeamOverview);
$('close-team-overview').addEventListener('click', () => $('team-overview-dialog').close());
$('quick-undo').addEventListener('click', () => { clearPickerFlights(); if (quickSession?.cursor > 0) { quickSession.cursor--; $('character-feedback').textContent = ''; renderCharacters(); } });
$('quick-redo').addEventListener('click', () => { clearPickerFlights(); if (quickSession && quickSession.cursor < quickSession.history.length - 1) { quickSession.cursor++; $('character-feedback').textContent = ''; renderCharacters(); } });
$('quick-reset').addEventListener('click', () => { clearPickerFlights(); if (quickSession && quickSequence().length) updateQuickSequence([]); });
document.addEventListener('keydown', event => {
  if (!quickSession || !$('character-dialog').open || !(event.ctrlKey || event.metaKey) || event.target.matches('input,textarea,[contenteditable=true]')) return;
  const key = event.key.toLowerCase();
  if (key === 'z' || key === 'y') { event.preventDefault(); $(key === 'y' || event.shiftKey ? 'quick-redo' : 'quick-undo').click(); }
});
$('close-dialog').addEventListener('click', () => $('character-dialog').close());
$('character-search').addEventListener('input', renderCharacters);
$('dialog-team-name').addEventListener('input', () => {
  dialogAutoName = !$('dialog-team-name').value.trim() || $('dialog-team-name').value.trim() === defaultTeamName(picked, characterMap);
});
for (const id of ['dialog-team-name', 'dialog-team-score']) $(id).addEventListener('keydown', event => {
  if (event.key === 'Enter' && !$('confirm-characters').disabled) { event.preventDefault(); $('confirm-characters').click(); }
});
let rulerFrame = false;
function queueRulerTicks() {
  if (rulerFrame) return;
  rulerFrame = true;
  requestAnimationFrame(() => { rulerFrame = false; renderRulerTicks(); });
}
$('timeline-viewport').addEventListener('scroll', () => { hideTeamTooltip(); queueRulerTicks(); });
window.addEventListener('resize', () => { clearPickerFlights(); document.querySelector('.inspector').style.minHeight = ''; hideTeamTooltip(); queueRulerTicks(); });
function renderRoundOptions() {
  $('max-round').replaceChildren();
  for (let round = 1; round <= getSeason(state).maxRound; round++) {
    const records = visibleWaves(scores.records, round).filter(wave => wave.round === round);
    const projected = records.filter(wave => wave.estimated).length;
    const suffix = matrixInfo(state).provisional ? '（暂定）' : projected ? projected === records.length ? '（推算）' : '（含推算）' : '';
    const option = element('option', '', `R${round}${suffix}`);
    option.value = round; $('max-round').append(option);
  }
}
$('max-round').addEventListener('change', () => {
  const next = Number($('max-round').value);
  const nextTotal = visibleWaves(scores.records, next).at(-1).cumulative_points_after;
  if (state.teams.reduce((sum, team) => sum + team.score, 0) > nextTotal + 1e-7) { $('max-round').value = state.maxRound; toast('队伍总分超出该轮范围，请先调整队伍分数'); return; }
  if (state.scoreMarker != null && state.scoreMarker > nextTotal) { $('max-round').value = state.maxRound; toast('目标标记超出该轮范围，请先清除标记'); return; }
  state.maxRound = next; persist(); renderTimeline();
});
function setZoom(value) {
  const viewport = $('timeline-viewport');
  const focus = (viewport.scrollLeft + viewport.clientWidth / 2 - LABEL) / state.pixelsPerPoint;
  state.pixelsPerPoint = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
  updateZoomControls();
  $('zoom-out').disabled = state.pixelsPerPoint <= MIN_ZOOM;
  $('zoom-in').disabled = state.pixelsPerPoint >= MAX_ZOOM;
  renderTimeline();
  viewport.scrollLeft = focus * state.pixelsPerPoint + LABEL - viewport.clientWidth / 2;
  persist();
}
function updateZoomControls() {
  $('zoom').value = state.pixelsPerPoint;
  const percentage = state.pixelsPerPoint / .04 * 100;
  $('zoom-level').textContent = `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: percentage < 1 ? 3 : 1 }).format(percentage)}%`;
  $('zoom-level').title = '缩小可看到更长的排布，放大可查看细节';
}
function fitAxis(entireBloodline) {
  const points = entireBloodline ? total() : axisTeamPoints() || waves()[0]?.full_kill_points || 10000;
  const available = Math.max(30, $('timeline-viewport').clientWidth - LABEL - 28);
  state.pixelsPerPoint = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, available / points));
  renderAll(); $('timeline-viewport').scrollLeft = 0; persist();
}
$('fit-teams').addEventListener('click', () => fitAxis(false));
$('fit-bloodline').addEventListener('click', () => fitAxis(true));
$('zoom').addEventListener('input', event => setZoom(Number(event.target.value)));
$('zoom-in').addEventListener('click', () => setZoom(state.pixelsPerPoint * 1.5));
$('zoom-out').addEventListener('click', () => setZoom(state.pixelsPerPoint / 1.5));
$('jump-selected').addEventListener('click', () => { const team = current(); if (team) $('timeline-viewport').scrollTo({ left: Math.max(0, axisEntry(team).axisStartScore * state.pixelsPerPoint - 25), behavior: 'smooth' }); });
$('score-locator').addEventListener('submit', event => {
  event.preventDefault();
  const text = $('target-score').value.trim();
  const value = parseScoreInput(text);
  if (!text || !Number.isFinite(value) || value < 0) { toast('请输入不小于 0 的目标总分'); return; }
  const required = scores.records.find(wave => wave.cumulative_points_after >= value);
  if (hasBloodline() && !required) { toast('目标总分超出已导入的 Boss 数据范围'); return; }
  state.scoreMarker = value; if (hasBloodline()) state.maxRound = Math.max(state.maxRound, required.round);
  persist(); renderAll(); scrollToScore(value);
});
$('target-score').addEventListener('input', renderTargetScoreGap);
$('clear-score-marker').addEventListener('click', () => { state.scoreMarker = null; persist(); renderScoreMarker(); });
$('load-example').addEventListener('click', () => { teamDeletionHistories.delete(planLibrary.activePlanId); state = structuredClone(example); pendingStaminaSeason = null; if (!libraryRecoveryLocked) restoreError = null; renderRestoreWarning(); selectedId = state.teams[0].id; persist(); renderAll(); $('timeline-viewport').scrollLeft = 0; toast('已恢复示例排布'); });
$('export-button').addEventListener('click', () => {
  downloadPlanConfig(state, activePlan().name);
});
$('import-button').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 1_000_000) throw new Error('配置文件不能超过 1 MB');
    const parsed = JSON.parse(await file.text());
    if (parsed.schemaVersion === 1 && Array.isArray(parsed.bosses) && parsed.scoring) throw new Error('这是赛季数据配置，请放到 config/seasons 目录；此处用于导入队伍排布 JSON。');
    const imported = validatePlan(parsed);
    const importedName = typeof imported.planName === 'string' ? imported.planName : file.name.replace(/\.json$/i, '');
    delete imported.planName;
    const next = addPlan(planLibrary, uniquePlanName(importedName), imported);
    planLibrary = next; enterActivePlan(); toast('已导入为新排布，原有方案已保留。');
  } catch (error) { toast(`导入失败：${error.message}`); }
  event.target.value = '';
});
$('plan-select').addEventListener('change', () => {
  const id = $('plan-select').value; persist();
  planLibrary = activatePlan(planLibrary, id); enterActivePlan();
});
$('new-plan').addEventListener('click', () => openPlanDialog('new'));
$('duplicate-plan').addEventListener('click', () => openPlanDialog('copy'));
$('rename-plan').addEventListener('click', () => openPlanDialog('rename'));
$('copy-plan-config').addEventListener('click', copyPlanConfig);
$('delete-plan').addEventListener('click', openDeletePlan);
$('cancel-delete-plan').addEventListener('click', () => { deletingPlanId = null; $('delete-plan-dialog').close(); });
$('confirm-delete-plan').addEventListener('click', confirmDeletePlan);
$('export-delete-plan').addEventListener('click', () => {
  const plan = planLibrary.plans.find(item => item.id === deletingPlanId);
  if (!plan) return;
  downloadPlanConfig(plan.config, plan.name);
  $('delete-plan-backup-note').textContent = '已发起 JSON 下载。请确认备份文件已保存，再点击确认永久删除。';
  $('confirm-delete-plan').textContent = '已保存备份，确认永久删除';
});
$('close-plan-dialog').addEventListener('click', () => $('plan-dialog').close());
$('close-copy-config').addEventListener('click', () => $('copy-config-dialog').close());
$('close-boss-dialog').addEventListener('click', () => $('boss-dialog').close());
$('boss-hp-percent').addEventListener('input', renderBossScoreCalculation);
$('boss-properties-search').addEventListener('input', renderBossPropertiesCatalog);
$('boss-dialog').addEventListener('close', () => { inspectedBossWave = null; });
$('select-copy-config').addEventListener('click', () => { $('copy-config-text').focus(); $('copy-config-text').select(); });
$('plan-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('plan-name').value.trim();
  try {
    if (planAction === 'rename') planLibrary = renamePlan(planLibrary, planLibrary.activePlanId, name);
    else if (planAction === 'copy') planLibrary = copyPlan(planLibrary, planLibrary.activePlanId, name);
    else {
      const season = staminaRules.seasons.find(item => item.id === $('plan-season').value);
      const config = validatePlan({ ...structuredClone(example), teams: [], towerId: season.towerId, matrixSeason: season.id, matrixVersion: season.name, staminaSeason: season.id, pixelsPerPoint: state.pixelsPerPoint });
      planLibrary = addPlan(planLibrary, name, config);
    }
    $('plan-dialog').close(); enterActivePlan();
  } catch (error) { $('plan-dialog-error').textContent = error.message; }
});
for (const season of staminaRules.seasons) {
  const option = element('option', '', season.name);
  option.value = season.id; $('stamina-season').append(option);
  const planOption = element('option', '', season.name); planOption.value = season.id; $('plan-season').append(planOption);
}
$('plan-season').addEventListener('change', renderNewPlanSeasonNote);
$('export-season-config').addEventListener('click', () => {
  const season = getSeason(state);
  const url = URL.createObjectURL(new Blob([JSON.stringify(season, null, 2) + '\n'], { type: 'application/json' }));
  const link = element('a'); link.href = url; link.download = `${season.name}-赛季配置.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('stamina-season').addEventListener('change', () => {
  tryChangeStaminaSeason($('stamina-season').value);
});
$('zoom').min = MIN_ZOOM;
$('zoom').max = MAX_ZOOM;
renderElementFilters();
renderBossPropertyFilters();
renderBossPropertiesCatalog();
renderAll();
renderRestoreWarning();
if (!restoreError) persist();
if (repairedRosters && !restoreError) toast('已保留队伍与分数，无法识别或同队重复的角色已标为待补选；原始配置备份已保留。');
else if (removedOutOfRangeMarker && !restoreError) toast('已移除超出 R15 的旧目标标记，队伍与分数已保留。');
if (disabledIsolationNotice && !restoreError) { $('disabled-removal-notice').textContent = disabledIsolationNotice; $('disabled-removal-notice').hidden = false; toast(disabledIsolationNotice); }
