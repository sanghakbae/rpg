import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signInAnonymously, onAuthStateChanged, connectAuthEmulator, setPersistence, browserLocalPersistence, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, setDoc, updateDoc, onSnapshot, collection,
  query, orderBy, limit, addDoc, runTransaction, getDoc, writeBatch, increment, where,
  connectFirestoreEmulator
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const app = initializeApp(window.firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

if (location.search.includes('emu=1')) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

/* ================= 상수 ================= */
const WORLD = { w: 1600, h: 1200 };
const SPAWN = { x: 800, y: 600 };
const OFFLINE_MS = 35000;
const BASE_BAG = 18, MAX_BAG = 36;
const bagSize = () => Math.min(MAX_BAG, me.bagSize || BASE_BAG);
const bagUpCost = () => 500 * Math.pow(2, (bagSize() - BASE_BAG) / 6);
const MAX_SKILL_LV = 5;

const CLASSES = {
  warrior: { name: '전사',   icon: '⚔', weaponName: '장검',   hp: 160, atk: 13, speed: 230, range: 95,  atkCd: 520, crit: .05, color: '#e74c3c', melee: true, rec: 'stAtk' },
  archer:  { name: '아처',   icon: '🏹', weaponName: '활',     hp: 110, atk: 11, speed: 255, range: 290, atkCd: 560, crit: .10, color: '#27ae60', proj: 'arrow', rec: 'stSpd' },
  rogue:   { name: '로그',   icon: '🗡', weaponName: '단검',   hp: 95,  atk: 9,  speed: 290, range: 66,  atkCd: 300, crit: .25, color: '#f39c12', melee: true, rec: 'stCrit' },
  mage:    { name: '마법사', icon: '🪄', weaponName: '지팡이', hp: 85,  atk: 18, speed: 225, range: 270, atkCd: 850, crit: .05, color: '#9b59b6', proj: 'bolt', rec: 'stWis' },
};
const CLASS_ORDER = ['warrior', 'archer', 'rogue', 'mage'];

const MONSTER_TYPES = {
  slime:  { name: '슬라임', hp: 35,  atk: 6,  speed: 45,  exp: 12, gold: 15, r: 16, color: '#2ecc71', aggro: 160, respawn: 8000,  range: 42 },
  goblin: { name: '고블린', hp: 70,  atk: 11, speed: 70,  exp: 28, gold: 35, r: 18, color: '#e67e22', aggro: 200, respawn: 9000,  range: 46 },
  wolf:   { name: '늑대',   hp: 130, atk: 18, speed: 105, exp: 55, gold: 70, r: 20, color: '#95a5a6', aggro: 260, respawn: 10000, range: 50 },
};
const SPAWN_ZONES = [
  { type: 'slime',  count: 8, cx: 540,  cy: 430, spread: 150 },
  { type: 'goblin', count: 6, cx: 1060, cy: 770, spread: 150 },
  { type: 'wolf',   count: 5, cx: 1250, cy: 250, spread: 180 },
];
const BOSS_DEF = { name: '오크 대족장', hp: 800, atk: 35, speed: 65, exp: 400, gold: 500, r: 42, color: '#c0392b', aggro: 420, respawn: 120000, range: 72 };
const SKELETON_DEF = { name: '스켈레톤', hp: 220, atk: 26, speed: 75, exp: 90, gold: 110, r: 19, color: '#e8e4d8', aggro: 240, respawn: 12000, range: 50 };
const LICH_DEF = { name: '리치 왕', hp: 2000, atk: 55, speed: 55, exp: 1500, gold: 2500, r: 46, color: '#8b6bff', aggro: 460, respawn: 180000, range: 80 };
const M2_ZONES = [
  { type: 'skeleton', count: 8, cx: 450, cy: 300, spread: 200 },
  { type: 'skeleton', count: 6, cx: 1150, cy: 850, spread: 200 },
];
const KINDS = {
  slime:      { base: 'slime', name: '슬라임', main: '#2ecc71', shade: '#1e8449' },
  rslime:     { base: 'slime', name: '레드 슬라임', main: '#e74c3c', shade: '#a93226' },
  islime:     { base: 'slime', name: '서리 슬라임', main: '#5dade2', shade: '#2e86c1' },
  pslime:     { base: 'slime', name: '독 슬라임', main: '#a040b0', shade: '#6c3483' },
  dslime:     { base: 'slime', name: '암흑 슬라임', main: '#4a4a5a', shade: '#2a2a38' },
  goblin:     { base: 'goblin', name: '고블린', main: '#6da34d', shade: '#4f7a36' },
  hob:        { base: 'goblin', name: '홉고블린', main: '#c8a03c', shade: '#9a7828' },
  orcwar:     { base: 'goblin', name: '오크 전사', main: '#5d8a41', shade: '#3f5c33' },
  madorc:     { base: 'goblin', name: '광포한 오크', main: '#b05030', shade: '#7a3418' },
  wolf:       { base: 'wolf', name: '늑대', main: '#9aa2a8', shade: '#6f777c' },
  hound:      { base: 'wolf', name: '지옥견', main: '#c0392b', shade: '#7a2418' },
  frost:      { base: 'wolf', name: '서리늑대', main: '#aed6f1', shade: '#5dade2' },
  nightmare:  { base: 'wolf', name: '몽마', main: '#7d5fff', shade: '#4a2fa8' },
  skeleton:   { base: 'skeleton', name: '스켈레톤', main: '#e8e4d8', shade: '#b8b4a8' },
  skarcher:   { base: 'skeleton', name: '해골 궁수', main: '#d4c8a8', shade: '#a89878' },
  knight:     { base: 'skeleton', name: '죽음의 기사', main: '#8d93a1', shade: '#565c68' },
  wraith:     { base: 'skeleton', name: '사령', main: '#a8d8d8', shade: '#6aa8a8' },
  orcchief:   { base: 'orc', name: '오크 족장', main: '#5d8a41', shade: '#3f5c33' },
  troll:      { base: 'orc', name: '트롤', main: '#3d7a5c', shade: '#2a5540' },
  ogre:       { base: 'orc', name: '오거', main: '#b07030', shade: '#7a4c18' },
  cyclops:    { base: 'orc', name: '사이클롭스', main: '#8a6b45', shade: '#5c4527' },
  demon:      { base: 'orc', name: '마귀', main: '#a03050', shade: '#6a1830' },
  lich:       { base: 'lich', name: '리치 왕', main: '#8b6bff', shade: '#5a3fd4' },
  lichlord:   { base: 'lich', name: '리치 로드', main: '#c05fff', shade: '#8a2fd4' },
  deathlord:  { base: 'lich', name: '죽음 군주', main: '#40c090', shade: '#208a60' },
  archlich:   { base: 'lich', name: '대마령', main: '#ff6b9a', shade: '#d43a6a' },
};
const KIND_BASE = {
  slime:    { hp: 35, atk: 6, exp: 12, gold: 15, r: 16, aggro: 160, speed: 45, respawn: 8000, range: 42 },
  goblin:   { hp: 70, atk: 11, exp: 28, gold: 35, r: 18, aggro: 200, speed: 70, respawn: 9000, range: 46 },
  wolf:     { hp: 130, atk: 18, exp: 55, gold: 70, r: 20, aggro: 260, speed: 105, respawn: 10000, range: 50 },
  skeleton: { hp: 220, atk: 26, exp: 90, gold: 110, r: 19, aggro: 240, speed: 75, respawn: 12000, range: 50 },
  orc:      { hp: 800, atk: 35, exp: 400, gold: 500, r: 42, aggro: 420, speed: 65, respawn: 120000, range: 72 },
  lich:     { hp: 2000, atk: 55, exp: 1500, gold: 2500, r: 46, aggro: 460, speed: 55, respawn: 180000, range: 80 },
};
const BIOMES = [
  { name: '초원', style: 'meadow', kinds: ['slime', 'goblin', 'wolf'], boss: 'orcchief' },
  { name: '어두운 숲', style: 'grave', kinds: ['wolf', 'goblin', 'pslime'], boss: 'troll' },
  { name: '사막', style: 'meadow', kinds: ['hob', 'skeleton', 'hound'], boss: 'ogre' },
  { name: '설원', style: 'meadow', kinds: ['frost', 'islime', 'wolf'], boss: 'knight' },
  { name: '못가', style: 'grave', kinds: ['pslime', 'goblin', 'wraith'], boss: 'wraith' },
  { name: '화산', style: 'meadow', kinds: ['hound', 'madorc', 'rslime'], boss: 'demon' },
  { name: '동굴', style: 'grave', kinds: ['skeleton', 'madorc', 'dslime'], boss: 'cyclops' },
  { name: '폐허', style: 'grave', kinds: ['knight', 'skarcher', 'wolf'], boss: 'orcwar' },
  { name: '마계', style: 'grave', kinds: ['demon', 'nightmare', 'knight'], boss: 'archlich' },
  { name: '천공', style: 'meadow', kinds: ['dslime', 'frost', 'wraith'], boss: 'lichlord' },
];
const MAX_PAGE = 100;
const pageId = n => 'p' + n;
const myPage = () => { const m = me.map || 'm1'; return m.startsWith('p') ? m : 'p1'; };
const pageNum = () => +myPage().slice(1) || 1;
const pageDiff = n => 1 + (n - 1) * .45;
const pageExp = n => 1 + (n - 1) * .5 + (n - 1) * (n - 1) * .06;
function pageDef(n) {
  const bio = BIOMES[Math.min(9, Math.floor((n - 1) / 10))];
  const tier = (n - 1) % 10;
  const dh = pageDiff(n), de = pageExp(n);
  const mk = kindId => {
    const k = KINDS[kindId], b = KIND_BASE[k.base];
    const km = 1 + tier * .18;
    return { ...k, hp: Math.round(b.hp * dh * km), atk: Math.round(b.atk * dh * km * .9),
      exp: Math.round(b.exp * de * km), gold: Math.round(b.gold * de * km),
      r: b.r, aggro: b.aggro, speed: b.speed, respawn: b.respawn, range: b.range };
  };
  const bossKind = mk(bio.boss);
  bossKind.hp = Math.round(bossKind.hp * 3);
  bossKind.exp = Math.round(bossKind.exp * 2.2);
  bossKind.gold = Math.round(bossKind.gold * 2);
  bossKind.r = Math.round(KIND_BASE[KINDS[bio.boss].base].r * 1.15);
  return {
    n, id: pageId(n), name: `${bio.name} ${tier + 1}구역`, bio,
    kinds: [mk(bio.kinds[0]), mk(bio.kinds[1])], boss: bossKind,
    spawn: { x: n === 1 ? 800 : 170, y: 600 },
  };
}
const myMap = myPage;


const SLOTS = [
  ['weapon', '무기'], ['armor', '갑옷'], ['helmet', '모자'],
  ['pants', '바지'], ['gloves', '장갑'], ['boots', '부츠'],
  ['bracelet', '팔찌'], ['necklace', '목걸이'], ['ring', '반지'],
];
const SLOT_ICONS = { weapon: '⚔', armor: '🛡', helmet: '🪖', pants: '👖', gloves: '🧤', boots: '🥾', bracelet: '📿', necklace: '🧿', ring: '💍' };
const ITEM_ICONS = { potion: '🧪', potion_mp: '💧', potion_hi: '⚗️', potion_mm: '🔵', scroll_normal: '📜', scroll_adv: '📜', scroll_top: '📜' };
const itemIcon = raw => ITEM_ICONS[splitStack(raw)[0]] || SLOT_ICONS[getItem(raw).slot] || '📦';

const ITEMS = {
  sword_wood:    { name: '나무 검',   slot: 'weapon', atk: 3,  color: '#a0714f', rarity: 'common' },
  sword_iron:    { name: '철 검',     slot: 'weapon', atk: 8,  color: '#bdc3c7', rarity: 'rare' },
  sword_flame:   { name: '화염검',    slot: 'weapon', atk: 15, color: '#ff7f27', rarity: 'epic' },
  armor_cloth:   { name: '천 갑옷',   slot: 'armor',  def: 2,  color: '#d9c8a9', rarity: 'common' },
  armor_leather: { name: '가죽 갑옷', slot: 'armor',  def: 5,  color: '#8b5a2b', rarity: 'rare' },
  armor_plate:   { name: '강철 갑옷', slot: 'armor',  def: 10, color: '#7f8c8d', rarity: 'epic' },
  cap_cloth:     { name: '천 모자',   slot: 'helmet', def: 1,  color: '#d9c8a9', rarity: 'common' },
  cap_leather:   { name: '가죽 투구', slot: 'helmet', def: 3,  color: '#8b5a2b', rarity: 'rare' },
  crown_gold:    { name: '대족장의 왕관', slot: 'helmet', def: 6, atk: 3, color: '#ffd700', rarity: 'legend' },
  pants_cloth:   { name: '천 바지',   slot: 'pants',  def: 1,  color: '#cbbfa3', rarity: 'common' },
  pants_leather: { name: '가죽 바지', slot: 'pants',  def: 3,  color: '#7a5230', rarity: 'rare' },
  pants_plate:   { name: '강철 다리보호대', slot: 'pants', def: 6, color: '#95a5a6', rarity: 'epic' },
  gloves_cloth:  { name: '천 장갑',   slot: 'gloves', def: 1,  color: '#d9c8a9', rarity: 'common' },
  gloves_leather:{ name: '가죽 장갑', slot: 'gloves', def: 2,  atk: 2, color: '#8b5a2b', rarity: 'uncommon' },
  gloves_steel:  { name: '강철 건틀릿', slot: 'gloves', def: 4, atk: 4, color: '#aab7c4', rarity: 'epic' },
  boots_cloth:   { name: '천 신발',   slot: 'boots',  def: 1,  color: '#cbbfa3', rarity: 'common' },
  boots_leather: { name: '가죽 부츠', slot: 'boots',  def: 2,  color: '#7a5230', rarity: 'rare' },
  boots_wind:    { name: '질풍 부츠', slot: 'boots',  def: 3,  spd: 25, color: '#5dade2', rarity: 'epic' },
  bracelet_wood: { name: '나무 팔찌', slot: 'bracelet', def: 1, color: '#a0714f', rarity: 'uncommon' },
  bracelet_jade: { name: '옥 팔찌',   slot: 'bracelet', def: 3, atk: 2, color: '#48c9b0', rarity: 'rare' },
  necklace_copper:{ name: '구리 목걸이', slot: 'necklace', atk: 2, color: '#b87333', rarity: 'uncommon' },
  necklace_ruby: { name: '루비 목걸이', slot: 'necklace', atk: 5, color: '#e74c3c', rarity: 'epic' },
  ring_leather:  { name: '가죽 반지', slot: 'ring', crit: .03, color: '#8b5a2b', rarity: 'uncommon' },
  ring_shadow:   { name: '그림자 반지', slot: 'ring', crit: .08, atk: 3, color: '#6c3483', rarity: 'legend' },
  potion:        { name: '체력 물약', heal: 50, color: '#e74c3c', rarity: 'common' },
  potion_mp:     { name: '마나 물약', mana: 40, color: '#3498db', rarity: 'common' },
  potion_hi:     { name: '상급 체력 물약', heal: 150, color: '#ff6b81', rarity: 'uncommon' },
  potion_mm:     { name: '상급 마나 물약', mana: 120, color: '#5dade2', rarity: 'uncommon' },
  crown_slime:   { name: '슬라임 킹의 왕관', slot: 'helmet', def: 8, spd: 10, color: '#2ecc71', rarity: 'unique' },
  club_chief:    { name: '고블린 대장의 몽둥이', slot: 'weapon', atk: 20, color: '#8a6b45', rarity: 'unique' },
  fang_neck:     { name: '알파 늑대의 송곳니', slot: 'necklace', atk: 9, crit: .06, color: '#e8e4d8', rarity: 'unique' },
  knight_sword:  { name: '해골 기사의 검', slot: 'weapon', atk: 24, def: 4, color: '#e8e4d8', rarity: 'unique' },
  orb_lich:      { name: '리치의 마구', slot: 'ring', atk: 12, crit: .10, color: '#8b6bff', rarity: 'unique' },
  scroll_normal: { name: '일반 강화 주문서', scroll: true, grade: 'normal', color: '#cfd8dc', rarity: 'common' },
  scroll_adv:    { name: '고급 강화 주문서', scroll: true, grade: 'adv', color: '#64b5f6', rarity: 'rare' },
  scroll_top:    { name: '최고급 강화 주문서', scroll: true, grade: 'top', color: '#ffd700', rarity: 'legend' },
};

function splitStack(id) {
  const s = String(id);
  const i = s.indexOf('*');
  return i < 0 ? [s, 1] : [s.slice(0, i), Math.max(1, +s.slice(i + 1) || 1)];
}

const itemDefCache = {};
function getItem(id) {
  id = String(id);
  const star = id.indexOf('*');
  if (star >= 0) id = id.slice(0, star);
  if (itemDefCache[id]) return itemDefCache[id];
  const plus = id.indexOf('+');
  let out;
  if (plus < 0) {
    /* 미강화 아이템도 _base/_lv를 반드시 채움 — 없으면 강화 시 "undefined+1"로 아이템 파괴 */
    out = ITEMS[id] ? { ...ITEMS[id], _base: id, _lv: 0 } : { name: id, rarity: 'common' };
  } else {
    const baseId = id.slice(0, plus);
    const base = ITEMS[baseId];
    const lv = +id.slice(plus + 1) || 0;
    if (!base) out = { name: id, rarity: 'common' };
    else {
      const m = 1 + lv * .25;
      out = { ...base, name: base.name + ' +' + lv, _lv: lv, _base: baseId };
      if (base.atk) out.atk = Math.round(base.atk * m);
      if (base.def) out.def = Math.round(base.def * m);
      if (base.heal) out.heal = Math.round(base.heal * (1 + lv * .15));
      if (base.crit) out.crit = +(base.crit + lv * .01).toFixed(3);
      if (base.spd) out.spd = Math.round(base.spd * m);
    }
  }
  itemDefCache[id] = out;
  return out;
}
const RARITY_KR = { common: '일반', uncommon: '고급', rare: '희귀', epic: '영웅', legend: '전설', unique: '유니크' };
const RARITY_COLOR = { common: '#aaa', uncommon: '#2ecc71', rare: '#3498db', epic: '#9b59b6', legend: '#ffd700', unique: '#ff4d4d' };
const RARITY_RANK = { common: 0, uncommon: 1, rare: 2, epic: 3, legend: 4, unique: 5 };
const RARITY_SELL = { common: 15, uncommon: 40, rare: 100, epic: 250, legend: 600, unique: 1500 };
function sellPrice(rawId) {
  const [bid, cnt] = splitStack(rawId);
  const it = getItem(bid);
  let u;
  if (it.heal) u = Math.round(it.heal * .35);
  else if (it.mana) u = Math.round(it.mana * .28);
  else if (it.scroll) u = 25;
  else {
    u = Math.round(((RARITY_SELL[it.rarity] || 15) + (it.atk || 0) * 2 + (it.def || 0) * 2 + (it.crit || 0) * 400 + (it.spd || 0)) * (1 + (it._lv || 0) * .6));
  }
  return Math.max(1, u) * cnt;
}
const DROP_TABLE = {
  slime:  [['potion', .30], ['potion_mp', .12], ['sword_wood', .15], ['pants_cloth', .10], ['cap_cloth', .10], ['boots_cloth', .08], ['gloves_cloth', .08], ['bracelet_wood', .06], ['scroll_normal', .07]],
  goblin: [['potion', .25], ['potion_mp', .10], ['sword_iron', .12], ['armor_cloth', .12], ['gloves_leather', .10], ['cap_leather', .10], ['pants_leather', .10], ['necklace_copper', .08], ['scroll_normal', .08]],
  wolf:   [['potion', .30], ['potion_mp', .10], ['potion_hi', .04], ['armor_leather', .12], ['boots_leather', .12], ['gloves_leather', .10], ['ring_leather', .08], ['scroll_normal', .09], ['scroll_adv', .03]],
  boss:   [['sword_flame', 1], ['armor_plate', 1], ['pants_plate', .8], ['gloves_steel', .8], ['boots_wind', .8], ['bracelet_jade', .8], ['necklace_ruby', .8], ['potion_hi', .8], ['potion_mm', .8], ['scroll_adv', .7], ['scroll_top', .25]],
  skeleton: [['potion', .30], ['potion_mp', .10], ['potion_hi', .05], ['potion_mm', .04], ['sword_iron', .10], ['armor_leather', .10], ['boots_wind', .05], ['necklace_ruby', .04], ['scroll_normal', .09], ['scroll_adv', .04]],
  lich:   [['sword_flame', .7], ['armor_plate', .7], ['potion', .5], ['potion_hi', .7], ['potion_mm', .7], ['scroll_adv', 1], ['scroll_top', .5]],
};
const LEGEND_POOL = ['crown_gold', 'ring_shadow'];
const UNIQUE_POOL = ['crown_slime', 'club_chief', 'fang_neck', 'knight_sword', 'orb_lich'];
const LEGEND_RATE = .01, UNIQUE_RATE = .0001;

const SKILLS = {
  power_strike: { cls: 'warrior', icon: '💥', name: '강타',         desc: '즉시 강력한 일격 (공격력 400%)',              type: 'active', cd: 6000,  cost: 400, mp: 15 },
  warcry:       { cls: 'warrior', icon: '🔥', name: '전투의 함성',   desc: '공격력 영구 증가 (+3)',                        type: 'passive', atk: 3,   cost: 500 },
  iron_body:    { cls: 'warrior', icon: '🛡', name: '철벽',         desc: '방어력 영구 증가 (+2)',                        type: 'passive', def: 2,   cost: 450 },
  multishot:    { cls: 'archer',  icon: '🎯', name: '다중 사격',     desc: '주변 모든 적 타격 (공격력 150%)',              type: 'active', cd: 8000,  cost: 450, mp: 20 },
  sharpshooter: { cls: 'archer',  icon: '🔭', name: '정밀 조준',     desc: '공격력 영구 증가 (+3)',                        type: 'passive', atk: 3,   cost: 500 },
  swift_feet:   { cls: 'archer',  icon: '👟', name: '민첩',         desc: '이동속도 증가 (+15)',                          type: 'passive', spd: 15,  cost: 400 },
  shadow_strike:{ cls: 'rogue',   icon: '🌑', name: '그림자 일격',   desc: '단일 처형 일격 (공격력 600%, 필중 크리티컬)',  type: 'active', cd: 7000,  cost: 450, mp: 20 },
  assassination:{ cls: 'rogue',   icon: '🔪', name: '암살 본능',     desc: '치명타 확률 증가 (+7%p)',                      type: 'passive', crit: .07, cost: 550 },
  swift_feet2:  { cls: 'rogue',   icon: '👟', name: '신속',         desc: '이동속도 증가 (+15)',                          type: 'passive', spd: 15,  cost: 400 },
  fireball:     { cls: 'mage',    icon: '☄', name: '화염구',       desc: '광역 폭발 피해 (공격력 220%)',                 type: 'active', cd: 9000,  cost: 500, mp: 25 },
  magic_power:  { cls: 'mage',    icon: '📖', name: '마력 강화',     desc: '공격력 영구 증가 (+4)',                        type: 'passive', atk: 4,   cost: 550 },
  mana_shield:  { cls: 'mage',    icon: '🔮', name: '마나 보호막',   desc: '방어력 영구 증가 (+2)',                        type: 'passive', def: 2,   cost: 450 },
  heal:         { cls: 'all',     icon: '💚', name: '회복술',       desc: '최대 HP의 40% 즉시 회복',                      type: 'active', cd: 20000, cost: 800, mp: 30 },
};
const POTION_SHOP = [
  ['potion',    '🧪', 50],
  ['potion_mp', '💧', 50],
  ['potion_hi', '⚗️', 180],
  ['potion_mm', '🔵', 180],
];
const skillCost = (def, lv) => Math.round(def.cost * Math.pow(2, lv));

const QUESTS = [
  { id: 'q1', icon: '🟢', name: '첫 사냥',           desc: '슬라임 5마리 처치',      goal: ['slime', 5],        reward: { gold: 100, exp: 40 } },
  { id: 'q2', icon: '🟢', name: '슬라임 대소동',     desc: '슬라임 20마리 처치',     need: 'q1', goal: ['slime', 20],  reward: { gold: 300, exp: 120 } },
  { id: 'q3', icon: '👺', name: '고블린 토벌',       desc: '고블린 10마리 처치',     need: 'q2', goal: ['goblin', 10], reward: { gold: 500, exp: 250 } },
  { id: 'q4', icon: '🐺', name: '늑대 사냥꾼',       desc: '늑대 8마리 처치',        need: 'q3', goal: ['wolf', 8],    reward: { gold: 900, exp: 450 } },
  { id: 'q5', icon: '👑', name: '보스 사냥',         desc: '오크 대족장 처치',       need: 'q4', goal: ['boss', 1],    reward: { gold: 3000, exp: 1200 } },
  { id: 's1', icon: '⚔',  name: '전투 경험',         desc: '몬스터 30마리 처치',     goal: ['total', 30],       reward: { gold: 400, exp: 200 } },
  { id: 's2', icon: '💰', name: '재정 축적',         desc: '골드 누적 2,000G 획득',  goal: ['gold_earned', 2000], reward: { exp: 400 } },
  { id: 's3', icon: '⭐', name: '성장하는 모험가',   desc: 'Lv 5 달성',              goal: ['lv', 5],           reward: { gold: 600 } },
  { id: 's4', icon: '✦',  name: '새로운 힘',         desc: '스킬 1개 구매',          goal: ['skills_bought', 1], reward: { exp: 150 } },
  { id: 's5', icon: '🗡',  name: '무장 완비',         desc: '아이템 장착하기',        goal: ['eqflag', 1],       reward: { gold: 200 } },
  { id: 's6', icon: '🎒', name: '수집가',            desc: '아이템 5개 획득',        goal: ['items', 5],        reward: { gold: 350, exp: 100 } },
  { id: 's7', icon: '💀', name: '죽음의 경험',       desc: '한 번 쓰러져보기',       goal: ['deaths', 1],       reward: { exp: 80 } },
  { id: 's8', icon: '🌟', name: '베테랑',            desc: 'Lv 10 달성',             need: 's3', goal: ['lv', 10],    reward: { gold: 2000, exp: 800 } },
];

/* ================= 헬퍼 ================= */
/* 최대 100레벨 · 100구역: "구역 번호 ≈ 적정 레벨" 페이싱 — 요구는 lv², 구역 보상은 완만한 2차 가속(pageExp) */
const expNeed = lv => Math.floor(200 * lv * lv);
const maxHpOf = () => Math.round(cdef().hp + ((me.lv || 1) - 1) * 10 + (me.stHp || 0) * 15);
const maxMpOf = () => 100 + ((me.lv || 1) - 1) * 5 + (me.stWis || 0) * 12;
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (a, b) => a + Math.random() * (b - a);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => document.getElementById(id);
function sr(n) { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); }
function shade(hex, f) {
  const n = parseInt((hex || '#888888').slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}
function sortInvMap(inv) {
  const stacks = {};
  const items = [];
  for (let i = 0; i < 40; i++) {
    const id = inv[String(i)];
    if (!id) continue;
    const [bid, cnt] = splitStack(id);
    const it0 = getItem(bid);
    if (!it0.slot && (it0.heal || it0.mana || it0.scroll)) stacks[bid] = (stacks[bid] || 0) + cnt;
    else items.push(id);
  }
  for (const [bid, cnt] of Object.entries(stacks)) items.push(cnt > 1 ? bid + '*' + cnt : bid);
  const slotOrder = {};
  SLOTS.forEach((s, i) => slotOrder[s[0]] = i);
  items.sort((a, b) => {
    const ia = getItem(a), ib = getItem(b);
    const sa = ia.slot ? slotOrder[ia.slot] : 99;
    const sb = ib.slot ? slotOrder[ib.slot] : 99;
    if (sa !== sb) return sa - sb;
    const pa = (ia.atk || 0) * 10 + (ia.def || 0) * 10 + (ia.crit || 0) * 1000 + (ia.spd || 0);
    const pb = (ib.atk || 0) * 10 + (ib.def || 0) * 10 + (ib.crit || 0) * 1000 + (ib.spd || 0);
    return pb - pa;
  });
  const out = {};
  items.forEach((id, i) => out[String(i)] = id);
  return out;
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

/* ================= 사운드 (합성음) ================= */
let AC = null;
let muted = false;
function tone(f0, f1, dur, type = 'sine', vol = .08, delay = 0) {
  if (muted || !AC) return;
  try {
    const t = AC.currentTime + delay;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(.0008, t + dur);
    o.connect(g); g.connect(AC.destination);
    o.start(t); o.stop(t + dur + .02);
  } catch (e) {}
}
function sfx(kind) {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } }
  if (AC.state === 'suspended') AC.resume().catch(() => {});
  switch (kind) {
    case 'swing':  tone(320, 90, .07, 'sawtooth', .04); break;
    case 'shoot':  tone(950, 280, .07, 'square', .05); break;
    case 'cast':   tone(560, 1150, .11, 'sine', .06); break;
    case 'hit':    tone(190, 55, .09, 'square', .09); break;
    case 'crit':   tone(340, 80, .13, 'square', .11); tone(500, 130, .1, 'sawtooth', .05, .03); break;
    case 'hurt':   tone(210, 60, .14, 'sawtooth', .1); break;
    case 'coin':   tone(880, 880, .05, 'sine', .06); tone(1320, 1320, .07, 'sine', .06, .05); break;
    case 'pickup': tone(620, 1040, .11, 'triangle', .07); break;
    case 'potion': tone(500, 300, .16, 'sine', .07); break;
    case 'levelup':[523, 659, 784, 1046].forEach((f, i) => tone(f, f, .12, 'sine', .08, i * .09)); break;
    case 'boss':   tone(110, 95, .7, 'sawtooth', .12); tone(220, 180, .7, 'sawtooth', .05); break;
    case 'boom':   tone(140, 35, .32, 'sawtooth', .14); break;
    case 'heal':   tone(440, 880, .2, 'sine', .06); break;
    case 'buy':    tone(700, 1000, .08, 'triangle', .07); tone(1000, 1300, .08, 'triangle', .06, .07); break;
    case 'die':    tone(300, 40, .5, 'sawtooth', .1); break;
  }
}
function toggleMute() {
  muted = !muted;
  if (meRef) updateDoc(meRef, { muted }).catch(() => {});
  toast(muted ? '🔇 소리 끔' : '🔊 소리 켬');
}

/* ================= 상태 ================= */
let uid = null, myName = '', meRef = null, myCls = 'warrior', googleName = '';
let me = { x: SPAWN.x, y: SPAWN.y, face: Math.PI / 2, lv: 1, exp: 0, hp: 100, maxHp: 100, atk: 10, gold: 0, inv: {}, equipped: {}, skills: {}, q: {}, qc: {}, dead: false };
let others = {}, lootItems = {};
let sims = [], bossWasAlive = true;
let keys = {};
let cam = { x: SPAWN.x, y: SPAWN.y };
let floats = [], slashes = [], shots = [], rings = [], poofs = [];
let othersPrev = {}, mePrev = { x: SPAWN.x, y: SPAWN.y }, meMovingNow = false;
let mouseDown = false, dest = null, attackTargetSimId = null;
const view = { x: 0, y: 0 };
let lastAttackAt = 0, lastPosWrite = 0, hurtUntil = 0, picking = false;
let sentX = -1, sentY = -1, sentHp = -1, sentMp = null;
let ready = false;
let loginAt = Date.now();
let shakeT = 0, shakePow = 0, lastRegenWrite = 0, dustT = 0, hpDirty = false;
let goldHintShown = false;
let hitStopUntil = 0, mapFading = false, portalHintT = 0;
const skillCdUntil = {};

const PALETTE = ['#e74c3c', '#3498db', '#9b59b6', '#1abc9c', '#f39c12', '#e91e63', '#00bcd4'];
const colorOf = id => PALETTE[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];

const skillLv = id => (me.skills || {})[id] || 0;
const passSum = f => Object.keys(SKILLS).reduce((a, id) => a + (SKILLS[id][f] || 0) * skillLv(id), 0);
const eqStats = f => Object.values(me.equipped || {}).reduce((a, id) => a + (getItem(id)[f] || 0), 0);
const cdef = () => CLASSES[myCls] || CLASSES.warrior;
const totalAtk = () => (me.atk || 10) + (me.stAtk || 0) * 2 + eqStats('atk') + passSum('atk');
const totalDef = () => (me.stDef || 0) + eqStats('def') + passSum('def');
const totalCrit = () => cdef().crit + (me.stCrit || 0) * .01 + passSum('crit') + eqStats('crit');
const skillPow = () => 1 + (me.stWis || 0) * .03; /* 지혜: 스킬 피해/회복 +3%씩 */
const moveSpd = () => cdef().speed + (me.stSpd || 0) * 4 + passSum('spd') + eqStats('spd');
const classActiveId = () => Object.keys(SKILLS).find(k => SKILLS[k].cls === myCls && SKILLS[k].type === 'active');

function float(x, y, text, color = '#fff', big = false) { floats.push({ x, y, text, color, t: 0, big }); }
async function sysMsg(text, k = '') { await addDoc(collection(db, 'chat'), { from: '', text, ts: Date.now(), k }).catch(() => {}); }

function toast(html, kind = '') {
  const box = $('toasts');
  if (!box) return;
  const d = document.createElement('div');
  d.className = 'toast ' + kind;
  d.innerHTML = html;
  box.appendChild(d);
  setTimeout(() => d.classList.add('fade'), 2800);
  setTimeout(() => d.remove(), 3400);
  while (box.children.length > 6) box.firstChild.remove();
}
function flashInv() {
  for (const id of ['invPanel', 'invBtn']) { /* 패널이 닫혀 있으면 가방 버튼이 대신 번쩍 */
    const p = $(id);
    if (!p) continue;
    p.classList.remove('flash');
    void p.offsetWidth;
    p.classList.add('flash');
  }
}
function doShake(pow) { shakePow = Math.max(shakePow, pow); shakeT = Date.now(); }

/* ================= 월드 초기화 ================= */
async function ensureWorld() {
  const flag = doc(db, 'world', 'init');
  if ((await getDoc(flag)).exists()) return;
  const batch = writeBatch(db);
  for (const z of SPAWN_ZONES) {
    const def = MONSTER_TYPES[z.type];
    for (let i = 0; i < z.count; i++) {
      batch.set(doc(db, 'monsters', `${z.type}_${i}`), {
        type: z.type, hp: def.hp, maxHp: def.hp, alive: true,
        homeX: clampN(z.cx + rand(-z.spread, z.spread), 60, WORLD.w - 60),
        homeY: clampN(z.cy + rand(-z.spread, z.spread), 60, WORLD.h - 60),
      });
    }
  }
  batch.set(doc(db, 'monsters', 'boss'), { type: 'boss', hp: BOSS_DEF.hp, maxHp: BOSS_DEF.hp, alive: true, homeX: 800, homeY: 1050 });
  batch.set(flag, { ts: Date.now() });
  try { await batch.commit(); } catch (e) {}
}

async function ensurePage(n) {
  const pid = pageId(n);
  const flag = doc(db, 'world', 'init_' + pid);
  const probe = await getDoc(doc(db, 'monsters', pid + '_z0_0'));
  if ((await getDoc(flag)).exists() && probe.exists()) return;
  const pd = pageDef(n);
  const batch = writeBatch(db);
  const zones = [{ cx: 540, cy: 430, spread: 150 }, { cx: 1060, cy: 770, spread: 150 }];
  for (let zi = 0; zi < 2; zi++) {
    const k = pd.kinds[zi];
    for (let j = 0; j < 6; j++) {
      batch.set(doc(db, 'monsters', `${pid}_z${zi}_${j}`), {
        page: pid, kind: k.name, hp: k.hp, maxHp: k.hp, alive: true,
        homeX: clampN(zones[zi].cx + rand(-zones[zi].spread, zones[zi].spread), 60, WORLD.w - 60),
        homeY: clampN(zones[zi].cy + rand(-zones[zi].spread, zones[zi].spread), 60, WORLD.h - 60),
      });
    }
  }
  batch.set(doc(db, 'monsters', pid + '_boss'), {
    page: pid, kind: pd.boss.name, boss: true, hp: pd.boss.hp, maxHp: pd.boss.hp, alive: true,
    homeX: 800, homeY: 1000,
  });
  batch.set(flag, { ts: Date.now() });
  try { await batch.commit(); } catch (e) {}
}

async function ensureWorldM2() {
  const flag = doc(db, 'world', 'init_m2');
  if ((await getDoc(flag)).exists()) return;
  const batch = writeBatch(db);
  for (const z of M2_ZONES) {
    for (let i = 0; i < z.count; i++) {
      batch.set(doc(db, 'monsters', `m2_${z.type}_${i}`), {
        type: z.type, hp: SKELETON_DEF.hp, maxHp: SKELETON_DEF.hp, alive: true,
        homeX: clampN(z.cx + rand(-z.spread, z.spread), 60, WORLD.w - 60),
        homeY: clampN(z.cy + rand(-z.spread, z.spread), 60, WORLD.h - 60),
      });
    }
  }
  batch.set(doc(db, 'monsters', 'm2_boss'), { type: 'lich', hp: LICH_DEF.hp, maxHp: LICH_DEF.hp, alive: true, homeX: 800, homeY: 1000 });
  batch.set(flag, { ts: Date.now() });
  try { await batch.commit(); } catch (e) {}
}

function kindByName(name) {
  return Object.values(KINDS).find(k => k.name === name) || KINDS.slime;
}
function makeSim(id, d) {
  const isPage = (d.page || '').startsWith('p');
  let def, type, sprId;
  if (isPage) {
    const k = kindByName(d.kind || '슬라임');
    type = k.base;
    sprId = k.base + '::' + k.name;
    /* 구역 스케일링(pageDiff/pageExp)이 적용된 정본 def 사용 — 이전엔 atk/exp/gold가 10으로 하드코딩돼
       전 구역 밸런스가 죽어 있었음. HP도 문서의 (유니크 인플레이션 가능한) maxHp 대신 정본 기준 */
    const pn3 = +(d.page.slice(1)) || 1;
    const pd3 = pageDef(pn3);
    const kk = d.boss ? pd3.boss : (pd3.kinds.find(x => x.name === (d.kind || '')) || pd3.kinds[0]);
    def = { ...kk, maxHp: kk.hp };
    if (!SPRITE_DEFS[sprId]) {
      const bp = SPRITE_DEFS[k.base].pal;
      const keys = Object.keys(bp);
      SPRITE_DEFS[sprId] = { pal: { ...bp, [keys[1]]: k.main, [keys[2]]: k.shade }, rows: SPRITE_DEFS[k.base].rows };
    }
  } else {
    def = d.type === 'boss' ? BOSS_DEF : d.type === 'skeleton' ? SKELETON_DEF : d.type === 'lich' ? LICH_DEF : (MONSTER_TYPES[d.type] || MONSTER_TYPES.slime);
    type = d.type || 'slime';
    sprId = type;
  }
  const mapId = isPage ? d.page : (id.startsWith('m2') ? 'm2' : 'm1');
  return { id, type, page: mapId, map: mapId, boss: !!d.boss, sprId, uniq: !!d.uniq, def,
    homeX: d.homeX ?? 800, homeY: d.homeY ?? 600,
    x: d.homeX, y: d.homeY, wa: rand(0, Math.PI * 2), nextWander: 0, atkCdUntil: 0, alive: !!d.alive,
    hp: typeof d.hp === 'number' ? d.hp : def.hp, maxHp: def.maxHp, respawnAt: d.respawnAt || 0,
    dirA: Math.PI / 2, movingF: false, aggroF: false, blink: rand(0, 4000) };
}

function sdef(s) {
  if (!s.uniq) return s.def;
  if (!s._ud) s._ud = { ...s.def, name: '★' + s.def.name, hp: Math.round(s.def.hp * 6), maxHp: Math.round(s.def.hp * 6), atk: Math.round(s.def.atk * 1.8), exp: s.def.exp * 8, gold: s.def.gold * 15, r: Math.round(s.def.r * 1.25), aggro: Math.round(s.def.aggro * 1.3) };
  return s._ud;
}

function bossAlert(on) {
  const el = $('bossAlert');
  if (!el) return;
  if (on) {
    sfx('boss');
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => el.style.display = 'none', 5000);
  } else el.style.display = 'none';
}

function spawnPoof(s) {
  for (let i = 0; i < 14; i++) {
    const a = rand(0, Math.PI * 2), v = rand(40, 150);
    poofs.push({ x: s.x, y: s.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 50, r: rand(2, 5), t: 0, color: s.def.color, g: 240 });
  }
  sfx('die');
}
function fxSparks(x, y, n, color, spread = 130) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), v = rand(30, spread);
    poofs.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, r: rand(1.2, 2.6), t: 0, color, g: 170 });
  }
}
function hitFlashOverlay(c, s, now, d) {
  if (!s.hitFlash) return;
  const p = (now - s.hitFlash) / 150;
  if (p >= 1) { s.hitFlash = 0; return; }
  c.globalAlpha = (1 - p) * .65;
  c.fillStyle = '#fff';
  c.beginPath(); c.arc(s.x, s.y, d * .58, 0, 7); c.fill();
  c.globalAlpha = 1;
}

/* ================= 실시간 구독 ================= */
let unsubMon = null;
let pageRetryT = 0;
let monErr = '';
let monWarned = false;
let quotaWarned = false;
function noteErr(e) {
  const code = String((e && (e.code || e.message)) || e || '');
  if (code.includes('resource-exhausted') || code.toLowerCase().includes('quota')) {
    if (!quotaWarned) { quotaWarned = true; toast('⛔ 서버 일일 한도 초과 — 내일 자정(태평양)까지 일부 기능 제한', 'sysq'); }
    return true;
  }
  return false;
}
function onSnapSafe(label, q, cb) {
  const sub = () => onSnapshot(q, s => cb(s), err => {
    console.error('[' + label + ']', err);
    noteErr(err);
    setTimeout(sub, 5000);
  });
  sub();
}
function watchMonsters() {
  if (unsubMon) unsubMon();
  sims = [];
  othersPrev = {};
  unsubMon = onSnapshot(query(collection(db, 'monsters'), where('page', '==', myPage())), snap => {
    monErr = '';
    const EXPECT = 13;
    if (snap.size < EXPECT && Date.now() - pageRetryT > 8000) {
      pageRetryT = Date.now();
      ensurePage(pageNum()).catch(e => { monErr = '보충실패:' + (e.code || e.message); });
    }
    const seenIds = new Set();
    snap.forEach(dc => {
      seenIds.add(dc.id);
      const d = dc.data();
      let s = null;
      try { s = sims.find(x => x.id === dc.id); if (!s) { s = makeSim(dc.id, d); sims.push(s); } }
      catch (e) { monErr = 'makeSim실패(' + dc.id + '):' + (e.message || e); if (!monWarned) { monWarned = true; toast('⚠️ 몬스터 로드 오류: ' + esc(monErr)); } return; }
      if (typeof d.hp === 'number' && typeof s.hp === 'number' && d.hp < s.hp && s.alive) s.hitFlash = Date.now();
      if (!d.alive && s.alive) spawnPoof(s);
      if (d.alive && !s.alive) {
        s.x = d.homeX; s.y = d.homeY;
        if (dc.id === 'boss' && !bossWasAlive) bossAlert(true);
      }
      if (!d.alive && s.alive && dc.id === 'boss') bossAlert(false);
      s.alive = !!d.alive;
      s.uniq = !!d.uniq;
      s.hp = typeof d.hp === 'number' ? d.hp : sdef(s).hp;
      s.respawnAt = d.respawnAt || 0;
    });
    sims = sims.filter(s => seenIds.has(s.id)); /* 문서가 삭제된 유령 몬스터 제거(불사신+실피해 방지) */
    bossWasAlive = (sims.find(s => s.boss) || { alive: true }).alive;
  }, err => {
    const code = String(err.code || err.message || '');
    monErr = '구독오류:' + code;
    console.error('[monsters]', err);
    if (!monWarned) {
      monWarned = true;
      toast(code.includes('resource-exhausted') || code.includes('quota')
        ? '⛔ 서버 일일 한도 초과! 내일 자정(태평양)까지 일부 기능 제한 — Firebase Blaze 플랜 필요'
        : '⚠️ 몬스터 연결 실패: ' + esc(code));
    }
    setTimeout(() => watchMonsters(), 4000);
  });
}

function watchPlayers() {
  onSnapSafe('players', collection(db, 'players'), snap => {
    snap.forEach(dc => { if (dc.id !== uid) others[dc.id] = dc.data(); });
  });
}

let unsubLoot = null;
function watchLoot() {
  /* 현재 구역만 구독 — 전체 컬렉션 구독은 읽기 쿼터를 세계 전체 드랍에 비례해 소모 */
  if (unsubLoot) unsubLoot();
  lootItems = {};
  const sub = () => unsubLoot = onSnapshot(query(collection(db, 'loot'), where('map', '==', myPage())), snap => {
    lootItems = {};
    snap.forEach(dc => lootItems[dc.id] = dc.data());
  }, err => { console.error('[loot]', err); noteErr(err); setTimeout(() => { if (unsubLoot) watchLoot(); }, 5000); });
  sub();
}

let rankMode = 'lv';
let rankCache = [];
function renderRank() {
  const list = [...rankCache].sort((a, b) => rankMode === 'lv' ? (b.lv || 1) - (a.lv || 1) : (b.power || 0) - (a.power || 0)).slice(0, 10);
  const rows = list.map((p, i) => {
    const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}`;
    const val = rankMode === 'lv' ? `Lv${p.lv || 1}` : `⚔${p.power || 0}`;
    return `<div><span style="color:#889;display:inline-block;width:18px;">${medal}</span> ${esc(p.name || '?')} <b style="color:#ffd700">${val}</b> <span style="color:#667">${CLASSES[p.cls]?.icon || ''}</span></div>`;
  }).join('');
  const el = $('rankList');
  if (el) el.innerHTML = rows || '<div style="color:#556">아직 없음</div>';
  const t1 = $('rankTabLv'), t2 = $('rankTabAtk');
  if (t1) t1.style.background = rankMode === 'lv' ? '#c9a227' : '#2b3547';
  if (t2) t2.style.background = rankMode === 'atk' ? '#c9a227' : '#2b3547';
}
function watchRank() {
  onSnapSafe('rank', query(collection(db, 'players'), orderBy('lv', 'desc'), limit(30)), snap => {
    rankCache = [];
    snap.forEach(dc => rankCache.push(dc.data()));
    renderRank();
  }, () => {});
}

function watchChat() {
  const log = $('chatLog');
  onSnapSafe('chat', query(collection(db, 'chat'), orderBy('ts', 'desc'), limit(40)), snap => {
    const msgs = [];
    snap.forEach(d => msgs.push(d.data()));
    msgs.reverse();
    log.innerHTML = msgs.map(m =>
      m.from ? `<div><span class="nick">${esc(m.from)}</span>: ${esc(m.text)}</div>`
             : `<div class="${m.k === 'q' ? 'sysq' : 'sys'}">${esc(m.text)}</div>`).join('');
    log.scrollTop = log.scrollHeight;
  }, () => {});
}

/* ================= 성장 ================= */
function levelCalc(p, expGain) {
  let exp = (p.exp || 0) + expGain;
  let lv = p.lv || 1, leveled = 0;
  while (lv < 100 && exp >= expNeed(lv)) { exp -= expNeed(lv); lv++; leveled++; }
  if (lv >= 100) exp = Math.min(exp, expNeed(100)); /* HUD 분모(expNeed(lv))와 일치 */
  const upd = { exp, lv };
  if (leveled) upd.statPts = (p.statPts || 0) + 3 * leveled;
  return { upd, leveled, nlv: lv };
}
function simLevel(s) {
  if (!s.page) return 1;
  if (s.page.startsWith('p')) return +s.page.slice(1) || 1;
  return s.page === 'm2' ? 2 : 1;
}

async function gainExp(expGain, kill = null) {
  await runTransaction(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return;
    const p = snap.data();
    const { upd, leveled, nlv } = levelCalc(p, expGain);
    const q = { ...(p.q || {}) };
    let gold = p.gold || 0;
    if (kill) {
      gold += kill.gold || 0;
      q.total = (q.total || 0) + 1;
      q.gold_earned = (q.gold_earned || 0) + (kill.gold || 0);
      if (kill.type === 'boss') q.boss = (q.boss || 0) + 1;
      else if (kill.type) q[kill.type] = (q[kill.type] || 0) + 1;
    }
    tx.update(meRef, { ...upd, gold, q });
    return { leveled, nlv }; /* FX는 트랜잭션 밖에서 — 본문은 경합 시 재실행되어 중복 발동됨 */
  }).then(r => {
    if (!r || !r.leveled) return;
    float(me.x, me.y - 52, `LEVEL UP! Lv ${r.nlv}`, '#ffd700', true);
    toast(`✨ 레벨업! 스탯 포인트 +${3 * r.leveled} (좌측 상단에서 분배)`, 'sysq');
    rings.push({ x: me.x, y: me.y, r: 90, t: 0, max: 600, color: '255,215,0' });
    fxSparks(me.x, me.y, 22, '#ffd700', 180);
    sfx('levelup');
    sysMsg(`${myName}님이 Lv ${r.nlv} 달성!`);
  }).catch(() => {});
}

function rollDrops(type) {
  const drops = (DROP_TABLE[type] || []).filter(([, p]) => Math.random() < p).map(([id]) => id);
  if (Math.random() < UNIQUE_RATE) drops.push(UNIQUE_POOL[Math.floor(Math.random() * UNIQUE_POOL.length)]);
  if (Math.random() < LEGEND_RATE) drops.push(LEGEND_POOL[Math.floor(Math.random() * LEGEND_POOL.length)]);
  return drops;
}

async function dropLoot(type, x, y) {
  for (const itemId of rollDrops(type)) {
    await addDoc(collection(db, 'loot'), { itemId, x: x + rand(-24, 24), y: y + rand(-24, 24), map: myMap(), ts: Date.now() }).catch(() => {});
  }
}

/* ================= 전투 ================= */
function dealDamage(sim, dmg) {
  return runTransaction(db, async tx => {
    const ref = doc(db, 'monsters', sim.id);
    const g = await tx.get(ref);
    if (!g.exists()) return null;
    const m = g.data();
    if (!m.alive) return null;
    const nhp = (typeof m.hp === 'number' ? m.hp : m.maxHp) - dmg;
    if (nhp <= 0) {
      tx.update(ref, { hp: 0, alive: false, killedBy: uid, respawnAt: Date.now() + sdef(sim).respawn });
      return true;
    }
    tx.update(ref, { hp: nhp });
    return false;
  }).catch(() => null);
}

async function handleKill(sim) {
  const d2 = sdef(sim);
  const gold = Math.round((d2.gold || 0) * rand(.8, 1.25));
  float(sim.x, sim.y - d2.r - 30, `+${d2.exp} EXP`, '#3498db');
  float(sim.x, sim.y - d2.r - 52, `+${gold} G`, '#ffd700');
  sfx('coin');
  await gainExp(d2.exp, { type: sim.boss ? 'boss' : sim.type, gold }); /* 보스 퀘스트(q.boss) 카운트 */
  dropLoot(sim.type, sim.x, sim.y);
  if (sim.boss && sim.page && sim.page.startsWith('p')) {
    const pn2 = +sim.page.slice(1);
    if (!(me.conq || {})[pn2]) {
      runTransaction(db, async tx => {
        const snap = await tx.get(meRef);
        if (!snap.exists()) return false;
        const p = snap.data();
        if ((p.conq || {})[pn2]) return false; /* 서버 기준 재확인 — 중복 정복/FX 방지 */
        tx.update(meRef, {
          ['conq.' + pn2]: true,
          lv: Math.min(100, (p.lv || 1) + 1),
          statPts: (p.statPts || 0) + 3,
        });
        return true;
      }).then(applied => {
        if (!applied) return;
        me.hp = maxHpOf();
        updateDoc(meRef, { hp: me.hp }).catch(() => {});
        toast(`👑 ${pn2}구역 정복! <b>레벨 +1</b> · 스탯 포인트 +3${pn2 < MAX_PAGE ? ' · ' + (pn2 + 1) + '구역 개방' : ' · 전 지역 정복 완료!'}`, 'sysq');
        sysMsg(`👑 ${myName}님이 ${pn2}구역을 정복했습니다! (Lv +1)`, 'q');
        sfx('levelup');
        rings.push({ x: me.x, y: me.y, r: 100, t: 0, max: 700, color: '255,215,0' });
        fxSparks(me.x, me.y, 24, '#ffd700', 200);
        float(me.x, me.y - 52, 'LEVEL UP!', '#ffd700', true);
      }).catch(() => {});
    }
  }
  if (sim.uniq) {
    sysMsg(`★ 유니크 ${d2.name} 처치!`, 'q');
    toast(`★ 유니크 몬스터 처치!`, 'sysq');
  }
  sysMsg(`${myName}님이 ${d2.name}을(를) 처치했습니다!${sim.type === 'boss' || sim.type === 'lich' ? ' 👑👑👑' : ''}`);
}

async function attackResult(sim, dmg, crit) {
  const r = await dealDamage(sim, dmg);
  if (r === null || r === undefined) return;
  sim.angry = true;
  const kdx = sim.x - me.x, kdy = sim.y - me.y, kd = Math.hypot(kdx, kdy) || 1;
  sim.kbx = kdx / kd * (crit ? 7 : 4.2);
  sim.kby = kdy / kd * (crit ? 7 : 4.2);
  sim.punchT = Date.now();
  float(sim.x + rand(-8, 8), sim.y - sdef(sim).r - 10, String(dmg) + (crit ? '!' : ''), crit ? '#ffd700' : '#fff', crit);
  fxSparks(sim.x, sim.y - sdef(sim).r * .3, crit ? 12 : 6, crit ? '#ffd700' : '#ffecb3', crit ? 160 : 100);
  if (crit) { doShake(7); hitStopUntil = Math.max(hitStopUntil, Date.now() + 42); }
  sfx(crit ? 'crit' : 'hit');
  if (r) { hitStopUntil = Math.max(hitStopUntil, Date.now() + 72); doShake(9); await handleKill(sim); }
}

function nearestSim(maxD) {
  let best = null, bestD = maxD;
  for (const s of sims) {
    if (!s.alive || s.map !== myMap()) continue;
    const d = Math.hypot(s.x - me.x, s.y - me.y);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

function angLerp(a, b, t) {
  if (!Number.isFinite(a)) return b;
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}
function stepToward(pt, sp) {
  const ta = Math.atan2(pt.y - me.y, pt.x - me.x);
  me.face = angLerp(me.face, ta, .28);
  const d = Math.hypot(pt.x - me.x, pt.y - me.y) || 1;
  const ease = d < 46 ? Math.max(.4, d / 46) : 1;
  const step = Math.min(sp * ease, d);
  me.x = clampN(me.x + Math.cos(me.face) * step, 40, WORLD.w - 40);
  me.y = clampN(me.y + Math.sin(me.face) * step, 40, WORLD.h - 40);
}

function fireShot(tx, ty, color, dur, size = 5) {
  const d = Math.hypot(tx - me.x, ty - me.y) || 1;
  shots.push({ x: me.x, y: me.y, vx: (tx - me.x) / d * 520, vy: (ty - me.y) / d * 520, t: 0, max: dur, color, size });
}

function tryAttack(now, forced = null) {
  if (!ready || me.dead || worldMapOpen()) return; /* 지도 오버레이 뒤에서 눈먼 전투 방지 */
  const cd = cdef().atkCd;
  if (now < lastAttackAt + cd) return;
  lastAttackAt = now;
  const target = forced && forced.alive ? forced : nearestSim(cdef().range);
  if (target) me.face = Math.atan2(target.y - me.y, target.x - me.x);
  if (cdef().melee) {
    slashes.push({ x: me.x, y: me.y, a: target ? me.face : -Math.PI / 2, t: 0, w: myCls === 'rogue' ? 2.4 : 3.6, len: myCls === 'rogue' ? 30 : 38 });
    sfx('swing');
  } else if (target) {
    fireShot(target.x, target.y, myCls === 'archer' ? '#e8d9a0' : '#c89bff', Math.min(600, Math.hypot(target.x - me.x, target.y - me.y) / 520 * 1000), myCls === 'archer' ? 4 : 8);
    sfx(myCls === 'archer' ? 'shoot' : 'cast');
  }
  if (!target) return;
  const crit = Math.random() < totalCrit();
  const dmg = Math.max(1, Math.round(totalAtk() * rand(.85, 1.15) * (crit ? 1.6 : 1)));
  attackResult(target, dmg, crit);
}

function useSkill(slot) {
  if (!ready || me.dead || worldMapOpen()) return;
  const now = Date.now();
  const id = slot === 2 ? 'heal' : classActiveId();
  if (!id) return;
  const def = SKILLS[id];
  if (skillLv(id) < 1) { float(me.x, me.y - 34, '미습득 스킬 (B: 샵)', '#aaa'); return; }
  if (now < (skillCdUntil[id] || 0)) return;
  if (mapFading) return; /* 맵 전환 중 시전 금지 — 지연 콜백이 새 구역 몬스터를 때리는 사고 방지 */
  const castPage = myPage(); /* 지연 폭발/발사 콜백용 구역 스냅샷 */
  const mpc = def.mp || 0;
  if ((me.mp ?? maxMpOf()) < mpc) { float(me.x, me.y - 34, '마나 부족!', '#5dade2'); return; }

  if (id === 'heal') {
    const amt = Math.round(maxHpOf() * .4 * skillPow()); /* me.maxHp는 생성 시점 값이라 낡음 */
    me.hp = Math.min(maxHpOf(), (me.hp || 0) + amt);
    updateDoc(meRef, { hp: me.hp }).catch(() => {});
    float(me.x, me.y - 34, `+${amt} HP`, '#2ecc71');
    rings.push({ x: me.x, y: me.y, r: 70, t: 0, max: 450, color: '46,204,113' });
    fxSparks(me.x, me.y - 10, 12, '#7fe3a0', 110);
    sfx('heal');
  } else if (id === 'power_strike') {
    const t = nearestSim(cdef().range * 1.35);
    if (!t) { float(me.x, me.y - 34, '대상 없음', '#aaa'); return; }
    slashes.push({ x: me.x, y: me.y, a: Math.atan2(t.y - me.y, t.x - me.x), t: 0, w: 8, len: 52, color: '#ffb347' });
    rings.push({ x: t.x, y: t.y, r: 48, t: 0, max: 320, color: '255,140,0' });
    fxSparks(t.x, t.y, 14, '#ffb347', 160);
    doShake(6); sfx('crit');
    attackResult(t, Math.max(1, Math.round(totalAtk() * 4 * skillPow() * rand(.9, 1.1))), true);
  } else if (id === 'multishot') {
    const targets = sims.filter(s => s.alive && Math.hypot(s.x - me.x, s.y - me.y) < 240);
    if (!targets.length) { float(me.x, me.y - 34, '대상 없음', '#aaa'); return; }
    for (const t of targets) {
      fireShot(t.x, t.y, '#e8d9a0', Math.hypot(t.x - me.x, t.y - me.y) / 520 * 1000 + 60, 4);
      const dmg = Math.max(1, Math.round(totalAtk() * 1.5 * skillPow() * rand(.9, 1.1)));
      setTimeout(() => { if (myPage() === castPage) attackResult(t, dmg, false); }, 140);
    }
    sfx('swing');
  } else if (id === 'shadow_strike') {
    const t = nearestSim(190);
    if (!t) { float(me.x, me.y - 34, '대상 없음', '#aaa'); return; }
    poofs.push({ x: me.x, y: me.y, vx: 0, vy: 0, r: 16, t: 0, color: '#34495e', g: -60 });
    me.x = clampN(t.x + rand(-44, 44), 40, WORLD.w - 40);
    me.y = clampN(t.y + rand(-44, 44), 40, WORLD.h - 40);
    cam.x = me.x; cam.y = me.y;
    slashes.push({ x: me.x, y: me.y, a: Math.atan2(t.y - me.y, t.x - me.x), t: 0, w: 7, len: 50, color: '#b388ff' });
    fxSparks(t.x, t.y, 16, '#9b59b6', 170);
    doShake(6); sfx('boom');
    attackResult(t, Math.max(1, Math.round(totalAtk() * 6 * skillPow())), true);
  } else if (id === 'fireball') {
    const t = nearestSim(340);
    if (!t) { float(me.x, me.y - 34, '대상 없음', '#aaa'); return; }
    fireShot(t.x, t.y, '#ff7f27', Math.hypot(t.x - me.x, t.y - me.y) / 520 * 1000, 10);
    setTimeout(() => {
      if (myPage() !== castPage) return; /* 폭발 전 맵 이동 시 새 구역 오폭 방지 */
      rings.push({ x: t.x, y: t.y, r: 150, t: 0, max: 500, color: '255,90,0' });
      rings.push({ x: t.x, y: t.y, r: 90, t: 0, max: 350, color: '255,200,60' });
      fxSparks(t.x, t.y, 24, '#ff7f27', 220);
      doShake(9); sfx('boom');
      const victims = sims.filter(s => s.alive && Math.hypot(s.x - t.x, s.y - t.y) < 145);
      for (const v of victims) {
        const dmg = Math.max(1, Math.round(totalAtk() * 2.2 * skillPow() * rand(.9, 1.1)));
        attackResult(v, dmg, false);
      }
    }, 240);
  }
  if (mpc) {
    me.mp = (me.mp ?? maxMpOf()) - mpc;
    updateDoc(meRef, { mp: Math.round(me.mp) }).catch(() => {});
  }
  skillCdUntil[id] = now + def.cd;
}

/* ================= 스킬 샵 ================= */
function renderShop() {
  const body = $('shopBody');
  const list = Object.entries(SKILLS).filter(([, d]) => d.cls === myCls || d.cls === 'all');
  let html = list.map(([id, d]) => {
    const lv = skillLv(id);
    const maxed = lv >= MAX_SKILL_LV;
    const cost = skillCost(d, lv);
    const afford = (me.gold || 0) >= cost;
    const stat = d.atk ? `공격 +${d.atk}` : d.def ? `방어 +${d.def}` : d.spd ? `속도 +${d.spd}` : d.crit ? `치명타 +${Math.round(d.crit * 100)}%p` : '';
    return `<div class="srow">
      <div class="si">${d.icon}</div>
      <div class="sm">
        <div><span class="st">${esc(d.name)}</span>${d.type === 'passive' ? `<span class="slv">${stat}</span>` : ''}<span class="slv">Lv ${lv}/${MAX_SKILL_LV}</span></div>
        <div class="sd">${esc(d.desc)}${d.mp ? ` · 마나 ${d.mp}` : ''}${d.cd ? ` · 재사용 ${d.cd / 1000}s` : ''}</div>
      </div>
      ${maxed ? `<button class="buyBtn" disabled>MAX</button>`
              : `<button class="buyBtn" data-buy="${id}" ${afford ? '' : 'disabled'}>${cost} G</button>`}
    </div>`;
  }).join('');
  for (const [pid, picon, pcost] of POTION_SHOP) {
    const pd = ITEMS[pid];
    const affordP = (me.gold || 0) >= pcost;
    const bagFull = Object.keys(me.inv || {}).length >= bagSize();
    html += `<div class="srow">
      <div class="si">${picon}</div>
      <div class="sm">
        <div><span class="st">${esc(pd.name)}</span><span class="slv">${pd.heal ? 'HP +' + pd.heal : 'MP +' + pd.mana} 회복</span></div>
        <div class="sd">가방에 담아 클릭하면 사용 (${bagFull ? '가방 가득 참' : `${Object.keys(me.inv || {}).length}/${bagSize()}`})</div>
      </div>
      <button class="buyBtn" data-potion="${pid}" ${affordP && !bagFull ? '' : 'disabled'}>${pcost} G</button>
    </div>`;
  }
  const canExpand = bagSize() < MAX_BAG;
  const upCost = bagUpCost();
  html += `<div class="srow">
      <div class="si">🎒</div>
      <div class="sm">
        <div><span class="st">가방 확장</span><span class="slv">${bagSize()}칸 → ${bagSize() + 6}칸</span></div>
        <div class="sd">가방 슬롯을 영구적으로 6칸 늘립니다${canExpand ? '' : ' · 최대치 도달'}</div>
      </div>
      ${canExpand ? `<button class="buyBtn" id="buyBag" ${(me.gold || 0) >= upCost ? '' : 'disabled'}>${upCost} G</button>`
                  : `<button class="buyBtn" disabled>MAX</button>`}
    </div>`;
  body.innerHTML = html;
  body.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => buySkill(b.dataset.buy));
  body.querySelectorAll('[data-potion]').forEach(b => b.onclick = () => buyPotion(b.dataset.potion));
  const bb = $('buyBag');
  if (bb) bb.onclick = buyBag;
}

function buyBag() {
  runTransaction(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return false;
    const p = snap.data();
    const bs = p.bagSize || 18;
    if (bs >= MAX_BAG) return false;
    const cost = 500 * Math.pow(2, (bs - 18) / 6);
    if ((p.gold || 0) < cost) return false;
    tx.update(meRef, { gold: p.gold - cost, bagSize: bs + 6 });
    return true;
  }).then(ok => {
    if (ok) { sfx('buy'); toast('🎒 가방이 <b>6칸</b> 확장되었습니다!', 'sysq'); renderShop(); }
    else toast('💰 골드가 부족합니다');
  }).catch(() => {});
}

function buySkill(id) {
  runTransaction(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return 'err';
    const p = snap.data();
    const def = SKILLS[id];
    const lv = (p.skills || {})[id] || 0;
    if (lv >= MAX_SKILL_LV) return 'max';
    const cost = skillCost(def, lv);
    if ((p.gold || 0) < cost) return 'poor';
    const q = { ...(p.q || {}) };
    q.skills_bought = (q.skills_bought || 0) + 1;
    tx.update(meRef, { gold: p.gold - cost, [`skills.${id}`]: lv + 1, q });
    return 'ok';
  }).then(r => {
    if (r === 'ok') { sfx('buy'); toast(`✦ ${SKILLS[id].name} 습득!`, 'sysq'); float(me.x, me.y - 34, `${SKILLS[id].name} 습득!`, '#7fe3a0'); renderShop(); }
    else if (r === 'poor') { float(me.x, me.y - 34, '골드가 부족합니다', '#ff6b6b'); toast('💰 골드가 부족합니다'); }
  }).catch(() => {});
}

function buyPotion(itemId = 'potion') {
  const pcost = (POTION_SHOP.find(([p]) => p === itemId) || [])[2] || 0;
  runTransaction(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return false;
    const p = snap.data();
    if ((p.gold || 0) < pcost) return false;
    const bs = p.bagSize || 18;
    if (Object.keys(p.inv || {}).length >= bs) return false;
    const inv = { ...(p.inv || {}) };
    for (let i = 0; i < bs; i++) {
      if (inv[String(i)] == null) { inv[String(i)] = itemId; break; }
    }
    tx.update(meRef, { gold: p.gold - pcost, inv: sortInvMap(inv) });
    return true;
  }).then(ok => {
    if (ok) { sfx('buy'); toast(`🧪 ${ITEMS[itemId].name} 구매`); flashInv(); renderShop(); }
    else toast('구매 실패 (골드/가방 확인)');
  }).catch(() => {});
}

/* ================= 퀘스트 ================= */
const qCounter = key => key === 'lv' ? me.lv : (me.q || {})[key] || 0;

function renderQuests() {
  const body = $('questBody');
  body.innerHTML = QUESTS.map(q => {
    const claimed = (me.qc || {})[q.id];
    const needOk = !q.need || (me.qc || {})[q.need];
    const cur = qCounter(q.goal[0]);
    const done = cur >= q.goal[1] && needOk;
    const pct = clampN(cur / q.goal[1] * 100, 0, 100);
    const rw = [q.reward.gold ? `💰${q.reward.gold}G` : '', q.reward.exp ? `⭐${q.reward.exp}EXP` : ''].filter(Boolean).join(' ');
    return `<div class="srow ${claimed ? 'qdone' : ''}">
      <div class="si">${q.icon}</div>
      <div class="sm">
        <div class="st">${esc(q.name)}${!needOk ? ' <span style="color:#667;font-size:10px">(이전 퀘스트 필요)</span>' : ''}</div>
        <div class="sd">${esc(q.desc)} — ${Math.min(cur, q.goal[1])}/${q.goal[1]} · 보상 ${rw}</div>
        <div class="qbar"><div style="width:${pct}%"></div></div>
      </div>
      ${claimed ? `<button class="claimBtn" disabled>완료</button>`
        : `<button class="claimBtn ${done ? 'ready' : ''}" data-q="${q.id}" ${done ? '' : 'disabled'}>수령</button>`}
    </div>`;
  }).join('');
  body.querySelectorAll('[data-q]').forEach(b => b.onclick = () => claimQuest(b.dataset.q));
}

function claimQuest(id) {
  const qdef = QUESTS.find(q => q.id === id);
  if (!qdef) return;
  runTransaction(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return false;
    const p = snap.data();
    if ((p.qc || {})[id]) return false;
    const qc = { ...(p.qc || {}), [id]: true };
    const { upd } = levelCalc(p, qdef.reward.exp || 0);
    tx.update(meRef, { ...upd, gold: (p.gold || 0) + (qdef.reward.gold || 0), qc });
    return true;
  }).then(ok => {
    if (ok) {
      sfx('coin');
      float(me.x, me.y - 40, `퀘스트 완료! +${qdef.reward.gold || 0}G`, '#7fe3a0');
      toast(`📜 「${esc(qdef.name)}」 완료! 보상 수령`, 'sysq');
      sysMsg(`[퀘스트] ${myName}님이 「${qdef.name}」 완료!`, 'q');
      renderQuests();
    }
  }).catch(() => {});
}

/* ================= 인벤토리/루팅 ================= */
function itemStat(it) {
  return [it.atk ? `공격+${it.atk}` : '', it.def ? `방어+${it.def}` : '',
    it.crit ? `치명타+${Math.round(it.crit * 100)}%p` : '', it.spd ? `속도+${it.spd}` : '',
    it.heal ? `HP+${it.heal} 회복` : '', it.mana ? `MP+${it.mana} 회복` : ''].filter(Boolean).join(' · ');
}

let bagFullUntil = 0;
async function pickup(lid, l) {
  if (picking) return;
  picking = true;
  try {
    let item = null, res = null;
    /* 루팅 삭제와 인벤토리 추가를 한 트랜잭션으로 — 가방이 가득이면 삭제하지 않고 바닥에 남김
       (이전엔 먼저 삭제 후 추가 실패 시 아이템이 영구 소실) */
    await runTransaction(db, async tx => {
      item = null; res = null;
      const ref = doc(db, 'loot', lid);
      const lsnap = await tx.get(ref);
      if (!lsnap.exists()) return;
      const psnap = await tx.get(meRef);
      if (!psnap.exists()) return;
      const cand = lsnap.data();
      const r = computeAddToInv(psnap.data(), cand.itemId);
      if (!r) { res = 'full'; return; }
      tx.delete(ref);
      tx.update(meRef, r.upd);
      item = cand; res = r.res;
    });
    if (res === 'full') {
      bagFullUntil = Date.now() + 2500; /* 자동 루팅 재시도 폭주 방지 */
      float(me.x, me.y - 30, '가방이 가득 참', '#e74c3c');
      toast('🎒 가방이 가득 찼습니다 — 아이템은 바닥에 남아있습니다');
      return;
    }
    if (!item) return;
    const it = getItem(item.itemId);
    sfx('pickup');
    flashInv();
    if (res === 'equipped') toast(`${itemIcon(item.itemId)} <b style="color:${it.color}">${esc(it.name)}</b> 획득 → <b>자동 장착!</b> <span style="color:#8aa">[${RARITY_KR[it.rarity] || '일반'}]</span>`, 'sysq');
    else if (res === 'swapped') toast(`${itemIcon(item.itemId)} <b style="color:${it.color}">${esc(it.name)}</b> 획득 → <b>등급 우위 자동 교체!</b> <span style="color:#8aa">[${RARITY_KR[it.rarity] || '일반'}]</span>`, 'sysq');
    else if (res === 'stacked') toast(`${itemIcon(item.itemId)} <b style="color:${it.color}">${esc(it.name)}</b> 보유 수량 +1 <span style="color:#8aa">[${RARITY_KR[it.rarity] || '일반'}]</span>`);
    else toast(`${itemIcon(item.itemId)} <b style="color:${it.color}">${esc(it.name)}</b> 획득 <span style="color:#8aa">[${RARITY_KR[it.rarity] || '일반'}]</span> → 가방 <b>${Object.keys(me.inv || {}).length}/${bagSize()}</b>`);
    float(me.x, me.y - 30, `+ ${it.name}`, it.color);
  } finally { picking = false; }
}

/* 플레이어 데이터 p에 itemId를 추가했을 때의 갱신 계산 (순수 함수) — null이면 가방 가득 */
function computeAddToInv(p, itemId) {
  const bs = p.bagSize || 18;
  const inv = { ...(p.inv || {}) };
  const eq = { ...(p.equipped || {}) };
  const it = getItem(itemId);
  const q = { ...(p.q || {}) };
  q.items = (q.items || 0) + 1;
  const upd = { q };
  if (!it.slot && (it.heal || it.mana || it.scroll)) {
    for (const [k, v] of Object.entries(inv)) {
      const [bid, cnt] = splitStack(v);
      if (bid === itemId) {
        inv[k] = bid + '*' + (cnt + 1);
        upd.inv = sortInvMap(inv);
        return { upd, res: 'stacked' };
      }
    }
  }
  for (let i = 0; i < bs; i++) {
    if (inv[String(i)] == null) {
      let res;
      inv[String(i)] = itemId;
      if (it.slot && !eq[it.slot]) {
        delete inv[String(i)];
        eq[it.slot] = itemId;
        upd.equipped = eq;
        upd['q.eqflag'] = 1;
        res = 'equipped';
      } else if (it.slot && eq[it.slot]) {
        const cur = getItem(eq[it.slot]);
        const cR = RARITY_RANK[cur.rarity] ?? 0, nR = RARITY_RANK[it.rarity] ?? 0;
        if (nR > cR || (nR === cR && (it._lv || 0) > (cur._lv || 0))) {
          inv[String(i)] = eq[it.slot];
          eq[it.slot] = itemId;
          upd.equipped = eq;
          upd['q.eqflag'] = 1;
          res = 'swapped';
        } else res = 'added';
      } else res = 'added';
      upd.inv = sortInvMap(inv);
      return { upd, res };
    }
  }
  return null;
}

function addToInv(itemId) {
  return runTransaction(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return null;
    const r = computeAddToInv(snap.data(), itemId);
    if (!r) return null;
    tx.update(meRef, r.upd);
    return r.res;
  }).catch(() => null);
}

function slotClick(rawId) {
  runTransaction(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return;
    const p = snap.data();
    const inv = { ...(p.inv || {}) };
    const eq = { ...(p.equipped || {}) };
    const key = findInvKey(inv, rawId);
    if (!key) return;
    const itemId = inv[key];
    const it = getItem(itemId);
    if (it.heal) {
      const nhp = Math.min(maxHpOf(), (me.hp || 0) + it.heal);
      const [bid, cnt] = splitStack(itemId);
      if (cnt > 1) inv[key] = bid + '*' + (cnt - 1); else delete inv[key];
      tx.update(meRef, { inv, hp: nhp });
      setTimeout(() => {
        me.hp = nhp;
        hpDirty = true;
        float(me.x, me.y - 30, `+${it.heal} HP`, '#2ecc71');
        rings.push({ x: me.x, y: me.y, r: 50, t: 0, max: 350, color: '46,204,113' });
        sfx('potion');
      }, 0);
    } else if (it.mana) {
      const nmp = Math.min(maxMpOf(), (me.mp ?? 0) + it.mana);
      const [bid2, cnt2] = splitStack(itemId);
      if (cnt2 > 1) inv[key] = bid2 + '*' + (cnt2 - 1); else delete inv[key];
      tx.update(meRef, { inv, mp: Math.round(nmp) });
      setTimeout(() => {
        me.mp = nmp;
        float(me.x, me.y - 30, `+${it.mana} MP`, '#3498db');
        rings.push({ x: me.x, y: me.y, r: 50, t: 0, max: 350, color: '52,152,219' });
        sfx('potion');
      }, 0);
    } else if (it.slot) {
      const old = eq[it.slot];
      eq[it.slot] = itemId;
      if (old) inv[key] = old; else delete inv[key];
      tx.update(meRef, { inv: sortInvMap(inv), equipped: eq, 'q.eqflag': 1 });
      setTimeout(() => sfx('buy'), 0);
    } else {
      /* 슬롯 정의가 없는(레거시/알 수 없는) 아이템 — 장착하면 eq["undefined"]로 증발하므로 차단 */
      setTimeout(() => toast('사용할 수 없는 아이템입니다 (판매만 가능)'), 0);
    }
  }).catch(() => {});
}

function unequip(slot) {
  runTransaction(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return;
    const p = snap.data();
    const eq = { ...(p.equipped || {}) };
    const itemId = eq[slot];
    if (!itemId) return;
    const bs = p.bagSize || 18;
    const inv = { ...(p.inv || {}) };
    let placed = false;
    for (let i = 0; i < bs; i++) {
      if (inv[String(i)] == null) { inv[String(i)] = itemId; placed = true; break; }
    }
    if (!placed) return 'full';
    delete eq[slot];
    tx.update(meRef, { inv: sortInvMap(inv), equipped: eq });
    return true;
  }).then(r => {
    if (r === 'full') toast('🎒 가방이 가득 해제할 수 없습니다');
  }).catch(() => {});
}

function openEnhModal(scrollRaw, targetRaw) {
  closeEnhModal();
  const [sb] = splitStack(scrollRaw);
  const sc = getItem(sb);
  const t = getItem(targetRaw);
  if (!sc.scroll || t.heal || t.mana || t.scroll) return;
  const lv = t._lv || 0;
  const rMul = t.rarity === 'unique' ? 4 : t.rarity === 'legend' ? 3 : t.rarity === 'epic' ? 2 : 1;
  const cost = 300 * (lv + 1) * rMul;
  const grade = sc.grade || 'normal';
  const chance = Math.round(ENH_CHANCE[grade](lv));
  const [, tcnt] = splitStack(targetRaw), [, scnt2] = splitStack(scrollRaw);
  const gl = document.createElement('div');
  gl.id = 'enhModal';
  gl.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;';
  gl.innerHTML = `<div id="enhBox">
    <div style="font-size:16px;font-weight:bold;margin-bottom:10px;">🔨 아이템 강화</div>
    <div style="margin-bottom:4px;">대상: <b style="color:${t.color}">${esc(t.name)}</b>${tcnt > 1 ? ` x${tcnt}` : ''}</div>
    <div style="margin-bottom:4px;">주문서: <b style="color:${RARITY_COLOR[sc.rarity] || '#ccc'}">${esc(sc.name)}</b>${scnt2 > 1 ? ` (보유 ${scnt2})` : ''}</div>
    <div style="margin:8px 0;padding:8px;background:#1c2536;border-radius:8px;">
      <div>성공률 <b style="color:${chance >= 70 ? '#2ecc71' : chance >= 40 ? '#f39c12' : '#e74c3c'}">${chance}%</b></div>
      <div>골드 <b style="color:#ffd700">${cost.toLocaleString()} G</b></div>
      <div style="color:#ff9b9b;">실패 시 <b>아이템 파괴!</b></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;">
      <button id="enhGo" style="flex:1;padding:9px 0;font-weight:bold;background:linear-gradient(#c9a227,#8f6f14);color:#fff;border-radius:6px;">강화 실행</button>
      <button id="enhNo" style="flex:1;padding:9px 0;background:#243049;color:#aab;border-radius:6px;">취소</button>
    </div>
  </div>`;
  document.body.appendChild(gl);
  gl.addEventListener('pointerdown', e => { if (e.target === gl) closeEnhModal(); });
  $('enhNo').onclick = closeEnhModal; /* $는 getElementById — '#' 붙이면 null이라 버튼이 죽음 */
  $('enhGo').onclick = () => { closeEnhModal(); enhanceItem(targetRaw, grade); };
}
function closeEnhModal() { const m = $('enhModal'); if (m) m.remove(); }

const normId = s => { const [b] = splitStack(s); const i = b.indexOf('+'); return i < 0 ? b : b.slice(0, i); };
function findInvKey(inv, rawId) {
  for (const [k, v] of Object.entries(inv)) if (v === rawId) return k;
  const want = normId(rawId);
  for (const [k, v] of Object.entries(inv)) if (normId(v) === want) return k;
  return null;
}

function sellItem(itemId) {
  runTransaction(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return null;
    const p = snap.data();
    const inv = { ...(p.inv || {}) };
    const eq = { ...(p.equipped || {}) };
    const key = findInvKey(inv, itemId);
    if (!key) return 'gone';
    const id = inv[key];
    const it = getItem(id);
    const [, cnt] = splitStack(id);
    const gain = sellPrice(id);
    delete inv[key]; /* 가방의 사본만 판매 — 같은 id가 장착돼 있어도 그건 별개 아이템 */
    tx.update(meRef, { gold: (p.gold || 0) + gain, inv: sortInvMap(inv) });
    return { gain, name: it.name, cnt };
  }).then(r => {
    if (!r) return;
    if (r === 'gone') { toast('이미 사라진 아이템입니다'); return; }
    sfx('coin');
    toast(`💰 <b style="color:#ffd700">${esc(r.name)}</b>${r.cnt > 1 ? ` x${r.cnt}` : ''} 판매 → <b style="color:#ffd700">+${r.gain.toLocaleString()} G</b>`);
    renderInvUI();
  }).catch(() => {});
}

const ENH_BASE = lv => Math.max(70 - lv * 6, 15);
const ENH_CHANCE = {
  normal: lv => Math.max(ENH_BASE(lv), 5),
  adv:    lv => Math.min(97, ENH_BASE(lv) + 20),
  top:    lv => Math.min(99, ENH_BASE(lv) + 30),
};
const ENH_GRADES = [
  ['normal', '일반 주문서', '#cfd8dc'],
  ['adv',    '고급 주문서', '#64b5f6'],
  ['top',    '최고급 주문서', '#ffd700'],
];
function countScrolls() {
  const c = { normal: 0, adv: 0, top: 0 };
  for (const v of Object.values(me.inv || {})) {
    const [b, n] = splitStack(v);
    const it = getItem(b);
    if (it.scroll) c[it.grade || 'normal'] += n;
  }
  return c;
}
let enhMenuEl = null;
function closeEnhMenu() { if (enhMenuEl) { enhMenuEl.remove(); enhMenuEl = null; document.removeEventListener('pointerdown', onEnhAway); } }
function onEnhAway(e) { if (enhMenuEl && !enhMenuEl.contains(e.target)) closeEnhMenu(); }
function showEnhMenu(x, y, rawId) {
  closeEnhMenu();
  const c = countScrolls();
  const it0 = getItem(rawId);
  const isConsumable = !!(it0.heal || it0.mana || it0.scroll);
  const lv = it0._lv || 0;
  enhMenuEl = document.createElement('div');
  enhMenuEl.style.cssText = 'position:fixed;z-index:9999;background:#141a26;border:1px solid #3a4a66;border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:6px;box-shadow:0 8px 24px rgba(0,0,0,.6);min-width:180px;';
  if (!isConsumable) for (const [g, label, col] of ENH_GRADES) {
    const b = document.createElement('button');
    b.style.cssText = `display:flex;justify-content:space-between;gap:12px;padding:7px 10px;font-size:13px;background:${c[g] ? '#1c2536' : '#161d2a'};color:${c[g] ? col : '#556'};border:1px solid #2b3547;border-radius:6px;cursor:${c[g] ? 'pointer' : 'not-allowed'};text-align:left;`;
    b.innerHTML = `<span>${label}</span><span style="color:#889">${c[g]}개 · ${Math.round(ENH_CHANCE[g](lv))}%</span>`;
    b.disabled = !c[g];
    b.onclick = () => { closeEnhMenu(); enhanceItem(rawId, g); };
    enhMenuEl.appendChild(b);
  }
  const sb = document.createElement('button');
  sb.style.cssText = 'display:flex;justify-content:space-between;gap:12px;padding:7px 10px;font-size:13px;background:#2a1620;color:#ff9b9b;border:1px solid #4a2530;border-radius:6px;cursor:pointer;text-align:left;';
  sb.innerHTML = `<span>💰 판매</span><span style="color:#889">+${sellPrice(rawId).toLocaleString()} G</span>`;
  sb.onclick = () => { closeEnhMenu(); sellItem(rawId); };
  enhMenuEl.appendChild(sb);
  document.body.appendChild(enhMenuEl);
  const r = enhMenuEl.getBoundingClientRect();
  enhMenuEl.style.left = Math.min(x, innerWidth - r.width - 10) + 'px';
  enhMenuEl.style.top = Math.min(y, innerHeight - r.height - 10) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', onEnhAway), 0);
}

function enhanceItem(itemId, grade = 'normal') {
  runTransaction(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return null;
    const p = snap.data();
    const inv = { ...(p.inv || {}) };
    const eq = { ...(p.equipped || {}) };
    const key = findInvKey(inv, itemId);
    if (!key) return 'gone';
    const id = inv[key];
    const it = getItem(id);
    if (it.heal || it.mana || it.scroll) return 'no';
    let scIdx = null, scBase = null, scCnt = 0;
    for (const [k, v] of Object.entries(inv)) {
      const [b, c] = splitStack(v);
      const sc = getItem(b);
      if (sc.scroll && (sc.grade || 'normal') === grade) { scIdx = k; scBase = b; scCnt = c; break; }
    }
    if (scIdx === null) return 'noscroll';
    const lv = it._lv || 0;
    const rMul = it.rarity === 'unique' ? 4 : it.rarity === 'legend' ? 3 : it.rarity === 'epic' ? 2 : 1;
    const cost = 300 * (lv + 1) * rMul;
    if ((p.gold || 0) < cost) return 'poor';
    const chance = ENH_CHANCE[grade](lv);
    if (scCnt > 1) inv[scIdx] = scBase + '*' + (scCnt - 1); else delete inv[scIdx];
    /* 강화 대상은 항상 가방의 사본 — 같은 id가 장착돼 있어도 별개 아이템이므로 건드리지 않음 */
    let result;
    if (Math.random() * 100 < chance) {
      const nid = it._base + '+' + (lv + 1);
      inv[key] = nid;
      tx.update(meRef, { gold: p.gold - cost, inv: sortInvMap(inv) });
      result = { ok: true, nid };
    } else {
      delete inv[key];
      tx.update(meRef, { gold: p.gold - cost, inv: sortInvMap(inv) });
      result = { ok: false };
    }
    return result;
  }).then(r => {
    if (!r) return;
    if (r === 'gone') { toast('아이템을 찾을 수 없습니다'); renderInvUI(); return; }
    if (r === 'poor') { toast('💰 골드가 부족합니다'); return; }
    if (r === 'noscroll') { toast('📜 강화 주문서가 없습니다'); return; }
    if (r === 'no') return;
    if (r === null) { toast('강화에 실패했습니다 — 다시 시도하세요'); return; }
    if (r.ok) {
      sfx('levelup');
      toast(`🔨 강화 성공! <b style="color:${RARITY_COLOR[getItem(r.nid).rarity]}">${getItem(r.nid).name}</b>`, 'sysq');
      float(me.x, me.y - 40, '강화 성공!', '#ffd700');
      rings.push({ x: me.x, y: me.y, r: 70, t: 0, max: 450, color: '255,215,0' });
      fxSparks(me.x, me.y - 10, 14, '#ffd700', 140);
    } else {
      sfx('die');
      doShake(10);
      toast('💥 <b>강화 실패 — 아이템이 파괴되었습니다!</b>');
      float(me.x, me.y - 40, '파괴...', '#ff5050');
      fxSparks(me.x, me.y - 10, 18, '#ff5050', 180);
    }
    renderInvUI();
  }).catch(() => {});
}

let invUIKey = '';
function renderInvUI() {
  /* 위치 저장 에코 스냅샷마다 호출되므로 실제 내용이 바뀐 경우에만 DOM 재구축 */
  const key = JSON.stringify([me.inv, me.equipped, me.bagSize, me.skills]);
  if (key === invUIKey) return;
  invUIKey = key;
  const grid = $('invGrid');
  grid.innerHTML = '';
  let count = 0;
  for (let i = 0; i < bagSize(); i++) {
    const div = document.createElement('div');
    div.className = 'islot';
    const itemId = (me.inv || {})[String(i)];
    if (itemId) {
      count++;
      const it = getItem(itemId);
      const [, scnt] = splitStack(itemId);
      div.dataset.r = it.rarity || 'common';
      div.innerHTML = `<span class="ic">${itemIcon(itemId)}</span>` + (scnt > 1 ? `<span class="scnt">${scnt}</span>` : '');
      div.title = `${it.name} [${RARITY_KR[it.rarity] || '일반'}]\n${itemStat(it) || '소모품'}\n좌클릭: 장착/사용 · 우클릭: 강화/판매`;
      div.onclick = () => { if (it.scroll) { toast('📜 주문서를 장비 위로 끌어다 놓으세요'); return; } slotClick(itemId); };
      div.oncontextmenu = e => { e.preventDefault(); showEnhMenu(e.clientX, e.clientY, itemId); };
      let lpT = null;
      div.addEventListener('touchstart', e => {
        const t = e.changedTouches[0];
        clearTimeout(lpT);
        lpT = setTimeout(() => { lpT = null; showEnhMenu(t.clientX, t.clientY, itemId); }, 450);
      }, { passive: true });
      const cancelLp = () => clearTimeout(lpT);
      div.addEventListener('touchmove', cancelLp, { passive: true });
      div.addEventListener('touchend', e => {
        if (lpT === null) e.preventDefault();
        cancelLp();
      });
      if (it.heal || it.mana || it.scroll) {
        div.draggable = true;
        div.ondragstart = e => {
          e.dataTransfer.setData('text/plain', itemId);
          e.dataTransfer.effectAllowed = 'copy';
          requestAnimationFrame(() => div.classList.add('dragging'));
        };
        div.ondragend = () => div.classList.remove('dragging');
      } else {
        div.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; div.classList.add('dropok'); };
        div.ondragleave = () => div.classList.remove('dropok');
        div.ondrop = e => {
          e.preventDefault();
          div.classList.remove('dropok');
          const src = e.dataTransfer.getData('text/plain');
          if (src && getItem(splitStack(src)[0]).scroll) openEnhModal(src, itemId);
        };
      }
    }
    grid.appendChild(div);
  }
  const bc = $('bagCount');
  if (bc) bc.textContent = `${count}/${bagSize()}`;

  const eg = $('equipGrid');
  eg.innerHTML = '';
  for (const [slot, label] of SLOTS) {
    const div = document.createElement('div');
    div.className = 'eslot';
    const itemId = (me.equipped || {})[slot];
    if (itemId) {
      const it = getItem(itemId);
      div.dataset.r = it.rarity || 'common';
      div.innerHTML = `<span class="slbl">${label}</span><span style="color:${it.color}">${SLOT_ICONS[slot]} ${esc(it.name)}</span>`;
      div.title = `${it.name} [${RARITY_KR[it.rarity] || '일반'}]\n${itemStat(it)}\n클릭: 해제`;
      div.onclick = () => unequip(slot);
    } else {
      div.innerHTML = `<span class="slbl">${label}</span><span style="color:#556">${SLOT_ICONS[slot]} -</span>`;
    }
    eg.appendChild(div);
  }
}

/* ================= 몬스터 시뮬레이션 ================= */
function updateSims(now, dt) {
  const targets = [];
  for (const [, o] of Object.entries(others)) {
    if (Date.now() - (o.lastSeen || 0) < OFFLINE_MS && !o.dead && (o.map || 'm1') === myMap()) targets.push({ x: o.x, y: o.y, mine: false });
  }
  if (ready && !me.dead) targets.push({ x: me.x, y: me.y, mine: true });

  for (const s of sims) {
    if (!s.alive) {
      if (s.respawnAt > 0 && now > s.respawnAt) {
        s.respawnAt = now + 5000;
        runTransaction(db, async tx => {
          const ref = doc(db, 'monsters', s.id);
          const g = await tx.get(ref);
          if (!g.exists() || g.data().alive) return;
          const isUniq = Math.random() < .1;
          const d2 = sdef(s);
          const mh = isUniq ? Math.round(s.def.hp * 6) : s.def.hp;
          tx.update(ref, { alive: true, hp: mh, maxHp: mh, uniq: isUniq, killedBy: null });
        }).catch(() => {});
      }
      continue;
    }
    if (s.kbx) {
      s.x = clampN(s.x + s.kbx, 40, WORLD.w - 40);
      s.y = clampN(s.y + s.kby, 40, WORLD.h - 40);
      s.kbx *= .8; s.kby *= .8;
      if (Math.abs(s.kbx) < .3) { s.kbx = 0; s.kby = 0; }
    }
    if (s.map !== myMap()) continue;
    let tgt = null, best = Infinity;
    const homeD = Math.hypot(s.x - s.homeX, s.y - s.homeY);
    const canAggro = (s.angry || simLevel(s) >= (me.lv || 1)) && homeD < 460;
    if (canAggro) {
      for (const t of targets) {
        const d = Math.hypot(t.x - s.x, t.y - s.y);
        if (d < sdef(s).aggro && d < best) { best = d; tgt = t; }
      }
    }
    if (tgt) {
      if (best > s.def.range) {
        const sp = s.def.speed * dt / 1000;
        s.dirA = angLerp(s.dirA, Math.atan2(tgt.y - s.y, tgt.x - s.x), dt * .012);
        s.movingF = true;
        s.aggroF = true;
        s.x = clampN(s.x + Math.cos(s.dirA) * sp, 40, WORLD.w - 40);
        s.y = clampN(s.y + Math.sin(s.dirA) * sp, 40, WORLD.h - 40);
      } else if (now >= s.atkCdUntil) {
        s.atkCdUntil = now + (s.type === 'boss' ? 1800 : 1300);
        s.swingT = now;
        if (tgt.mine) monsterHitMe(s, now);
      }
    } else {
      const hd2 = Math.hypot(s.homeX - s.x, s.homeY - s.y);
      if (hd2 > 600) { s.x = s.homeX; s.y = s.homeY; }
      else if (hd2 > 240) {
        s.dirA = angLerp(s.dirA, Math.atan2(s.homeY - s.y, s.homeX - s.x), dt * .01);
        s.movingF = true;
        s.aggroF = false;
        const sp = s.def.speed * .8 * dt / 1000;
        s.x = clampN(s.x + Math.cos(s.dirA) * sp, 40, WORLD.w - 40);
        s.y = clampN(s.y + Math.sin(s.dirA) * sp, 40, WORLD.h - 40);
      } else {
        if (now >= s.nextWander) { s.nextWander = now + rand(1400, 3200); s.wa = s.dirA + rand(-1.7, 1.7); }
        const sp = s.def.speed * .45 * dt / 1000;
        s.dirA = angLerp(s.dirA, s.wa, dt * .006);
        s.movingF = true;
        s.aggroF = false;
        s.x = clampN(s.x + Math.cos(s.dirA) * sp, 40, WORLD.w - 40);
        s.y = clampN(s.y + Math.sin(s.dirA) * sp, 40, WORLD.h - 40);
      }
    }
  }
  for (let i = 0; i < sims.length; i++) {
    const a = sims[i];
    if (!a.alive || a.map !== myMap()) continue;
    for (let j = i + 1; j < sims.length; j++) {
      const b = sims[j];
      if (!b.alive || b.map !== myMap()) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const rr = (sdef(a).r + sdef(b).r) * .9;
      const dd = dx * dx + dy * dy;
      if (dd > .01 && dd < rr * rr) {
        const dist = Math.sqrt(dd), push = (rr - dist) / 2 / dist;
        a.x -= dx * push; a.y -= dy * push;
        b.x += dx * push; b.y += dy * push;
      }
    }
  }
}

function d2(s) { return sdef(s); }
function monsterHitMe(s, now) {
  const dmg = Math.max(1, Math.round(sdef(s).atk * rand(.85, 1.15)) - totalDef());
  hurtUntil = now + 300;
  me.lastHurtAt = now;
  doShake(4);
  sfx('hurt');
  float(me.x, me.y - 30, String(dmg), '#ff6b6b');
  const nhp = (me.hp || 0) - dmg;
  if (nhp <= 0 && !me.dead) {
    me.dead = true; me.hp = 0; me.deadUntil = now + 1800000;
    updateDoc(meRef, { dead: true, deadUntil: me.deadUntil, hp: 0, 'q.deaths': increment(1) }).catch(() => {});
    sfx('die');
    sysMsg(`${myName}님이 ${d2(s).name}에게 쓰러졌습니다...`);
  } else {
    me.hp = nhp;
    hpDirty = true;
    updateDoc(meRef, { hp: nhp }).catch(() => {});
  }
}


/* ================= 픽셀 아트 스프라이트 ================= */
const SPRITE_DEFS = {
  warrior: {
    pal: { O: '#1a1d24', H: '#a8b2bd', h: '#5d656e', S: '#f2c79a', s: '#d9a878', E: '#1a1d24', A: '#c0392b', D: '#8e2a20', G: '#d9b23c', B: '#6b4a2f', L: '#3a3f4a', l: '#262b33' },
    rows: [
      '...OOOOOO...',
      '..OHHHHHHO..',
      '.OHHHHHHHHO.',
      '.OhhhhhhhhO.',
      '.OSESSSSESO.',
      '.OSSSssSSSO.',
      '..OSSSSSSO..',
      '.OAAAAAAAAO.',
      'OAAGAAAAAAAO',
      'OAaDAAAADAaO',
      '.OADAAAADAO.',
      '..OBBBBBBO..',
      '..OLLLOLLO..',
      '..OllOOllO..',
      '..OOO..OOO..',
    ],
  },
  archer: {
    pal: { O: '#1a1d24', C: '#2e7d52', c: '#1e5c3a', F: '#e74c3c', S: '#f2c79a', s: '#d9a878', E: '#1a1d24', A: '#27ae60', D: '#1e8449', G: '#d9b23c', B: '#6b4a2f', L: '#4a6b3a', l: '#2c3e2a' },
    rows: [
      '...OCCCCO...',
      '..OCCCCFCO..',
      '.OcCCCCCCcO.',
      '.OSSSSSSSSO.',
      '.OSESSSSESO.',
      '.OSSSssSSSO.',
      '..OSSSSSSO..',
      '.OAAAAAAAAO.',
      'OAAGAAAAAAAO',
      'OAaDAAAADAaO',
      '.OADAAAADAO.',
      '..OBBBBBBO..',
      '..OLLLOLLO..',
      '..OllOOllO..',
      '..OOO..OOO..',
    ],
  },
  rogue: {
    pal: { O: '#1a1d24', K: '#34495e', k: '#22303f', S: '#e8bd93', s: '#c49a6c', E: '#1a1d24', A: '#5d6d7e', D: '#43505c', G: '#d9b23c', B: '#2c2620', L: '#2c3e50', l: '#1a2530' },
    rows: [
      '...OOOOOO...',
      '..OKKKKKKO..',
      '.OKKKKKKKKO.',
      '.OKSSSSSSKO.',
      '.OSESSSSESO.',
      '.OKSSssSSKO.',
      '..OKSSSSKO..',
      '.OKKAAAAKKO.',
      'OAKAGAAAAGO.',
      'OAkADAAAADkO',
      '.OADAAAADAO.',
      '..OBBBBBBO..',
      '..OLLLOLLO..',
      '..OllOOllO..',
      '..OOO..OOO..',
    ],
  },
  mage: {
    pal: { O: '#1a1d24', P: '#6c3483', p: '#4a235a', G: '#ffd700', S: '#f2c79a', s: '#d9a878', E: '#1a1d24', A: '#6c3483', D: '#4a235a' },
    rows: [
      '.....OPO....',
      '....OPPPO...',
      '..OPPPPPPO..',
      '.OPPPPPPPPO.',
      '.OSESSSSESO.',
      '.OSSSssSSSO.',
      '..OSSSSSSO..',
      '.OPPPPPPPPO.',
      'OAPPGGGPPPAO',
      'OApDGGGGDpAO',
      '.OADGGGGDAO.',
      '.OPPPPPPPPO.',
      '.OPPPPPPPPO.',
      '.OpPPPPPpPO.',
      '..OOOOOOOO..',
    ],
  },
  slime: {
    pal: { O: '#123a20', G: '#2ecc71', g: '#1e8449', H: '#a8f0c8', E: '#0e2b18', M: '#0e2b18' },
    rows: [
      '....OOOOOO....',
      '..OOGGGGGGOO..',
      '.OGGHGGGGGGO..',
      '.OGGGGGGGGGGO.',
      'OGGWEGGGGWEGO.',
      'OGGGEGGGGEGGO.',
      'OGGGGMMMGGGGO.',
      'OGGGGGGGGGGGgO'.slice(0, 14),
      '.OgGGGGGGGGgO.',
      '..OggGGGGggO..',
      '...OOOOOOOO...',
    ],
  },
  goblin: {
    pal: { O: '#1a2412', G: '#6da34d', g: '#4f7a36', E: '#ffd54a', e: '#1c2b12', T: '#f3ede0', M: '#2b1d10', B: '#7a5230', A: '#5f8f3e', D: '#4a6e33' },
    rows: [
      '..O......O...',
      '.OGO....OGO..',
      '.OGGOOOOGGO..',
      '.OGGGGGGGGO..',
      '.OGEGGEGGEGO.'.slice(0, 13),
      '.OGGGGGGGGO..',
      '.OGGTeETEGO..',
      '..OGGMMOGGO..',
      '..OAAAAAAO...',
      '.OADAADAADAO.',
      '.OAAAAAAAAAO.',
      '..OAAAAAAO...',
      '..ODDDDDDO...',
      '..OgO..OgO...',
      '..OOO..OOO...',
    ],
  },
  wolf: {
    pal: { O: '#23262b', W: '#9aa2a8', w: '#6f777c', d: '#565e64', H: '#c6ccd1', E: '#e8d44a', e: '#1a1d24', N: '#22262e', T: '#f3ede0', R: '#ff5050' },
    rows: [
      '..OO..............O.OO..',
      '.OwwO............OWwOWO.',
      '.OwOOO....OOOOO..OwOwO..',
      '..OwwWOOOOwwwwWOOwwwwO..',
      '.OwwWWWWWWwwwwWWWWWwwWO.',
      'OWwwWWWWWWWWWWWWWWWWwwWO',
      'OwwdWWWWWWWWWWWWWWWWdwwO',
      '.OwdwwwwwwwwwwwwwwwwdwO.',
      '..OdOOwwO..OOwwO..OdO...',
      '..OwO..OwO.OwO..OwO.....',
      '..OdO..OdO.OdO..OdO.....',
      '..OOO..OOO.OOO..OOO.....',
      '........................',
    ],
  },
  skeleton: {
    pal: { O: '#3a3a42', W: '#e8e4d8', w: '#b8b4a8', d: '#8a867c', E: '#7fe3ff', R: '#5a5a62', B: '#a8a49a' },
    rows: [
      '...OOOOOO...',
      '..OWWWWWWO..',
      '.OWWWWWWWWO.',
      '.OWEWWEWEWO.',
      '.OWWWWWWWWO.',
      '..OWWdWdWO..',
      '...OWWWWO...',
      '...ORWWRO...',
      '..OWOWWOWO..',
      '.OW.OwwO.WO.',
      '.OW.OWWO.WO.',
      '.Ow.OWWO.wO.',
      '..O.OWWO.O..',
      '....OwOwO...',
      '....OOOOO...',
    ],
  },
  orc: {
    pal: { O: '#141810', G: '#5d8a41', g: '#3f5c33', D: '#2f4523', T: '#f3ede0', E: '#ff3535', A: '#6d7781', a: '#4d565e', B: '#5c4327', M: '#c0392b', K: '#39424b' },
    rows: [
      '......OOOOOO......',
      '..OOOOAAAAAAOOOO..',
      '.OKKOAAAAAAAOKKO..',
      '.OKKAGGGGGGGAOKKO.',
      '..OOAGGGGGGGAOO...',
      '..OGGEEEEEEEGGO...'.slice(0, 19),
      '..OGEEEEEEEEEGO...',
      '..OGGTTEGGTTTGO...',
      '.OAAAAAAAAAAAAAO..',
      'OAGAAKKKAAAKKAAGO.',
      'OAGAAKKKAAAKKAAGO.',
      'OGaAAAAAAAAAAAaGO.',
      '.OGABBBBBBBBBAGO..',
      '..OGGDDDDDDDGG O..'.replace(' ', ''),
      '..OGDDDDDDDDGO....'.slice(0, 19),
      '...OGGO..OGGO.....',
      '...OOO....OOO.....',
    ],
  },
  lich: {
    pal: { O: '#14101f', P: '#4a3a7a', p: '#2e2450', C: '#8b6bff', c: '#5a3fd4', E: '#c9b8ff', W: '#d8d4e8', G: '#7fe3ff', K: '#c8d0d8' },
    rows: [
      '....OOOOOO....',
      '...OCCCCCCO...',
      '..OCCCEECCCO..',
      '..OCCCEECCCO..',
      '...OCCCCCCO...',
      '..OPPPPPPPPO..',
      '.OPPPWWWWPPPO.',
      '.OPPPWCCWPPPO.',
      'OPPPPPWWPPPPPO',
      'OPpPPPPPPPPpPO',
      'OPpPPPPPPPPpPO',
      '.OPpPPPPPPpPO.',
      '.OPpPPPPPPpPO.',
      '..OPpPPPPpPO..',
      '..OPpPPPPpPO..',
      '...OCCCCCO....',
      '....OOOOO.....',
    ],
  },
};

const ITEM_SHAPES = {
  weapon: ['...L...', '..LLM..', '..MLM..', '..MLM..', '..MLM..', '..MLM..', '..MDM..', '.GGGGG.', '...G...', '...D...'],
  armor:  ['MMM...MMM', 'MMMMMMMMM', 'MLMMMMMDM', 'MLMMMMMDM', '.MMMMMMM.', '.MMMMMMM.', '.MMMMMMM.', '.DMMMMMD.', '..DDDDD..'],
  helmet: ['..MMMM..', '.MMMMMM.', '.MLMMDM.', '.MMMMMM.', '.MM..MM.', '.MM..MM.'],
  pants:  ['.MMMMM.', '.MMMMM.', '.MLMDM.', '.MMMMM.', '.MM.MM.', '.MM.MM.', '.MM.MM.', '.DD.DD.'],
  gloves: ['..MMM..', '.MMMMM.', '.MLMMM.', '.MMMMM.', '.MMMMM.', '.MMMMM.', '..DDD..'],
  boots:  ['.MM..MM.', '.MM..MM.', '.MM..MM.', '.ML..MD.', '.MMMMMM.', '.DDDDDD.'],
  bracelet: ['..MMMM..', '.MLLMDM.', '.ML..DM.', '.ML..DM.', '.MLLMDM.', '..MMMM..'],
  necklace: ['G.......G', '.G.....G.', '.GG...GG.', '..GGGGG..', '....M....', '...MLM...', '...MMM...', '....D....'],
  ring:   ['..LL..', '.LLLL.', '..MM..', '.M..M.', 'M....M', '.MMMM.'],
  potion: ['..GGG..', '...G...', '..MMM..', '.MLMMD.', '.MMMMM.', '.MMMMM.', '.MMMMM.', '..DDD..'],
  scroll: ['..WWW..', '.WWWWW.', '.WB.BW.', '.WWWWW.', '.W.BBW.', '.WWWWW.', '..WWW..'],
};
function itemSprite(id) {
  const it = getItem(id);
  const slotKey = it.scroll ? 'scroll' : it.heal ? 'potion' : (it.slot && ITEM_SHAPES[it.slot] ? it.slot : 'bracelet');
  const col = it.color || '#ccc';
  const key = 'itspr_' + slotKey + '_' + col;
  if (!SPRITE_DEFS[key]) SPRITE_DEFS[key] = { pal: { M: col, D: shade(col, .55), L: shade(col, 1.5), G: '#d9b23c', W: '#e8e4d8', B: '#8a6b45' }, rows: ITEM_SHAPES[slotKey] };
  return key;
}

const spriteCache = {};
function buildSprite(name) {
  if (spriteCache[name]) return spriteCache[name];
  const def = SPRITE_DEFS[name];
  const h = def.rows.length;
  const w = Math.max(...def.rows.map(r => r.length));
  const cv2 = document.createElement('canvas');
  cv2.width = w; cv2.height = h;
  const c = cv2.getContext('2d');
  def.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ' || !def.pal[ch]) continue;
      c.fillStyle = def.pal[ch];
      c.fillRect(x, y, 1, 1);
    }
  });
  /* 자동 베벨: 위가 뚫린 픽셀은 하이라이트, 아래가 뚫린 픽셀은 셰이드 — 전 스프라이트 공통 입체감 */
  const solidAt = (yy, xx) => { const r = def.rows[yy]; if (!r) return false; const ch2 = r[xx]; return !!ch2 && ch2 !== '.' && ch2 !== ' ' && ch2 !== 'O' && !!def.pal[ch2]; };
  def.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ' || ch === 'O' || !def.pal[ch]) continue;
      if (!solidAt(y - 1, x)) { c.fillStyle = 'rgba(255,255,255,.22)'; c.fillRect(x, y, 1, 1); }
      else if (!solidAt(y + 1, x)) { c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(x, y, 1, 1); }
    }
  });
  const white = document.createElement('canvas');
  white.width = w; white.height = h;
  const wc = white.getContext('2d');
  wc.drawImage(cv2, 0, 0);
  wc.globalCompositeOperation = 'source-in';
  wc.fillStyle = '#fff';
  wc.fillRect(0, 0, w, h);
  spriteCache[name] = { cv: cv2, white, w, h };
  return spriteCache[name];
}
function drawSprite(name, x, y, scale = 4, opts = {}) {
  const sp = buildSprite(name);
  const bob = opts.bob || 0;
  ctx.save();
  ctx.translate(x, y + bob);
  if (opts.flip) ctx.scale(-1, 1);
  if (opts.squashX || opts.squashY) ctx.scale(opts.squashX || 1, opts.squashY || 1);
  ctx.imageSmoothingEnabled = false;
  const alpha = opts.alpha != null ? opts.alpha : 1;
  if (alpha < 1) ctx.globalAlpha = alpha;
  if (opts.rot) ctx.rotate(opts.rot);
  ctx.drawImage(sp.cv, -sp.w * scale / 2, -sp.h * scale, sp.w * scale, sp.h * scale);
  if (opts.flash) {
    ctx.globalAlpha = alpha * opts.flash;
    ctx.drawImage(sp.white, -sp.w * scale / 2, -sp.h * scale, sp.w * scale, sp.h * scale);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.imageSmoothingEnabled = true;
  return { w: sp.w * scale, h: sp.h * scale };
}

/* ================= 캔버스 ================= */
const cv = $('game'), ctx = cv.getContext('2d');
const mm = $('minimap'), mctx = mm.getContext('2d');
function resize() { cv.width = innerWidth; cv.height = innerHeight; }
addEventListener('resize', resize);
resize();

/* ================= 월드 텍스처 (프리렌더) ================= */
const worldTex = document.createElement('canvas');
worldTex.width = WORLD.w; worldTex.height = WORLD.h;

function buildWorld() {
  const c = worldTex.getContext('2d');
  c.fillStyle = '#26492f';
  c.fillRect(0, 0, WORLD.w, WORLD.h);
  const tints = ['#2a5034', '#224329', '#2d5538', '#1f3f26'];
  for (let i = 0; i < 90; i++) {
    const x = sr(i * 3) * WORLD.w, y = sr(i * 3 + 1) * WORLD.h, r = 70 + sr(i * 3 + 2) * 190;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, tints[i % 4] + '55');
    g.addColorStop(1, 'transparent');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let y = 0; y < WORLD.h; y += 64) {
    for (let x = 0; x < WORLD.w; x += 64) {
      if ((x / 64 + y / 64) % 2 === 0) continue;
      c.fillStyle = 'rgba(0,0,0,.045)';
      c.fillRect(x, y, 64, 64);
    }
  }
  const pathTo = (tx, ty) => {
    const mx = (SPAWN.x + tx) / 2 + (sr(tx + ty) - .5) * 260, my = (SPAWN.y + ty) / 2 + (sr(tx * 2 + ty) - .5) * 200;
    c.strokeStyle = '#8a7a52';
    c.lineWidth = 44; c.lineCap = 'round';
    c.beginPath(); c.moveTo(SPAWN.x, SPAWN.y); c.quadraticCurveTo(mx, my, tx, ty); c.stroke();
    c.strokeStyle = '#6e6040';
    c.lineWidth = 36;
    c.beginPath(); c.moveTo(SPAWN.x, SPAWN.y); c.quadraticCurveTo(mx, my, tx, ty); c.stroke();
    c.fillStyle = 'rgba(0,0,0,.18)';
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const px = (1 - t) * (1 - t) * SPAWN.x + 2 * (1 - t) * t * mx + t * t * tx;
      const py = (1 - t) * (1 - t) * SPAWN.y + 2 * (1 - t) * t * my + t * t * ty;
      c.beginPath(); c.ellipse(px + rand(-12, 12), py + rand(-12, 12), rand(2, 4.5), rand(1.5, 3), rand(0, 3), 0, 7); c.fill();
    }
  };
  pathTo(350, 900); pathTo(1100, 800); pathTo(1250, 250); pathTo(800, 1050);
  for (const z of SPAWN_ZONES) {
    const g = c.createRadialGradient(z.cx, z.cy, 10, z.cx, z.cy, z.spread + 60);
    g.addColorStop(0, 'rgba(0,0,0,.10)');
    g.addColorStop(.75, 'rgba(0,0,0,.05)');
    g.addColorStop(1, 'transparent');
    c.fillStyle = g;
    c.beginPath(); c.arc(z.cx, z.cy, z.spread + 60, 0, 7); c.fill();
  }
  c.strokeStyle = 'rgba(120,60,40,.25)';
  c.lineWidth = 6;
  c.beginPath(); c.arc(800, 1050, 130, 0, 7); c.stroke();
  for (let i = 0; i < 2600; i++) {
    const x = sr(i * 7 + 1) * WORLD.w, y = sr(i * 7 + 2) * WORLD.h;
    c.strokeStyle = sr(i * 7 + 3) < .5 ? 'rgba(46,94,58,.5)' : 'rgba(64,120,74,.45)';
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(x, y); c.lineTo(x + rand(-2, 2), y - rand(3, 7));
    c.stroke();
  }
  for (let i = 0; i < 240; i++) {
    const x = sr(i * 5 + 50) * WORLD.w, y = sr(i * 5 + 51) * WORLD.h;
    const col = ['#e8da7a', '#d98cb3', '#8ecae6', '#f4f1de'][i % 4];
    c.fillStyle = col;
    for (let p = 0; p < 4; p++) {
      const a = p * Math.PI / 2 + .4;
      c.beginPath(); c.arc(x + Math.cos(a) * 2.4, y + Math.sin(a) * 2.4, 1.7, 0, 7); c.fill();
    }
    c.fillStyle = '#fff3b0';
    c.beginPath(); c.arc(x, y, 1.3, 0, 7); c.fill();
  }
  for (let i = 0; i < 340; i++) {
    const x = sr(i * 11 + 90) * WORLD.w, y = sr(i * 11 + 91) * WORLD.h;
    c.fillStyle = `rgba(130,135,140,${.25 + sr(i) * .3})`;
    c.beginPath(); c.ellipse(x, y, rand(1.5, 4), rand(1, 2.6), rand(0, 3), 0, 7); c.fill();
  }
  for (let i = 0; i < 16; i++) {
    const x = 80 + sr(i * 13 + 7) * (WORLD.w - 160), y = 80 + sr(i * 13 + 8) * (WORLD.h - 160);
    if (Math.hypot(x - SPAWN.x, y - SPAWN.y) < 130) continue;
    const n = 2 + Math.floor(sr(i * 13 + 9) * 3);
    worldColliders.m1.push({ x, y, r: 16 });
    for (let k = 0; k < n; k++) {
      const rx = x + (sr(i + k) - .5) * 46, ry = y + (sr(i * 2 + k) - .5) * 30;
      const rr = 10 + sr(i * 3 + k) * 13;
      c.fillStyle = 'rgba(0,0,0,.26)';
      c.beginPath(); c.ellipse(rx + 4, ry + rr * .55, rr * 1.1, rr * .5, 0, 0, 7); c.fill();
      const g = c.createLinearGradient(rx - rr, ry - rr, rx + rr * .6, ry + rr);
      g.addColorStop(0, '#aab2bb'); g.addColorStop(.55, '#7d8790'); g.addColorStop(1, '#525b64');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(rx - rr, ry + rr * .42);
      c.quadraticCurveTo(rx - rr * .95, ry - rr * .35, rx - rr * .35, ry - rr * .72);
      c.quadraticCurveTo(rx + rr * .15, ry - rr * .95, rx + rr * .7, ry - rr * .38);
      c.quadraticCurveTo(rx + rr * 1.05, ry - rr * .05, rx + rr * .85, ry + rr * .45);
      c.quadraticCurveTo(rx + rr * .3, ry + rr * .62, rx - rr, ry + rr * .42);
      c.closePath(); c.fill();
      c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = 1.4; c.stroke();
      c.strokeStyle = 'rgba(255,255,255,.3)'; c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(rx - rr * .5, ry - rr * .28); c.quadraticCurveTo(rx - rr * .1, ry - rr * .6, rx + rr * .3, ry - rr * .5); c.stroke();
      c.strokeStyle = 'rgba(0,0,0,.2)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(rx + rr * .1, ry - rr * .2); c.lineTo(rx + rr * .35, ry + rr * .2); c.stroke();
      if (sr(i * 5 + k) < .5) {
        c.fillStyle = 'rgba(90,140,80,.4)';
        c.beginPath(); c.ellipse(rx - rr * .3, ry + rr * .25, rr * .38, rr * .18, .2, 0, 7); c.fill();
      }
    }
  }
  for (let i = 0; i < 30; i++) {
    const x = 70 + sr(i * 17 + 3) * (WORLD.w - 140), y = 70 + sr(i * 17 + 4) * (WORLD.h - 140);
    if (Math.hypot(x - SPAWN.x, y - SPAWN.y) < 140) continue;
    let near = false;
    for (const z of SPAWN_ZONES) if (Math.hypot(x - z.cx, y - z.cy) < z.spread * .55) near = true;
    if (Math.hypot(x - 800, y - 1050) < 190) near = true;
    if (near) continue;
    const s = .95 + sr(i * 19) * .65;
    const pine = sr(i * 29) < .38;
    worldColliders.m1.push({ x, y: y + 2, r: 13 * s });
    c.fillStyle = 'rgba(0,0,0,.3)';
    c.beginPath(); c.ellipse(x + 9 * s, y + 16 * s, 28 * s, 10 * s, 0, 0, 7); c.fill();
    c.fillStyle = '#4a3524';
    c.beginPath();
    c.moveTo(x - 6.5 * s, y + 15 * s);
    c.quadraticCurveTo(x - 4 * s, y, x - 3.5 * s, y - 16 * s);
    c.lineTo(x + 3.5 * s, y - 16 * s);
    c.quadraticCurveTo(x + 4 * s, y, x + 6.5 * s, y + 15 * s);
    c.quadraticCurveTo(x + 9 * s, y + 17 * s, x + 4 * s, y + 16 * s);
    c.lineTo(x - 4 * s, y + 16 * s);
    c.quadraticCurveTo(x - 9 * s, y + 17 * s, x - 6.5 * s, y + 15 * s);
    c.closePath(); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(x - 2 * s, y + 12 * s); c.lineTo(x - 2 * s, y - 12 * s); c.stroke();
    c.beginPath(); c.moveTo(x + 2 * s, y + 8 * s); c.lineTo(x + 2 * s, y - 6 * s); c.stroke();
    if (pine) {
      for (let L = 2; L >= 0; L--) {
        const ly = y - 14 * s - L * 15 * s;
        const lw = (26 - L * 6.5) * s;
        c.fillStyle = ['#1a5233', '#1f6039', '#257047'][L];
        c.beginPath();
        c.moveTo(x - lw, ly + 14 * s);
        c.quadraticCurveTo(x, ly - 4 * s, x + lw, ly + 14 * s);
        c.quadraticCurveTo(x, ly + 8 * s, x - lw, ly + 14 * s);
        c.closePath(); c.fill();
        c.strokeStyle = 'rgba(0,0,0,.22)'; c.lineWidth = 1.4; c.stroke();
      }
      c.fillStyle = 'rgba(144,220,160,.3)';
      c.beginPath(); c.moveTo(x - 6 * s, y - 30 * s); c.quadraticCurveTo(x - 2 * s, y - 36 * s, x + 2 * s, y - 30 * s);
      c.quadraticCurveTo(x - 2 * s, y - 32 * s, x - 6 * s, y - 30 * s); c.closePath(); c.fill();
    } else {
      const cy = y - 32 * s;
      const blob = (bx, by, br, col) => { c.fillStyle = col; c.beginPath(); c.arc(bx, by, br, 0, 7); c.fill(); };
      blob(x - 16 * s, cy + 7 * s, 18 * s, '#173f28');
      blob(x + 16 * s, cy + 7 * s, 18 * s, '#173f28');
      blob(x, cy + 10 * s, 19 * s, '#1a4a2e');
      blob(x, cy - 4 * s, 22 * s, '#1f6039');
      blob(x - 12 * s, cy - 12 * s, 14 * s, '#257047');
      blob(x + 12 * s, cy - 10 * s, 13 * s, '#257047');
      blob(x - 2 * s, cy - 16 * s, 12 * s, '#2e8455');
      for (let L2 = 0; L2 < 10; L2++) {
        const a = sr(i * 7 + L2) * Math.PI * 2, rr2 = 10 + sr(i * 11 + L2) * 16;
        blob(x + Math.cos(a) * rr2 * s * 1.15, cy - 4 * s + Math.sin(a) * rr2 * s * .6, 2.6 * s, 'rgba(120,200,140,.4)');
      }
      c.fillStyle = 'rgba(160,230,170,.28)';
      c.beginPath(); c.ellipse(x - 8 * s, cy - 14 * s, 9 * s, 5 * s, -.5, 0, 7); c.fill();
    }
  }
  for (let i = 0; i < 18; i++) {
    const x = 60 + sr(i * 31 + 5) * (WORLD.w - 120), y = 60 + sr(i * 31 + 6) * (WORLD.h - 120);
    if (Math.hypot(x - SPAWN.x, y - SPAWN.y) < 90) continue;
    const s = .8 + sr(i * 37) * .5;
    worldColliders.m1.push({ x, y, r: 8 * s });
    c.fillStyle = 'rgba(0,0,0,.22)';
    c.beginPath(); c.ellipse(x + 3 * s, y + 7 * s, 13 * s, 5 * s, 0, 0, 7); c.fill();
    c.fillStyle = '#1f6039';
    c.beginPath(); c.arc(x - 6 * s, y, 8 * s, 0, 7); c.arc(x + 6 * s, y - 1 * s, 9 * s, 0, 7); c.arc(x, y - 6 * s, 8 * s, 0, 7); c.fill();
    c.fillStyle = '#2e8455';
    c.beginPath(); c.arc(x - 2 * s, y - 5 * s, 5.5 * s, 0, 7); c.fill();
    if (sr(i * 41) < .5) {
      c.fillStyle = '#e74c3c';
      c.beginPath(); c.arc(x + 4 * s, y - 7 * s, 1.6 * s, 0, 7); c.arc(x - 5 * s, y - 3 * s, 1.6 * s, 0, 7); c.fill();
    }
  }
  for (let i = 0; i < 22; i++) {
    const x = sr(i * 43 + 2) * WORLD.w, y = sr(i * 43 + 3) * WORLD.h;
    if (sr(i * 47) > .4) continue;
    c.fillStyle = '#d9c8a9';
    c.fillRect(x - 1.5, y - 5, 3, 5);
    c.fillStyle = '#c0392b';
    c.beginPath(); c.ellipse(x, y - 6, 4.5, 3, 0, 0, 7); c.fill();
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(x - 1.5, y - 7, .9, 0, 7); c.fill();
  }
  for (let i = 0; i < 8; i++) {
    const x = 90 + sr(i * 53 + 1) * (WORLD.w - 180), y = 90 + sr(i * 53 + 2) * (WORLD.h - 180);
    if (Math.hypot(x - SPAWN.x, y - SPAWN.y) < 120) continue;
    worldColliders.m1.push({ x, y, r: 10 });
    c.fillStyle = 'rgba(0,0,0,.25)';
    c.beginPath(); c.ellipse(x + 2, y + 6, 13, 5, 0, 0, 7); c.fill();
    c.fillStyle = '#7a5a3a';
    c.beginPath(); c.arc(x, y, 11, 0, 7); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = 1.2;
    c.beginPath(); c.arc(x, y, 11, 0, 7); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.18)';
    c.beginPath(); c.arc(x, y, 7.5, 0, 7); c.stroke();
    c.beginPath(); c.arc(x, y, 4, 0, 7); c.stroke();
    c.fillStyle = '#5a4030';
    c.beginPath(); c.arc(x, y, 2.2, 0, 7); c.fill();
  }
  drawBrickBorder(c, 213, 9);
}

/* 외곽 벽돌 테두리: 얇은 폭(16px), 벽돌별 명암 지터 + 베벨 + 줄눈 + 균열/이끼 디테일 */
function drawBrickBorder(c, hue, sat) {
  const BW = 16, STEP = 30;
  const brick = (x, y, w, h, seed) => {
    const l = 36 + (sr(seed + 2.45) - .5) * 13;
    const g = c.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, `hsl(${hue},${sat}%,${l + 8}%)`);
    g.addColorStop(1, `hsl(${hue},${sat}%,${l - 6}%)`);
    c.fillStyle = g;
    roundRect(c, x + 1, y + 1, w - 2, h - 2, 2.5); /* 네이티브 c.roundRect는 구형 모바일 Safari에 없음 */
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 1; c.stroke();
    c.fillStyle = 'rgba(255,255,255,.2)';
    c.fillRect(x + 3, y + 2.2, w - 6, 1.5);
    c.fillStyle = 'rgba(0,0,0,.22)';
    c.fillRect(x + 3, y + h - 3.6, w - 6, 1.5);
    if (sr(seed * 3.7) > .82) {
      c.strokeStyle = 'rgba(0,0,0,.28)'; c.lineWidth = .8;
      c.beginPath(); c.moveTo(x + w * .32, y + 2.5); c.lineTo(x + w * .52, y + h - 3.5); c.stroke();
    }
    if (sr(seed * 5.3) > .86) {
      c.fillStyle = 'rgba(95,145,85,.42)';
      c.beginPath(); c.arc(x + w * (.25 + sr(seed * 7.1) * .5), y + h - 4.2, 1.7, 0, 7); c.fill();
    }
  };
  c.fillStyle = `hsl(${hue},${Math.max(0, sat - 3)}%,15%)`;
  c.fillRect(0, 0, WORLD.w, BW); c.fillRect(0, WORLD.h - BW, WORLD.w, BW);
  c.fillRect(0, 0, BW, WORLD.h); c.fillRect(WORLD.w - BW, 0, BW, WORLD.h);
  let i = 0;
  for (let x = 0; x < WORLD.w + STEP / 2; x += STEP, i++) { brick(x, 0, STEP - 2, BW, i * 2.13); brick(x - STEP / 2, WORLD.h - BW, STEP - 2, BW, i * 2.31 + 97); }
  for (let y = BW; y < WORLD.h - BW; y += STEP, i++) { brick(0, y, BW, STEP - 2, i * 2.71 + 511); brick(WORLD.w - BW, y, BW, STEP - 2, i * 2.97 + 977); }
  c.fillStyle = 'rgba(0,0,0,.22)';
  c.fillRect(BW, BW, WORLD.w - BW * 2, 5);
  c.fillRect(BW, BW, 5, WORLD.h - BW * 2);
}

const worldColliders = { m1: [], m2: [] };
function resolveCollide() {
  const cols = worldColliders[myMap()] || [];
  for (const c of cols) {
    const dx = me.x - c.x, dy = me.y - c.y;
    const d = Math.hypot(dx, dy), min = c.r + 10;
    if (d < min && d > 0) {
      me.x = clampN(c.x + dx / d * min, 40, WORLD.w - 40);
      me.y = clampN(c.y + dy / d * min, 40, WORLD.h - 40);
    }
  }
}

const mapTexs = {};
function getTex(mp) {
  if (!mapTexs[mp]) mapTexs[mp] = mp === 'm2' ? buildWorldM2() : worldTex;
  return mapTexs[mp];
}

function buildWorldM2() {
  const cv2 = document.createElement('canvas');
  cv2.width = WORLD.w; cv2.height = WORLD.h;
  const c = cv2.getContext('2d');
  c.fillStyle = '#241f33';
  c.fillRect(0, 0, WORLD.w, WORLD.h);
  const tints = ['#2a2440', '#1f1b2e', '#302a48', '#262138'];
  for (let i = 0; i < 90; i++) {
    const x = sr(i * 3) * WORLD.w, y = sr(i * 3 + 1) * WORLD.h, r = 70 + sr(i * 3 + 2) * 190;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, tints[i % 4] + '55');
    g.addColorStop(1, 'transparent');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let y = 0; y < WORLD.h; y += 64) {
    for (let x = 0; x < WORLD.w; x += 64) {
      if ((x / 64 + y / 64) % 2 === 0) continue;
      c.fillStyle = 'rgba(0,0,0,.06)';
      c.fillRect(x, y, 64, 64);
    }
  }
  const pathTo = (tx, ty, sx, sy) => {
    const mx = (sx + tx) / 2 + (sr(tx + ty) - .5) * 240, my = (sy + ty) / 2 + (sr(tx * 2 + ty) - .5) * 180;
    c.strokeStyle = '#4e4860';
    c.lineWidth = 42; c.lineCap = 'round';
    c.beginPath(); c.moveTo(sx, sy); c.quadraticCurveTo(mx, my, tx, ty); c.stroke();
    c.strokeStyle = '#3c374e';
    c.lineWidth = 34;
    c.beginPath(); c.moveTo(sx, sy); c.quadraticCurveTo(mx, my, tx, ty); c.stroke();
  };
  pathTo(450, 300, 170, 600); pathTo(1150, 850, 170, 600); pathTo(800, 1000, 170, 600);
  for (const z of M2_ZONES) {
    const g = c.createRadialGradient(z.cx, z.cy, 10, z.cx, z.cy, z.spread + 60);
    g.addColorStop(0, 'rgba(90,60,140,.12)');
    g.addColorStop(1, 'transparent');
    c.fillStyle = g;
    c.beginPath(); c.arc(z.cx, z.cy, z.spread + 60, 0, 7); c.fill();
  }
  c.strokeStyle = 'rgba(140,100,255,.22)';
  c.lineWidth = 6;
  c.beginPath(); c.arc(800, 1000, 130, 0, 7); c.stroke();
  for (let i = 0; i < 1900; i++) {
    const x = sr(i * 7 + 1) * WORLD.w, y = sr(i * 7 + 2) * WORLD.h;
    c.strokeStyle = sr(i * 7 + 3) < .5 ? 'rgba(70,110,100,.4)' : 'rgba(90,130,120,.35)';
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(x, y); c.lineTo(x + rand(-2, 2), y - rand(3, 6));
    c.stroke();
  }
  for (let i = 0; i < 70; i++) {
    const x = sr(i * 5 + 60) * WORLD.w, y = sr(i * 5 + 61) * WORLD.h;
    c.strokeStyle = 'rgba(215,210,190,.5)';
    c.lineWidth = 2.4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x - 4, y); c.lineTo(x + 4, y); c.stroke();
    c.beginPath(); c.moveTo(x, y - 3); c.lineTo(x, y + 3); c.stroke();
    c.beginPath(); c.arc(x - 5.5, y - 1.5, 2, 0, 7); c.arc(x + 5.5, y - 1.5, 2, 0, 7); c.fill();
    c.lineCap = 'butt';
  }
  for (let i = 0; i < 22; i++) {
    const x = 80 + sr(i * 13 + 7) * (WORLD.w - 160), y = 90 + sr(i * 13 + 8) * (WORLD.h - 180);
    worldColliders.m2.push({ x, y: y + 6, r: 11 });
    c.fillStyle = 'rgba(0,0,0,.3)';
    c.beginPath(); c.ellipse(x + 3, y + 14, 13, 5, 0, 0, 7); c.fill();
    const g = c.createLinearGradient(x - 11, y - 22, x + 11, y + 14);
    g.addColorStop(0, '#8d93a1'); g.addColorStop(1, '#565c68');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x - 11, y + 14); c.lineTo(x - 11, y - 14);
    c.quadraticCurveTo(x - 11, y - 24, x, y - 24);
    c.quadraticCurveTo(x + 11, y - 24, x + 11, y - 14);
    c.lineTo(x + 11, y + 14);
    c.closePath(); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 1.4; c.stroke();
    c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x - 4, y - 16); c.lineTo(x + 3, y - 4); c.lineTo(x - 1, y + 6); c.stroke();
  }
  for (let i = 0; i < 24; i++) {
    const x = 70 + sr(i * 17 + 3) * (WORLD.w - 140), y = 70 + sr(i * 17 + 4) * (WORLD.h - 140);
    if (Math.hypot(x - 170, y - 600) < 130) continue;
    worldColliders.m2.push({ x, y: y + 4, r: 12 });
    const s = .9 + sr(i * 19) * .5;
    c.fillStyle = 'rgba(0,0,0,.3)';
    c.beginPath(); c.ellipse(x + 6 * s, y + 16 * s, 20 * s, 8 * s, 0, 0, 7); c.fill();
    c.strokeStyle = '#3a2f28';
    c.lineWidth = 7 * s; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x, y + 14 * s); c.lineTo(x, y - 22 * s); c.stroke();
    c.lineWidth = 4 * s;
    c.beginPath(); c.moveTo(x, y - 8 * s); c.lineTo(x - 14 * s, y - 26 * s); c.stroke();
    c.beginPath(); c.moveTo(x, y - 14 * s); c.lineTo(x + 13 * s, y - 34 * s); c.stroke();
    c.beginPath(); c.moveTo(x, y - 2 * s); c.lineTo(x + 11 * s, y - 14 * s); c.stroke();
    c.lineCap = 'butt';
  }
  for (let i = 0; i < 26; i++) {
    const x = sr(i * 23) * WORLD.w, y = sr(i * 23 + 1) * WORLD.h;
    const g = c.createRadialGradient(x, y, 0, x, y, 60 + sr(i) * 80);
    g.addColorStop(0, 'rgba(190,180,230,.06)');
    g.addColorStop(1, 'transparent');
    c.fillStyle = g;
    c.fillRect(x - 140, y - 140, 280, 280);
  }
  drawBrickBorder(c, 252, 10);
  return cv2;
}

function gotoPage(n) {
  if (mapFading || n < 1 || n > MAX_PAGE) return;
  mapFading = true;
  const ov = $('mapFade');
  if (ov) ov.style.opacity = 1;
  sfx('boom');
  doShake(5);
  setTimeout(async () => {
    await ensurePage(n);
    me.map = pageId(n);
    const sp = pageDef(n).spawn;
    me.x = sp.x; me.y = sp.y;
    dest = null; attackTargetSimId = null;
    cam.x = sp.x; cam.y = sp.y;
    updateDoc(meRef, { map: pageId(n), x: sp.x, y: sp.y }).catch(() => {});
    const mn = $('mapName');
    if (mn) mn.textContent = pageDef(n).name;
    watchMonsters();
    watchLoot(); /* 루팅도 구역별 구독 재설정 */
    sysMsg(`${myName}님이 ${pageDef(n).name}(으)로 이동했습니다.`);
    setTimeout(() => { if (ov) ov.style.opacity = 0; mapFading = false; }, 300);
  }, 380);
}

/* ================= 엔티티 드로잉 ================= */
const SKIN = '#f2c79a';
const OL = '#232833';

function limb(c, x1, y1, x2, y2, w, color) {
  c.lineCap = 'round';
  c.strokeStyle = OL; c.lineWidth = w + 2.4;
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  c.strokeStyle = color; c.lineWidth = w;
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  c.lineCap = 'butt';
}

function drawHat(cls, helmetId) {
  const it = ITEMS[helmetId];
  const hc = it ? it.color : null;
  if (hc || cls === 'warrior') {
    const col = hc || '#9aa5b1';
    const g = ctx.createLinearGradient(0, -35, 0, -19);
    g.addColorStop(0, shade(col, 1.3)); g.addColorStop(1, shade(col, .78));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, -21, 12.5, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = shade(col, .82);
    roundRect(ctx, -14.5, -24, 29, 5, 2.2); ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = shade(col, 1.12);
    roundRect(ctx, -1.7, -22, 3.4, 7.5, 1.5); ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.beginPath(); ctx.ellipse(-4.5, -28.5, 3.4, 2, -.5, 0, 7); ctx.fill();
    ctx.fillStyle = it ? '#ff5a5a' : '#d9b23c';
    ctx.beginPath();
    ctx.moveTo(-2.6, -33.5); ctx.quadraticCurveTo(0, -40.5, 2.6, -33.5);
    ctx.quadraticCurveTo(0, -36, -2.6, -33.5);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 1; ctx.stroke();
    if (it && it.rarity === 'legend') {
      ctx.fillStyle = '#ffec8a';
      ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 7;
      ctx.beginPath(); ctx.arc(0, -30, 1.8, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
    }
    return;
  }
  if (cls === 'archer') {
    ctx.fillStyle = '#2e7d52';
    ctx.beginPath(); ctx.ellipse(0, -31, 12, 4.6, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
    roundRect(ctx, -12, -32, 24, 3.6, 1.6); ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.moveTo(10, -31); ctx.quadraticCurveTo(19, -40, 21, -42);
    ctx.quadraticCurveTo(16, -38, 12.5, -29.5);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#3d2817';
    ctx.beginPath();
    ctx.moveTo(-11, -22); ctx.quadraticCurveTo(-13, -26, -10, -28);
    ctx.lineTo(-8, -24); ctx.closePath(); ctx.fill();
  } else if (cls === 'rogue') {
    ctx.fillStyle = '#34495e';
    ctx.beginPath(); ctx.arc(0, -21, 13, Math.PI * .88, Math.PI * 2.12); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#22303f';
    ctx.beginPath();
    ctx.moveTo(-13, -21); ctx.quadraticCurveTo(-6, -26, 0, -25);
    ctx.quadraticCurveTo(6, -26, 13, -21);
    ctx.lineTo(11, -17); ctx.quadraticCurveTo(0, -21, -11, -17);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.1)';
    ctx.beginPath(); ctx.arc(-4, -27, 3.6, 0, 7); ctx.fill();
    ctx.fillStyle = '#2c3e50';
    ctx.beginPath();
    ctx.moveTo(-12, -19); ctx.quadraticCurveTo(-18, -14, -15, -6);
    ctx.quadraticCurveTo(-11, -10, -10.5, -17);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 1.2; ctx.stroke();
  } else if (cls === 'mage') {
    ctx.fillStyle = '#6c3483';
    ctx.beginPath();
    ctx.moveTo(-13.5, -24); ctx.lineTo(13.5, -24); ctx.lineTo(2.5, -50); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#8e44ad';
    roundRect(ctx, -15, -26, 30, 5.5, 2.4); ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = '#ffd700';
    ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 7;
    ctx.beginPath(); ctx.arc(3.5, -37, 2.3, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.beginPath(); ctx.moveTo(-6, -26); ctx.lineTo(-1, -44); ctx.lineTo(1, -44); ctx.lineTo(-3, -26); ctx.closePath(); ctx.fill();
  }
}

function drawHeldWeapon(cls, wid) {
  const it = wid ? getItem(wid) : null;
  const enh = (it && it._lv) || 0;
  if (enh >= 3) { /* 강화 무기 오라: +3 파랑 → +5 금색 → +7 붉은색 */
    ctx.shadowColor = enh >= 7 ? '#ff6b6b' : enh >= 5 ? '#ffd700' : '#7fc7ff';
    ctx.shadowBlur = 5 + enh * 1.2;
  }
  if (cls === 'warrior' || cls === 'rogue') {
    const bl = it ? it.color : (cls === 'rogue' ? '#aab4bd' : '#cdd5dd');
    const L = cls === 'warrior' ? 31 : 18;
    const W = cls === 'warrior' ? 2.7 : 2;
    ctx.fillStyle = '#4a3524';
    roundRect(ctx, -2.1, -1, 4.2, 8.5, 1.9); ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#d9b23c';
    ctx.beginPath(); ctx.arc(0, 8.6, 2.3, 0, 7); ctx.fill();
    ctx.strokeStyle = OL; ctx.stroke();
    ctx.fillStyle = '#d9b23c';
    roundRect(ctx, -6.2, -5.6, 12.4, 3.6, 1.7); ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 1.1; ctx.stroke();
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath(); ctx.arc(0, -3.8, 1.35, 0, 7); ctx.fill();
    if (wid === 'sword_flame') { ctx.shadowColor = '#ff7f27'; ctx.shadowBlur = 13; }
    const bg = ctx.createLinearGradient(-W, 0, W, 0);
    bg.addColorStop(0, shade(bl, .72)); bg.addColorStop(.45, shade(bl, 1.28)); bg.addColorStop(1, shade(bl, .85));
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(-W, -5);
    ctx.lineTo(-W, -L + 5.5);
    ctx.quadraticCurveTo(-W * .4, -L - .5, 0, -L - 2.2);
    ctx.quadraticCurveTo(W * .4, -L - .5, W, -L + 5.5);
    ctx.lineTo(W, -5);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = OL; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = .9;
    ctx.beginPath(); ctx.moveTo(0, -7.5); ctx.lineTo(0, -L + 6); ctx.stroke();
    if ((Date.now() % 2300) < 150) {
      ctx.fillStyle = '#fff';
      const sx = W * .6, sy = -L * .55;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 4.2); ctx.lineTo(sx + 1.1, sy - 1.1); ctx.lineTo(sx + 4.2, sy);
      ctx.lineTo(sx + 1.1, sy + 1.1); ctx.lineTo(sx, sy + 4.2); ctx.lineTo(sx - 1.1, sy + 1.1);
      ctx.lineTo(sx - 4.2, sy); ctx.lineTo(sx - 1.1, sy - 1.1);
      ctx.closePath(); ctx.fill();
    }
  } else if (cls === 'archer') {
    ctx.strokeStyle = it ? it.color : '#7a5230';
    ctx.lineWidth = 3.6; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-2, -15);
    ctx.quadraticCurveTo(9, -8, 10, 0);
    ctx.quadraticCurveTo(9, 8, -2, 15);
    ctx.stroke();
    ctx.strokeStyle = shade(it ? it.color : '#7a5230', .7);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-2, -15); ctx.quadraticCurveTo(5, -8, 6, 0);
    ctx.quadraticCurveTo(5, 8, -2, 15);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#eee'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-1.2, -14.4); ctx.lineTo(-1.2, 14.4); ctx.stroke();
    ctx.strokeStyle = '#d9b23c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-3, -14); ctx.lineTo(-1, -15.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-3, 14); ctx.lineTo(-1, 15.5); ctx.stroke();
  } else if (cls === 'mage') {
    ctx.fillStyle = '#6b4a2f';
    roundRect(ctx, -2, -27, 4, 34, 2); ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.strokeStyle = '#57391f'; ctx.lineWidth = 1;
    for (const yy of [-16, -6, 3]) {
      ctx.beginPath(); ctx.moveTo(-1.6, yy); ctx.lineTo(1.6, yy + 2); ctx.stroke();
    }
    const oc = it ? it.color : '#b388ff';
    ctx.shadowColor = oc; ctx.shadowBlur = 14;
    ctx.fillStyle = oc;
    ctx.beginPath(); ctx.arc(0, -30, 5, 0, 7); ctx.fill();
    ctx.fillStyle = shade(oc, 1.35);
    ctx.beginPath(); ctx.arc(-3.5, -33, 3, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(3.8, -33.5, 2.4, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.beginPath(); ctx.arc(-1.2, -31.6, 1.5, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function eqSpriteName(cls, eq) {
  const a = eq.armor ? getItem(eq.armor) : null;
  const h = eq.helmet ? getItem(eq.helmet) : null;
  const p = eq.pants ? getItem(eq.pants) : null;
  const b = eq.boots ? getItem(eq.boots) : null;
  if (!a && !h && !p && !b) return cls;
  const key = `${cls}|w${a?.color || ''}|h${h?.color || ''}|p${p?.color || ''}|b${b?.color || ''}`;
  if (!SPRITE_DEFS[key]) {
    const bp = SPRITE_DEFS[cls];
    const pal = { ...bp.pal };
    const rows = [...bp.rows]; /* 장비 실루엣을 행 단위로 스탬핑 */
    if (a) {
      pal.A = a.color; pal.D = shade(a.color, .55);
      pal.T = shade(a.color, 1.5);
      rows[7] = '.TAAAAAAAAT.'; /* 어깨 견장 트림 */
    }
    if (p) { pal.L = shade(p.color, 1.05); pal.l = shade(p.color, .45); }
    if (h) {
      /* 색만 바꾸던 것에서 투구 실루엣으로 교체 (눈은 4행이라 전 직업 공통 적용 가능) */
      pal.M = h.color; pal.m = shade(h.color, .55); pal.Q = shade(h.color, 1.55);
      rows[0] = '...OMMMMO...';
      rows[1] = '..OMQQQMMO..';
      rows[2] = '.OMMMMMMMMO.';
      rows[3] = '.OmmMMMMmmO.';
    }
    if (b) {
      pal.Z = b.color; pal.z = shade(b.color, .55);
      rows[13] = '..OZzOOZzO..';
      rows[14] = '..ZZZ..ZZZ..';
    }
    SPRITE_DEFS[key] = { pal, rows };
  }
  return key;
}

function drawChar(o) {
  const now = Date.now();
  const moving = o.moving && !o.dead;
  const face = o.face ?? Math.PI / 2;
  const fx = Math.cos(face), fy = Math.sin(face);
  const flip = fx < -.05;
  const bobY = moving ? Math.abs(Math.sin(now / 85)) * 2.4 : 0;

  ctx.fillStyle = 'rgba(0,0,0,.32)';
  ctx.beginPath(); ctx.ellipse(o.x, o.y + 11, 15, 5.5, 0, 0, 7); ctx.fill();
  if (o.isSelf && !o.dead) {
    ctx.strokeStyle = 'rgba(255,215,0,.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(o.x, o.y + 11, 18, 7, 0, 0, 7); ctx.stroke();
  }

  const sc = 4.3, sw2 = 12 * sc, sh2 = 15 * sc;
  const eq = o.equipped || {};
  ctx.save();
  ctx.translate(o.x, o.y);
  if (o.dead) { ctx.globalAlpha = .45; ctx.rotate(Math.PI / 2); }
  else if (moving) ctx.rotate(Math.sin(now / 85) * .055); /* 걸음 스웨이 */
  ctx.save();
  if (flip) ctx.scale(-1, 1);
  ctx.imageSmoothingEnabled = false;
  const sy0 = -sh2 + 10 - bobY;
  ctx.drawImage(buildSprite(eqSpriteName(o.cls || 'warrior', eq)).cv, -sw2 / 2, sy0, sw2, sh2);
  /* 부츠는 이제 스프라이트 실루엣(eqSpriteName)으로 반영 */
  if (eq.necklace) {
    ctx.fillStyle = getItem(eq.necklace).color;
    ctx.beginPath(); ctx.arc(0, sy0 + 7.4 * sc, 2.6, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.restore();

  if (!o.dead) {
    const sw = o.swing ? (now - o.swing) / 220 : -1;
    const baseA = face + .55;
    const wa = sw >= 0 && sw < 1 ? baseA - 1.5 + sw * 2.6 : baseA + Math.sin(now / 320) * .07;
    const hx = Math.cos(wa) * 17, hy = Math.sin(wa) * 17 + 2;
    if (eq.gloves) {
      ctx.fillStyle = getItem(eq.gloves).color;
      ctx.beginPath(); ctx.arc(hx, hy, 3.4, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(wa);
    drawHeldWeapon(o.cls, eq.weapon);
    ctx.restore();
    if (sw >= 0 && sw < 1) {
      ctx.strokeStyle = `rgba(255,255,255,${.55 * (1 - sw)})`;
      ctx.lineWidth = 3.5;
      const aa = baseA - 1.2 + sw * 2.6;
      ctx.beginPath(); ctx.arc(0, 0, 26, aa - .55, aa + .55); ctx.stroke();
    }
    if (eq.bracelet) {
      ctx.fillStyle = getItem(eq.bracelet).color;
      ctx.beginPath(); ctx.arc(Math.cos(baseA) * 13, Math.sin(baseA) * 13 + 6, 2, 0, 7); ctx.fill();
    }
    if (eq.ring) { /* 반지: 무기 손 근처 글린트 */
      const tw = .6 + Math.sin(now / 260) * .4;
      ctx.fillStyle = getItem(eq.ring).color;
      ctx.globalAlpha = .55 + tw * .45;
      ctx.beginPath(); ctx.arc(hx + 2.5, hy - 2.5, 1.6, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();

  if (!o.dead && o.hp < o.maxHp) {
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    roundRect(ctx, o.x - 18, o.y - 52, 36, 6.5, 3); ctx.fill();
    ctx.fillStyle = '#2ecc71';
    ctx.fillRect(o.x - 17, o.y - 51, 34 * clampN(o.hp / o.maxHp, 0, 1), 4.5);
  }
  ctx.font = (o.isSelf ? 'bold ' : '') + '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = o.isSelf ? '#fff' : (CLASSES[o.cls]?.color || '#eee');
  ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 3;
  ctx.fillText(o.name, o.x, o.y - 56);
  ctx.shadowBlur = 0;
}

function mobUI(s, wide) {
  const d2 = sdef(s);
  const r = d2.r;
  const isU = !!s.uniq;
  const isBoss = s.type === 'boss' || s.type === 'lich';
  if (s.hp < d2.hp || isBoss || isU) {
    const w = wide ? r * 2.7 : r * 2;
    const y = s.y - r - (wide ? 38 : 18);
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    roundRect(ctx, s.x - w / 2 - 1.5, y - 1.5, w + 3, (wide ? 9 : 7) + 3, 3.5); ctx.fill();
    ctx.fillStyle = isU ? '#ff4d4d' : isBoss ? '#ff4040' : '#e74c3c';
    ctx.fillRect(s.x - w / 2, y, w * clampN(s.hp / d2.hp, 0, 1), wide ? 7 : 5);
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1;
    ctx.strokeRect(s.x - w / 2, y, w, wide ? 7 : 5);
  }
  ctx.font = (wide || isU) ? 'bold 13px sans-serif' : '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = isU ? '#ff8a5c' : isBoss ? '#ffb8b8' : 'rgba(255,255,255,.88)';
  ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 3;
  ctx.fillText(`Lv${simLevel(s)} ${d2.name}`, s.x, s.y + r + (wide ? 24 : 15));
  ctx.shadowBlur = 0;
}

function uniqAura(s, now) {
  const rad = r0(s) * 1.5;
  const p = .5 + Math.sin(now / 250) * .2;
  ctx.fillStyle = `rgba(255,77,77,${.07 + p * .05})`;
  ctx.beginPath(); ctx.arc(s.x, s.y + 6, rad, 0, 7); ctx.fill();
  ctx.strokeStyle = `rgba(255,77,77,${.4 + p * .3})`;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(s.x, s.y + 6, rad, 0, 7); ctx.stroke();
}

function drawSlime(s, now) {
  const wob = Math.sin(now / 140 + s.blink);
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(s.x, s.y + 10, r0(s) * .95, r0(s) * .36, 0, 0, 7); ctx.fill();
  if (s.uniq) uniqAura(s, now);
  const flash = s.hitFlash ? clampN(1 - (now - s.hitFlash) / 150, 0, 1) * .85 : 0;
  drawSprite(s.sprId || 'slime', s.x, s.y + 9, s.uniq ? 5.6 : 4.5, { squashX: 1 + wob * .07, squashY: 1 - wob * .07, flash, bob: s.movingF ? Math.abs(Math.sin(now / 140 + s.blink)) * 3 : 0 });
  mobUI(s, false);
}
function r0(s) { return sdef(s).r; }

function drawGoblin(s, now) {
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(s.x, s.y + 12, r0(s) * .95, r0(s) * .36, 0, 0, 7); ctx.fill();
  if (s.uniq) uniqAura(s, now);
  const flash = s.hitFlash ? clampN(1 - (now - s.hitFlash) / 150, 0, 1) * .85 : 0;
  drawSprite(s.sprId || 'goblin', s.x, s.y + 11, s.uniq ? 5.6 : 4.5, { flash, bob: s.movingF ? Math.abs(Math.sin(now / 110)) * 3 : 0 });
  mobUI(s, false);
}

function drawWolf(s, now) {
  const flip = Math.cos(s.dirA ?? 0) < 0 ? -1 : 1;
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(s.x, s.y + 13, r0(s) * 1.2, r0(s) * .32, 0, 0, 7); ctx.fill();
  if (s.uniq) uniqAura(s, now);
  const flash = s.hitFlash ? clampN(1 - (now - s.hitFlash) / 150, 0, 1) * .85 : 0;
  drawSprite(s.sprId || 'wolf', s.x, s.y + 12, s.uniq ? 5.6 : 4.5, { flip: flip < 0, flash, bob: s.movingF ? Math.abs(Math.sin(now / 75)) * 2 : 0 });
  mobUI(s, false);
}

function drawSkeleton(s, now) {
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(s.x, s.y + 12, r0(s) * .9, r0(s) * .34, 0, 0, 7); ctx.fill();
  if (s.uniq) uniqAura(s, now);
  const flash = s.hitFlash ? clampN(1 - (now - s.hitFlash) / 150, 0, 1) * .85 : 0;
  drawSprite(s.sprId || 'skeleton', s.x, s.y + 11, s.uniq ? 6.2 : 5, { flash, bob: s.movingF ? Math.abs(Math.sin(now / 120)) * 3 : 0 });
  mobUI(s, false);
}

function drawLich(s, now) {
  const fl = Math.sin(now / 300) * 7;
  const glow = ctx.createRadialGradient(s.x, s.y - 40, 6, s.x, s.y - 40, r0(s) * 1.8);
  glow.addColorStop(0, 'rgba(139,107,255,.3)');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(s.x, s.y - 40, r0(s) * 1.8, 0, 7); ctx.fill();
  ctx.save();
  ctx.translate(s.x, s.y + 14);
  ctx.rotate(now / 1200);
  ctx.strokeStyle = 'rgba(139,107,255,.5)';
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 9]);
  ctx.beginPath(); ctx.arc(0, 0, r0(s) * 1.3, 0, 7); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(s.x, s.y + 14, r0(s) * .8, r0(s) * .3, 0, 0, 7); ctx.fill();
  if (s.uniq) uniqAura(s, now);
  const flash = s.hitFlash ? clampN(1 - (now - s.hitFlash) / 150, 0, 1) * .85 : 0;
  drawSprite(s.sprId || 'lich', s.x, s.y + 16 - fl, s.uniq ? 6.6 : 5.5, { flash });
  for (let i = 0; i < 2; i++) {
    const a = now / 400 + i * Math.PI;
    ctx.fillStyle = '#8b6bff';
    ctx.shadowColor = '#8b6bff'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(s.x + Math.cos(a) * r0(s) * 1.2, s.y - 40 + Math.sin(a) * 14, 3.5, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
  }
  mobUI(s, true);
}

function drawBoss(s, now) {
  const r = s.def.r;
  const pulse = .3 + Math.sin(now / 220) * .12;
  const mg = ctx.createRadialGradient(s.x, s.y + 8, 8, s.x, s.y + 8, r * 1.8);
  mg.addColorStop(0, `rgba(255,40,40,${.2 + pulse * .14})`);
  mg.addColorStop(1, 'transparent');
  ctx.fillStyle = mg;
  ctx.beginPath(); ctx.arc(s.x, s.y + 8, r * 1.8, 0, 7); ctx.fill();

  ctx.save();
  ctx.translate(s.x, s.y + 10);
  ctx.rotate(now / 1400);
  ctx.strokeStyle = `rgba(255,60,40,${.5 + pulse * .3})`;
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 10]);
  ctx.beginPath(); ctx.arc(0, 0, r * 1.35, 0, 7); ctx.stroke();
  ctx.setLineDash([6, 14]);
  ctx.strokeStyle = `rgba(255,160,60,${.4 + pulse * .25})`;
  ctx.beginPath(); ctx.arc(0, 0, r * 1.1, 0, 7); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  ctx.fillStyle = 'rgba(0,0,0,.4)';
  ctx.beginPath(); ctx.ellipse(s.x, s.y + 18, r * 1.0, r * .34, 0, 0, 7); ctx.fill();

  const swing = s.swingT && now - s.swingT < 320 ? (now - s.swingT) / 320 : -1;
  if (s.uniq) uniqAura(s, now);
  const flash = s.hitFlash ? clampN(1 - (now - s.hitFlash) / 150, 0, 1) * .85 : 0;
  drawSprite(s.sprId || 'orc', s.x, s.y + 16, s.uniq ? 6.6 : 5.5, { flash, bob: Math.sin(now / 300) * 2 });

  ctx.save();
  ctx.translate(s.x + r * .78, s.y - r * .28);
  const restA = .5 + Math.sin(now / 400) * .08;
  const armA = swing >= 0 ? restA - Math.sin(swing * Math.PI) * 2.3 : restA;
  ctx.rotate(armA);
  ctx.fillStyle = '#4a6e33';
  roundRect(ctx, -5, 0, 11, r * .62, 5); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.translate(0, r * .6);
  ctx.rotate(-.35);
  ctx.fillStyle = '#5c4327';
  roundRect(ctx, -3.5, -r * 1.02, 7, r * 1.2, 3); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1.4; ctx.stroke();
  const axg = ctx.createLinearGradient(-r * .5, 0, r * .5, 0);
  axg.addColorStop(0, '#7d8790'); axg.addColorStop(.5, '#d5dde5'); axg.addColorStop(1, '#7d8790');
  ctx.fillStyle = axg;
  ctx.beginPath();
  ctx.moveTo(-4, -r * 1.0); ctx.quadraticCurveTo(-r * .58, -r * .8, -4, -r * .38);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(4, -r * 1.0); ctx.quadraticCurveTo(r * .58, -r * .8, 4, -r * .38);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-4, -r * 1.0); ctx.quadraticCurveTo(-r * .58, -r * .8, -4, -r * .38); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4, -r * 1.0); ctx.quadraticCurveTo(r * .58, -r * .8, 4, -r * .38); ctx.stroke();
  ctx.fillStyle = '#d9b23c';
  roundRect(ctx, -5.5, -r * 1.04, 11, 6, 2); ctx.fill();
  ctx.restore();

  if (swing >= 0 && swing < .6) {
    const sa = Math.atan2(cam.y - s.y, cam.x - s.x);
    ctx.strokeStyle = `rgba(255,120,80,${(1 - swing / .6) * .8})`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * 1.5, sa - .8 + swing * 1.2, sa + .5 + swing * 1.2);
    ctx.stroke();
  }
  mobUI(s, true);
}

/* ================= 메인 드로잉 ================= */
/* UI 인셋 — PC: 스테이지 항상 정중앙(인셋 없음), 모바일: 상하(HUD/하단 액션바)만 회피
   모바일에선 HUD 실제 높이를 CSS 변수 --hudB로 내보내 카운터/미니맵이 CSS에서 따라가게 함 */
const isMobileUI = () => innerWidth <= 640; /* index.html @media (max-width:640px)와 동기 유지 */
let uiInsetCache = { T: 0, B: 0, t: 0, hb: -1 };
function uiInsets(now) {
  if (now - uiInsetCache.t > 500) {
    let T = 0, B = 0;
    const h = $('hud')?.getBoundingClientRect();
    if (h && h.height) {
      /* HUD 실측 높이를 CSS 변수로 발행 — 장비패널(top)·모바일 카운터/미니맵이 CSS에서 따라감 */
      const hb = Math.round(h.bottom);
      if (hb !== uiInsetCache.hb) { uiInsetCache.hb = hb; document.documentElement.style.setProperty('--hudB', hb + 'px'); }
      if (isMobileUI()) T = h.bottom + 8;
    }
    if (isMobileUI()) {
      const mb = $('mobileBar')?.getBoundingClientRect();
      if (mb && mb.height) B = innerHeight - mb.top + 8;
    }
    uiInsetCache.T = T; uiInsetCache.B = B; uiInsetCache.t = now;
  }
  return uiInsetCache;
}
addEventListener('resize', () => { uiInsetCache.t = 0; }); /* 회전/리사이즈 시 인셋 즉시 재계산 */
function draw(now) {
  const vw = cv.width, vh = cv.height;
  let shx = 0, shy = 0;
  if (shakeT && now - shakeT < 180) {
    const p = (1 - (now - shakeT) / 180) * shakePow;
    shx = rand(-p, p); shy = rand(-p, p);
  } else shakePow = 0;
  /* 가로: 항상 정중앙(부족하면 스크롤). 세로: 모바일 상하 UI를 제외한 밴드 기준 */
  const { T, B } = uiInsets(now);
  const availH = vh - T - B;
  const cx = WORLD.w >= vw ? clampN(cam.x - vw / 2, 0, WORLD.w - vw) : (WORLD.w - vw) / 2;
  let cy;
  if (WORLD.h >= availH) cy = clampN(cam.y - T - availH / 2, -T, WORLD.h - vh + B);
  else cy = -(T + (availH - WORLD.h) / 2);
  view.x = cx; view.y = cy;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, vw, vh);
  ctx.save();
  ctx.translate(-cx + shx, -cy + shy);
  ctx.drawImage(getTex(myMap()), 0, 0);

  for (const [, l] of Object.entries(lootItems)) {
    if ((l.map || 'm1') !== myMap()) continue;
    const it = getItem(l.itemId);
    if (!it) continue;
    const bob = Math.sin(now / 300 + l.x) * 3;
    const R = it.rarity;
    const isU = R === 'unique', isL = R === 'legend';
    const glowCol = isL ? '255,145,20' : R === 'epic' ? '155,89,182' : R === 'rare' ? '52,152,219' : isU ? '255,205,60' : '255,255,255';
    const pulse = .35 + Math.sin(now / 250 + l.x) * .2;
    if (isU) {
      const beamH = Math.max(340, l.y - view.y + 60);
      const flick = .8 + Math.sin(now / 90 + l.x) * .12 + Math.sin(now / 231 + l.y) * .08;
      const bw = 15 + Math.sin(now / 170 + l.x) * 3;
      let g = ctx.createLinearGradient(0, l.y, 0, l.y - beamH);
      g.addColorStop(0, `rgba(255,215,80,${.42 * flick})`);
      g.addColorStop(.25, `rgba(255,225,120,${.24 * flick})`);
      g.addColorStop(1, 'rgba(255,230,150,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(l.x - bw, l.y);
      ctx.lineTo(l.x + bw, l.y);
      ctx.lineTo(l.x + bw * .22, l.y - beamH);
      ctx.lineTo(l.x - bw * .22, l.y - beamH);
      ctx.closePath(); ctx.fill();
      const g2 = ctx.createLinearGradient(0, l.y, 0, l.y - beamH);
      g2.addColorStop(0, `rgba(255,245,190,${.75 * flick})`);
      g2.addColorStop(1, 'rgba(255,245,190,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(l.x - 2.5, l.y - beamH, 5, beamH);
      for (let i = 0; i < 10; i++) {
        const sd = l.x * 13.7 + i * 97.3;
        const py = l.y - ((now * (.05 + (i % 4) * .018) + sd * 57) % beamH);
        const px = l.x + Math.sin(sd + now / 700) * (bw + 8) * (.3 + (i % 5) / 5);
        const tw = Math.max(0, Math.sin(now / 130 + i * 2.4 + sd));
        if (tw < .15) continue;
        const sz2 = 1.6 + (i % 3) * .9;
        ctx.fillStyle = `rgba(255,240,170,${tw * .95})`;
        ctx.fillRect(px - sz2 / 2, py - sz2 / 2, sz2, sz2);
        ctx.fillRect(px - sz2 * .18, py - sz2 * 1.7, sz2 * .36, sz2 * 3.4);
        ctx.fillRect(px - sz2 * 1.7, py - sz2 * .18, sz2 * 3.4, sz2 * .36);
      }
    }
    ctx.fillStyle = `rgba(${glowCol},${pulse * .45})`;
    ctx.beginPath(); ctx.arc(l.x, l.y - 4, 15 + bob * .5, 0, 7); ctx.fill();
    if (isL) {
      for (let i = 0; i < 2; i++) {
        const rr = 10 + ((now / 2.6 + l.x + i * 13) % 30);
        ctx.strokeStyle = `rgba(255,140,15,${clampN(1 - rr / 40, 0, 1) * .85})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.ellipse(l.x, l.y + 1, rr, rr * .42, 0, 0, 7); ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,.30)';
    ctx.beginPath(); ctx.ellipse(l.x, l.y + 2, 8, 3.2, 0, 0, 7); ctx.fill();
    drawSprite(itemSprite(l.itemId), l.x, l.y - 4 + bob, 2.4, { rot: Math.sin(now / 500 + l.y) * .07 });
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(${glowCol},.95)`;
    ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = 3;
    ctx.fillText(it.name, l.x, l.y + 26);
    ctx.shadowBlur = 0;
  }

  const pn = pageNum();
  const drawPortal = (px, label, locked, dirRight) => {
    const glow = .5 + Math.sin(now / 300) * .25;
    const pc2 = locked ? '120,120,140' : '160,90,255';
    ctx.save();
    ctx.translate(px, 600);
    const pg = ctx.createRadialGradient(0, 0, 4, 0, 0, 48);
    pg.addColorStop(0, `rgba(${pc2},${.45 * glow})`);
    pg.addColorStop(1, 'transparent');
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(0, 0, 48, 0, 7); ctx.fill();
    ctx.strokeStyle = `rgba(${pc2},.95)`;
    ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.ellipse(0, 0, 30, 41, 0, 0, 7); ctx.stroke();
    ctx.strokeStyle = `rgba(${pc2},${.4 + glow * .3})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = (dirRight ? -1 : 1) * now / 28;
    ctx.beginPath(); ctx.ellipse(0, 0, 21, 31, 0, 0, 7); ctx.stroke();
    ctx.setLineDash([]);
    for (let i2 = 0; i2 < 3; i2++) {
      const a = now / 480 + i2 * 2.1;
      ctx.fillStyle = `rgba(${pc2},.9)`;
      ctx.beginPath(); ctx.arc(Math.cos(a) * 13, Math.sin(a) * 21, 2.5, 0, 7); ctx.fill();
    }
    ctx.restore();
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = locked ? '#9a9aa8' : `rgb(${pc2})`;
    ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = 4;
    ctx.fillText((locked ? '🔒 ' : (dirRight ? '▶ ' : '◀ ')) + label, px, 546);
    ctx.shadowBlur = 0;
  };
  if (pn < MAX_PAGE) drawPortal(1490, pageDef(pn + 1).name, !(me.conq || {})[pn], true);
  if (pn > 1) drawPortal(100, pageDef(pn - 1).name, false, false);

  for (const s of sims) {
    if (!s.alive || s.map !== myMap()) continue;
    if (s.id === attackTargetSimId) {
      const r0 = sdef(s).r;
      const sel = .55 + Math.sin(now / 160) * .3;
      ctx.strokeStyle = `rgba(255,215,0,${sel})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(s.x, s.y + 5, r0 * 1.45 + 4, (r0 * 1.45 + 4) * .52, 0, 0, 7); ctx.stroke();
      ctx.fillStyle = 'rgba(255,215,0,.9)';
      const ay = s.y - r0 * 1.6 - 14 - Math.sin(now / 200) * 2;
      ctx.beginPath(); ctx.moveTo(s.x, ay + 7); ctx.lineTo(s.x - 5, ay); ctx.lineTo(s.x + 5, ay); ctx.closePath(); ctx.fill();
    }
    const pk = s.punchT && now - s.punchT < 130 ? 1 + (1 - (now - s.punchT) / 130) * .17 : 1;
    ctx.save();
    if (pk !== 1) { ctx.translate(s.x, s.y); ctx.scale(pk, pk); ctx.translate(-s.x, -s.y); }
    if (s.type === 'slime') drawSlime(s, now);
    else if (s.type === 'goblin') drawGoblin(s, now);
    else if (s.type === 'wolf') drawWolf(s, now);
    else if (s.type === 'skeleton') drawSkeleton(s, now);
    else if (s.type === 'lich') drawLich(s, now);
    else drawBoss(s, now);
    ctx.restore();
  }

  for (const [id, o] of Object.entries(others)) {
    if (Date.now() - (o.lastSeen || 0) >= OFFLINE_MS || (o.map || 'm1') !== myMap()) { delete othersPrev[id]; continue; }
    /* 네트워크 위치(600ms+ 간격)를 화면 위치로 시간기반 보간 — 순간이동 대신 부드러운 이동 */
    let pv = othersPrev[id];
    if (!pv) pv = othersPrev[id] = { x: o.x, y: o.y, f: Math.PI / 2, t: now };
    const ddx = o.x - pv.x, ddy = o.y - pv.y, dd = Math.hypot(ddx, ddy);
    const k2 = 1 - Math.exp(-(now - pv.t) / 110); /* 주사율 무관 수렴 속도 */
    pv.t = now;
    if (dd > 320) { pv.x = o.x; pv.y = o.y; } /* 텔레포트/맵이동은 스냅 */
    else { pv.x += ddx * k2; pv.y += ddy * k2; }
    if (dd > 2.5) { pv.mvT = now; pv.f = angLerp(pv.f ?? Math.PI / 2, Math.atan2(ddy, ddx), .25); }
    const mv = now - (pv.mvT || 0) < 400; /* 600ms 쓰기 간격 사이 걷기 애니메이션 깜빡임 방지 */
    drawChar({ x: pv.x, y: pv.y, color: o.color || colorOf(id), name: o.name, hp: o.hp, maxHp: o.maxHp, dead: o.dead, equipped: o.equipped, cls: o.cls || 'warrior', isSelf: false, face: pv.f, moving: mv });
  }
  if (ready) drawChar({ x: me.x, y: me.y, color: '#fff', name: myName, hp: me.hp, maxHp: me.maxHp, dead: me.dead, equipped: me.equipped, cls: myCls, isSelf: true, face: me.face ?? Math.PI / 2, moving: meMovingNow, swing: lastAttackAt });

  for (const sh of shots) {
    const p = sh.t / sh.max;
    ctx.globalAlpha = 1 - p * .4;
    if (sh.size <= 4) {
      ctx.strokeStyle = sh.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y);
      ctx.lineTo(sh.x - sh.vx * .045, sh.y - sh.vy * .045);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(sh.x, sh.y, 1.6, 0, 7); ctx.fill();
    } else {
      ctx.fillStyle = sh.color;
      ctx.shadowColor = sh.color; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(sh.x, sh.y, sh.size, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.beginPath(); ctx.arc(sh.x - sh.vx * .008, sh.y - sh.vy * .008, sh.size * .45, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  for (const rg of rings) {
    const p = rg.t / rg.max;
    ctx.strokeStyle = `rgba(${rg.color},${(1 - p) * .9})`;
    ctx.lineWidth = 5 * (1 - p) + 1.5;
    ctx.beginPath(); ctx.arc(rg.x, rg.y, rg.r * (.25 + p * .75), 0, 7); ctx.stroke();
  }

  for (const sl of slashes) {
    const p = sl.t / 180;
    ctx.strokeStyle = sl.color || `rgba(255,255,255,${.9 * (1 - p)})`;
    ctx.globalAlpha = 1 - p;
    ctx.lineWidth = (sl.w || 3.6) * (1 - p) + 1;
    ctx.beginPath();
    ctx.arc(sl.x, sl.y, (sl.len || 38) * (0.8 + p * .5), sl.a - .85, sl.a + .85);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${.5 * (1 - p)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sl.x, sl.y, (sl.len || 38) * (0.8 + p * .5) - 5, sl.a - .7, sl.a + .7);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  for (const p of poofs) {
    ctx.globalAlpha = clampN(1 - p.t / 600, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(.5, p.r * (1 - p.t / 900)), 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
  }

  for (const f of floats) {
    ctx.globalAlpha = clampN(1 - f.t / 1000, 0, 1);
    const sc2 = f.t < 90 ? 1.55 - (f.t / 90) * .55 : 1;
    ctx.save();
    ctx.translate(f.x, f.y - f.t * .03);
    ctx.scale(sc2, sc2);
    ctx.font = (f.big ? 'bold 17px ' : 'bold 13px ') + 'sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.lineWidth = 3;
    ctx.strokeText(f.text, 0, 0);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  if (now < hurtUntil) {
    ctx.strokeStyle = `rgba(231,76,60,${(hurtUntil - now) / 300 * .85})`;
    ctx.lineWidth = 16;
    ctx.strokeRect(0, 0, vw, vh);
  }

  mctx.clearRect(0, 0, 160, 120);
  mctx.globalAlpha = .85;
  mctx.drawImage(getTex(myMap()), 0, 0, WORLD.w, WORLD.h, 0, 0, 160, 120);
  mctx.globalAlpha = 1;
  const k = .1;
  for (const s of sims) {
    if (!s.alive || s.map !== myMap()) continue;
    mctx.fillStyle = s.type === 'boss' ? (Math.sin(now / 150) > 0 ? '#ff2020' : '#800') :
                     (s.type === 'wolf' ? '#ddd' : s.type === 'goblin' ? '#ff9a3c' : '#5aff8a');
    const rr = s.type === 'boss' ? 4.5 : 2.2;
    mctx.fillRect(s.x * k - rr / 2, s.y * k - rr / 2, rr, rr);
  }
  mctx.fillStyle = '#ffd700';
  for (const l of Object.values(lootItems)) {
    if ((l.map || 'm1') !== myMap()) continue;
    mctx.fillRect(l.x * k - 1.2, l.y * k - 1.2, 2.6, 2.6);
  }
  for (const [, o] of Object.entries(others)) {
    if (Date.now() - (o.lastSeen || 0) >= OFFLINE_MS || (o.map || 'm1') !== myMap()) continue;
    mctx.fillStyle = o.color || '#4aa';
    mctx.fillRect(o.x * k - 1.5, o.y * k - 1.5, 3, 3);
  }
  if (ready) {
    mctx.fillStyle = '#fff';
    mctx.fillRect(me.x * k - 2, me.y * k - 2, 4, 4);
    mctx.strokeStyle = 'rgba(255,255,255,.6)';
    mctx.strokeRect(view.x * k, view.y * k, Math.min(160, cv.width * k), Math.min(120, cv.height * k)); /* 실제 화면 영역 */
  }

  const hpR = (me.hp || 0) / maxHpOf();
  if (!me.dead && hpR < .35) {
    const vp = (.3 + Math.sin(now / 260) * .18) * clampN((.35 - hpR) / .35, 0, 1);
    const vg = ctx.createRadialGradient(cv.width / 2, cv.height / 2, cv.height * .28, cv.width / 2, cv.height / 2, cv.height * .72);
    vg.addColorStop(0, 'rgba(180,0,0,0)');
    vg.addColorStop(1, `rgba(180,0,0,${vp})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, cv.width, cv.height);
  }
}

/* ================= HUD ================= */
/* 매 프레임 호출되므로 값이 바뀐 경우에만 DOM에 씀 — 동일 값 재대입도 레이아웃을 오염시켜 모바일 스터터 유발 */
const domCache = {};
function setTxt(id, v) { if (domCache['t' + id] !== v) { domCache['t' + id] = v; $(id).textContent = v; } }
function setBarW(id, pct) { const v = pct.toFixed(1) + '%'; if (domCache['w' + id] !== v) { domCache['w' + id] = v; $(id).style.width = v; } }
function updateHUD() {
  setTxt('uiLv', String(me.lv));
  setTxt('uiCls', cdef().icon + ' ' + cdef().name);
  setTxt('uiName', myName);
  setBarW('hpbar', clampN((me.hp || 0) / maxHpOf() * 100, 0, 100));
  setTxt('hpText', `${Math.max(0, Math.ceil(me.hp || 0))} / ${maxHpOf()}`);
  setBarW('mpbar', clampN((me.mp ?? maxMpOf()) / maxMpOf() * 100, 0, 100));
  setTxt('mpText', `MP ${Math.floor(me.mp ?? maxMpOf())} / ${maxMpOf()}`);
  setBarW('expbar', clampN((me.exp || 0) / expNeed(me.lv) * 100, 0, 100));
  setTxt('expText', `EXP ${me.exp || 0} / ${expNeed(me.lv)}`);
  setTxt('uiAtk', String(totalAtk()));
  setTxt('uiDef', String(totalDef()));
  setTxt('uiCrit', String(Math.round(totalCrit() * 100)));
  setTxt('uiSpd', String(Math.round(moveSpd())));
  setTxt('uiGold', (me.gold || 0).toLocaleString());
  const pts = me.statPts || 0;
  const disp = pts > 0 ? 'flex' : 'none';
  if (domCache.ptsDisp !== disp) { domCache.ptsDisp = disp; $('statPtsRow').style.display = disp; uiInsetCache.t = 0; /* HUD 높이 변동 즉시 반영 */ }
  if (pts > 0) setTxt('uiPts', String(pts));
}

function updateHotbar(now) {
  const ids = [classActiveId(), 'heal'];
  [['hb1', 0], ['hb2', 1]].forEach(([el, i]) => {
    const box = $(el);
    const id = ids[i];
    const nm = box.querySelector('.nm'), ic = box.querySelector('.ic2'), cdEl = box.querySelector('.cd');
    if (!id) { nm.textContent = '-'; ic.textContent = '?'; return; }
    const def = SKILLS[id];
    const k = 'hb' + el;
    const locked = skillLv(id) < 1;
    const remain = (skillCdUntil[id] || 0) - now;
    const cdSec = remain > 0 && !locked ? Math.ceil(remain / 1000) : 0;
    const sig = `${id}|${locked}|${cdSec}`;
    if (domCache[k] === sig) return; /* 변화 없으면 DOM 접근 생략 (매 프레임 호출) */
    domCache[k] = sig;
    ic.textContent = def.icon;
    nm.textContent = def.name;
    box.classList.toggle('locked', locked);
    if (cdSec > 0) {
      cdEl.style.display = 'flex';
      cdEl.textContent = cdSec;
    } else cdEl.style.display = 'none';
  });
}

/* ================= 입력 ================= */
const chatInput = $('chatInput');
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const text = chatInput.value.trim();
    chatInput.value = '';
    chatInput.blur();
    if (text) addDoc(collection(db, 'chat'), { from: myName, text, ts: Date.now() }).catch(() => {});
    e.preventDefault();
  }
});

function toggleDex() {
  const el = $('dexPanel');
  const opening = !el.classList.contains('open');
  document.querySelectorAll('.sidepanel').forEach(p => p.classList.remove('open'));
  if (opening) { el.classList.add('open'); renderDex(); }
}
function renderDex() {
  const body = $('dexBody');
  let html = '';
  for (let n = 1; n <= MAX_PAGE; n++) {
    const pd = pageDef(n);
    const conq = (me.conq || {})[n];
    const cur = n === pageNum();
    html += `<div class="dexrow ${conq ? 'dexconq' : ''} ${cur ? 'dexcur' : ''}">
      <div class="dexpage">${conq ? '✅' : cur ? '📍' : '🔒'} ${pd.name} ${conq ? '<span class="dexok">정복 완료</span>' : ''}</div>
      <div class="dexmons">
        <span>Lv${n} ${pd.kinds[0].name}</span>
        <span>Lv${n} ${pd.kinds[1].name}</span>
        <span class="dexboss">BOSS Lv${n} ${pd.boss.name}</span>
        <span class="dexuniq">★유니크 10%</span>
      </div>
    </div>`;
  }
  body.innerHTML = html;
}

let wmSelPage = 0, wmRefreshT = 0;
const worldMapOpen = () => $('worldMap').classList.contains('open');
function toggleWorldMap() {
  const el = $('worldMap');
  const open = !el.classList.contains('open');
  el.classList.toggle('open', open);
  if (open) { wmSelPage = pageNum(); renderWorldMap(); }
}
const BIO_COLORS = ['#2e8455', '#1f6039', '#c9a227', '#aed6f1', '#4a7a5c', '#c0392b', '#5d656e', '#7d8790', '#6c3483', '#5dade2'];
/* 선택 구역 지도를 wmMap 캔버스에 렌더 — 지도가 열려 있는 동안 루프에서 주기 갱신됨 */
function wmDrawCanvas(n0) {
  const wc = $('wmMap');
  if (!wc) return;
  const wctx = wc.getContext('2d');
  const kx = wc.width / WORLD.w, ky = wc.height / WORLD.h;
  {
    wctx.drawImage(getTex(n0 === pageNum() ? myMap() : 'm1'), 0, 0, WORLD.w, WORLD.h, 0, 0, wc.width, wc.height);
    if (n0 === pageNum()) {
      /* 현재 구역: 실시간 마커(몬스터/보스/아이템/내 위치) */
      for (const s of sims) {
        if (!s.alive || s.map !== myMap()) continue;
        wctx.fillStyle = s.boss ? '#ff3030' : '#ffb347';
        wctx.beginPath(); wctx.arc(s.x * kx, s.y * ky, s.boss ? 7 : 4, 0, 7); wctx.fill();
        wctx.strokeStyle = 'rgba(0,0,0,.6)'; wctx.lineWidth = 1; wctx.stroke();
      }
      wctx.fillStyle = '#ffd700';
      for (const l of Object.values(lootItems)) {
        if ((l.map || 'm1') !== myMap()) continue;
        wctx.fillRect(l.x * kx - 2, l.y * ky - 2, 4, 4);
      }
      wctx.fillStyle = '#fff';
      wctx.beginPath(); wctx.arc(me.x * kx, me.y * ky, 6, 0, 7); wctx.fill();
      wctx.strokeStyle = '#ffd700'; wctx.lineWidth = 2.5;
      wctx.beginPath(); wctx.arc(me.x * kx, me.y * ky, 10, 0, 7); wctx.stroke();
      wctx.font = 'bold 15px sans-serif'; wctx.textAlign = 'center';
      wctx.fillStyle = '#ffd700';
      wctx.shadowColor = 'rgba(0,0,0,.9)'; wctx.shadowBlur = 4;
      wctx.fillText('📍 ' + myName, me.x * kx, me.y * ky - 16);
      wctx.shadowBlur = 0;
    } else {
      /* 다른 구역: 지도 미리보기 + 구역 정보 */
      const pd = pageDef(n0);
      const locked = !(n0 === 1 || (me.conq || {})[n0]);
      wctx.fillStyle = 'rgba(8,12,20,.55)';
      wctx.fillRect(0, 0, wc.width, wc.height);
      wctx.textAlign = 'center';
      wctx.fillStyle = locked ? '#9a9aa8' : '#ffd700';
      wctx.font = 'bold 30px sans-serif';
      wctx.fillText((locked ? '🔒 ' : '') + pd.name, wc.width / 2, wc.height / 2 - 40);
      wctx.font = '17px sans-serif';
      wctx.fillStyle = '#cdd6e4';
      wctx.fillText(`몬스터: ${pd.kinds.map(k => k.name).join(' · ')}`, wc.width / 2, wc.height / 2 + 4);
      wctx.fillText(`보스: ${pd.boss.name}`, wc.width / 2, wc.height / 2 + 34);
      wctx.fillStyle = '#8899aa';
      wctx.font = '14px sans-serif';
      wctx.fillText(locked ? '이전 구역 보스를 처치하면 포탈이 열립니다' : '맵 가장자리 포탈로 이동할 수 있습니다', wc.width / 2, wc.height / 2 + 68);
    }
  }
}

function renderWorldMap(sel) {
  /* 선택 구역의 지도를 크게 렌더 — 이동 기능 없음(이동은 맵 가장자리 포탈로) */
  const n0 = sel || pageNum();
  wmSelPage = n0;
  wmDrawCanvas(n0);
  const grid = $('wmGrid');
  let html = '';
  for (let n = 1; n <= MAX_PAGE; n++) {
    const conq = (me.conq || {})[n];
    const cur = n === pageNum();
    const bio = BIOMES[Math.min(9, Math.floor((n - 1) / 10))];
    const cls = (cur ? 'wmcur' : conq ? 'wmconq' : 'wmlock') + (n === n0 ? ' wmsel' : '');
    html += `<div class="wmcell ${cls}" data-p="${n}" title="${pageDef(n).name}" style="--bc:${BIO_COLORS[BIOMES.indexOf(bio)]}">${n}</div>`;
  }
  grid.innerHTML = html;
  $('wmInfo').textContent = `정복 ${Object.keys(me.conq || {}).filter(k => me.conq[k]).length} / ${MAX_PAGE} · 현재: ${pageDef(pageNum()).name}`;
  /* 구역 클릭 = 지도 미리보기(이동 아님 — 이동은 맵 가장자리 포탈) */
  grid.querySelectorAll('.wmcell').forEach(c => c.onclick = () => { sfx('click'); renderWorldMap(+c.dataset.p); });
}

function togglePanel(id) {
  const el = $(id);
  const opening = !el.classList.contains('open');
  document.querySelectorAll('.sidepanel').forEach(p => p.classList.remove('open'));
  if (opening) {
    el.classList.add('open');
    if (id === 'shopPanel') renderShop();
    if (id === 'questPanel') renderQuests();
  }
}
const rb2 = $('reviveBtn');
if (rb2) rb2.onclick = reviveNow;
$('mapBtn').onclick = () => { sfx('click'); toggleWorldMap(); };
const rtl = $('rankTabLv'), rta = $('rankTabAtk');
if (rtl) rtl.onclick = () => { rankMode = 'lv'; renderRank(); };
if (rta) rta.onclick = () => { rankMode = 'atk'; renderRank(); };
$('dexBtn').onclick = () => { sfx('click'); toggleDex(); };
document.querySelectorAll('.stbtn').forEach(b => b.onclick = () => addStat(b.dataset.st));
$('hudTop').onclick = () => {
  sfx('click');
  const mini = $('hud').classList.toggle('mini');
  uiInsetCache.t = 0; /* --hudB(장비패널/모바일 배치·카메라 밴드) 즉시 갱신 */
  try { localStorage.setItem('hudMini', mini ? '1' : ''); } catch (e) {}
};
try { if (localStorage.getItem('hudMini')) $('hud').classList.add('mini'); } catch (e) {}
function toggleInv() { sfx('click'); $('invPanel').classList.toggle('open'); }
$('invBtn').onclick = toggleInv;
$('shopBtn').onclick = () => { sfx('click'); togglePanel('shopPanel'); };
document.querySelector('#rankPanel h3').addEventListener('click', e => {
  if (e.target.tagName === 'BUTTON') return;
  sfx('click');
  $('rankPanel').classList.toggle('folded');
});
$('questBtn').onclick = () => { sfx('click'); togglePanel('questPanel'); };
async function doLogout() {
  try { await signOut(auth); } catch (e) {}
  location.reload();
}
$('logoutBtn').onclick = doLogout;
$('minimap').onclick = () => { sfx('click'); toggleWorldMap(); }; /* 미니맵 탭 → 세계지도 */
$('hudLogout').onclick = e => { e.stopPropagation(); doLogout(); }; /* HUD 접기 클릭과 분리 */
document.querySelectorAll('#mobileBar [data-mb]').forEach(b => b.onclick = () => {
  sfx('click');
  const k = b.dataset.mb;
  if (k === 'inv') $('invPanel').classList.toggle('open'); /* sfx는 위에서 이미 재생 */
  else if (k === 'map') toggleWorldMap();
  else if (k === 'dex') toggleDex();
  else togglePanel(k);
});
$('hb1').onclick = () => useSkill(1);
$('hb2').onclick = () => useSkill(2);
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $(b.dataset.close).classList.remove('open'));

addEventListener('keydown', e => {
  const typing = document.activeElement === chatInput || document.activeElement === $('nameInput');
  if (e.key === 'Escape') {
    chatInput.blur();
    document.querySelectorAll('.sidepanel').forEach(p => p.classList.remove('open'));
    $('invPanel').classList.remove('open');
    $('worldMap').classList.remove('open');
    closeEnhMenu();
    return;
  }
  if (typing) return;
  if (e.key === 'Enter') { chatInput.focus(); e.preventDefault(); return; }
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'Space') tryAttack(Date.now());
  if (e.code === 'Digit1') useSkill(1);
  if (e.code === 'Digit2') useSkill(2);
  if (e.code === 'KeyI') toggleInv();
  if (e.code === 'KeyB') { sfx('click'); togglePanel('shopPanel'); }
  if (e.code === 'KeyQ') { sfx('click'); togglePanel('questPanel'); }
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyV') { sfx('click'); toggleWorldMap(); }
  if (e.code === 'KeyC') { sfx('click'); toggleDex(); }
});
addEventListener('keyup', e => keys[e.code] = false);
/* 포커스 이탈/탭 전환 시 keyup 유실로 캐릭터가 계속 걷는 것 방지 */
addEventListener('blur', () => { keys = {}; mouseDown = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden) { keys = {}; mouseDown = false; } });

function screenToWorld(mx, my) { return { x: mx + view.x, y: my + view.y }; }
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('mousedown', e => {
  if (e.button !== 0 || !ready || me.dead || document.activeElement === chatInput) return;
  chatInput.blur();
  const w = screenToWorld(e.clientX, e.clientY);
  const s = sims.find(v => v.alive && v.map === myMap() && Math.hypot(v.x - w.x, v.y - w.y) < v.def.r + 16);
  if (s) {
    dest = null;
    attackTargetSimId = s.id;
    if (Math.hypot(s.x - me.x, s.y - me.y) <= cdef().range * 1.05) tryAttack(Date.now(), s);
  } else {
    attackTargetSimId = null;
    dest = w;
  }
  mouseDown = true;
});
addEventListener('mousemove', e => {
  if (mouseDown && !(e.buttons & 1)) { mouseDown = false; return; } /* 창 밖에서 버튼을 뗀 경우 */
  if (!mouseDown || attackTargetSimId) return;
  dest = screenToWorld(e.clientX, e.clientY);
});
addEventListener('mouseup', () => mouseDown = false);

/* ================= 터치 (모바일) ================= */
let touchDownId = null;
function tapWorld(x, y) {
  if (!ready || me.dead) return;
  /* 채팅 입력 중 월드 탭 = 키보드 내리기 (preventDefault 때문에 네이티브 블러가 안 됨) */
  if (document.activeElement === chatInput) { chatInput.blur(); return; }
  const w = screenToWorld(x, y);
  const s = sims.find(v => v.alive && v.map === myMap() && Math.hypot(v.x - w.x, v.y - w.y) < v.def.r + 22);
  if (s) {
    dest = null;
    attackTargetSimId = s.id;
    if (Math.hypot(s.x - me.x, s.y - me.y) <= cdef().range * 1.05) tryAttack(Date.now(), s);
  } else {
    attackTargetSimId = null;
    dest = w;
  }
}
cv.addEventListener('touchstart', e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  touchDownId = t.identifier;
  tapWorld(t.clientX, t.clientY);
}, { passive: false });
cv.addEventListener('touchmove', e => {
  e.preventDefault();
  if (attackTargetSimId != null) return;
  const t = [...e.changedTouches].find(c => c.identifier === touchDownId);
  if (t) dest = screenToWorld(t.clientX, t.clientY);
}, { passive: false });
for (const ev of ['touchend', 'touchcancel']) cv.addEventListener(ev, e => {
  e.preventDefault();
  if ([...e.changedTouches].some(c => c.identifier === touchDownId)) touchDownId = null;
}, { passive: false });
addEventListener('pointerdown', function unlockAudio() {
  try { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) {}
}, { once: true });

/* ================= 메인 루프 ================= */
let lastT = 0;
let lastLoopErr = '', loopErrMsg = '';
function loop(t) {
  requestAnimationFrame(loop);
  try {
    loopBody(t);
    if (loopErrMsg) loopErrMsg = '';
  } catch (err) {
    loopErrMsg = String(err && err.message || err);
    if (loopErrMsg !== lastLoopErr) { lastLoopErr = loopErrMsg; console.error('[loop]', err); toast('⚠️ 렌더 오류: ' + esc(loopErrMsg)); }
  }
}
function loopBody(t) {
  const now = Date.now();
  const dt = Math.min(50, t - lastT);
  lastT = t;
  if (!ready) {
    ctx.fillStyle = '#0d1420';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#8899aa';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⚔ 미니 MMORPG ⚔', cv.width / 2, cv.height / 2 - 12);
    ctx.fillStyle = '#556';
    ctx.font = '12px sans-serif';
    ctx.fillText('연결 중...', cv.width / 2, cv.height / 2 + 12);
    return;
  }

  let moved = false;
  const frozen = now < hitStopUntil;
  const wmUp = worldMapOpen();
  if (wmUp && now - wmRefreshT > 400) { wmRefreshT = now; wmDrawCanvas(wmSelPage); } /* 지도 열림 중 마커 실시간 갱신 */
  if (!frozen && !me.dead && !wmUp && document.activeElement !== chatInput) {
    let dx = 0, dy = 0;
    if (keys.KeyW || keys.ArrowUp) dy -= 1;
    if (keys.KeyS || keys.ArrowDown) dy += 1;
    if (keys.KeyA || keys.ArrowLeft) dx -= 1;
    if (keys.KeyD || keys.ArrowRight) dx += 1;
    if (dx || dy) {
      dest = null; attackTargetSimId = null;
      me.face = Math.atan2(dy, dx);
      const len = Math.hypot(dx, dy);
      const sp = moveSpd() * dt / 1000;
      me.x = clampN(me.x + dx / len * sp, 40, WORLD.w - 40);
      me.y = clampN(me.y + dy / len * sp, 40, WORLD.h - 40);
      moved = true;
    } else if (attackTargetSimId) {
      const s = sims.find(v => v.id === attackTargetSimId && v.map === myMap());
      if (!s || !s.alive) attackTargetSimId = null;
      else if (Math.hypot(s.x - me.x, s.y - me.y) > cdef().range) { stepToward(s, moveSpd() * dt / 1000); moved = true; }
      else tryAttack(now, s);
    } else if (dest) {
      if (Math.hypot(dest.x - me.x, dest.y - me.y) < 10 && !mouseDown) dest = null;
      else { stepToward(dest, moveSpd() * dt / 1000); moved = true; }
    }
    if (moved) {
      meMovingNow = true;
      dustT += dt;
      if (dustT > 240) {
        dustT = 0;
        poofs.push({ x: me.x + rand(-5, 5), y: me.y + 12, vx: rand(-8, 8), vy: rand(-14, -6), r: rand(1.5, 3), t: 0, color: 'rgba(150,140,110,.5)', g: -14 });
      }
    } else meMovingNow = false;
  } else meMovingNow = false;
  if (moved) resolveCollide();

  if (!Number.isFinite(me.x) || !Number.isFinite(me.y)) { me.x = SPAWN.x; me.y = SPAWN.y; cam.x = me.x; cam.y = me.y; }
  if (!Number.isFinite(me.hp)) me.hp = maxHpOf(); /* 비정상 HP가 Firestore로 퍼지는 것 차단 */
  if (me.mp != null && !Number.isFinite(me.mp)) me.mp = maxMpOf();
  const movedFar = Math.abs(me.x - sentX) + Math.abs(me.y - sentY) > 2;
  const mpChanged = me.mp != null && (Math.abs(Math.round(me.mp) - (sentMp ?? 0)) >= 5 || (Math.round(me.mp) !== sentMp && me.mp >= maxMpOf()));
  if ((now - lastPosWrite > 600 && (movedFar || hpDirty || mpChanged)) || now - lastPosWrite > 8000) {
    lastPosWrite = now;
    hpDirty = false;
    sentX = me.x; sentY = me.y; sentHp = Math.round(me.hp || 0); sentMp = me.mp != null ? Math.round(me.mp) : null;
updateDoc(meRef, { x: me.x, y: me.y, hp: me.hp, ...(me.mp != null ? { mp: Math.round(me.mp) } : {}), ...(me.lastHurtAt ? { lastHurtAt: Math.round(me.lastHurtAt) } : {}), power: Math.round(totalAtk() * (1 + totalCrit()) * skillPow()), lastSeen: now }).catch(() => {});
  }

  if (!me.dead && (me.mp ?? 0) < maxMpOf()) {
    me.mp = Math.min(maxMpOf(), (me.mp ?? 0) + maxMpOf() * .03 * dt / 1000);
    /* 재생 중엔 5 이상 변했거나 만충 시에만 쓰기 — 매 600ms 쓰기로 쿼터 낭비 방지 */
    if (Math.abs(me.mp - (sentMp ?? 0)) >= 5 || me.mp >= maxMpOf()) hpDirty = true;
  }

  if (!me.dead && now - loginAt > 5000 && now - (me.lastHurtAt || 0) > 4000 && me.hp < maxHpOf()) {
    me.hp = Math.min(maxHpOf(), me.hp + maxHpOf() * .02 * dt / 1000);
    if (Math.abs(me.hp - sentHp) >= 5 || me.hp >= maxHpOf()) hpDirty = true;
  }

  if (me.dead && me.deadUntil && now > me.deadUntil) {
    me.dead = false; me.hp = maxHpOf();
    me.x = SPAWN.x; me.y = SPAWN.y;
    updateDoc(meRef, { dead: false, hp: me.hp, x: me.x, y: me.y, lastSeen: now }).catch(() => {});
    $('deadOv').style.display = 'none';
    float(me.x, me.y - 40, '부활!', '#2ecc71');
    rings.push({ x: me.x, y: me.y, r: 80, t: 0, max: 500, color: '46,204,113' });
  } else if (me.dead && me.deadUntil) {
    const ov = $('deadOv');
    ov.style.display = 'flex';
    const rem = me.deadUntil - now;
    const mm2 = Math.floor(rem / 60000), ss2 = Math.floor(rem % 60000 / 1000);
    $('deadCnt').textContent = `${mm2}:${String(ss2).padStart(2, '0')}`;
    const cost = me.lv * 100;
    $('reviveCost').textContent = cost.toLocaleString();
    $('reviveBtn').disabled = (me.gold || 0) < cost;
  }

  if (!frozen) updateSims(now, dt);

  if (!picking && !frozen) {
    for (const [lid, l] of Object.entries(lootItems)) {
      if (now < bagFullUntil) break; /* 가방 가득: 잠시 자동 루팅 중지 */
    if ((l.map || 'm1') === myMap() && Math.hypot(l.x - me.x, l.y - me.y) < 36) { pickup(lid, l); break; }
    }
  }

  cam.x += (me.x - cam.x) * Math.min(1, dt * .01);
  cam.y += (me.y - cam.y) * Math.min(1, dt * .01);

  if (!me.dead && !mapFading) {
    const pn = pageNum();
    if (pn < MAX_PAGE && Math.hypot(me.x - 1490, me.y - 600) < 48) {
      if ((me.conq || {})[pn]) gotoPage(pn + 1);
      else if (now - portalHintT > 3000) { portalHintT = now; float(me.x, me.y - 44, `🔒 ${pn}구역 보스 처치 필요`, '#ff9a9a'); }
    }
    if (pn > 1 && Math.hypot(me.x - 100, me.y - 600) < 48) gotoPage(pn - 1);
  }
  if (!goldHintShown && (me.gold || 0) >= 400 && Object.keys(me.skills || {}).length === 0) {
    goldHintShown = true;
    toast('💰 골드가 모였어요! <b>B키</b> = 스킬샵', 'sysq');
  }

  floats = floats.filter(f => (f.t += dt) < 1000);
  slashes = slashes.filter(s => (s.t += dt) < 180);
  shots = shots.filter(s => { s.t += dt; s.x += s.vx * dt / 1000; s.y += s.vy * dt / 1000; return s.t < s.max; });
  rings = rings.filter(r => (r.t += dt) < r.max);
  poofs = poofs.filter(p => { p.t += dt; p.x += (p.vx || 0) * dt / 1000; p.y += (p.vy || 0) * dt / 1000; p.vy = (p.vy || 0) + (p.g ?? 240) * dt / 1000; return p.t < 600; });

  updateHUD();
  updateHotbar(now);
  if ($('shopPanel').classList.contains('open')) renderShopThrottled();
  if ($('questPanel').classList.contains('open')) renderQuestsThrottled();
  draw(now);
}
let shopT = 0, questT = 0;
function renderShopThrottled() { if (Date.now() - shopT > 700) { shopT = Date.now(); renderShop(); } }
function renderQuestsThrottled() { if (Date.now() - questT > 700) { questT = Date.now(); renderQuests(); } }

let reviving = false;
function reviveNow() {
  if (reviving) return; /* 연타 이중 과금 방지 */
  const cost = me.lv * 100;
  if ((me.gold || 0) < cost) { toast('💰 골드가 부족합니다'); return; }
  reviving = true;
  const nhp = maxHpOf(); /* me.maxHp는 생성 시점 값이라 낡음 */
  runTransaction(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return false;
    const p = snap.data();
    if (!p.dead) return false; /* 이미 부활됨 */
    if ((p.gold || 0) < cost) return false;
    tx.update(meRef, { gold: p.gold - cost, dead: false, hp: nhp }); /* 과금과 부활을 원자적으로 */
    return true;
  }).then(ok => {
    reviving = false;
    if (!ok) { toast('💰 골드가 부족합니다'); return; }
    me.gold -= cost;
    me.dead = false; me.hp = nhp;
    $('deadOv').style.display = 'none';
    rings.push({ x: me.x, y: me.y, r: 80, t: 0, max: 500, color: '255,215,0' });
    fxSparks(me.x, me.y, 16, '#ffd700', 150);
    sfx('levelup');
    float(me.x, me.y - 40, '즉시 부활!', '#ffd700');
  }).catch(() => { reviving = false; });
}

function addStat(k) {
  if (!(me.statPts > 0)) return;
  runTransaction(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return false;
    const p = snap.data();
    if ((p.statPts || 0) <= 0) return false;
    tx.update(meRef, { statPts: p.statPts - 1, [k]: (p[k] || 0) + 1 });
    return true;
  }).then(ok => {
    if (!ok) return;
    sfx('buy');
    me[k] = (me[k] || 0) + 1; /* 스냅샷 도착 전 낙관적 반영 — maxHpOf/maxMpOf 즉시 정확 */
    if (k === 'stHp') {
      me.hp = Math.min(maxHpOf(), (me.hp || 0) + 15);
      updateDoc(meRef, { hp: me.hp }).catch(() => {});
    }
    const NM = { stAtk: '힘', stHp: '체력', stDef: '방어', stSpd: '민첩', stWis: '지혜', stCrit: '치명' };
    float(me.x, me.y - 30, `${NM[k]} +1`, '#7fe3a0');
  }).catch(() => {});
}

/* ================= 캐릭터 생성 ================= */
let selectedCls = 'warrior';
function buildCreateUI(resolve) {
  const grid = $('classGrid');
  const info = {
    warrior: '근접 · 균형잡힌 방어와 공격',
    archer: '원거리 · 빠른 연사와 기동성',
    rogue: '근접 · 초고속 공격과 높은 치명타',
    mage: '원거리 · 강력한 마법 피해',
  };
  grid.innerHTML = CLASS_ORDER.map(k => {
    const c = CLASSES[k];
    return `<div class="ccard ${k === selectedCls ? 'sel' : ''}" data-cls="${k}">
      <div class="cicon">${c.icon}</div>
      <div class="cname">${c.name}</div>
      <div class="cweap">「${c.weaponName}」</div>
      <div class="cstat">HP <b>${c.hp}</b> · 공격 <b>${c.atk}</b><br>치명타 <b>${Math.round(c.crit * 100)}%</b><br>${info[k]}</div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.ccard').forEach(card => card.onclick = () => {
    selectedCls = card.dataset.cls;
    grid.querySelectorAll('.ccard').forEach(c => c.classList.toggle('sel', c.dataset.cls === selectedCls));
  });
  $('startBtn').onclick = submit;
  function submit() {
    let n = $('nameInput').value.trim().slice(0, 12);
    if (!n) n = '모험가' + Math.floor(rand(1000, 9999));
    $('create').style.display = 'none';
    $('loading').style.display = 'flex';
    $('loading').textContent = '월드에 접속 중...';
    resolve({ name: n, cls: selectedCls });
  }
  $('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

function showCreateUI() {
  return new Promise(resolve => {
    $('loading').style.display = 'none';
    $('create').style.display = 'flex';
    if (googleName) $('nameInput').value = googleName.slice(0, 12);
    $('nameInput').focus();
    buildCreateUI(resolve);
  });
}

function waitForLoginClick() {
  return new Promise((resolve, reject) => {
    $('loading').style.display = 'none';
    let scr = $('loginScreen');
    if (!scr) {
      scr = document.createElement('div');
      scr.id = 'loginScreen';
      scr.innerHTML = '<h1>미니 MMORPG</h1><button id="googleLoginBtn">🅶 Google로 계속하기</button>';
      document.body.appendChild(scr);
    }
    scr.style.display = 'flex';
    const btn = $('googleLoginBtn');
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = '로그인 창 여는 중...';
      scr.style.display = 'none';
      $('loading').style.display = 'flex';
      $('loading').textContent = '구글 로그인 중...';
      try {
        resolve(await signInWithPopup(auth, new GoogleAuthProvider()).then(c => c.user));
      } catch (e) {
        if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) {
          try {
            $('loading').textContent = '구글 로그인 페이지로 이동 중...';
            await setPersistence(auth, browserLocalPersistence);
            await signInWithRedirect(auth, new GoogleAuthProvider());
            return;
          } catch (e2) { e = e2; }
        }
        btn.disabled = false;
        btn.innerHTML = '<span style="font-size:20px;">🅶</span>&nbsp; Google로 계속하기';
        reject(e);
      }
    };
  });
}

/* ================= 시작 ================= */
setInterval(() => { if (uid && meRef) updateDoc(meRef, { lastSeen: Date.now() }).catch(() => {}); }, 15000);
setInterval(() => {
  let n = 1;
  for (const [, o] of Object.entries(others)) if (Date.now() - (o.lastSeen || 0) < OFFLINE_MS) n++;
  const el = $('ocN');
  if (el) el.textContent = n;
}, 1000);

window.addEventListener('error', ev => {
  const el = $('loading');
  if (el && el.style.display !== 'none' && !String(ev.message).includes('favicon')) {
    el.style.display = 'flex';
    el.innerHTML = '오류 발생: ' + esc(ev.message || String(ev)) +
      '<br><br><a href="javascript:location.reload()" style="color:#7fc7ff">새로고침</a>';
  }
});

async function init() {
  try {
    await setPersistence(auth, browserLocalPersistence);
    await getRedirectResult(auth);
  } catch (e) { /* 저장소 차단 환경 - 무시 */ }
  let user = await new Promise(resolve => {
    const un = onAuthStateChanged(auth, u => { un(); resolve(u); });
  });
  if (!user) {
    if (location.search.includes('dev=1')) {
      $('loading').textContent = '테스트 계정으로 접속 중...';
      const cred = await signInAnonymously(auth);
      user = cred.user;
      googleName = '테스터';
    } else {
      try {
        user = await waitForLoginClick();
      } catch (e) {
        $('loading').innerHTML =
          '구글 로그인 실패: ' + esc(e.code || e.message) +
          '<br><br>확인: Firebase 콘솔 &gt; Authentication &gt; 로그인 방법에서 <b>Google 사용</b>, ' +
          '설정 &gt; 승인된 도메인에 <b>rpg.sanghak.kr</b> 등록' +
          '<br><br><a href="javascript:location.reload()" style="color:#7fc7ff">다시 시도</a>';
        return;
      }
    }
  }
  uid = user.uid;
  googleName = user.displayName || '';
  meRef = doc(db, 'players', uid);

  const snap = await getDoc(meRef);
  if (!snap.exists()) {
    const choice = await showCreateUI();
    myName = choice.name;
    myCls = choice.cls;
    const c = CLASSES[choice.cls];
    await setDoc(meRef, {
      name: myName, cls: choice.cls, x: SPAWN.x, y: SPAWN.y,
      lv: 1, exp: 0, hp: c.hp, maxHp: c.hp, atk: c.atk,
      gold: 100, inv: {}, equipped: {}, skills: {}, q: {}, qc: {},
      dead: false, color: colorOf(uid), map: 'p1', conq: {}, statPts: 0, lastSeen: Date.now(), mp: maxMpOf(),
    });
    me = { ...me, cls: choice.cls, map: 'p1', gold: 100, hp: c.hp, maxHp: c.hp, atk: c.atk }; /* 스냅샷 도착 전 로컬 동기화 */
    await sysMsg(`${myName}(${c.name})님이 월드에 입장했습니다.`);
  } else {
    const d = snap.data();
    myName = d.name;
    myCls = d.cls || 'warrior';
    muted = !!d.muted;
    if (!d.cls) await updateDoc(meRef, { cls: 'warrior' });
    /* 문서 전체를 지금 병합해야 아래 ensurePage/watchMonsters가 올바른 구역(me.map)을 본다
       — onSnapshot 병합만 믿으면 p2+에서 재접속 시 p1 몬스터를 구독해 현재 구역이 텅 빔 */
    const { x: _x, y: _y, hp: _hp, ...rest } = d;
    me = { ...me, ...rest };
    me.dead = false; /* DB에도 아래에서 dead:false로 기록 */
    me.x = Number.isFinite(d.x) ? d.x : SPAWN.x;
    me.y = Number.isFinite(d.y) ? d.y : SPAWN.y;
    me.hp = Number.isFinite(d.hp) ? clampN(d.hp, 1, maxHpOf()) : maxHpOf(); /* 저장된 HP 복원(이전엔 항상 기본값 100) */
    cam.x = me.x; cam.y = me.y;
    await updateDoc(meRef, { lastSeen: Date.now(), dead: false, ...(d.mp == null ? { mp: maxMpOf() } : {}) });
  }

  await ensureWorld();
  await ensureWorldM2();
  await ensurePage(pageNum());

  onSnapshot(meRef, s => {
    if (!s.exists()) return;
    const d = s.data();
    /* x/y/hp/mp/lastHurtAt는 로컬이 권위 — 자기 쓰기 에코가 이동/재생을 되돌리는 것 방지
       (이전의 '장착템=가방템 중복 제거' 클리너는 정당한 동일 아이템 사본까지 파괴해 제거함) */
    const { x, y, hp, mp, lastHurtAt, ...rest } = d;
    me = { ...me, ...rest };
    renderInvUI();
  });

  watchPlayers();
  watchMonsters();
  watchLoot();
  watchChat();
  watchRank();

  ready = true;
  loginAt = Date.now();
  window.__DBG = () => ({ page: myPage(), me: { x: Math.round(me.x), y: Math.round(me.y), lv: me.lv, map: me.map, bag: me.bagSize, conq: JSON.stringify(me.conq || {}) },
    sims: sims.filter(s => s.alive).slice(0, 20).map(s => ({ id: s.id, x: Math.round(s.x), y: Math.round(s.y), d: Math.round(Math.hypot(s.x - me.x, s.y - me.y)), boss: s.boss, lv: simLevel(s) })) });
  $('loading').style.display = 'none';
  document.querySelector(`.stbtn[data-st="${cdef().rec}"]`)?.classList.add('rec');
  if (isMobileUI()) toast('💡 아이템은 가까이 가면 자동으로 줍습니다');
  const mn = $('mapName');
  if (mn) mn.textContent = pageDef(pageNum()).name;
  renderInvUI();
}

buildWorld();

document.querySelectorAll('#invPanel h3.tog').forEach(h => {
  const g = $(h.dataset.tog);
  if (innerWidth <= 640) { g.classList.add('collapsed'); h.classList.add('closed'); }
  h.onclick = () => { g.classList.toggle('collapsed'); h.classList.toggle('closed'); sfx('click'); };
});

/* 몬스터 로드 실패 화면 경고 + 디버그 오버레이 */
let noMonWarned = false;
setInterval(() => {
  if (ready && Date.now() - loginAt > 12000 && !sims.some(s => s.alive) && !noMonWarned) {
    noMonWarned = true;
    toast('⚠️ 몬스터 로드 안 됨' + (monErr ? ' — ' + esc(monErr) : '') + ' — URL에 &dbg=1', 'sysq');
  }
  if (sims.some(s => s.alive)) noMonWarned = false;
}, 5000);
if (location.search.includes('dbg=1')) {
  const dv = document.createElement('div');
  dv.style.cssText = 'position:fixed;bottom:4px;right:4px;z-index:99999;background:rgba(0,0,0,.85);color:#4f4;font:11px monospace;padding:6px 8px;white-space:pre;pointer-events:none;border-radius:6px;';
  document.body.appendChild(dv);
  setInterval(() => {
    dv.textContent = `ready:${ready} map:${me.map || '?'}\nsims:${sims.length} alive:${sims.filter(s => s.alive).length}\nloot:${Object.keys(lootItems).length} players:${1 + Object.keys(others).length}\nloopErr:${loopErrMsg || '-'}\nmonErr:${monErr || '-'}`;
  }, 800);
}

init().catch(err => {
  $('loading').textContent = '초기화 실패: ' + err.message +
    '\n\nFirebase 콘솔에서 확인하세요:\n1. Authentication > Google 로그인 사용\n2. Cloud Firestore 생성\n3. 보안 규칙에서 로그인 사용자 읽기/쓰기 허용';
});

requestAnimationFrame(loop);
