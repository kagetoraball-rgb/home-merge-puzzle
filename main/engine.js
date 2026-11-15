'use strict';
/*
 * ホーム画面合体パズル — ゲームエンジン
 * 企画書 (2026-11-09) の初期試作スコープを実装する。
 * ごきげんサバイバルから流用したのは「4種の方向アイコン」「機嫌（通常/やる気/反抗/ねむり）」
 * 「移動で他のアイコンの睡眠が進む」という考え方のみ。盤面・ルールは本作専用に新規実装。
 * ブラウザ (window.HomeMerge) と Node (module.exports) の両方で使える。
 */
(function (global) {

// --- 方向アイコン定義 ---
// 注意: 企画書では サヨク=／(右上・左下) / ウヨク=＼(左上・右下) と定義されていたが、
// ごきげんサバイバル（旧作）では サヨク=＼(↖↘) / ウヨク=／(↗↙) で、ユーザーの認識も旧作どおり。
// 当初は企画書を優先したが、2026-11-13 にユーザーの認識（＝旧作）に合わせて入れ替えた。
// 記号と色は方向についたまま使う:
// タテ=↕ 紫 / ヨコ=↔ オレンジ / ↗↙方向=⤢ 青（ウヨク） / ↖↘方向=⤡ 緑（サヨク）
// colorName / arrows は、ごきげんサバイバルの TYPES と同じ指定（CSSクラスと aria-label 用）
const TYPES = {
  tate:   { id: 'tate',   name: 'タテ',   symbol: '↕', dirs: [[0, -1], [0, 1]],   color: '#7862d9', colorName: 'purple', arrows: ['↑', '↓'] },
  yoko:   { id: 'yoko',   name: 'ヨコ',   symbol: '↔', dirs: [[-1, 0], [1, 0]],   color: '#e98a52', colorName: 'orange', arrows: ['→', '←'] },
  // サヨク／ウヨクの対応は 2026-11-13 にユーザーの認識へ合わせて入れ替えた：
  // サヨク＝＼（緑）、ウヨク＝／（青）。性格の数値（PERSONALITY）は名前側に据え置き。
  sayoku: { id: 'sayoku', name: 'サヨク', symbol: '⤡', dirs: [[-1, -1], [1, 1]], color: '#7b9b65', colorName: 'green',  arrows: ['↖', '↘'] },
  uyoku:  { id: 'uyoku',  name: 'ウヨク', symbol: '⤢', dirs: [[1, -1], [-1, 1]], color: '#5598c4', colorName: 'blue',   arrows: ['↗', '↙'] },
  // 特殊アイコン（2026-11-12 追加、メイン版のみ）。原作ごきげんサバイバルの
  // fixed 特別枠の移植で、記号・色名・動きの定義は原作の KINDS と同じ。
  // 入手はストアでの購入のみ。通常のインストールでは出てこない。
  // 数は全アイコンが持ち（初期値1）、同種・同数で重なれば合体して
  // 加算されるのも全種類共通（2026-11-12 ユーザー指定で例外措置を撤廃）。
  // ワープは動きが数に対応しないだけで、合体・捕食の扱いは同じ。
  // スピン（2026-11-12、弱かったキシの代わりにユーザー発案で新設）：
  // Y字の3方向（左上・右上・下）に自分の数だけ直線移動でき、
  // 自分で動くたびにアイコンごと90度右回転して向きが変わる
  spin:   { id: 'spin',   name: 'スピン', symbol: 'Y', dirs: [[-1, -1], [1, -1], [0, 1]], color: '#b4863a', colorName: 'gold', arrows: ['↖', '↗', '↓'], special: true },
  ou:     { id: 'ou',     name: 'オウ',   symbol: '♚', dirs: [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]], color: '#ad668f', colorName: 'rose', arrows: ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'], special: true },
  warp:   { id: 'warp',   name: 'ワープ', symbol: '?', dirs: [], color: '#438c9d', colorName: 'cyan', arrows: ['?'], special: true },
};
const TYPE_IDS = Object.keys(TYPES);
// 通常アイコン4種（インストールで出てくるのはこの中からだけ）
const NORMAL_TYPE_IDS = TYPE_IDS.filter(id => !TYPES[id].special);
// ストアの品揃え（表示順）と価格（2026-11-15 ユーザー決定で
// 16/32/64 から値下げ）
const SPECIAL_IDS = ['warp', 'spin', 'ou'];
const PRICES = { warp: 10, spin: 20, ou: 40 };

// 性格補正（2026-11-13 ユーザー決定。メイン版のみ）。
// rebel / eager は目覚め時の機嫌抽選の確率、sleep は移動1マスごとに
// 眠りに落ちる確率。基礎は 反抗5% / やる気10% / 眠り80%（やる気は当初15%だったが、2026-11-14夜にユーザーが「高すぎるかも」として10%へ。ワープは ×3/2 で15%）。
// 機嫌の補正は倍率（逆数ペア：×2 と ×1/2、×3/2 と ×2/3）だが、
// 眠りの補正だけは倍率だと極端になるため ±10ポイントの加減算
// （2026-11-13 ユーザー決定で ×4/3／×3/4 から差し替え）：
// - ウヨク: 反抗 ×1/2、眠り +10ポイント＝90%（旧：×4/3 で実効100%）
// - サヨク: 反抗 ×2、眠り −10ポイント＝70%（旧：×3/4 で60%）
// - ワープ: やる気 ×3/2。移動距離がないので眠り判定は1回だけ（当たれば1z）
// - スピン: 反抗 ×1/2（キシの後継枠として「反抗しにくい」を引き継ぐ）
// - オウ: やる気は標準（以前の ×2/3 案と 10% 固定は差し替え済み）、眠り −10ポイント＝70%
const PERSONALITY = {
  tate:   { rebel: 0.05,  eager: 0.10,  sleep: 0.8 },
  yoko:   { rebel: 0.05,  eager: 0.10,  sleep: 0.8 },
  uyoku:  { rebel: 0.025, eager: 0.10,  sleep: 0.9 },
  sayoku: { rebel: 0.10,  eager: 0.10,  sleep: 0.7 },
  warp:   { rebel: 0.05,  eager: 0.15,  sleep: 0.8 },
  spin:   { rebel: 0.025, eager: 0.10,  sleep: 0.8 },
  ou:     { rebel: 0.05,  eager: 0.10,  sleep: 0.7 },
};

const DEFAULT_CONFIG = {
  cols: 4,
  rows: 7, // 2026-11-11 ユーザー指定で 8→7（盤面は 4×7=28マス）
  batteryStart: 100,
  batteryPerMove: 1,   // 旧方式（手数制）: 100回移動でクリア。コース制では 0 にして時間制へ
  batterySecPerPercent: 0, // 時間制バッテリー（チュートリアル基準の換算はアプリ側で 1%＝6秒＝100%で10分、チュートリアル30%を3分で消費。2026-11-15 夜に 1%＝12秒から変更）。0 の間は時間では減らない。減らす間隔そのものはアプリ側の時計が数え、tickBattery を呼ぶ
  installEvery: 2,     // （旧方式）2回の移動ごとに1個インストール。installIntervalSec が有効な間は使われない
  winCount: 3, // クリアになる合体数（2026-11-16：コースごとに変えられるようにした。2ページ目は4）
  installIntervalSec: 5, // リアルタイム制（2026-11-13 ユーザー指定でメイン版もフォルダ版と同じ時間連動へ）：プレイ中、5秒ごとに tick（眠りの進行＋1個インストール）
  // 機嫌抽選の確率は PERSONALITY（種類別）が正本。以下の2つは表に無い
  // 種類向けの予備値としてだけ使う
  eagerChance: 0.10,
  rebelChance: 0.05,
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
    voided: opts.voided ?? false, // 旧仕様（反抗で数字が無効化された印）の名残。2026-11-15以降は常に false
    orient: opts.orient ?? 0, // スピンの向き（0..3、90度右回転の回数）。他種では未使用
    spun: opts.spun ?? false, // スピンが一度でも回転したか（目の切り替えに使う）
    sleepProgress: opts.sleepProgress ?? 0, // 個別タイマーの進み（秒）。次の z 減少までの蓄積
    sleepMs: opts.sleepMs ?? 0, // 個別タイマーの進み（ミリ秒、アプリ側が実時間で加算）。次の z 減少までの蓄積
  };
}

// アイコンの現在の移動方向。スピンだけは向き（orient）で回転する：
// 基準はY字（左上・右上・下）で、90度右回転は (dx,dy) -> (-dy,dx)
function dirsOf(icon) {
  const base = TYPES[icon.type].dirs;
  if (icon.type !== 'spin') return base;
  const o = ((icon.orient ?? 0) % 4 + 4) % 4;
  let dirs = base;
  for (let i = 0; i < o; i++) dirs = dirs.map(([dx, dy]) => [-dy, dx]);
  return dirs;
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
 *   intent='merge'（重ねる）: 合体（数は +1 になり、移動側は消える。
 *   2026-11-12 ユーザー指定で足し算から変更）。相手が反抗中でも、
 *   同種・同数なら合体できる（2026-11-15 ユーザー決定）。
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
      target.count += 1;
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
  const out = [];
  for (const dir of dirsOf(icon)) {
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

// 目覚め時の機嫌抽選（確率は固定で、蓄積で変わる仕組みは全部なし。
// 確率は種類ごとに PERSONALITY で補正される）
function rollMood(state, icon) {
  const p = PERSONALITY[icon.type] || { rebel: state.config.rebelChance, eager: state.config.eagerChance };
  const r = state.rng();
  if (r < p.rebel) return 'rebel';
  if (r < p.rebel + p.eager) return 'eager';
  return 'normal';
}

// 眠りの確率判定（2026-11-13 ユーザー決定）：従来の「距離分だけ決定的に
// 眠る」をやめ、移動したマスごとにその種類の眠り確率で判定し、
// 当たったマス数だけ z が増える（上限3）。合計0なら眠らない
function rollSleep(state, icon, distance) {
  const p = PERSONALITY[icon.type] || { sleep: 0.8 };
  const chance = Math.min(p.sleep, 1);
  let z = 0;
  for (let i = 0; i < distance; i++) {
    if (state.rng() < chance) z += 1;
  }
  return Math.min(z, 3);
}

// 眠りの進行：眠っているアイコンの z が1減り、0になったら機嫌抽選。
// 移動後の経過と、リアルタイム制の tick の両方から使う。
// exceptId は進ませないアイコン（移動した本人。tick では null で全員）
function advanceSleep(state, events, exceptId) {
  for (const icon of state.icons) {
    if (icon.id === exceptId) continue;
    advanceSleepOne(state, icon, events);
  }
}

// 1個だけ眠りを1段進める（個別タイマー方式の時計から使う）。
// z が0になったら機嫌抽選する
function advanceSleepOne(state, icon, events) {
  if (icon.z > 0) {
    icon.z -= 1;
    if (icon.z === 0) {
      icon.mood = rollMood(state, icon);
      // 反抗になっても数字は消えない（2026-11-15 ユーザー決定で
      // 変更。以前は反抗になった時点で数が消えて1扱いだった）。
      // 捕食で相手の数が移ることもない
      events.push({ kind: 'wake', iconId: icon.id, mood: icon.mood });
    }
  }
}

/*
 * 移動後の経過処理（移動＝経過制）:
 * - バッテリー減少
 * - 自分以外の睡眠アイコンの z が1減り、0になったら機嫌抽選
 * - 移動した（合体先含む）アイコンは、移動したマスごとの確率判定で
 *   当たった分だけ眠る（上限3、やる気でも同様。0なら眠らない）
 * - インストールはリアルタイム制の tick が担う（installIntervalSec が
 *   無効な場合だけ、旧方式の移動連動インストールが働く）
 * - 勝敗判定（合体数3を作ると勝ち / バッテリー0か全マス埋まると負け）
 */
function progressAfterMove(state, resultId, distance, wasEager, madeCount = null) {
  const events = [];
  state.moves += 1;
  state.battery = Math.max(0, state.battery - state.config.batteryPerMove);

  // 眠りの手数進行は、アプリが「手数で進める場面」（チュートリアルの
  // 導入フロー中）だと state.sleepByMoves で知らせる時だけ行う。
  // 自由プレイでは眠りは個別タイマー（秒）で進むので、ここでは
  // 進めない（2026-11-14夜 ユーザー決定：設置に合わせても、他を
  // 動かしても、休みは縮まらない）。エンジン単体では従来どおり進める
  if (state.sleepByMoves !== false) advanceSleep(state, events, resultId);

  const result = state.icons.find(i => i.id === resultId);
  if (result) {
    result.z = rollSleep(state, result, distance);
    result.sleepProgress = 0; // 眠り直し：個別タイマーはここから数え直す
    result.sleepMs = 0;
    result.mood = 'normal';
    result.voided = false;
    if (result.z > 0) events.push({ kind: 'sleep', iconId: result.id, z: result.z });
    if (wasEager) events.push({ kind: 'eagerConsumed', iconId: result.id });
  }

  // クリア判定（2026-11-15 ユーザー決定で変更）：合体や捕食で
  // 目標の合体数（config.winCount、通常は3）のアイコンを作ったら
  // クリア。バッテリー切れは勝ちではなくゲームオーバーになった
  if (madeCount === state.config.winCount && state.status === 'playing') {
    state.status = 'won';
    events.push({ kind: 'won' });
    return events;
  }

  if (state.battery <= 0) {
    state.status = 'lost';
    events.push({ kind: 'lost' });
    return events;
  }

  if (!(state.config.installIntervalSec > 0) && state.moves % state.config.installEvery === 0) {
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

// リアルタイム制の tick（2026-11-13 ユーザー指定：フォルダ版の
// リアルタイム・インストールと同じ仕組みに、眠りの進行を足したもの。
// ユーザーの見立て「秒数の決まったインストールを眠りのカウントに
// すれば、全員睡眠の詰みが解ける」に基づく）：
// - 眠っている全アイコンの z が1減り、0になったら機嫌抽選
//   （全員眠っていても時間で目覚めるので、詰むことがない）
// - 新しいアイコンが1個、読み順で最速の空きマスへ入る（通常種のみ）
// - 入れて満杯になったら、その時点で敗北。置く場所が既に無ければ
//   （購入で満杯になった直後など）も敗北
// - バッテリーと手数は進まない
function applyRealtimeTick(state) {
  if (state.status !== 'playing') return { ok: false, events: [] };
  const events = [];
  advanceSleep(state, events, null);
  events.push(...tickInstall(state).events);
  return { ok: true, events };
}

// 眠りの進行だけの tick。applyRealtimeTick の眠り部分と同じ内容を
// 単体で呼べるようにしたもの（単体テスト・将来用。アプリの時計は
// 眠りを個別タイマーで進めるため advanceSleepOne を使い、設置は
// tickInstall を使う：2026-11-14夜の切り離し以降）
function tickSleep(state) {
  if (state.status !== 'playing') return { ok: false, events: [] };
  const events = [];
  advanceSleep(state, events, null);
  return { ok: true, events };
}

// インストールだけの tick（コース制の時計から、コースごとの間隔で
// 呼ばれる）。applyRealtimeTick のインストール部分と同じ内容
function tickInstall(state) {
  if (state.status !== 'playing') return { ok: false, events: [] };
  const events = [];
  const cell = installCell(state);
  if (!cell) {
    state.status = 'lost';
    events.push({ kind: 'lost' });
    return { ok: true, events };
  }
  const type = NORMAL_TYPE_IDS[Math.floor(state.rng() * NORMAL_TYPE_IDS.length)];
  const icon = makeIcon(type, cell.x, cell.y);
  state.icons.push(icon);
  events.push({ kind: 'install', iconId: icon.id, type, x: cell.x, y: cell.y });
  if (emptyCells(state).length === 0) {
    state.status = 'lost';
    events.push({ kind: 'lost' });
  }
  return { ok: true, events };
}

// 時間制バッテリーの tick：1% 減らし、0 になったらゲームオーバー
// （2026-11-15 ユーザー決定。以前は0でクリアだった）。
// 減らす間隔（batterySecPerPercent 秒）はアプリ側の時計が数える
function tickBattery(state) {
  if (state.status !== 'playing') return { ok: false, events: [] };
  const events = [];
  state.battery = Math.max(0, state.battery - 1);
  if (state.battery <= 0) {
    state.status = 'lost';
    events.push({ kind: 'lost' });
  }
  return { ok: true, events };
}

// 保存データから読み込んだアイコンの id と、新規アイコンの id が
// 重ならないよう、採番カウンタを既存の最大 id の先まで進める
function reserveIconIds(ids) {
  for (const id of ids) {
    if (typeof id === 'number' && id >= nextId) nextId = id + 1;
  }
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
    if (type === 'spin') t.orient = 0; // 変換で生まれたスピンは初期の向き（Y字）
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
  // スピンは自分で動くたびに90度右回転する。合体で相手に取り込まれた
  // 場合は、残った相手側は動いていないので回らない
  if (icon.type === 'spin' && !sim.merged) {
    const moved = state.icons.find(i => i.id === iconId);
    if (moved) { moved.orient = ((moved.orient ?? 0) + 1) % 4; moved.spun = true; }
  }
  const events = [];
  // 合体したら「できた数」だけコインが増える（ストアの通貨）
  if (sim.merged) {
    const resultIcon = state.icons.find(i => i.id === sim.resultId);
    const gained = resultIcon ? resultIcon.count : 0;
    state.coins += gained;
    events.push({ kind: 'coins', amount: gained, total: state.coins });
  }
  if (wasEager) convertDisplaced(state, beforePos, icon.type, events);
  const madeIcon = sim.merged ? state.icons.find(i => i.id === sim.resultId) : null;
  events.push(...progressAfterMove(state, sim.resultId, sim.steps, wasEager,
    madeIcon ? madeIcon.count : null));
  return { ok: true, steps: sim.steps, merged: sim.merged, intent, events };
}

/*
 * ワープの発動（2026-11-12）: 盤上の全マス（自分とドックの列以外）から
 * 1マスと居場所を交換する。相手が空きマスならそのまま移動する。
 * target を渡すとそのマスと交換する（やる気のとき、プレイヤーが選ぶ。
 * 変換はしない）。省略するとランダムに決まる。
 * 1手として数える。発動後の眠りは確率判定1回だけ（ワープの眠り確率で
 * 当たれば1z、外れれば眠らない）。入れ替わった相手は眠らない。
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
    // ランダムな移動先はアイコンのいるマスだけ（2026-11-12 ユーザー
    // 指定で空きマスを候補から外した。必ず誰かと入れ替わる）。
    // やる気で自分で選ぶ場合（上の target 経路）は空きマスも選べる
    const cells = [];
    for (let y = 0; y < state.rows; y++) for (let x = 0; x < state.cols; x++) {
      if (isReservedCell(x, y)) continue;
      if (x === icon.x && y === icon.y) continue;
      if (!iconAt(state.icons, x, y)) continue;
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
 * 着地点にアイコンがいたら取り込み、食べた側は合体と同じく一律で
 * +1 になり、できた数だけコインが増える（相手の種類・数・眠りは
 * 関係なし。相手の数そのものは移らない。眠っている相手もそのまま
 * 取り込む）。空きマスならそのまま着地する。着地点の決め方だけが
 * 種類で違う：
 * - ワープ: 盤上の全マス（自分とドック以外）からランダム
 * - それ以外（通常アイコンとオウ・スピン）: 自分の方向のうちランダムな1方向の
 *   直線上の全マスからランダム（距離は数に関係ない）
 * 捕食・着地の後は、進んだ距離分の確率判定で当たった分だけ眠る
 * （上限3、判定は捕食した本人の種類の眠り確率）。1手として数え、
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
  // 反抗は他の反抗と同じ捕食）。候補はアイコンのいるマスだけ
  // （2026-11-12 ユーザー指定で空きマスを外したので、着けば必ず取り込む）。
  // 他の反抗と同じく、獲物が1個もいないときだけ空きマスへ行く
  if (icon.type === 'warp') {
    const cells = [];
    const emptyCells = [];
    for (let y = 0; y < state.config.rows; y += 1) {
      for (let x = 0; x < state.config.cols; x += 1) {
        if (isReservedCell(x, y)) continue;
        if (x === icon.x && y === icon.y) continue;
        const victim = iconAt(state.icons, x, y);
        if (victim) cells.push({ x, y, victim });
        else emptyCells.push({ x, y, victim: null });
      }
    }
    const pool = cells.length ? cells : emptyCells;
    if (!pool.length) {
      return { ok: false, reason: '反抗しましたが、動ける場所がありませんでした。', events: [] };
    }
    const land = pool[Math.floor(state.rng() * pool.length)];
    const events = [
      { kind: 'warp', iconId: icon.id, x: land.x, y: land.y, swappedWith: null },
    ];
    let predation = false;
    if (land.victim) {
      // 捕食も合体と同じ扱い（2026-11-15 ユーザー決定）：相手の数は
      // 移らないが、食べた側は一律で +1 になり、できた数だけ
      // コインが増える
      state.icons = state.icons.filter((item) => item.id !== land.victim.id);
      predation = true;
      icon.count += 1;
      state.coins += icon.count;
      events.push({
        kind: 'predation', iconId: icon.id, victimId: land.victim.id,
        victimType: land.victim.type, gained: 1, x: land.x, y: land.y,
      });
      events.push({ kind: 'coins', amount: icon.count, total: state.coins });
    }
    icon.x = land.x;
    icon.y = land.y;
    events.push(...progressAfterMove(state, icon.id, 1, false, predation ? icon.count : null));
    return { ok: true, x: land.x, y: land.y, predation, events, rebel: true };
  }
  // 方向ごとに着地点の候補を集める（スピンは現在の向きの方向で）
  const byDir = [];
  for (const dir of dirsOf(icon)) {
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
  // 着地点は、方向範囲内にアイコンがいればその中からだけ選ぶ
  // （2026-11-12 ユーザー指定「反抗も空きマスには基本行かない」）。
  // 範囲内に1個もいないときだけ空きマスへ行く
  const preyDirs = byDir
    .map(cells => cells.filter(c => c.victim))
    .filter(cells => cells.length);
  const pools = preyDirs.length ? preyDirs : byDir;
  const line = pools[Math.floor(state.rng() * pools.length)];
  const land = line[Math.floor(state.rng() * line.length)];
  const events = [];
  let predation = false;
  if (land.victim) {
    // 捕食も合体と同じ扱い（2026-11-15 ユーザー決定）：相手の数は
    // 移らないが、食べた側は一律で +1 になり、できた数だけ
    // コインが増える
    state.icons = state.icons.filter(i => i.id !== land.victim.id);
    predation = true;
    icon.count += 1;
    state.coins += icon.count;
    events.push({ kind: 'predation', iconId: icon.id, victimId: land.victim.id, victimType: land.victim.type, gained: 1, x: land.x, y: land.y });
    events.push({ kind: 'coins', amount: icon.count, total: state.coins });
  }
  icon.x = land.x; icon.y = land.y;
  // スピンの反抗移動も「自分で動いた」ので90度右回転する
  if (icon.type === 'spin') { icon.orient = ((icon.orient ?? 0) + 1) % 4; icon.spun = true; }
  events.push(...progressAfterMove(state, icon.id, land.dist, false, predation ? icon.count : null));
  return { ok: true, steps: land.dist, predation, x: land.x, y: land.y, events };
}

const api = {
  TYPES, TYPE_IDS, DEFAULT_CONFIG, INITIAL_LAYOUT, PERSONALITY,
  mulberry32, createGame, createCustomGame,
  inside, iconAt: (state, x, y) => iconAt(state.icons, x, y), emptyCells, installCell,
  SETTINGS_CELL, isSettingsCell, SEARCH_CELL, isSearchCell, isReservedCell,
  STORE_CELL, isStoreCell,
  NORMAL_TYPE_IDS, SPECIAL_IDS, PRICES,
  destinations, moveIntents, applyMove, applyRebelMove, simulateMove, rollMood, rollSleep,
  applyWarpSwap, buySpecial, dirsOf, applyRealtimeTick,
  tickSleep, tickInstall, tickBattery, reserveIconIds, advanceSleepOne,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
global.HomeMerge = api;

})(typeof window !== 'undefined' ? window : globalThis);
