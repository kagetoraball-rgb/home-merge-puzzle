'use strict';
/*
 * ホーム画面合体パズル — ゲームエンジン
 * 企画書 (2026-11-09) の初期試作スコープを実装する。
 * ごきげんサバイバルから流用したのは「4種の方向アイコン」「機嫌（通常/やる気/反抗/ねむり）」
 * 「移動で他のアイコンの睡眠が進む」という考え方のみ。盤面・ルールは本作専用に新規実装。
 * ブラウザ (window.HomeMerge) と Node (module.exports) の両方で使える。
 */
(function (global) {

// --- 方向アイコン定義（企画書の定義どおり） ---
// 注意: ごきげんサバイバルでは サヨク=＼(↖↘) / ウヨク=／(↗↙) だったが、
// 本企画書では サヨク=／(右上・左下) / ウヨク=＼(左上・右下) と定義が逆。企画書を優先した。
// 記号と色は、ごきげんサバイバルのアイコンと同じものを使う:
// タテ=↕ 紫 / ヨコ=↔ オレンジ / ↗↙方向=⤢ 青 / ↖↘方向=⤡ 緑
// （方向と名前の対応は本企画書の定義: サヨク=↗↙ なので青の⤢、ウヨク=↖↘ なので緑の⤡）
// colorName / arrows は、ごきげんサバイバルの TYPES と同じ指定（CSSクラスと aria-label 用）
const TYPES = {
  tate:   { id: 'tate',   name: 'タテ',   symbol: '↕', dirs: [[0, -1], [0, 1]],   color: '#7862d9', colorName: 'purple', arrows: ['↑', '↓'] },
  yoko:   { id: 'yoko',   name: 'ヨコ',   symbol: '↔', dirs: [[-1, 0], [1, 0]],   color: '#e98a52', colorName: 'orange', arrows: ['→', '←'] },
  sayoku: { id: 'sayoku', name: 'サヨク', symbol: '⤢', dirs: [[1, -1], [-1, 1]], color: '#5598c4', colorName: 'blue',   arrows: ['↗', '↙'] },
  uyoku:  { id: 'uyoku',  name: 'ウヨク', symbol: '⤡', dirs: [[-1, -1], [1, 1]], color: '#7b9b65', colorName: 'green',  arrows: ['↖', '↘'] },
};
const TYPE_IDS = Object.keys(TYPES);

const DEFAULT_CONFIG = {
  cols: 4,
  rows: 8,
  batteryStart: 100,
  batteryPerMove: 1,   // 仮値: 100回移動でクリア（企画書: 試作後に調整）
  installEvery: 2,     // 2回の移動ごとに1個インストール（2026-11-09 ユーザー指定。変遷： 仮値4 → 3 → 2 → 1 → 3 → 2）
  eagerChance: 0.20,   // 仮値: 目覚め時にやる気になる確率
  rebelBase: 0.05,     // 仮値: 反抗の基礎確率
  rebelPerNeglect: 0.03, // 仮値: 放置1ごとに反抗率 +3%
  rebelMax: 0.50,      // 仮値: 反抗率の上限
};

// 初期配置はランダム（2026-11-09 ユーザー指定で企画書の固定配置から変更）。
// 上半分16マスに、各種類4個ずつをシャッフルして置く。
const INITIAL_LAYOUT = [
  ['tate', 'sayoku', 'yoko', 'uyoku'],
  ['uyoku', 'tate', 'sayoku', 'yoko'],
  ['yoko', 'uyoku', 'tate', 'sayoku'],
  ['sayoku', 'yoko', 'uyoku', 'tate'],
];

// 決定的乱数（テスト用）
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let nextId = 1;
function makeIcon(type, x, y, opts = {}) {
  return {
    id: nextId++,
    type,
    count: opts.count ?? 1,
    x, y,
    z: opts.z ?? 0,
    mood: opts.mood ?? 'normal', // 'normal' | 'eager' | 'rebel'（睡眠は z>0 で表す）
    neglect: opts.neglect ?? 0,
  };
}

function createGame(opts = {}) {
  const config = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
  const state = {
    config,
    cols: config.cols,
    rows: config.rows,
    icons: [],
    battery: config.batteryStart,
    moves: 0,
    status: 'playing', // 'playing' | 'won' | 'lost'
    log: [],
    rng: opts.rng || Math.random,
  };
  const deck = INITIAL_LAYOUT.flat();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(state.rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  deck.forEach((type, idx) => {
    state.icons.push(makeIcon(type, idx % config.cols, Math.floor(idx / config.cols)));
  });
  return state;
}

// テスト・デバッグ用に任意配置で開始する
function createCustomGame(iconSpecs, opts = {}) {
  const config = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
  const state = {
    config,
    cols: config.cols,
    rows: config.rows,
    icons: iconSpecs.map(s => makeIcon(s.type, s.x, s.y, s)),
    battery: opts.battery ?? config.batteryStart,
    moves: opts.moves ?? 0,
    status: 'playing',
    log: [],
    rng: opts.rng || Math.random,
  };
  return state;
}

function inside(state, x, y) { return x >= 0 && y >= 0 && x < state.cols && y < state.rows; }
function iconAt(icons, x, y) { return icons.find(i => i.x === x && i.y === y) || null; }
// アプリのアイコンが固定で置かれるマス（最下段：左端が設定、その横が検索。
// 2026-11-09 ユーザー指定）。ゲームのアイコンは入ることができず、
// 空きマスとしても数えない（使えるマスは 32-2=30 個）
const SETTINGS_CELL = { x: 0, y: 7 };
const SEARCH_CELL = { x: 1, y: 7 };
function isSettingsCell(x, y) { return x === SETTINGS_CELL.x && y === SETTINGS_CELL.y; }
function isSearchCell(x, y) { return x === SEARCH_CELL.x && y === SEARCH_CELL.y; }
function isReservedCell(x, y) { return isSettingsCell(x, y) || isSearchCell(x, y); }
function emptyCells(state) {
  const cells = [];
  for (let y = 0; y < state.rows; y++) for (let x = 0; x < state.cols; x++) {
    if (isReservedCell(x, y)) continue;
    if (!iconAt(state.icons, x, y)) cells.push({ x, y });
  }
  return cells;
}

// インストール先の法則（2026-11-09 ユーザー指定）:
// 空きマスの中で「読み順」の優先順位が最も高いマスにインストールされる。
// 読み順とは、左上を起点に、一番上の行を左から右へ、次にその下の行を
// 左から右へ、と進む順序。ランダム要素はない。
// emptyCells は行優先（y→x）で列挙するので、その先頭が該当マスになる。
function installCell(state) {
  const empties = emptyCells(state);
  return empties.length > 0 ? empties[0] : null;
}
function cloneIcons(icons) { return icons.map(i => ({ ...i })); }

/*
 * 1マス分の移動をクローン上で試す。
 * - 空きマス: そのまま移動
 * - 同種・同数: 最終ステップなら、intent で結果が分かれる。
 *   intent='merge'（重ねる）: 合体（相手の count に加算され、移動側は消える）。
 *   intent='swap'（入れ替え）: 合体せず、他の相手と同じく入れ替わる
 *   （2026-11-10 ユーザー指定「重ねる／入れ替えを選べるように」）。
 *   重ねた数（count）が同数同士でないと合体できない
 *   （2026-11-09 ユーザー指定「同数でないと重ならない」）。
 *   途中ならどちらの intent でも合体せずに通過する（2026-11-09 ユーザー指定
 *   「合体の強制はしない」。移動範囲が同種のマスで止まらないようにするため）
 * - 同種・数が違う: 合体はできないが、異種と同じく入れ替わる
 *   （2026-11-09 ユーザー指定「重ならなくても入れ替えはできるように」）
 * - 異種: 相手と入れ替わる（押し出しはしない。入れ替わった相手は眠らない）
 * 戻り値: { icons, resultId, merged, swapped } | null（移動不可）
 */
// 盤面サイズを明示して1歩試す本体
function tryStepOnBoard(work, mover, dir, board, isFinal, intent) {
  const cols = board ? board.cols : 4;
  const rows = board ? board.rows : 8;
  const nx = mover.x + dir[0], ny = mover.y + dir[1];
  if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return null;
  if (isReservedCell(nx, ny)) return null; // アプリ（設定・検索）のマスには入らない
  const target = iconAt(work, nx, ny);
  if (!target) {
    mover.x = nx; mover.y = ny;
    return { icons: work, resultId: mover.id, merged: false };
  }
  if (target.type === mover.type && target.count === mover.count) {
    if (!isFinal) {
      // 通過: 一時的に同じマスに重なるが、最終位置では重ならない
      mover.x = nx; mover.y = ny;
      return { icons: work, resultId: mover.id, merged: false, passed: true };
    }
    if (intent !== 'swap') {
      target.count += mover.count;
      const rest = work.filter(i => i.id !== mover.id);
      return { icons: rest, resultId: target.id, merged: true };
    }
    // intent='swap': 同種・同数でも合体せず入れ替わる（下の入れ替え処理へ合流）。
    // ただし通過直後で自分のマスに同種が残っている場合は入れ替われない
    if (work.some(i => i.id !== mover.id && i.x === mover.x && i.y === mover.y)) return null;
    target.x = mover.x; target.y = mover.y;
    mover.x = nx; mover.y = ny;
    return { icons: work, resultId: mover.id, merged: false, swapped: true };
  }
  // 異種、または同種でも数が違う場合: 常に入れ替わる（押し出しはしない）
  // ただし、通過直後で自分のマスに同種が残っている場合は入れ替われない（重なってしまうため）
  if (work.some(i => i.id !== mover.id && i.x === mover.x && i.y === mover.y)) return null;
  target.x = mover.x; target.y = mover.y;
  mover.x = nx; mover.y = ny;
  return { icons: work, resultId: mover.id, merged: false, swapped: true };
}

/*
 * 指定方向へ dist マス移動を試す（歩行シミュレーション）。
 * 合体するのは最終ステップで同種・同数に着き、かつ intent='merge' のときだけ。
 * 途中の同種は通過する。intent='swap' では最終ステップでも合体せず入れ替わる。
 * intent は操作側（ドラッグのホールド等）が決める意図で、
 * エンジンはそれを受けて結果を計算するだけ（操作と処理の分離。
 * 将来フォルダ操作を同じ意図の枠に差し替えられるようにするため）。
 * 戻り値: { icons, resultId, steps, merged, swapped } | null
 */
function simulateMove(state, iconId, dir, dist, intent = 'merge') {
  let icons = cloneIcons(state.icons);
  let resultId = iconId;
  let swapped = false;
  for (let step = 1; step <= dist; step++) {
    const cur = icons.find(i => i.id === resultId);
    if (!cur) return null;
    const r = tryStepOnBoard(icons, cur, dir, state, step === dist, intent);
    if (!r) return null;
    icons = r.icons;
    if (r.swapped) swapped = true;
    if (r.merged) return { icons, resultId: r.resultId, steps: step, merged: true, swapped };
    resultId = r.resultId;
  }
  return { icons, resultId, steps: dist, merged: false, swapped };
}

// 選択中アイコンの移動候補一覧。intent を渡すと、その意図で解決した候補を返す。
// 同じマスでも intent によって結果（合体か入れ替えか）が変わりうる。
function destinations(state, iconId, intent = 'merge') {
  const icon = state.icons.find(i => i.id === iconId);
  if (!icon || state.status !== 'playing') return [];
  if (icon.z > 0) return []; // 睡眠中は自分から動けない
  const type = TYPES[icon.type];
  const out = [];
  for (const dir of type.dirs) {
    for (let d = 1; d <= icon.count; d++) {
      const sim = simulateMove(state, iconId, dir, d, intent);
      // 失敗しても打ち切らない: 「同数でないのでそのマスには止まれない」が理由の
      // 場合、その先へ通過する候補はありうるため（壁などの失敗は先でも同様に失敗する）
      if (!sim) continue;
      const result = sim.icons.find(i => i.id === sim.resultId);
      out.push({
        x: result.x, y: result.y,
        dist: sim.steps, dir, merged: sim.merged, intent,
        pushed: sim.icons.length === state.icons.length && !sim.merged
          ? movedOthers(state.icons, sim.icons, iconId)
          : !sim.merged,
      });
      // 合体できるマスより先（通過した先）も候補になるので、ここでは打ち切らない
      if (sim.steps < d) break;
    }
  }
  return out;
}

/*
 * あるマス（アイコンがいるマス）に対して選べる意図の一覧を返す。
 * - 'merge'（重ねる）: 同種・同数で合体が成立する場合のみ
 * - 'swap'（入れ替え）: 入れ替えとして到達できる場合
 * 同種・同数では両方選べる。通過直後の同種に隣接する等、入れ替えだけが
 * 成立しない場合は ['merge'] だけになることもある。
 * アイコンがいないマス・到達できないマスでは []。
 */
function moveIntents(state, iconId, x, y) {
  if (!iconAt(state.icons, x, y)) return [];
  const intents = [];
  const mergeDest = destinations(state, iconId, 'merge')
    .find(d => d.x === x && d.y === y && d.merged);
  if (mergeDest) intents.push('merge');
  const swapDest = destinations(state, iconId, 'swap')
    .find(d => d.x === x && d.y === y);
  if (swapDest) intents.push('swap');
  return intents;
}

function movedOthers(before, after, moverId) {
  const beforeMap = new Map(before.filter(i => i.id !== moverId).map(i => [i.id, i]));
  return after.some(i => {
    const b = beforeMap.get(i.id);
    return b && (b.x !== i.x || b.y !== i.y || b.count !== i.count);
  });
}

// 目覚め時の機嫌抽選（放置が多いほど反抗しやすい）
function rollMood(state, icon) {
  const cfg = state.config;
  const rebelChance = Math.min(cfg.rebelMax, cfg.rebelBase + icon.neglect * cfg.rebelPerNeglect);
  const r = state.rng();
  icon.neglect = 0;
  if (r < rebelChance) return 'rebel';
  if (r < rebelChance + cfg.eagerChance) return 'eager';
  return 'normal';
}

/*
 * 移動後の経過処理（移動＝経過制）:
 * - バッテリー減少
 * - 自分以外の睡眠アイコンの z が1減り、0になったら機嫌抽選
 * - 自分以外の通常アイコンの放置 +1
 * - 移動した（合体先含む）アイコンは距離分だけ眠る（やる気消費時は眠らない）
 * - 一定経過ごとに新規アイコンをランダムな空きマスへインストール
 * - 勝敗判定（バッテリー0で勝ち / 全マス埋まると負け）
 */
function progressAfterMove(state, resultId, distance, wasEager) {
  const events = [];
  state.moves += 1;
  state.battery = Math.max(0, state.battery - state.config.batteryPerMove);

  for (const icon of state.icons) {
    if (icon.id === resultId) continue;
    if (icon.z > 0) {
      icon.z -= 1;
      if (icon.z === 0) {
        icon.mood = rollMood(state, icon);
        events.push({ kind: 'wake', iconId: icon.id, mood: icon.mood });
      }
    } else if (icon.mood === 'normal') {
      icon.neglect += 1;
    }
  }

  const result = state.icons.find(i => i.id === resultId);
  if (result) {
    result.neglect = 0;
    if (wasEager) {
      result.mood = 'normal';
      result.z = 0;
      events.push({ kind: 'eagerConsumed', iconId: result.id });
    } else {
      result.z = Math.min(distance, 3);
      result.mood = 'normal';
      events.push({ kind: 'sleep', iconId: result.id, z: result.z });
    }
  }

  if (state.battery <= 0) {
    state.status = 'won';
    events.push({ kind: 'won' });
    return events;
  }

  if (state.moves % state.config.installEvery === 0) {
    const cell = installCell(state);
    if (cell) {
      const type = TYPE_IDS[Math.floor(state.rng() * TYPE_IDS.length)];
      const icon = makeIcon(type, cell.x, cell.y);
      state.icons.push(icon);
      events.push({ kind: 'install', iconId: icon.id, type, x: cell.x, y: cell.y });
    }
  }

  // 敗北判定: 使えるマスが全部埋まったら負け。アプリ（設定・検索）のマスは使えないので、
  // 個数ではなく「空きマス（アプリのマスを除く）が0」で判定する（最大30個で満杯）
  if (emptyCells(state).length === 0) {
    state.status = 'lost';
    events.push({ kind: 'lost' });
  }
  return events;
}

// 通常の移動を実行する。dest は destinations() の要素（または {x, y, intent?}）。
// dest.intent が 'swap' なら、同種・同数のマスでも合体せず入れ替える。
// 省略時は 'merge'（従来どおり、合体できるマスでは合体する）
function applyMove(state, iconId, dest) {
  if (state.status !== 'playing') return { ok: false, reason: 'ゲームは終了しています' };
  const icon = state.icons.find(i => i.id === iconId);
  if (!icon) return { ok: false, reason: 'アイコンがありません' };
  if (icon.z > 0) return { ok: false, reason: '睡眠中は自分から動けません' };
  if (icon.mood === 'rebel') return { ok: false, reason: '反抗中は applyRebelMove を使ってください' };
  const intent = dest.intent === 'swap' ? 'swap' : 'merge';
  // destinations はどちらの intent でも到達可能な全マスを返す（結果の解決だけが違う）。
  // 選べる意図の判定は moveIntents() が担当し、ここでは指定された intent で厳密に実行する
  const cand = destinations(state, iconId, intent).find(d => d.x === dest.x && d.y === dest.y);
  if (!cand) return { ok: false, reason: 'そのマスへは移動できません' };
  const sim = simulateMove(state, iconId, cand.dir, cand.dist, intent);
  if (!sim) return { ok: false, reason: '移動できません' };
  const wasEager = icon.mood === 'eager';
  state.icons = sim.icons;
  const events = progressAfterMove(state, sim.resultId, sim.steps, wasEager);
  return { ok: true, steps: sim.steps, merged: sim.merged, intent, events };
}

/*
 * 反抗アイコンの移動: プレイヤーは「動かす」ことだけ決め、
 * 方向と距離はランダム（移動上限＝合体数の制限を受けない、最大4マス: 仮実装）。
 * 動ける候補が無ければ移動せず経過も進まない。
 */
function applyRebelMove(state, iconId) {
  if (state.status !== 'playing') return { ok: false, reason: 'ゲームは終了しています' };
  const icon = state.icons.find(i => i.id === iconId);
  if (!icon) return { ok: false, reason: 'アイコンがありません' };
  if (icon.z > 0) return { ok: false, reason: '睡眠中です' };
  if (icon.mood !== 'rebel') return { ok: false, reason: '反抗状態ではありません' };
  const type = TYPES[icon.type];
  const candidates = [];
  for (const dir of type.dirs) for (let d = 1; d <= 4; d++) candidates.push({ dir, d });
  // ランダムな順序で試す
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(state.rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (const c of candidates) {
    const sim = simulateMove(state, iconId, c.dir, c.d);
    if (!sim) continue;
    const result = sim.icons.find(i => i.id === sim.resultId);
    const before = icon;
    if (!sim.merged && result.x === before.x && result.y === before.y) continue;
    state.icons = sim.icons;
    const events = progressAfterMove(state, sim.resultId, sim.steps, false);
    return { ok: true, steps: sim.steps, merged: sim.merged, events, x: result.x, y: result.y };
  }
  return { ok: false, reason: '反抗しましたが、動ける場所がありませんでした' };
}

const api = {
  TYPES, TYPE_IDS, DEFAULT_CONFIG, INITIAL_LAYOUT,
  mulberry32, createGame, createCustomGame,
  inside, iconAt: (state, x, y) => iconAt(state.icons, x, y), emptyCells, installCell,
  SETTINGS_CELL, isSettingsCell, SEARCH_CELL, isSearchCell, isReservedCell,
  destinations, moveIntents, applyMove, applyRebelMove, simulateMove, rollMood,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
global.HomeMerge = api;

})(typeof window !== 'undefined' ? window : globalThis);
