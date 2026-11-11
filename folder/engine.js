'use strict';
/*
 * ホーム画面合体パズル — ゲームエンジン【フォルダ版ブランチ】
 * 本ブランチ（folder）は、メイン（強化方式）から分かれた別方式：
 * 合体数（強化数）まわりの仕様をすべて廃止し、アイコンを重ねると
 * 数が増える代わりに「フォルダ」ができる。仕様と暫定ルールは FOLDER.md。
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
  rows: 7, // 2026-11-11 ユーザー指定で 8→7（盤面は 4×7=28マス、メイン版 0b37172 と同じ）
  batteryStart: 100,
  batteryPerMove: 1,   // 仮値: 100回移動でクリア（企画書: 試作後に調整）
  installEvery: 2,     // （旧方式）2回の移動ごとに1個インストール。installIntervalSec が有効な間は使われない
  installIntervalSec: 5, // リアルタイム・インストール：プレイ中、5秒ごとに1個（2026-11-11 ユーザー指定でフォルダ版は移動連動から時間連動へ）
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
    // フォルダ版では合体数（強化数）を廃止したため、count は常に1で固定。
    // 移動距離も全アイコン1のまま（フォルダ収納で伸びることもない）
    count: 1,
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
    folders: [],
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

// テスト・デバッグ用に任意配置で開始する。
// opts.folders: [{ x, y, members: [{ type, ... }] }] でフォルダも置ける
// （カテゴリはメンバー同士から自動で決まる。3個以上は先頭2個で確定）
function createCustomGame(iconSpecs, opts = {}) {
  const config = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
  const state = {
    config,
    cols: config.cols,
    rows: config.rows,
    icons: iconSpecs.map(s => makeIcon(s.type, s.x, s.y, s)),
    folders: [],
    battery: opts.battery ?? config.batteryStart,
    moves: opts.moves ?? 0,
    status: 'playing',
    log: [],
    rng: opts.rng || Math.random,
  };
  for (const f of opts.folders || []) {
    const members = f.members.map(m => makeIcon(m.type, f.x, f.y, m));
    state.folders.push({
      id: nextId++,
      x: f.x, y: f.y,
      category: folderCategory(members[0].type, members[1] ? members[1].type : members[0].type),
      members,
    });
  }
  return state;
}

function inside(state, x, y) { return x >= 0 && y >= 0 && x < state.cols && y < state.rows; }
function iconAt(icons, x, y) { return icons.find(i => i.x === x && i.y === y) || null; }
function folderAtIn(folders, x, y) { return (folders || []).find(f => f.x === x && f.y === y) || null; }

/*
 * フォルダのカテゴリは、作成時の最初の2個の組み合わせで確定する（順序不問）：
 * - 同種同士 → その種類のみ収納可（kind: 'type'）
 * - タテ+ヨコ → 十字（タテ・ヨコのみ）
 * - サヨク+ウヨク → ナナメ（サヨク・ウヨクのみ）
 * - それ以外 → 多様性（全種可だが、同種の重複収納は不可）
 * 収納に個数上限は設けない（2026-11-10 ユーザー訂正）。可否はカテゴリ条件
 * のみで判定する。多様性の「同種重複不可」も上限ではなく条件のひとつで、
 * 結果として最大4種になるが、それは上限として数えるものではない
 */
function folderCategory(typeA, typeB) {
  if (typeA === typeB) return { kind: 'type', type: typeA };
  const pair = [typeA, typeB].sort().join('+');
  if (pair === 'tate+yoko') return { kind: 'cross' };
  if (pair === 'sayoku+uyoku') return { kind: 'diagonal' };
  return { kind: 'variety' };
}

function canStore(folder, type) {
  const cat = folder.category;
  const members = folder.members;
  switch (cat.kind) {
    case 'type': return type === cat.type;
    case 'cross': return type === 'tate' || type === 'yoko';
    case 'diagonal': return type === 'sayoku' || type === 'uyoku';
    case 'variety': return !members.some(m => m.type === type);
    default: return false;
  }
}

function cloneFolders(folders) {
  return (folders || []).map(f => ({
    ...f,
    category: { ...f.category },
    members: f.members.map(m => ({ ...m })),
  }));
}
// 最下段の列はドック（2026-11-11 ユーザー決定で列全体がゲームの外）。
// 左端が設定、その横が検索の固定アプリで、右の2マスもゲームには
// 使わない。ゲームのアイコン・フォルダは最下段には入ることができず、
// 空きマスとしても数えない（使えるマスは 28-4=24 個）
const SETTINGS_CELL = { x: 0, y: 6 }; // 最下段（rows-1）
const SEARCH_CELL = { x: 1, y: 6 };
function isSettingsCell(x, y) { return x === SETTINGS_CELL.x && y === SETTINGS_CELL.y; }
function isSearchCell(x, y) { return x === SEARCH_CELL.x && y === SEARCH_CELL.y; }
function isReservedCell(x, y) { return y === SETTINGS_CELL.y; }
function emptyCells(state) {
  const cells = [];
  for (let y = 0; y < state.rows; y++) for (let x = 0; x < state.cols; x++) {
    if (isReservedCell(x, y)) continue;
    if (iconAt(state.icons, x, y)) continue;
    if (folderAtIn(state.folders, x, y)) continue; // フォルダも1マスを占有する
    cells.push({ x, y });
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
 * 1マス分の移動をクローン上で試す（フォルダ版）。
 * - 空きマス: そのまま移動
 * - アイコンのマス:
 *   - 最終ステップ かつ intent='merge'（重ねる） かつ ctx.allowFolder が真
 *     → 2個でフォルダを作成（カテゴリは最初の2個で確定）。両方とも盤面から
 *     消え、対象のマスにフォルダができる
 *   - 途中ステップで同種 → 通過（反抗の複数マス移動用。同種は重ならない）
 *   - それ以外 → 入れ替わる（押し出しはしない。入れ替わった相手は眠らない）
 * - フォルダのマス:
 *   - 最終ステップ かつ intent='merge' かつ ctx.allowFolder かつ
 *     カテゴリ条件に合う（canStore）→ 収納される（盤面から消える）
 *   - それ以外は、フォルダと入れ替わる。条件に合わないアイコンを重ねよう
 *     としても「フォルダに入る判定自体がない」扱いで、収納されず入れ替えに
 *     なる（2026-11-10 ユーザー訂正）。フォルダ自体もドラッグで動かせて
 *     入れ替えできる（applyFolderMove。ただしフォルダが動いてアイコンを
 *     取り込むことはしない）
 * ctx.allowFolder は、プレイヤーの通常移動（intent='merge'）でのみ真になる。
 * 反抗の移動ではフォルダ作成・収納は起きない（入れ替えのみ起きる）。
 * 戻り値: { icons, folders, resultId, merged, swapped, foldered, folderId } | null
 */
// 盤面サイズを明示して1歩試す本体
function tryStepOnBoard(work, mover, dir, board, isFinal, intent, ctx) {
  const cols = board ? board.cols : 4;
  const rows = board ? board.rows : 7;
  const nx = mover.x + dir[0], ny = mover.y + dir[1];
  if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return null;
  if (isReservedCell(nx, ny)) return null; // アプリ（設定・検索）のマスには入らない
  const folders = ctx ? ctx.folders : [];
  // 通過直後は自分のマスに同種が残っている（重なった状態）。そのままでは
  // 入れ替え相手の行き場が無いため、同種を経路の後方へ1マスずつずらして
  // 自分のマスを空ける（入れ替えの連鎖。後方に連なる同種をたどり、
  // 最初の空きマスまで送る）。後方に異種が詰まっている等で空けられ
  // ない場合は false を返し、そのステップ自体が成立しない
  function unshare() {
    const shared = work.find(i => i.id !== mover.id && i.x === mover.x && i.y === mover.y);
    if (!shared) return true;
    const chain = [shared];
    let cx = mover.x, cy = mover.y;
    for (;;) {
      const bx = cx - dir[0], by = cy - dir[1];
      if (bx < 0 || by < 0 || bx >= cols || by >= rows) return false;
      const back = work.find(i => i.id !== mover.id && i.x === bx && i.y === by);
      if (!back) break;
      if (back.type !== mover.type) return false;
      chain.push(back);
      cx = bx; cy = by;
    }
    for (let k = chain.length - 1; k >= 0; k--) { chain[k].x -= dir[0]; chain[k].y -= dir[1]; }
    return true;
  }
  const folder = folderAtIn(folders, nx, ny);
  if (folder) {
    if (isFinal && intent === 'merge' && ctx.allowFolder && canStore(folder, mover.type)) {
      folder.members.push({ ...mover });
      const rest = work.filter(i => i.id !== mover.id);
      return { icons: rest, folders, resultId: mover.id, merged: false, foldered: true, stored: true, folderId: folder.id };
    }
    // 収納できない場合はフォルダと入れ替わる（アイコン同士の入れ替えと同じ。
    // 通過直後で自分のマスに同種が残っている場合は、先に同種を後方へ
    // ずらして空ける）
    if (!unshare()) return null;
    folder.x = mover.x; folder.y = mover.y;
    mover.x = nx; mover.y = ny;
    return { icons: work, folders, resultId: mover.id, merged: false, swapped: true, folderSwapped: true };
  }
  const target = iconAt(work, nx, ny);
  if (!target) {
    mover.x = nx; mover.y = ny;
    return { icons: work, folders, resultId: mover.id, merged: false };
  }
  if (isFinal && intent === 'merge' && ctx && ctx.allowFolder) {
    // フォルダ作成: 種類の組み合わせは問わない（カテゴリが吸収する）
    const created = {
      id: nextId++,
      x: nx, y: ny,
      category: folderCategory(mover.type, target.type),
      members: [{ ...target }, { ...mover }],
    };
    folders.push(created);
    const rest = work.filter(i => i.id !== mover.id && i.id !== target.id);
    return { icons: rest, folders, resultId: mover.id, merged: false, foldered: true, created: true, folderId: created.id };
  }
  if (target.type === mover.type && !isFinal) {
    // 通過: 一時的に同じマスに重なるが、最終位置では重ならない
    mover.x = nx; mover.y = ny;
    return { icons: work, folders, resultId: mover.id, merged: false, passed: true };
  }
  // 入れ替わる（押し出しはしない）
  // 通過直後で自分のマスに同種が残っている場合は、先に同種を後方へ
  // ずらして空ける（unshare）。それでも空けられなければ入れ替われない
  if (!unshare()) return null;
  target.x = mover.x; target.y = mover.y;
  mover.x = nx; mover.y = ny;
  return { icons: work, folders, resultId: mover.id, merged: false, swapped: true };
}

/*
 * 指定方向へ dist マス移動を試す（歩行シミュレーション）。
 * フォルダ版では、最終ステップで intent='merge'（重ねる）なら、アイコン相手
 * ではフォルダ作成、フォルダ相手では収納になる（opts.allowFolder が真のとき。
 * プレイヤーの通常移動だけが真で、反抗の移動では起きない）。
 * 途中の同種は通過する。intent='swap' では最終ステップでも入れ替わる。
 * intent は操作側（ドラッグのホールド等）が決める意図で、エンジンはそれを
 * 受けて結果を計算するだけ（操作と処理の分離）。
 * 戻り値: { icons, folders, resultId, steps, merged, swapped, foldered, folderId } | null
 */
function simulateMove(state, iconId, dir, dist, intent = 'merge', opts = {}) {
  let icons = cloneIcons(state.icons);
  let folders = cloneFolders(state.folders);
  const ctx = { folders, allowFolder: !!opts.allowFolder };
  let resultId = iconId;
  let swapped = false;
  for (let step = 1; step <= dist; step++) {
    const cur = icons.find(i => i.id === resultId);
    if (!cur) return null;
    const r = tryStepOnBoard(icons, cur, dir, state, step === dist, intent, ctx);
    if (!r) return null;
    icons = r.icons;
    folders = r.folders || folders;
    if (r.swapped) swapped = true;
    if (r.foldered) return { icons, folders, resultId: r.resultId, steps: step, merged: false, swapped, foldered: true, folderId: r.folderId };
    resultId = r.resultId;
  }
  return { icons, folders, resultId, steps: dist, merged: false, swapped, foldered: false };
}

// 選択中アイコンの移動候補一覧。intent を渡すと、その意図で解決した候補を返す。
// フォルダ版では移動距離に制限はない（2026-11-10 ユーザー指示で撤廃。当初は
// count 廃止に合わせて一律1マスだった）: 自分の方向に盤面の端まで進める。
// intent='merge' の候補にはフォルダ作成・収納（foldered）も含まれる
function destinations(state, iconId, intent = 'merge') {
  const icon = state.icons.find(i => i.id === iconId);
  if (!icon || state.status !== 'playing') return [];
  if (icon.z > 0) return []; // 睡眠中は自分から動けない
  const type = TYPES[icon.type];
  const out = [];
  for (const dir of type.dirs) {
    const maxD = dir[0] > 0 ? state.cols - 1 - icon.x
      : dir[0] < 0 ? icon.x
      : dir[1] > 0 ? state.rows - 1 - icon.y
      : icon.y;
    for (let d = 1; d <= maxD; d++) {
      const sim = simulateMove(state, iconId, dir, d, intent, { allowFolder: intent === 'merge' });
      if (!sim) continue;
      // フォルダ作成・収納では、結果アイコンは盤面にいない。行き先は目標マスそのもの
      const result = sim.icons.find(i => i.id === sim.resultId);
      const destX = sim.foldered ? icon.x + dir[0] * sim.steps : result.x;
      const destY = sim.foldered ? icon.y + dir[1] * sim.steps : result.y;
      out.push({
        x: destX, y: destY,
        dist: sim.steps, dir, merged: false, foldered: !!sim.foldered, intent,
        pushed: sim.icons.length === state.icons.length && !sim.foldered
          ? movedOthers(state.icons, sim.icons, iconId)
          : !sim.foldered,
      });
      if (sim.steps < d) break;
    }
  }
  return out;
}

/*
 * あるマスに対して選べる意図の一覧を返す（フォルダ版）。
 * - アイコンのマス: 到達できれば ['merge'（フォルダ作成）, 'swap'（入れ替え）]
 * - フォルダのマス: カテゴリ条件に合って収納できれば 'merge'、加えて
 *   入れ替えは常に対象になるので 'swap' も選べる。条件に合わない場合は
 *   ['swap'] のみ（重ねても収納されず入れ替えになる）
 * - 空きマス・到達できないマスでは []
 */
function moveIntents(state, iconId, x, y) {
  const folder = folderAtIn(state.folders, x, y);
  if (!folder && !iconAt(state.icons, x, y)) return [];
  const intents = [];
  if (destinations(state, iconId, 'merge').some(d => d.x === x && d.y === y && d.foldered)) intents.push('merge');
  if (destinations(state, iconId, 'swap').some(d => d.x === x && d.y === y)) intents.push('swap');
  return intents;
}

/*
 * フォルダ自身の移動候補（フォルダ版。2026-11-10 ユーザー訂正で、
 * フォルダもスマホ準拠にドラッグで動かせるようにした）。
 * フォルダには方向の性質がないため、周囲8マスへ1マス（暫定）。
 * 行き先がアイコン／フォルダなら位置交換、空きマスならそのまま移動。
 * フォルダが動いてアイコンを取り込む（収納する）ことはしない
 */
function destinationsForFolder(state, folderId) {
  const folder = (state.folders || []).find(f => f.id === folderId);
  if (!folder || state.status !== 'playing') return [];
  const out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (dx === 0 && dy === 0) continue;
    const x = folder.x + dx, y = folder.y + dy;
    if (!inside(state, x, y) || isReservedCell(x, y)) continue;
    out.push({ x, y });
  }
  return out;
}

// フォルダを動かす。フォルダの移動・入れ替えは1手として数える
// （2026-11-10 ユーザー訂正）: バッテリーが減り、盤面のアイコンの
// 睡眠が進み、インストールと勝敗判定も通常どおり行われる。
// 動かしたフォルダ自身は眠らない（眠るのはアイコンだけ）
function applyFolderMove(state, folderId, dest) {
  if (state.status !== 'playing') return { ok: false, reason: 'ゲームは終了しています' };
  const folder = (state.folders || []).find(f => f.id === folderId);
  if (!folder) return { ok: false, reason: 'フォルダがありません' };
  const cand = destinationsForFolder(state, folderId).find(d => d.x === dest.x && d.y === dest.y);
  if (!cand) return { ok: false, reason: 'そのマスへは移動できません' };
  const icon = iconAt(state.icons, dest.x, dest.y);
  const other = folderAtIn(state.folders, dest.x, dest.y);
  const fx = folder.x, fy = folder.y;
  if (icon) { icon.x = fx; icon.y = fy; }
  if (other) { other.x = fx; other.y = fy; }
  folder.x = dest.x; folder.y = dest.y;
  const events = progressAfterMove(state, -1, 1, false);
  return { ok: true, swappedWithIcon: !!icon, swappedWithFolder: !!other, events };
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

  if (!(state.config.installIntervalSec > 0) && state.moves % state.config.installEvery === 0) {
    const cell = installCell(state);
    if (cell) {
      const type = TYPE_IDS[Math.floor(state.rng() * TYPE_IDS.length)];
      const icon = makeIcon(type, cell.x, cell.y);
      state.icons.push(icon);
      events.push({ kind: 'install', iconId: icon.id, type, x: cell.x, y: cell.y });
    }
  }

  // 敗北判定: 使えるマスが全部埋まったら負け。アプリ（設定・検索）のマスは使えないので、
  // 個数ではなく「空きマス（アプリのマスを除く）が0」で判定する（最大26個で満杯）
  if (emptyCells(state).length === 0) {
    state.status = 'lost';
    events.push({ kind: 'lost' });
  }
  return events;
}

// リアルタイム・インストール（フォルダ版）：時間経過で1個だけ入れる。
// 移動に伴う経過（バッテリー・睡眠）は進めない。入れた結果として
// 空きマスが無くなったら、その時点で敗北になる
function applyTimedInstall(state) {
  if (state.status !== 'playing') return { ok: false, events: [] };
  const cell = installCell(state);
  if (!cell) return { ok: false, events: [] };
  const type = TYPE_IDS[Math.floor(state.rng() * TYPE_IDS.length)];
  const icon = makeIcon(type, cell.x, cell.y);
  state.icons.push(icon);
  const events = [{ kind: 'install', iconId: icon.id, type, x: cell.x, y: cell.y }];
  if (emptyCells(state).length === 0) {
    state.status = 'lost';
    events.push({ kind: 'lost' });
  }
  return { ok: true, events };
}

/*
 * やる気の効果（2026-11-11 ユーザー指定で旧効果「移動しても眠らない」
 * から変更、メイン版と同じ）: やる気アイコンの移動で位置が変わった
 * アイコンは全部、そのアイコンと同じ種類になる（最後に入れ替わった
 * 相手も含む。フォルダ自体とフォルダの中身は対象外）。
 * beforePos は移動前の id -> "x,y" の対応。
 */
function convertDisplaced(state, beforePos, type, events) {
  for (const t of state.icons) {
    const b = beforePos.get(t.id);
    if (b === undefined || b === t.x + ',' + t.y) continue;
    if (t.type === type) continue;
    events.push({ kind: 'converted', iconId: t.id, from: t.type, to: type });
    t.type = type;
  }
}

// 通常の移動を実行する。dest は destinations() の要素（または {x, y, intent?}）。
// dest.intent が 'merge'（重ねる）なら、アイコン相手ではフォルダ作成、
// フォルダ相手では収納になる。'swap'（入れ替え）なら常に入れ替え。
// 省略時は 'merge'
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
  const sim = simulateMove(state, iconId, cand.dir, cand.dist, intent, { allowFolder: intent === 'merge' });
  if (!sim) return { ok: false, reason: '移動できません' };
  const wasEager = icon.mood === 'eager';
  const beforePos = new Map(state.icons.map(i => [i.id, i.x + ',' + i.y]));
  state.icons = sim.icons;
  state.folders = sim.folders; // フォルダと入れ替わった場合も含め、常に取り込む
  const convEvents = [];
  if (wasEager) convertDisplaced(state, beforePos, icon.type, convEvents);
  if (sim.foldered) {
    // フォルダに入ったアイコンは盤面にいないため、眠る対象はいない。
    // 移動としての経過（バッテリー・他のアイコンの睡眠・
    // インストール・勝敗判定）は通常どおり進める
    const events = [...convEvents, ...progressAfterMove(state, -1, sim.steps, false)];
    return { ok: true, steps: sim.steps, merged: false, foldered: true, folderId: sim.folderId, intent, events };
  }
  const events = [...convEvents, ...progressAfterMove(state, sim.resultId, sim.steps, wasEager)];
  return { ok: true, steps: sim.steps, merged: false, foldered: false, intent, events };
}

/*
 * 経路ベースの移動を試す（2026-11-10 ユーザー指示「入れ替えの時は自分の
 * 方向とか関係ないようにして」に対応する経路方式）。
 * path はドラッグしたアイコンが順に踏むマス（8近傍のステップ列、開始マス
 * は含まない）。各ステップは入れ替えとして解決する（tryStepOnBoard の
 * swap 解決。途中の同種通過・フォルダとの入れ替えを含む）。
 * opts.folderTarget を渡すと、path を踏み終えた位置からそのマスへ
 * 「重ねる」最終ステップを行い、フォルダ作成／収納になれば成功、
 * なれなければ（カテゴリ条件に合わない等）null を返す。
 * 戻り値の形は simulateMove と同じ。
 */
function simulatePathMove(state, iconId, path, opts = {}) {
  let icons = cloneIcons(state.icons);
  let folders = cloneFolders(state.folders);
  const ctx = { folders, allowFolder: true };
  let resultId = iconId;
  let swapped = false;
  let steps = 0;
  const folderTarget = opts.folderTarget || null;
  function stepTo(tx, ty, isFinal, intent) {
    const cur = icons.find(i => i.id === resultId);
    if (!cur) return null;
    const dir = [tx - cur.x, ty - cur.y];
    if (Math.abs(dir[0]) > 1 || Math.abs(dir[1]) > 1 || (dir[0] === 0 && dir[1] === 0)) return null;
    const r = tryStepOnBoard(icons, cur, dir, state, isFinal, intent, ctx);
    if (!r) return null;
    icons = r.icons;
    folders = r.folders || folders;
    if (r.swapped) swapped = true;
    steps++;
    return r;
  }
  for (let s = 0; s < path.length; s++) {
    const r = stepTo(path[s].x, path[s].y, s === path.length - 1 && !folderTarget, 'swap');
    if (!r || r.foldered) return null;
    resultId = r.resultId;
  }
  if (folderTarget) {
    const r = stepTo(folderTarget.x, folderTarget.y, true, 'merge');
    if (!r || !r.foldered) return null;
    return { icons, folders, resultId: r.resultId, steps, merged: false, swapped, foldered: true, folderId: r.folderId };
  }
  return { icons, folders, resultId, steps, merged: false, swapped, foldered: false };
}

// 経路ベースの移動を実行する。経過の進め方は applyMove と同じ
// （progressAfterMove を共用する）
function applyPathMove(state, iconId, path, folderTarget) {
  if (state.status !== 'playing') return { ok: false, reason: 'ゲームは終了しています' };
  const icon = state.icons.find(i => i.id === iconId);
  if (!icon) return { ok: false, reason: 'アイコンがありません' };
  if (icon.z > 0) return { ok: false, reason: '睡眠中は自分から動けません' };
  if (icon.mood === 'rebel') return { ok: false, reason: '反抗中は applyRebelMove を使ってください' };
  if ((!path || path.length === 0) && !folderTarget) return { ok: false, reason: '移動していません' };
  const sim = simulatePathMove(state, iconId, path, { folderTarget: folderTarget || null });
  if (!sim) return { ok: false, reason: '移動できません' };
  const wasEager = icon.mood === 'eager';
  const beforePos = new Map(state.icons.map(i => [i.id, i.x + ',' + i.y]));
  state.icons = sim.icons;
  state.folders = sim.folders;
  const convEvents = [];
  if (wasEager) convertDisplaced(state, beforePos, icon.type, convEvents);
  if (sim.foldered) {
    const events = [...convEvents, ...progressAfterMove(state, -1, sim.steps, false)];
    return { ok: true, steps: sim.steps, merged: false, foldered: true, folderId: sim.folderId, events };
  }
  const events = [...convEvents, ...progressAfterMove(state, sim.resultId, sim.steps, wasEager)];
  return { ok: true, steps: sim.steps, merged: false, foldered: false, events };
}

/*
 * フォルダの解除（暫定仕様。FOLDER.md に明記）:
 * 収納アイコンを、フォルダ周囲（8近傍）の空きマスへ読み順に配置する。
 * 周囲だけで足りない場合は、盤面全体の空きマスを読み順に使って補う。
 * 空きマスの総数がメンバー数に足りない場合は解除できない。
 * 解除は「移動」として数えず、バッテリーや他のアイコンの経過は進まない。
 * 収納中は眠り・機嫌が進まない（凍結）ため、出てくるアイコンは
 * 起きた状態（z=0・通常）になる。
 */
function applyFolderRelease(state, folderId) {
  const folder = (state.folders || []).find(f => f.id === folderId);
  if (!folder) return { ok: false, reason: 'フォルダがありません' };
  const need = folder.members.length;
  const empties = emptyCells(state); // 読み順（行優先）。フォルダ・予約マスは除く
  if (empties.length < need) return { ok: false, reason: '空きマスが足りないため解除できません' };
  const around = empties.filter(c => Math.abs(c.x - folder.x) <= 1 && Math.abs(c.y - folder.y) <= 1);
  const rest = empties.filter(c => !(Math.abs(c.x - folder.x) <= 1 && Math.abs(c.y - folder.y) <= 1));
  const cells = around.concat(rest).slice(0, need);
  const placed = folder.members.map((m, i) => {
    const icon = { ...m, x: cells[i].x, y: cells[i].y, count: 1, z: 0, mood: 'normal' };
    state.icons.push(icon);
    return { iconId: icon.id, x: icon.x, y: icon.y };
  });
  state.folders = state.folders.filter(f => f.id !== folderId);
  return { ok: true, placed };
}

/*
 * フォルダから1個だけ取り出す（フォルダを開いた画面で中身をタップした
 * ときの操作。スマホ準拠：開いたフォルダからアプリを出す動き）。
 * 置き場所は解除と同じ優先順（フォルダ周囲の空きマス→盤面全体、読み順）。
 * 取り出しは「移動」として数えない（解除と同じ）。
 * 残りが1個になったら、空きがあれば最後の1個も出してフォルダは消える
 * （スマホで最後のアプリを出すとフォルダが消えるのと同じ）。
 * 空きが無ければ取り出せない。
 */
function applyFolderExtract(state, folderId, memberId) {
  const folder = (state.folders || []).find(f => f.id === folderId);
  if (!folder) return { ok: false, reason: 'フォルダがありません' };
  const idx = folder.members.findIndex(m => m.id === memberId);
  if (idx < 0) return { ok: false, reason: 'そのアイコンは入っていません' };
  const empties = emptyCells(state);
  if (empties.length === 0) return { ok: false, reason: '空きマスがありません' };
  const around = empties.filter(c => Math.abs(c.x - folder.x) <= 1 && Math.abs(c.y - folder.y) <= 1);
  const rest = empties.filter(c => !(Math.abs(c.x - folder.x) <= 1 && Math.abs(c.y - folder.y) <= 1));
  const cells = around.concat(rest);
  const placed = [];
  const take = (member, cell) => {
    const icon = { ...member, x: cell.x, y: cell.y, count: 1, z: 0, mood: 'normal' };
    state.icons.push(icon);
    placed.push({ iconId: icon.id, x: cell.x, y: cell.y });
  };
  take(folder.members[idx], cells[0]);
  folder.members.splice(idx, 1);
  if (folder.members.length === 1 && cells.length >= 2) {
    take(folder.members[0], cells[1]);
    folder.members = [];
  }
  let dissolved = false;
  if (folder.members.length === 0) {
    state.folders = state.folders.filter(f => f.id !== folderId);
    dissolved = true;
  }
  return { ok: true, placed, dissolved };
}

/*
 * 反抗アイコンの移動: プレイヤーは「動かす」ことだけ決め、
 * 方向と距離はランダム（通常の移動距離1の制限を受けない、最大4マス: 仮実装）。
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
    state.folders = sim.folders; // フォルダと入れ替わることもある
    const events = progressAfterMove(state, sim.resultId, sim.steps, false);
    return { ok: true, steps: sim.steps, merged: sim.merged, events, x: result.x, y: result.y };
  }
  return { ok: false, reason: '反抗しましたが、動ける場所がありませんでした' };
}

const api = {
  TYPES, TYPE_IDS, DEFAULT_CONFIG, INITIAL_LAYOUT,
  mulberry32, createGame, createCustomGame,
  inside, iconAt: (state, x, y) => iconAt(state.icons, x, y), emptyCells, installCell, applyTimedInstall,
  SETTINGS_CELL, isSettingsCell, SEARCH_CELL, isSearchCell, isReservedCell,
  destinations, moveIntents, applyMove, applyRebelMove, simulateMove, rollMood,
  simulatePathMove, applyPathMove,
  folderAt: (state, x, y) => folderAtIn(state.folders, x, y),
  folderCategory, canStore, applyFolderRelease, applyFolderExtract,
  destinationsForFolder, applyFolderMove,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
global.HomeMerge = api;

})(typeof window !== 'undefined' ? window : globalThis);
