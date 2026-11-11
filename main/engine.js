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
  // 特殊アイコン（2026-11-12 追加、メイン版のみ）。原作ごきげんサバイバルの
  // fixed 特別枠の移植で、記号・色名・動きの定義は原作の KINDS と同じ。
  // 入手はストアでの購入のみ。通常のインストールでは出てこない。
  // 数は全アイコンが持ち（初期値1）、同種・同数で重なれば合体して
  // 加算されるのも全種類共通（2026-11-12 ユーザー指定で例外措置を撤廃）。
  // ワープとキシは動きが数に対応しないだけで、合体・捕食の扱いは同じ
  kishi:  { id: 'kishi',  name: 'キシ',   symbol: '♞', dirs: [[1, -2], [2, -1], [2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2]], color: '#b4863a', colorName: 'gold', arrows: ['↗', '↗', '↘', '↘', '↙', '↙', '↖', '↖'], special: true },
  ou:     { id: 'ou',     name: 'オウ',   symbol: '♚', dirs: [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]], color: '#ad668f', colorName: 'rose', arrows: ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'], special: true },
  warp:   { id: 'warp',   name: 'ワープ', symbol: '?', dirs: [], color: '#438c9d', colorName: 'cyan', arrows: ['?'], special: true },
};
const TYPE_IDS = Object.keys(TYPES);
// 通常アイコン4種（インストールで出てくるのはこの中からだけ）
const NORMAL_TYPE_IDS = TYPE_IDS.filter(id => !TYPES[id].special);
// ストアの品揃え（表示順）と価格（2026-11-12 決定）
const SPECIAL_IDS = ['warp', 'kishi', 'ou'];
const PRICES = { warp: 16, kishi: 32, ou: 64 };

const DEFAULT_CONFIG = {
  cols: 4,
  rows: 7, // 2026-11-11 ユーザー指定で 8→7（盤面は 4×7=28マス）
  batteryStart: 100,
  batteryPerMove: 1,   // 仮値: 100回移動でクリア（企画書: 試作後に調整）
  installEvery: 2,     // 2回の移動ごとに1個インストール（2026-11-09 ユーザー指定。変遷： 仮値4 → 3 → 2 → 1 → 3 → 2）
  eagerChance: 0.15,   // 目覚め時にやる気になる確率（2026-11-11 ユーザー指定で 20%→15%）
  rebelChance: 0.05,   // 目覚め時に反抗になる確率（固定。2026-11-11 ユーザー決定で放置の蓄積は全廃）
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
    coins: 0,        // ストアの通貨。そのラン限りで、合体すると「できた数」だけ増える
    purchased: {},   // ストアで買った特殊アイコン（種類ごとに1回まで）
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
    coins: opts.coins ?? 0,
    purchased: opts.purchased ? { ...opts.purchased } : {},
    status: 'playing',
    log: [],
    rng: opts.rng || Math.random,
  };
  return state;
}

function inside(state, x, y) { return x >= 0 && y >= 0 && x < state.cols && y < state.rows; }
function iconAt(icons, x, y) { return icons.find(i => i.x === x && i.y === y) || null; }
// 最下段の列はドック（2026-11-11 ユーザー決定で列全体がゲームの外）。
// 左端が設定、その横が検索の固定アプリで、右の2マスもゲームには
// 使わない。ゲームのアイコンは最下段には入ることができず、
// 空きマスとしても数えない（使えるマスは 28-4=24 個）
const SETTINGS_CELL = { x: 0, y: 6 }; // 最下段（rows-1）
const SEARCH_CELL = { x: 1, y: 6 };
const STORE_CELL = { x: 2, y: 6 }; // ドックの空き枠の1つはストア（2026-11-12）
function isSettingsCell(x, y) { return x === SETTINGS_CELL.x && y === SETTINGS_CELL.y; }
function isSearchCell(x, y) { return x === SEARCH_CELL.x && y === SEARCH_CELL.y; }
function isStoreCell(x, y) { return x === STORE_CELL.x && y === STORE_CELL.y; }
function isReservedCell(x, y) { return y === SETTINGS_CELL.y; }
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
// 通過で自分のマスに重なって残っている同種を、経路の後方へ1マスずつ
// ずらして自分のマスを空ける（フォルダ版の unshare と同じ考え方。
// 2026-11-11 の同期監査で、メインにも同じ塞がりがあったため移植）。
// 後方に同種が連なっていれば、最初の空きマスまで連鎖でずらす。
// 後方が盤面外・予約マス・異種で詰まっていれば false（入れ替え不可）。
function unshareMain(work, mover, dir, cols, rows) {
  const sharer = work.find(i => i.id !== mover.id && i.x === mover.x && i.y === mover.y);
  if (!sharer) return true;
  const chain = [sharer];
  let cx = mover.x - dir[0], cy = mover.y - dir[1];
  for (;;) {
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
    if (isReservedCell(cx, cy)) return false;
    const occ = work.find(i => i.id !== mover.id && i.x === cx && i.y === cy);
    if (!occ) break;
    if (occ.id !== sharer.id && occ.type !== sharer.type) return false;
    chain.push(occ);
    cx -= dir[0]; cy -= dir[1];
  }
  for (const icon of chain) { icon.x -= dir[0]; icon.y -= dir[1]; }
  return true;
}

// 盤面サイズを明示して1歩試す本体
function tryStepOnBoard(work, mover, dir, board, isFinal, intent) {
  const cols = board ? board.cols : 4;
  const rows = board ? board.rows : 7;
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
    // 通過直後で自分のマスに同種が残っていても、後方へずらして空けてから入れ替わる
    if (!unshareMain(work, mover, dir, cols, rows)) return null;
    target.x = mover.x; target.y = mover.y;
    mover.x = nx; mover.y = ny;
    return { icons: work, resultId: mover.id, merged: false, swapped: true };
  }
  // 異種、または同種でも数が違う場合: 常に入れ替わる（押し出しはしない）
  // 通過直後で自分のマスに同種が残っていても、後方へずらして空けてから入れ替わる
  if (!unshareMain(work, mover, dir, cols, rows)) return null;
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

// 目覚め時の機嫌抽選（2026-11-11 ユーザー決定：確率は固定で、
// 蓄積で変わる仕組みは全部なし。反抗 5% / やる気 15% / 残り通常）
function rollMood(state, icon) {
  const cfg = state.config;
  const r = state.rng();
  if (r < cfg.rebelChance) return 'rebel';
  if (r < cfg.rebelChance + cfg.eagerChance) return 'eager';
  return 'normal';
}

/*
 * 移動後の経過処理（移動＝経過制）:
 * - バッテリー減少
 * - 自分以外の睡眠アイコンの z が1減り、0になったら機嫌抽選
 * - 移動した（合体先含む）アイコンは距離分だけ眠る（やる気でも同様）
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
    }
  }

  const result = state.icons.find(i => i.id === resultId);
  if (result) {
    result.z = Math.min(distance, 3);
    result.mood = 'normal';
    events.push({ kind: 'sleep', iconId: result.id, z: result.z });
    if (wasEager) events.push({ kind: 'eagerConsumed', iconId: result.id });
  }

  if (state.battery <= 0) {
    state.status = 'won';
    events.push({ kind: 'won' });
    return events;
  }

  if (state.moves % state.config.installEvery === 0) {
    const cell = installCell(state);
    if (cell) {
      const type = NORMAL_TYPE_IDS[Math.floor(state.rng() * NORMAL_TYPE_IDS.length)];
      const icon = makeIcon(type, cell.x, cell.y);
      state.icons.push(icon);
      events.push({ kind: 'install', iconId: icon.id, type, x: cell.x, y: cell.y });
    }
  }

  // 敗北判定: 使えるマスが全部埋まったら負け。アプリ（設定・検索）のマスは使えないので、
  // 個数ではなく「空きマス（ドックの列を除く）が0」で判定する（最大24個で満杯）
  if (emptyCells(state).length === 0) {
    state.status = 'lost';
    events.push({ kind: 'lost' });
  }
  return events;
}

/*
 * やる気の効果（2026-11-11 ユーザー指定で旧効果「移動しても眠らない」
 * から変更）: やる気アイコンの移動で位置が変わったアイコンは全部、
 * そのアイコンと同じ種類になる（最後に入れ替わった相手も含む。
 * 合体相手は位置が変わらないので対象外。個数・睡眠・機嫌は変わらない）。
 * beforePos は移動前の id -> "x,y" の対応。
 */
function convertDisplaced(state, beforePos, type, events) {
  for (const t of state.icons) {
    const b = beforePos.get(t.id);
    if (b === undefined || b === t.x + ',' + t.y) continue;
    if (t.type === type) continue;
    // 特殊アイコンは変換の対象外（位置が変わっても種類は変わらない）
    if (TYPES[t.type].special) continue;
    events.push({ kind: 'converted', iconId: t.id, from: t.type, to: type });
    t.type = type;
    // 数は全アイコンが持つので、種類が変わっても数はそのまま
  }
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
  if (icon.type === 'warp') return { ok: false, reason: 'ワープは applyWarpSwap を使ってください' };
  const intent = dest.intent === 'swap' ? 'swap' : 'merge';
  // destinations はどちらの intent でも到達可能な全マスを返す（結果の解決だけが違う）。
  // 選べる意図の判定は moveIntents() が担当し、ここでは指定された intent で厳密に実行する
  const cand = destinations(state, iconId, intent).find(d => d.x === dest.x && d.y === dest.y);
  if (!cand) return { ok: false, reason: 'そのマスへは移動できません' };
  const sim = simulateMove(state, iconId, cand.dir, cand.dist, intent);
  if (!sim) return { ok: false, reason: '移動できません' };
  const wasEager = icon.mood === 'eager';
  const beforePos = new Map(state.icons.map(i => [i.id, i.x + ',' + i.y]));
  state.icons = sim.icons;
  const events = [];
  // 合体したら「できた数」だけコインが増える（ストアの通貨）
  if (sim.merged) {
    const resultIcon = state.icons.find(i => i.id === sim.resultId);
    const gained = resultIcon ? resultIcon.count : 0;
    state.coins += gained;
    events.push({ kind: 'coins', amount: gained, total: state.coins });
  }
  if (wasEager) convertDisplaced(state, beforePos, icon.type, events);
  events.push(...progressAfterMove(state, sim.resultId, sim.steps, wasEager));
  return { ok: true, steps: sim.steps, merged: sim.merged, intent, events };
}

/*
 * ワープの発動（2026-11-12）: 盤上の全マス（自分とドックの列以外）から
 * 1マスと居場所を交換する。相手が空きマスならそのまま移動する。
 * target を渡すとそのマスと交換する（やる気のとき、プレイヤーが選ぶ。
 * 変換はしない）。省略するとランダムに決まる。
 * 1手として数え、発動後は睡眠1。入れ替わった相手は眠らない。
 */
function applyWarpSwap(state, iconId, target) {
  if (state.status !== 'playing') return { ok: false, reason: 'ゲームは終了しています' };
  const icon = state.icons.find(i => i.id === iconId);
  if (!icon) return { ok: false, reason: 'アイコンがありません' };
  if (icon.type !== 'warp') return { ok: false, reason: 'ワープではありません' };
  if (icon.z > 0) return { ok: false, reason: '睡眠中は発動できません' };
  let dest = null;
  if (target) {
    if (!inside(state, target.x, target.y) || isReservedCell(target.x, target.y)) {
      return { ok: false, reason: 'そのマスへはワープできません' };
    }
    if (target.x === icon.x && target.y === icon.y) return { ok: false, reason: '自分のマスです' };
    dest = { x: target.x, y: target.y };
  } else {
    const cells = [];
    for (let y = 0; y < state.rows; y++) for (let x = 0; x < state.cols; x++) {
      if (isReservedCell(x, y)) continue;
      if (x === icon.x && y === icon.y) continue;
      cells.push({ x, y });
    }
    if (!cells.length) return { ok: false, reason: 'ワープ先がありません' };
    dest = cells[Math.floor(state.rng() * cells.length)];
  }
  const wasEager = icon.mood === 'eager';
  const partner = iconAt(state.icons, dest.x, dest.y);
  const from = { x: icon.x, y: icon.y };
  icon.x = dest.x; icon.y = dest.y;
  if (partner) { partner.x = from.x; partner.y = from.y; }
  const events = [{ kind: 'warp', iconId: icon.id, x: dest.x, y: dest.y, swappedWith: partner ? partner.id : null }];
  events.push(...progressAfterMove(state, icon.id, 1, wasEager));
  return { ok: true, x: dest.x, y: dest.y, swapped: !!partner, events };
}

/*
 * ストアでの購入（2026-11-12）: コインを払って特殊アイコンを買うと、
 * 通常のインストールと同じ規則（一番手前の空きマス）で即座に置かれる。
 * 購入は1手として数えず、バッテリー・インストール・睡眠の時計も進めない。
 * 同じ種類は1ランに1回まで。全体の購入回数に上限はない。
 */
function buySpecial(state, typeId) {
  if (state.status !== 'playing') return { ok: false, reason: 'ゲームは終了しています' };
  const type = TYPES[typeId];
  if (!type || !type.special) return { ok: false, reason: 'そのアイコンは買えません' };
  if (state.purchased[typeId]) return { ok: false, reason: 'このランではもう買いました' };
  if (state.coins < PRICES[typeId]) return { ok: false, reason: 'コインが足りません' };
  const cell = installCell(state);
  if (!cell) return { ok: false, reason: '空きマスがありません' };
  state.coins -= PRICES[typeId];
  state.purchased[typeId] = true;
  const icon = makeIcon(typeId, cell.x, cell.y);
  state.icons.push(icon);
  return { ok: true, iconId: icon.id, x: cell.x, y: cell.y, events: [{ kind: 'buy', iconId: icon.id, type: typeId, x: cell.x, y: cell.y }] };
}

/*
 * 反抗アイコンの発動（2026-11-12 ユーザー決定で「捕食」に変更。
 * 旧仕様は「自分の方向へ1〜4マス、通常の移動規則でランダムに動く」だった）:
 * 掴んだら発動し、行き先はプレイヤーには選べない。
 * 全アイコンが数を持ち（初期値1）、反抗は全種類とも「捕食」で統一：
 * 着地点にアイコンがいたら取り込み、反抗側の数に相手の数が加算される
 * （相手の種類・数・眠りは関係なし。眠っている相手もそのまま取り込む）。
 * 空きマスならそのまま着地する。これにより2の累乗でない数が生まれる
 * のは仕様どおり。着地点の決め方だけが種類で違う：
 * - ワープ: 盤上の全マス（自分とドック以外）からランダム
 * - キシ: ナイト跳びの着地点からランダム
 * - それ以外（通常アイコンとオウ）: 自分の方向のうちランダムな1方向の
 *   直線上の全マスからランダム（距離は数に関係ない）
 * 捕食・着地の後は、進んだ距離分だけ眠る（上限3）。1手として数え、
 * 時計の進み方は通常の移動と同じ。候補が無ければ発動せず経過も進まない。
 */
function applyRebelMove(state, iconId) {
  if (state.status !== 'playing') return { ok: false, reason: 'ゲームは終了しています' };
  const icon = state.icons.find(i => i.id === iconId);
  if (!icon) return { ok: false, reason: 'アイコンがありません' };
  if (icon.z > 0) return { ok: false, reason: '睡眠中です' };
  if (icon.mood !== 'rebel') return { ok: false, reason: '反抗状態ではありません' };
  // ワープの反抗：盤上のランダムな地点へ移動し、アイコンがいたら
  // 重なって取り込む（通常の発動は「交換」で誰も消えないが、
  // 反抗は他の反抗と同じ捕食）。候補は自分とドックを除く全マス。
  if (icon.type === 'warp') {
    const cells = [];
    for (let y = 0; y < state.config.rows; y += 1) {
      for (let x = 0; x < state.config.cols; x += 1) {
        if (isReservedCell(x, y)) continue;
        if (x === icon.x && y === icon.y) continue;
        cells.push({ x, y, victim: iconAt(state.icons, x, y) });
      }
    }
    if (!cells.length) {
      return { ok: false, reason: '反抗しましたが、動ける場所がありませんでした。', events: [] };
    }
    const land = cells[Math.floor(state.rng() * cells.length)];
    const events = [
      { kind: 'warp', iconId: icon.id, x: land.x, y: land.y, swappedWith: null },
    ];
    let predation = false;
    if (land.victim) {
      icon.count += land.victim.count;
      state.icons = state.icons.filter((item) => item.id !== land.victim.id);
      predation = true;
      events.push({
        kind: 'predation', iconId: icon.id, victimId: land.victim.id,
        victimType: land.victim.type, gained: land.victim.count, x: land.x, y: land.y,
      });
    }
    icon.x = land.x;
    icon.y = land.y;
    events.push(...progressAfterMove(state, icon.id, 1, false));
    return { ok: true, x: land.x, y: land.y, predation, events, rebel: true };
  }
  // キシの反抗：ランダムな着地点へ跳び、相手がいたら取り込む
  if (icon.type === 'kishi') {
    const dests = destinations(state, iconId);
    if (!dests.length) return { ok: false, reason: '反抗しましたが、跳べる場所がありませんでした' };
    const dest = dests[Math.floor(state.rng() * dests.length)];
    const partner = iconAt(state.icons, dest.x, dest.y);
    const events = [];
    let predation = false;
    if (partner) {
      icon.count += partner.count;
      state.icons = state.icons.filter((i) => i.id !== partner.id);
      predation = true;
      events.push({
        kind: 'predation', iconId: icon.id, victimId: partner.id,
        victimType: partner.type, gained: partner.count, x: dest.x, y: dest.y,
      });
    }
    icon.x = dest.x; icon.y = dest.y;
    events.push(...progressAfterMove(state, icon.id, 1, false));
    return { ok: true, steps: 1, predation, x: dest.x, y: dest.y, events, rebel: true };
  }
  const type = TYPES[icon.type];
  // 方向ごとに着地点の候補を集める
  const byDir = [];
  for (const dir of type.dirs) {
    const cells = [];
    let cx = icon.x + dir[0], cy = icon.y + dir[1], dist = 1;
    while (inside(state, cx, cy) && !isReservedCell(cx, cy)) {
      const occ = iconAt(state.icons, cx, cy);
      cells.push({ x: cx, y: cy, dist, victim: occ });
      cx += dir[0]; cy += dir[1]; dist += 1;
    }
    if (cells.length) byDir.push(cells);
  }
  if (!byDir.length) return { ok: false, reason: '反抗しましたが、動ける場所がありませんでした' };
  const line = byDir[Math.floor(state.rng() * byDir.length)];
  const land = line[Math.floor(state.rng() * line.length)];
  const events = [];
  let predation = false;
  if (land.victim) {
    icon.count += land.victim.count;
    state.icons = state.icons.filter(i => i.id !== land.victim.id);
    predation = true;
    events.push({ kind: 'predation', iconId: icon.id, victimId: land.victim.id, victimType: land.victim.type, gained: land.victim.count, x: land.x, y: land.y });
  }
  icon.x = land.x; icon.y = land.y;
  events.push(...progressAfterMove(state, icon.id, land.dist, false));
  return { ok: true, steps: land.dist, predation, x: land.x, y: land.y, events };
}

const api = {
  TYPES, TYPE_IDS, DEFAULT_CONFIG, INITIAL_LAYOUT,
  mulberry32, createGame, createCustomGame,
  inside, iconAt: (state, x, y) => iconAt(state.icons, x, y), emptyCells, installCell,
  SETTINGS_CELL, isSettingsCell, SEARCH_CELL, isSearchCell, isReservedCell,
  STORE_CELL, isStoreCell,
  NORMAL_TYPE_IDS, SPECIAL_IDS, PRICES,
  destinations, moveIntents, applyMove, applyRebelMove, simulateMove, rollMood,
  applyWarpSwap, buySpecial,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
global.HomeMerge = api;

})(typeof window !== 'undefined' ? window : globalThis);
