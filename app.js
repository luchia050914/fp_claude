/* FP2級 再挑戦ドリル  app.js
   外部ライブラリなし。学習データは localStorage に保存します。 */
'use strict';

const APP_VERSION = '1.0.0';
const STORE_KEY = 'fp2drill.store.v1';
const CUSTOM_KEY = 'fp2drill.custom.v1';
const HISTORY_LIMIT = 3000;
const CHOICE_KEYS = ['ア', 'イ', 'ウ', 'エ', 'オ', 'カ'];

/* 分野の定義（priority：3＝最優先、2＝重点、1＝維持） */
const CATEGORIES = [
  { id: 'finance', name: '金融資産運用', group: 'gakka', priority: 3, last: '4/10' },
  { id: 'realestate', name: '不動産', group: 'gakka', priority: 3, last: '4/10' },
  { id: 'life', name: 'ライフプランニングと資金計画', group: 'gakka', priority: 2, last: '5/10' },
  { id: 'risk', name: 'リスク管理', group: 'gakka', priority: 2, last: '5/10' },
  { id: 'practical', name: '実技・計算（資産設計提案業務）', group: 'jitsugi', priority: 2, last: '50/100' },
  { id: 'tax', name: 'タックスプランニング', group: 'gakka', priority: 1, last: '6/10' },
  { id: 'inheritance', name: '相続・事業承継', group: 'gakka', priority: 1, last: '6/10' }
];
const CAT = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
const PRIORITY_LABEL = { 3: '最優先', 2: '重点', 1: '維持' };

const MODES = {
  weak: { label: '弱点集中', desc: '間違えた問題と最優先分野を多めに10問', size: 10 },
  random: { label: 'ランダム', desc: '選んだ分野からランダムに10問', size: 10 },
  mock: { label: '模擬試験', desc: '解説は最後にまとめて表示', size: null },
  wrong: { label: '間違えた問題', desc: '直近で不正解だった問題だけ', size: null },
  fav: { label: 'お気に入り', desc: '★を付けた問題を復習', size: null },
  retry: { label: '解き直し', desc: '', size: null }
};

/* ---------- 状態 ---------- */
let QUESTIONS = [];
let QMAP = new Map();
let META = { dataVersion: '', lawBaseDate: '', lawBaseNote: '' };
let loadError = '';
let store = loadStore();
let view = 'home';
let reviewTab = 'fav';
let pendingChoice = null;
let waitingWorker = null;

/* ---------- 小さな道具 ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(url) {
  try {
    const u = new URL(String(url));
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
  } catch (e) {
    return '';
  }
}

function fmtDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '不明';
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

function fmtNum(n) {
  if (typeof n !== 'number' || !isFinite(n)) return String(n);
  return n.toLocaleString('ja-JP', { maximumFractionDigits: 6 });
}

function pct(correct, total) {
  return total > 0 ? Math.round((correct / total) * 1000) / 10 : null;
}

function pctText(correct, total) {
  const p = pct(correct, total);
  return p === null ? '—' : `${p}%`;
}

function rateClass(p) {
  if (p === null) return '';
  if (p < 60) return 'low';
  if (p < 80) return 'mid';
  return '';
}

function localKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysUntil(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, ms);
}

/* 全角数字・カンマ・単位を取り除いて数値に変換 */
function parseNumber(str) {
  if (typeof str !== 'string') return null;
  let s = str.trim()
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[．。]/g, '.')
    .replace(/[－ー−‐]/g, '-')
    .replace(/[，,、\s]/g, '');
  s = s.replace(/[^0-9.\-]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s) && !/^-?\.\d+$/.test(s)) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

/* ---------- 保存データ ---------- */
function defaultSettings() {
  return {
    examDateGakka: '',
    examDateJitsugi: '',
    theme: 'auto',
    fontScale: 1,
    mockCount: 20,
    selectedCats: CATEGORIES.map(c => c.id)
  };
}

function defaultStore() {
  return {
    version: 1,
    stats: {},
    history: [],
    favorites: [],
    streak: 0,
    bestStreak: 0,
    settings: defaultSettings(),
    session: null
  };
}

function normalizeStore(s) {
  const out = defaultStore();
  if (!s || typeof s !== 'object') return out;
  if (s.stats && typeof s.stats === 'object') out.stats = s.stats;
  if (Array.isArray(s.history)) out.history = s.history.slice(-HISTORY_LIMIT);
  if (Array.isArray(s.favorites)) out.favorites = s.favorites.filter(x => typeof x === 'string');
  out.streak = Number(s.streak) || 0;
  out.bestStreak = Number(s.bestStreak) || 0;
  out.settings = Object.assign(defaultSettings(), (s.settings && typeof s.settings === 'object') ? s.settings : {});
  if (!Array.isArray(out.settings.selectedCats)) out.settings.selectedCats = CATEGORIES.map(c => c.id);
  out.settings.selectedCats = out.settings.selectedCats.filter(id => CAT[id]);
  if (s.session && Array.isArray(s.session.ids)) out.session = s.session;
  return out;
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? normalizeStore(JSON.parse(raw)) : defaultStore();
  } catch (e) {
    return defaultStore();
  }
}

function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (e) {
    toast('保存できませんでした。端末の空き容量を確認してください。');
  }
}

function loadCustom() {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveCustom(arr) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(arr));
    return true;
  } catch (e) {
    toast('追加問題を保存できませんでした。');
    return false;
  }
}

/* ---------- 問題データ ---------- */
function validateQuestion(q) {
  const e = [];
  if (!q || typeof q !== 'object') return ['問題がオブジェクト形式ではありません'];
  if (typeof q.id !== 'string' || !q.id.trim()) e.push('id がありません');
  if (!CAT[q.category]) e.push(`category「${q.category}」は使えません`);
  if (q.type !== 'choice' && q.type !== 'numeric') e.push('type は choice か numeric です');
  if (typeof q.question !== 'string' || !q.question.trim()) e.push('question がありません');
  if (q.type === 'choice') {
    if (!Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > CHOICE_KEYS.length) {
      e.push(`choices は2〜${CHOICE_KEYS.length}個必要です`);
    } else if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) {
      e.push('answer は正解の選択肢の番号（0から数える）です');
    }
  }
  if (q.type === 'numeric' && (typeof q.answer !== 'number' || !isFinite(q.answer))) {
    e.push('answer は数値です');
  }
  if (q.sources != null && !Array.isArray(q.sources)) e.push('sources は配列です');
  return e;
}

async function loadQuestions() {
  let base = { questions: [] };
  loadError = '';
  try {
    const res = await fetch('questions.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    base = await res.json();
  } catch (e) {
    loadError = `問題データ（questions.json）を読み込めませんでした（${e.message}）。index.html と同じフォルダに questions.json があるか、JSONの書式が正しいか確認してください。`;
  }
  META = {
    dataVersion: base.dataVersion || '',
    lawBaseDate: base.lawBaseDate || '',
    lawBaseNote: base.lawBaseNote || ''
  };
  const map = new Map();
  let invalid = 0;
  (Array.isArray(base.questions) ? base.questions : []).forEach(q => {
    if (validateQuestion(q).length === 0) map.set(q.id, q); else invalid++;
  });
  loadCustom().forEach(q => {
    if (validateQuestion(q).length === 0) map.set(q.id, Object.assign({}, q, { _custom: true }));
  });
  QUESTIONS = Array.from(map.values());
  QMAP = new Map(QUESTIONS.map(q => [q.id, q]));
  if (invalid > 0 && !loadError) {
    loadError = `questions.json のうち ${invalid} 問は書式エラーのため読み込みませんでした。`;
  }
}

function catOrder(id) {
  const i = CATEGORIES.findIndex(c => c.id === id);
  return i < 0 ? 99 : i;
}

/* ---------- 出題の重み付け ---------- */
function questionWeight(q, usePriority) {
  const pr = usePriority ? ((CAT[q.category] || {}).priority || 1) : 1;
  const st = store.stats[q.id];
  let w = pr;
  if (!st) return w * 1.6;
  w *= (1 + 2 * st.wrong) / (1 + 1.5 * st.streak);
  if (st.last === false) w *= 1.8;
  const minutes = (Date.now() - (st.lastAt || 0)) / 60000;
  if (minutes < 5) w *= 0.3;
  return Math.max(w, 0.05);
}

function weightedPick(pool, n, usePriority) {
  const rest = pool.slice();
  const out = [];
  while (out.length < n && rest.length) {
    const weights = rest.map(q => questionWeight(q, usePriority));
    const sum = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * sum;
    let i = 0;
    for (; i < rest.length; i++) {
      r -= weights[i];
      if (r <= 0) break;
    }
    if (i >= rest.length) i = rest.length - 1;
    out.push(rest[i].id);
    rest.splice(i, 1);
  }
  return out;
}

/* ---------- 集計 ---------- */
function catStats(catId) {
  const qs = QUESTIONS.filter(q => q.category === catId);
  let attempts = 0, correct = 0, seen = 0;
  qs.forEach(q => {
    const st = store.stats[q.id];
    if (st) { attempts += st.attempts; correct += st.correct; seen++; }
  });
  return { total: qs.length, attempts, correct, seen };
}

function overallStats() {
  let attempts = 0, correct = 0, seen = 0;
  QUESTIONS.forEach(q => {
    const st = store.stats[q.id];
    if (st) { attempts += st.attempts; correct += st.correct; seen++; }
  });
  return { attempts, correct, seen, total: QUESTIONS.length };
}

function wrongIds(pool) {
  return pool.filter(q => {
    const st = store.stats[q.id];
    return st && st.last === false;
  }).map(q => q.id);
}

/* ---------- 画面遷移 ---------- */
function go(next, push = true) {
  if (view === 'quiz' && next !== 'quiz' && store.session && store.session.finished) {
    store.session = null;
    saveStore();
  }
  view = next;
  if (push) history.pushState({ view: next }, '', location.pathname + location.search);
  render();
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', e => {
  const v = (e.state && e.state.view) || 'home';
  go(v, false);
});

function render() {
  const app = $('#app');
  $$('.tabbar button').forEach(b => {
    const active = b.dataset.nav === view || (view === 'quiz' && b.dataset.nav === 'home');
    if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  pendingChoice = null;
  const errorHtml = loadError ? `<div class="error-box">${esc(loadError)}</div>` : '';
  switch (view) {
    case 'quiz': renderQuiz(app, errorHtml); break;
    case 'stats': renderStats(app, errorHtml); break;
    case 'review': renderReview(app, errorHtml); break;
    case 'settings': renderSettings(app, errorHtml); break;
    default: renderHome(app, errorHtml);
  }
}

/* ---------- ホーム ---------- */
function countdownRow(label, sub, dateStr) {
  const d = daysUntil(dateStr);
  let right;
  if (d === null) {
    right = `<div class="days"><span class="unset">試験日が未設定です</span></div>`;
  } else if (d > 0) {
    right = `<div class="days${d <= 7 ? ' soon' : ''}"><small>あと</small><strong>${d}</strong><span>日</span></div>`;
  } else if (d === 0) {
    right = `<div class="days today"><strong>当日</strong></div>`;
  } else {
    right = `<div class="days"><span class="unset">試験日を過ぎています</span></div>`;
  }
  return `<div class="ticket-row">
    <div class="ticket-label">${esc(label)}<span class="sub">${esc(sub)}${dateStr ? `／${esc(fmtDate(dateStr))}` : ''}</span></div>
    ${right}
  </div>`;
}

function renderHome(app, errorHtml) {
  const s = store.settings;
  const o = overallStats();
  const selected = new Set(s.selectedCats);
  const pool = QUESTIONS.filter(q => selected.has(q.category));
  const favCount = pool.filter(q => store.favorites.includes(q.id)).length;
  const wrongCount = wrongIds(pool).length;
  const ss = store.session;
  const resume = ss && !ss.finished && ss.index < ss.ids.length
    ? `<section class="block resume">
        <div><b>途中の学習があります</b><br><span class="note">${esc((MODES[ss.mode] || {}).label || '')}：${ss.index + 1}問目から（全${ss.ids.length}問）</span></div>
        <div class="btn-row" style="margin-top:0">
          <button class="btn primary" type="button" data-act="resume">続きから</button>
          <button class="btn" type="button" data-act="discard">やめる</button>
        </div>
      </section>`
    : '';

  const catRows = CATEGORIES.map(c => {
    const cs = catStats(c.id);
    const p = pct(cs.correct, cs.attempts);
    const on = selected.has(c.id);
    return `<button type="button" class="cat" data-act="toggle-cat" data-cat="${c.id}" aria-pressed="${on}">
      <span class="check" aria-hidden="true">${on ? '✓' : ''}</span>
      <span>
        <span class="cat-name">${esc(c.name)}<span class="prio prio-${c.priority}">${PRIORITY_LABEL[c.priority]}</span></span>
        <span class="cat-sub">前回 ${esc(c.last)}／収録 ${cs.total}問／学習済み ${cs.seen}問</span>
        <span class="bar ${rateClass(p)}"><span style="width:${p === null ? 0 : p}%"></span></span>
      </span>
      <span class="cat-rate">${pctText(cs.correct, cs.attempts)}<small>${cs.attempts}回答</small></span>
    </button>`;
  }).join('');

  const modeBtn = (mode, cls, count, disabledReason) => {
    const m = MODES[mode];
    const disabled = !!disabledReason;
    return `<button type="button" class="mode-btn ${cls}" data-act="start" data-mode="${mode}" ${disabled ? 'disabled' : ''}>
      <b>${esc(m.label)}${count != null ? `（${count}問）` : ''}</b>
      <span>${esc(disabled ? disabledReason : m.desc)}</span>
    </button>`;
  };
  const noPool = pool.length === 0 ? '分野を1つ以上選んでください' : '';

  app.innerHTML = `${errorHtml}
  <div class="home-grid">
    <div class="home-col">
      <section class="ticket" aria-label="試験日までの残り日数">
        <div class="ticket-title">2026年11月 再受験 <small>合格基準 学科36/60・実技60/100</small></div>
        ${countdownRow('学科試験', '前回 30/60', s.examDateGakka)}
        ${countdownRow('実技試験（資産設計提案業務）', '前回 50/100', s.examDateJitsugi)}
        <div class="ticket-foot">${(!s.examDateGakka || !s.examDateJitsugi) ? '<button type="button" class="chip-btn" data-act="goto-settings">試験日を設定する</button>' : '試験日は「設定」で変更できます'}</div>
      </section>
      ${resume}
      <section class="block">
        <h2>学習の記録</h2>
        <div class="tiles">
          <div class="tile"><b>${pctText(o.correct, o.attempts)}</b><span>全体の正答率</span></div>
          <div class="tile"><b>${o.attempts}</b><span>回答数</span></div>
          <div class="tile"><b>${store.streak}</b><span>連続正解</span></div>
        </div>
      </section>
      <section class="block">
        <h2>モードを選んで開始</h2>
        <div class="modes">
          ${modeBtn('weak', 'primary', null, noPool)}
          ${modeBtn('random', '', null, noPool)}
          ${modeBtn('mock', '', Math.min(s.mockCount, pool.length), noPool)}
          ${modeBtn('wrong', '', wrongCount, noPool || (wrongCount === 0 ? '直近で間違えた問題はありません' : ''))}
          ${modeBtn('fav', '', favCount, noPool || (favCount === 0 ? '★を付けた問題はまだありません' : ''))}
        </div>
      </section>
    </div>
    <section class="block">
      <h2>出題する分野</h2>
      <div class="quick">
        <button type="button" class="chip-btn" data-act="cats" data-set="priority">最優先2分野</button>
        <button type="button" class="chip-btn" data-act="cats" data-set="gakka">学科6分野</button>
        <button type="button" class="chip-btn" data-act="cats" data-set="jitsugi">実技・計算</button>
        <button type="button" class="chip-btn" data-act="cats" data-set="all">すべて</button>
      </div>
      <div class="cat-list">${catRows}</div>
      <p class="note" style="margin-top:12px">正答率の色：赤は60%未満、黄は80%未満。弱点集中モードは「最優先」の分野と、間違えた回数が多い問題ほど出やすくなります。</p>
    </section>
  </div>`;
}

function setCats(kind) {
  let ids;
  if (kind === 'priority') ids = CATEGORIES.filter(c => c.priority === 3).map(c => c.id);
  else if (kind === 'gakka') ids = CATEGORIES.filter(c => c.group === 'gakka').map(c => c.id);
  else if (kind === 'jitsugi') ids = CATEGORIES.filter(c => c.group === 'jitsugi').map(c => c.id);
  else ids = CATEGORIES.map(c => c.id);
  store.settings.selectedCats = ids;
  saveStore();
  render();
}

function toggleCat(id) {
  const set = new Set(store.settings.selectedCats);
  if (set.has(id)) set.delete(id); else set.add(id);
  store.settings.selectedCats = CATEGORIES.map(c => c.id).filter(x => set.has(x));
  saveStore();
  render();
}

/* ---------- セッション ---------- */
function startSession(mode, presetIds) {
  const selected = new Set(store.settings.selectedCats);
  const pool = QUESTIONS.filter(q => selected.has(q.category));
  let ids = [];
  if (presetIds) {
    ids = presetIds.filter(id => QMAP.has(id));
  } else if (mode === 'weak') {
    ids = weightedPick(pool, Math.min(MODES.weak.size, pool.length), true);
  } else if (mode === 'random') {
    ids = weightedPick(pool, Math.min(MODES.random.size, pool.length), false);
  } else if (mode === 'mock') {
    ids = shuffle(pool).slice(0, Math.min(store.settings.mockCount, pool.length))
      .sort((a, b) => catOrder(a.category) - catOrder(b.category))
      .map(q => q.id);
  } else if (mode === 'wrong') {
    ids = shuffle(wrongIds(pool));
  } else if (mode === 'fav') {
    ids = shuffle(pool.filter(q => store.favorites.includes(q.id)).map(q => q.id));
  }
  if (ids.length === 0) {
    toast('出題できる問題がありません。分野の選択を確認してください。');
    return;
  }
  store.session = { mode, ids, index: 0, answers: [], startedAt: Date.now(), finished: false };
  saveStore();
  go('quiz');
}

function currentAnswer(ss) {
  return ss.answers.find(a => a.idx === ss.index) || null;
}

function checkAnswer(q, given) {
  if (q.type === 'choice') return given === q.answer;
  if (typeof given !== 'number') return false;
  const tol = (q.numeric && typeof q.numeric.tolerance === 'number') ? Math.abs(q.numeric.tolerance) : 0;
  return Math.abs(given - q.answer) <= tol + 1e-9;
}

function recordResult(q, ok, mode) {
  const now = Date.now();
  const st = store.stats[q.id] || { attempts: 0, correct: 0, wrong: 0, streak: 0, last: null, lastAt: 0 };
  st.attempts++;
  if (ok) { st.correct++; st.streak++; } else { st.wrong++; st.streak = 0; }
  st.last = ok;
  st.lastAt = now;
  store.stats[q.id] = st;
  store.history.push({ id: q.id, c: q.category, ok, at: now, m: mode });
  if (store.history.length > HISTORY_LIMIT) store.history = store.history.slice(-HISTORY_LIMIT);
  if (ok) {
    store.streak++;
    store.bestStreak = Math.max(store.bestStreak, store.streak);
  } else {
    store.streak = 0;
  }
}

function submitAnswer() {
  const ss = store.session;
  if (!ss) return;
  const q = QMAP.get(ss.ids[ss.index]);
  if (!q || currentAnswer(ss)) return;
  let given;
  if (q.type === 'choice') {
    if (pendingChoice === null) { toast('選択肢を選んでください'); return; }
    given = pendingChoice;
  } else {
    const input = $('#numInput');
    given = parseNumber(input ? input.value : '');
    if (given === null) { toast('数値を入力してください（例：1530 や 1.53）'); return; }
  }
  const ok = checkAnswer(q, given);
  ss.answers.push({ id: q.id, idx: ss.index, given, ok });
  recordResult(q, ok, ss.mode);
  if (ss.mode === 'mock') {
    ss.index++;
    if (ss.index >= ss.ids.length) ss.finished = true;
  }
  saveStore();
  render();
  if (ss.mode !== 'mock') {
    const fb = $('#feedback');
    if (fb) fb.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    window.scrollTo(0, 0);
  }
}

function nextQuestion() {
  const ss = store.session;
  if (!ss) return;
  ss.index++;
  if (ss.index >= ss.ids.length) ss.finished = true;
  saveStore();
  render();
  window.scrollTo(0, 0);
}

function toggleFavorite(id) {
  const i = store.favorites.indexOf(id);
  if (i >= 0) {
    store.favorites.splice(i, 1);
    toast('お気に入りから外しました');
  } else {
    store.favorites.push(id);
    toast('お気に入りに追加しました');
  }
  saveStore();
}

/* ---------- 出題画面 ---------- */
function answerLabel(q, v) {
  if (q.type === 'choice') {
    return Number.isInteger(v) && q.choices[v] != null ? `${CHOICE_KEYS[v]}．${q.choices[v]}` : '未回答';
  }
  const unit = (q.numeric && q.numeric.unit) || '';
  return typeof v === 'number' ? `${fmtNum(v)}${unit}` : '未回答';
}

function baseDateHtml(q) {
  const d = q.baseDate || META.lawBaseDate;
  return `<div class="basedate${q.lawSensitive ? ' law' : ''}">制度の基準時点：${esc(fmtDate(d))}${q.lawSensitive ? '（税率・控除額・年金額など法改正の影響を受ける内容を含みます）' : ''}</div>`;
}

function sourcesHtml(q) {
  const list = Array.isArray(q.sources) ? q.sources : [];
  if (list.length === 0) return '<p class="note">この問題は計算方法・一般原則を問うもので、特定の制度数値に依存しません。</p>';
  return `<ul class="sources">${list.map(s => {
    const url = safeUrl(s.url);
    const checked = s.checkedDate
      ? `確認日：${esc(fmtDate(s.checkedDate))}`
      : '<span class="unchecked">確認日：未確認（公的機関の情報で確認してください）</span>';
    return `<li>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || url)}</a>` : esc(s.title || '')}<br>${checked}${s.note ? `<br><span class="note">${esc(s.note)}</span>` : ''}</li>`;
  }).join('')}</ul>`;
}

function feedbackHtml(q, ans) {
  const ok = ans && ans.ok;
  return `<section class="feedback ${ok ? 'ok' : 'ng'}" id="feedback" tabindex="-1">
    <div class="verdict">${ok ? '正解' : '不正解'}</div>
    <p class="answer-line">正解：${esc(answerLabel(q, q.answer))}</p>
    ${ans ? `<p>あなたの答え：${esc(answerLabel(q, ans.given))}</p>` : ''}
    <h4>解説</h4>
    <p class="explain">${esc(q.explanation || '（解説は未登録です）')}</p>
    ${q.formula ? `<h4>計算手順</h4><pre class="formula">${esc(q.formula)}</pre>` : ''}
    ${q.pitfalls ? `<h4>間違えやすいポイント</h4><p class="pitfall">${esc(q.pitfalls)}</p>` : ''}
    <h4>根拠と基準時点</h4>
    ${baseDateHtml(q)}
    ${sourcesHtml(q)}
  </section>`;
}

function renderQuiz(app, errorHtml) {
  const ss = store.session;
  if (!ss) { go('home', false); return; }
  if (ss.finished || ss.index >= ss.ids.length) {
    ss.finished = true;
    renderSessionResult(app, errorHtml);
    return;
  }
  const q = QMAP.get(ss.ids[ss.index]);
  if (!q) {
    ss.index++;
    saveStore();
    renderQuiz(app, errorHtml);
    return;
  }
  const mode = MODES[ss.mode] || { label: '' };
  const ans = ss.mode === 'mock' ? null : currentAnswer(ss);
  const answered = !!ans;
  const fav = store.favorites.includes(q.id);
  const cat = CAT[q.category] || { name: q.category };
  const diff = Math.max(1, Math.min(3, Number(q.difficulty) || 1));
  const progress = Math.round((ss.index / ss.ids.length) * 100);

  let body;
  if (q.type === 'choice') {
    body = `<div class="choices" role="group" aria-label="選択肢">${q.choices.map((c, i) => {
      let cls = '';
      if (answered) {
        if (i === q.answer) cls = 'is-right';
        else if (i === ans.given) cls = 'is-wrong';
      }
      return `<button type="button" class="choice ${cls}" data-act="choose" data-i="${i}" ${answered ? 'disabled' : ''}>
        <span class="key">${CHOICE_KEYS[i]}</span><span>${esc(c)}</span></button>`;
    }).join('')}</div>`;
  } else {
    const unit = (q.numeric && q.numeric.unit) || '';
    const hint = (q.numeric && q.numeric.hint) || '数値を入力';
    body = `<div class="numeric ${answered ? (ans.ok ? 'is-right' : 'is-wrong') : ''}">
      <input id="numInput" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done"
        placeholder="${esc(hint)}" aria-label="答えの数値" ${answered ? `value="${esc(String(ans.given))}" disabled` : ''}>
      <span class="unit">${esc(unit)}</span>
    </div>
    <p class="note" style="margin-top:8px">カンマや全角数字でも入力できます。単位は入力不要です。</p>`;
  }

  const isLast = ss.index + 1 >= ss.ids.length;
  const actionRow = answered
    ? `<div class="btn-row"><button type="button" class="btn primary" data-act="next">${isLast ? '結果を見る' : '次の問題へ'}</button></div>`
    : `<div class="submit-row"><button type="button" class="btn primary" id="submitBtn" data-act="submit" ${q.type === 'choice' ? 'disabled' : ''}>この答えで回答する</button></div>`;

  app.innerHTML = `${errorHtml}
  <div class="quiz-head">
    <span class="mode-name">${esc(mode.label)}</span>
    <span class="count">${ss.index + 1} / ${ss.ids.length}</span>
    <button type="button" class="fav-btn" data-act="fav" data-id="${esc(q.id)}" aria-pressed="${fav}" aria-label="お気に入り">★</button>
    <button type="button" class="quit-btn" data-act="quit">中断</button>
  </div>
  <div class="progress" aria-hidden="true"><span style="width:${progress}%"></span></div>
  <article class="qcard">
    <div class="qmeta">
      <span class="catname">${esc(cat.name)}</span>
      <span>難易度 ${'●'.repeat(diff)}${'○'.repeat(3 - diff)}</span>
      <span>${q.type === 'choice' ? '四択' : '数値入力'}</span>
      <span>${esc(q.id)}${q._custom ? '（追加問題）' : ''}</span>
    </div>
    ${baseDateHtml(q)}
    <p class="qtext">${esc(q.question)}</p>
    ${body}
    ${actionRow}
  </article>
  ${answered ? feedbackHtml(q, ans) + actionRow : ''}
  ${ss.mode === 'mock' ? '<p class="note" style="margin-top:12px">模擬試験モードでは、正解と解説は最後にまとめて表示します。</p>' : ''}`;

  const input = $('#numInput');
  if (input && !answered) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submitAnswer(); }
    });
  }
}

function renderSessionResult(app, errorHtml) {
  const ss = store.session;
  const total = ss.ids.length;
  const correct = ss.answers.filter(a => a.ok).length;
  const p = pct(correct, total) || 0;
  const isMock = ss.mode === 'mock';
  const byCat = {};
  ss.answers.forEach(a => {
    const q = QMAP.get(a.id);
    if (!q) return;
    byCat[q.category] = byCat[q.category] || { n: 0, ok: 0 };
    byCat[q.category].n++;
    if (a.ok) byCat[q.category].ok++;
  });
  const catRows = CATEGORIES.filter(c => byCat[c.id]).map(c => {
    const b = byCat[c.id];
    const cp = pct(b.ok, b.n);
    return `<tr><td>${esc(c.name)}</td><td class="num">${b.ok} / ${b.n}</td>
      <td style="width:40%"><div class="bar ${rateClass(cp)}"><span style="width:${cp}%"></span></div></td><td class="num">${cp}%</td></tr>`;
  }).join('');
  const wrongs = ss.answers.filter(a => !a.ok).map(a => a.id);
  const items = ss.answers.map((a, i) => {
    const q = QMAP.get(a.id);
    if (!q) return '';
    return `<li><details>
      <summary><span class="mark ${a.ok ? 'ok' : 'ng'}">${a.ok ? '○' : '×'}</span>
        <span class="snippet">${i + 1}. ［${esc((CAT[q.category] || {}).name || '')}］${esc(q.question)}</span></summary>
      <div class="inner">${feedbackHtml(q, a)}</div>
    </details></li>`;
  }).join('');
  const passLine = isMock
    ? `<p>${p >= 60 ? '<span class="pass">合格基準の目安（6割）に届いています。</span>' : '<span class="fail">合格基準の目安（6割）まであと少しです。間違えた問題を解き直しましょう。</span>'}</p>`
    : '';

  app.innerHTML = `${errorHtml}
  <section class="block">
    <h2>${esc((MODES[ss.mode] || {}).label || '')}の結果</h2>
    <div class="score-big">${correct} / ${total}<span style="font-size:1.2rem;margin-left:12px">${p}%</span></div>
    ${passLine}
    <div class="table-wrap"><table>
      <thead><tr><th>分野</th><th>正解</th><th>正答率</th><th></th></tr></thead>
      <tbody>${catRows}</tbody>
    </table></div>
    <div class="btn-row">
      ${wrongs.length ? `<button type="button" class="btn primary" data-act="retry" data-ids="${esc(wrongs.join(','))}">間違えた${wrongs.length}問を解き直す</button>` : ''}
      <button type="button" class="btn" data-act="home">ホームへ戻る</button>
    </div>
  </section>
  <section class="block">
    <h2>問題ごとの正解と解説</h2>
    <ul class="qlist">${items}</ul>
  </section>`;
}

/* ---------- 成績 ---------- */
function renderStats(app, errorHtml) {
  const o = overallStats();
  const days = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push({ key: localKey(d.getTime()), label: `${d.getMonth() + 1}/${d.getDate()}`, n: 0, ok: 0 });
  }
  const dayMap = Object.fromEntries(days.map(d => [d.key, d]));
  store.history.forEach(h => {
    const d = dayMap[localKey(h.at)];
    if (d) { d.n++; if (h.ok) d.ok++; }
  });
  const maxN = Math.max(1, ...days.map(d => d.n));
  const week = days.map(d => `<div class="col"><b>${d.n}</b><i style="height:${Math.round((d.n / maxN) * 100)}%"></i><small>${d.label}</small></div>`).join('');

  const catRows = CATEGORIES.map(c => {
    const cs = catStats(c.id);
    const p = pct(cs.correct, cs.attempts);
    return `<tr><td>${esc(c.name)}<span class="prio prio-${c.priority}">${PRIORITY_LABEL[c.priority]}</span><br><span class="note">前回 ${esc(c.last)}</span></td>
      <td class="num">${cs.attempts}</td><td class="num">${cs.seen}/${cs.total}</td>
      <td style="width:30%"><div class="bar ${rateClass(p)}"><span style="width:${p === null ? 0 : p}%"></span></div></td>
      <td class="num">${pctText(cs.correct, cs.attempts)}</td></tr>`;
  }).join('');

  const weak = QUESTIONS.filter(q => store.stats[q.id] && store.stats[q.id].wrong > 0)
    .sort((a, b) => {
      const sa = store.stats[a.id], sb = store.stats[b.id];
      return (sb.wrong / sb.attempts) - (sa.wrong / sa.attempts) || sb.wrong - sa.wrong;
    }).slice(0, 8);
  const weakList = weak.length
    ? `<ul class="qlist">${weak.map(q => {
        const st = store.stats[q.id];
        return `<li><details><summary><span class="mark ng">${st.wrong}</span><span class="snippet">［${esc(CAT[q.category].name)}］${esc(q.question)}</span></summary>
          <div class="inner">${feedbackHtml(q, null)}</div></details></li>`;
      }).join('')}</ul>
      <div class="btn-row"><button type="button" class="btn primary" data-act="retry" data-ids="${esc(weak.map(q => q.id).join(','))}">この${weak.length}問を解く</button></div>`
    : '<p class="empty">まだ間違えた問題はありません。</p>';

  app.innerHTML = `${errorHtml}
  <section class="block">
    <h2>全体</h2>
    <div class="tiles wide">
      <div class="tile"><b>${pctText(o.correct, o.attempts)}</b><span>全体の正答率</span></div>
      <div class="tile"><b>${o.attempts}</b><span>回答数</span></div>
      <div class="tile"><b>${store.streak}</b><span>連続正解（現在）</span></div>
      <div class="tile"><b>${store.bestStreak}</b><span>連続正解（最高）</span></div>
      <div class="tile"><b>${o.seen}/${o.total}</b><span>解いた問題</span></div>
    </div>
  </section>
  <section class="block">
    <h2>直近7日間の回答数</h2>
    <div class="week">${week}</div>
  </section>
  <section class="block">
    <h2>分野別の正答率</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>分野</th><th>回答数</th><th>解いた問題</th><th></th><th>正答率</th></tr></thead>
      <tbody>${catRows}</tbody>
    </table></div>
  </section>
  <section class="block">
    <h2>苦手な問題（不正解の割合が高い順）</h2>
    ${weakList}
  </section>`;
}

/* ---------- 復習 ---------- */
function renderReview(app, errorHtml) {
  const favs = QUESTIONS.filter(q => store.favorites.includes(q.id));
  const wrongs = QUESTIONS.filter(q => store.stats[q.id] && store.stats[q.id].last === false);
  const list = reviewTab === 'fav' ? favs : wrongs;
  const items = list.length
    ? `<ul class="qlist">${list.map(q => `<li><details>
        <summary><span class="mark ${reviewTab === 'fav' ? '' : 'ng'}">${reviewTab === 'fav' ? '★' : '×'}</span>
          <span class="snippet">［${esc(CAT[q.category].name)}］${esc(q.question)}</span></summary>
        <div class="inner">
          <p class="qtext" style="font-size:1rem">${esc(q.question)}</p>
          ${q.type === 'choice' ? `<ol style="padding-left:1.4em">${q.choices.map((c, i) => `<li value="${i + 1}">${CHOICE_KEYS[i]}．${esc(c)}</li>`).join('')}</ol>` : ''}
          ${feedbackHtml(q, null)}
          <div class="btn-row"><button type="button" class="btn" data-act="fav-review" data-id="${esc(q.id)}">${store.favorites.includes(q.id) ? '★ お気に入りから外す' : '☆ お気に入りに追加'}</button></div>
        </div></details></li>`).join('')}</ul>
      <div class="btn-row"><button type="button" class="btn primary" data-act="retry" data-ids="${esc(list.map(q => q.id).join(','))}">この${list.length}問を解く</button></div>`
    : `<p class="empty">${reviewTab === 'fav' ? '出題画面の★ボタンで、あとで見直したい問題を登録できます。' : '直近で間違えた問題はありません。'}</p>`;

  app.innerHTML = `${errorHtml}
  <section class="block">
    <h2>復習</h2>
    <div class="seg" role="group" aria-label="復習の種類">
      <button type="button" data-act="review-tab" data-tab="fav" aria-pressed="${reviewTab === 'fav'}">お気に入り（${favs.length}）</button>
      <button type="button" data-act="review-tab" data-tab="wrong" aria-pressed="${reviewTab === 'wrong'}">間違えた問題（${wrongs.length}）</button>
    </div>
    ${items}
  </section>`;
}

/* ---------- 設定 ---------- */
function renderSettings(app, errorHtml) {
  const s = store.settings;
  const customCount = loadCustom().length;
  app.innerHTML = `${errorHtml}
  <section class="block">
    <h2>試験日</h2>
    <div class="field"><label for="dGakka">学科試験の受検日</label><input id="dGakka" type="date" value="${esc(s.examDateGakka)}" data-setting="examDateGakka"></div>
    <div class="field"><label for="dJitsugi">実技試験（資産設計提案業務）の受検日</label><input id="dJitsugi" type="date" value="${esc(s.examDateJitsugi)}" data-setting="examDateJitsugi"></div>
    <p class="note">CBT試験は学科と実技を別の日に予約できるため、別々に設定できます。</p>
  </section>
  <section class="block">
    <h2>表示</h2>
    <div class="field"><label for="sTheme">テーマ</label>
      <select id="sTheme" data-setting="theme">
        <option value="auto" ${s.theme === 'auto' ? 'selected' : ''}>端末の設定に合わせる</option>
        <option value="light" ${s.theme === 'light' ? 'selected' : ''}>ライト</option>
        <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>ダーク</option>
      </select></div>
    <div class="field"><label for="sFont">文字の大きさ</label>
      <select id="sFont" data-setting="fontScale">
        <option value="1" ${Number(s.fontScale) === 1 ? 'selected' : ''}>大（標準）</option>
        <option value="1.15" ${Number(s.fontScale) === 1.15 ? 'selected' : ''}>特大</option>
        <option value="1.3" ${Number(s.fontScale) === 1.3 ? 'selected' : ''}>最大</option>
      </select></div>
    <div class="field"><label for="sMock">模擬試験の問題数（上限）</label>
      <select id="sMock" data-setting="mockCount">
        ${[10, 20, 30, 60].map(n => `<option value="${n}" ${Number(s.mockCount) === n ? 'selected' : ''}>${n}問</option>`).join('')}
      </select></div>
  </section>
  <section class="block">
    <h2>データの書き出し・読み込み</h2>
    <p class="note">学習データ（正答率・履歴・お気に入り・設定）をJSONファイルに保存できます。機種変更やバックアップに使ってください。問題データのJSONを読み込むと、問題を追加・更新できます（同じIDの問題は上書き）。</p>
    <div class="btn-row">
      <button type="button" class="btn primary" data-act="export-progress">学習データを書き出す</button>
      <label class="file-label">JSONを読み込む<input id="importInput" type="file" accept="application/json,.json"></label>
    </div>
    <div class="btn-row">
      <button type="button" class="btn" data-act="export-questions">問題データを書き出す</button>
      <button type="button" class="btn danger" data-act="clear-custom" ${customCount ? '' : 'disabled'}>追加した問題を削除（${customCount}問）</button>
    </div>
  </section>
  <section class="block">
    <h2>学習履歴のリセット</h2>
    <p class="note">正答率・回答履歴・連続正解・途中経過を消去します。お気に入りと設定は残ります。</p>
    <div class="btn-row"><button type="button" class="btn danger" data-act="reset">学習履歴をリセット</button></div>
  </section>
  <section class="block">
    <h2>このアプリについて</h2>
    <dl class="info-list">
      <dt>アプリ</dt><dd>${APP_VERSION}</dd>
      <dt>問題データ</dt><dd>${esc(META.dataVersion || '不明')}（${QUESTIONS.length}問、うち追加 ${customCount}問）</dd>
      <dt>法令基準日</dt><dd>${esc(fmtDate(META.lawBaseDate))}</dd>
    </dl>
    <p class="note" style="margin-top:12px">${esc(META.lawBaseNote)}</p>
    <p class="note">収録問題はすべてオリジナルです。税率・控除額・年金額などは基準時点の制度に基づきます。出典の確認日が「未確認」の問題は、受験前に公的機関の情報で確認してください。</p>
  </section>`;

  $$('[data-setting]', app).forEach(el => {
    el.addEventListener('change', () => {
      const key = el.dataset.setting;
      let val = el.value;
      if (key === 'fontScale' || key === 'mockCount') val = Number(val);
      store.settings[key] = val;
      saveStore();
      applySettings();
      toast('設定を保存しました');
    });
  });
  const imp = $('#importInput', app);
  if (imp) {
    imp.addEventListener('change', () => {
      const f = imp.files && imp.files[0];
      if (f) importFile(f);
      imp.value = '';
    });
  }
}

function applySettings() {
  const s = store.settings;
  const root = document.documentElement;
  if (s.theme === 'light' || s.theme === 'dark') root.dataset.theme = s.theme;
  else delete root.dataset.theme;
  root.style.setProperty('--scale', String(Number(s.fontScale) || 1));
  const dark = s.theme === 'dark' || (s.theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#19221E' : '#2D6A57');
}

function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  const next = order[(order.indexOf(store.settings.theme) + 1) % order.length];
  store.settings.theme = next;
  saveStore();
  applySettings();
  toast(`テーマ：${{ auto: '端末の設定に合わせる', light: 'ライト', dark: 'ダーク' }[next]}`);
  if (view === 'settings') render();
}

/* ---------- 書き出し・読み込み ---------- */
function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function todayStamp() {
  return localKey(Date.now()).replace(/-/g, '');
}

function exportProgress() {
  downloadJson(`fp2drill-progress-${todayStamp()}.json`, {
    type: 'fp2drill-progress',
    app: APP_VERSION,
    exportedAt: new Date().toISOString(),
    store
  });
  toast('学習データを書き出しました（ダウンロードフォルダ）');
}

function exportQuestions() {
  const qs = QUESTIONS.map(q => {
    const c = Object.assign({}, q);
    delete c._custom;
    return c;
  });
  downloadJson(`fp2drill-questions-${todayStamp()}.json`, {
    schemaVersion: 1,
    dataVersion: META.dataVersion,
    lawBaseDate: META.lawBaseDate,
    lawBaseNote: META.lawBaseNote,
    questions: qs
  });
  toast('問題データを書き出しました');
}

async function importFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    toast('JSONとして読み込めませんでした。ファイルの中身を確認してください。', 4000);
    return;
  }
  if (data && data.type === 'fp2drill-progress' && data.store) {
    if (!confirm('今の学習データを、このファイルの内容に置き換えます。よろしいですか？')) return;
    store = normalizeStore(data.store);
    saveStore();
    applySettings();
    toast('学習データを読み込みました');
    render();
    return;
  }
  const qs = Array.isArray(data) ? data : (data && Array.isArray(data.questions) ? data.questions : null);
  if (!qs) {
    toast('このファイルの形式には対応していません（学習データか問題データのJSONを選んでください）', 4500);
    return;
  }
  const ok = [];
  const ng = [];
  qs.forEach((q, i) => {
    const err = validateQuestion(q);
    if (err.length) ng.push(`${(q && q.id) || `${i + 1}番目`}：${err.join('、')}`);
    else ok.push(q);
  });
  if (!ok.length) {
    alert(`追加できる問題がありませんでした。\n${ng.slice(0, 10).join('\n')}`);
    return;
  }
  const map = new Map(loadCustom().map(q => [q.id, q]));
  ok.forEach(q => {
    const c = Object.assign({}, q);
    delete c._custom;
    map.set(c.id, c);
  });
  if (!saveCustom(Array.from(map.values()))) return;
  await loadQuestions();
  render();
  toast(`${ok.length}問を追加・更新しました${ng.length ? `（${ng.length}問はエラーのため除外）` : ''}`, 4000);
  if (ng.length) alert(`除外した問題：\n${ng.slice(0, 15).join('\n')}`);
}

async function clearCustom() {
  if (!confirm('読み込んで追加した問題をすべて削除します。よろしいですか？')) return;
  saveCustom([]);
  await loadQuestions();
  render();
  toast('追加した問題を削除しました');
}

function resetHistory() {
  if (!confirm('正答率・回答履歴・連続正解・途中経過を消去します。元に戻せません。よろしいですか？')) return;
  if (!confirm('本当にリセットしますか？（念のための確認です）')) return;
  store.stats = {};
  store.history = [];
  store.streak = 0;
  store.bestStreak = 0;
  store.session = null;
  saveStore();
  toast('学習履歴をリセットしました');
  render();
}

/* ---------- 操作の受け付け（イベント委任） ---------- */
document.addEventListener('click', e => {
  const nav = e.target.closest('[data-nav]');
  if (nav) {
    go(nav.dataset.nav);
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  switch (act) {
    case 'toggle-cat': toggleCat(el.dataset.cat); break;
    case 'cats': setCats(el.dataset.set); break;
    case 'start': startSession(el.dataset.mode); break;
    case 'resume': go('quiz'); break;
    case 'discard':
      store.session = null; saveStore(); render(); break;
    case 'goto-settings': go('settings'); break;
    case 'choose': {
      pendingChoice = Number(el.dataset.i);
      $$('.choice').forEach(b => b.classList.toggle('selected', b === el));
      const sb = $('#submitBtn');
      if (sb) sb.disabled = false;
      break;
    }
    case 'submit': submitAnswer(); break;
    case 'next': nextQuestion(); break;
    case 'fav': {
      toggleFavorite(el.dataset.id);
      el.setAttribute('aria-pressed', String(store.favorites.includes(el.dataset.id)));
      break;
    }
    case 'fav-review': toggleFavorite(el.dataset.id); render(); break;
    case 'quit':
      toast('途中経過を保存しました。ホームの「続きから」で再開できます。');
      go('home');
      break;
    case 'retry': {
      const ids = (el.dataset.ids || '').split(',').filter(Boolean);
      store.session = null;
      startSession('retry', shuffle(ids));
      break;
    }
    case 'home':
      store.session = null; saveStore(); go('home'); break;
    case 'review-tab': reviewTab = el.dataset.tab; render(); break;
    case 'export-progress': exportProgress(); break;
    case 'export-questions': exportQuestions(); break;
    case 'clear-custom': clearCustom(); break;
    case 'reset': resetHistory(); break;
    default: break;
  }
});

/* ---------- オンライン／オフライン表示 ---------- */
function updateNet() {
  const b = $('#netBadge');
  if (navigator.onLine) {
    b.textContent = 'オンライン';
    b.className = 'net-badge online';
  } else {
    b.textContent = 'オフラインで動作中';
    b.className = 'net-badge offline';
  }
}
window.addEventListener('online', () => { updateNet(); toast('インターネットに接続しました'); });
window.addEventListener('offline', () => { updateNet(); toast('オフラインになりました。学習はこのまま続けられます。'); });

/* ---------- Service Worker（オフライン対応・更新通知） ---------- */
function showUpdate(worker) {
  waitingWorker = worker;
  $('#updateBar').hidden = false;
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });
  navigator.serviceWorker.register('service-worker.js').then(reg => {
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(nw);
      });
    });
    setInterval(() => { reg.update().catch(() => {}); }, 60 * 60 * 1000);
  }).catch(err => {
    console.warn('Service Worker の登録に失敗しました', err);
  });
}

$('#updateBtn').addEventListener('click', () => {
  if (waitingWorker) waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  $('#updateBar').hidden = true;
});
$('#themeBtn').addEventListener('click', cycleTheme);
if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (mq.addEventListener) mq.addEventListener('change', applySettings);
}

/* ---------- 起動 ---------- */
(async function init() {
  applySettings();
  updateNet();
  await loadQuestions();
  history.replaceState({ view: 'home' }, '', location.pathname + location.search);
  render();
  registerSW();
})();
