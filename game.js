import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInWithPopup, GoogleAuthProvider, signInAnonymously, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
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
const OFFLINE_MS = 12000;
const BASE_BAG = 18, MAX_BAG = 36;
const bagSize = () => Math.min(MAX_BAG, me.bagSize || BASE_BAG);
const bagUpCost = () => 500 * Math.pow(2, (bagSize() - BASE_BAG) / 6);
const MAX_SKILL_LV = 5;

const CLASSES = {
  warrior: { name: '전사',   icon: '⚔', weaponName: '장검',   hp: 160, atk: 13, speed: 230, range: 95,  atkCd: 520, crit: .05, color: '#e74c3c', melee: true },
  archer:  { name: '아처',   icon: '🏹', weaponName: '활',     hp: 110, atk: 11, speed: 255, range: 290, atkCd: 560, crit: .10, color: '#27ae60', proj: 'arrow' },
  rogue:   { name: '로그',   icon: '🗡', weaponName: '단검',   hp: 95,  atk: 9,  speed: 290, range: 66,  atkCd: 300, crit: .25, color: '#f39c12', melee: true },
  mage:    { name: '마법사', icon: '🪄', weaponName: '지팡이', hp: 85,  atk: 18, speed: 225, range: 270, atkCd: 850, crit: .05, color: '#9b59b6', proj: 'bolt' },
};
const CLASS_ORDER = ['warrior', 'archer', 'rogue', 'mage'];

const MONSTER_TYPES = {
  slime:  { name: '슬라임', hp: 35,  atk: 6,  speed: 45,  exp: 12, gold: 15, r: 16, color: '#2ecc71', aggro: 160, respawn: 8000,  range: 42 },
  goblin: { name: '고블린', hp: 70,  atk: 11, speed: 70,  exp: 28, gold: 35, r: 18, color: '#e67e22', aggro: 200, respawn: 9000,  range: 46 },
  wolf:   { name: '늑대',   hp: 130, atk: 18, speed: 105, exp: 55, gold: 70, r: 20, color: '#95a5a6', aggro: 260, respawn: 10000, range: 50 },
};
const SPAWN_ZONES = [
  { type: 'slime',  count: 8, cx: 350,  cy: 900, spread: 240 },
  { type: 'goblin', count: 6, cx: 1100, cy: 800, spread: 220 },
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
const pageExp = n => 1 + (n - 1) * .6;
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
  potion:        { name: 'HP 물약',   heal: 50, color: '#e74c3c', rarity: 'common' },
  crown_slime:   { name: '슬라임 킹의 왕관', slot: 'helmet', def: 8, spd: 10, color: '#2ecc71', rarity: 'unique' },
  club_chief:    { name: '고블린 대장의 몽둥이', slot: 'weapon', atk: 20, color: '#8a6b45', rarity: 'unique' },
  fang_neck:     { name: '알파 늑대의 송곳니', slot: 'necklace', atk: 9, crit: .06, color: '#e8e4d8', rarity: 'unique' },
  knight_sword:  { name: '해골 기사의 검', slot: 'weapon', atk: 24, def: 4, color: '#e8e4d8', rarity: 'unique' },
  orb_lich:      { name: '리치의 마구', slot: 'ring', atk: 12, crit: .10, color: '#8b6bff', rarity: 'unique' },
};

function getItem(id) {
  const plus = String(id).indexOf('+');
  if (plus < 0) return ITEMS[id] || { name: id, rarity: 'common' };
  const baseId = String(id).slice(0, plus);
  const base = ITEMS[baseId];
  const lv = +String(id).slice(plus + 1) || 0;
  if (!base) return { name: id, rarity: 'common' };
  const m = 1 + lv * .25;
  const out = { ...base, name: base.name + ' +' + lv, _lv: lv, _base: baseId };
  if (base.atk) out.atk = Math.round(base.atk * m);
  if (base.def) out.def = Math.round(base.def * m);
  if (base.heal) out.heal = Math.round(base.heal * (1 + lv * .15));
  if (base.crit) out.crit = +(base.crit + lv * .01).toFixed(3);
  if (base.spd) out.spd = Math.round(base.spd * m);
  return out;
}
const RARITY_KR = { common: '일반', uncommon: '고급', rare: '희귀', epic: '영웅', legend: '전설', unique: '유니크' };
const RARITY_COLOR = { common: '#aaa', uncommon: '#2ecc71', rare: '#3498db', epic: '#9b59b6', legend: '#ffd700', unique: '#ff4d4d' };
const DROP_TABLE = {
  slime:  [['potion', .30], ['sword_wood', .15], ['pants_cloth', .10], ['cap_cloth', .10], ['boots_cloth', .08], ['gloves_cloth', .08], ['bracelet_wood', .06]],
  goblin: [['potion', .25], ['sword_iron', .12], ['armor_cloth', .12], ['gloves_leather', .10], ['cap_leather', .10], ['pants_leather', .10], ['necklace_copper', .08]],
  wolf:   [['potion', .30], ['armor_leather', .12], ['boots_leather', .12], ['gloves_leather', .10], ['ring_leather', .08]],
  boss:   [['sword_flame', 1], ['armor_plate', 1], ['pants_plate', .8], ['crown_gold', .8], ['gloves_steel', .8], ['boots_wind', .8], ['bracelet_jade', .8], ['necklace_ruby', .8], ['ring_shadow', .8]],
  skeleton: [['potion', .30], ['sword_iron', .10], ['armor_leather', .10], ['boots_wind', .05], ['necklace_ruby', .04]],
  lich:   [['crown_gold', 1], ['ring_shadow', 1], ['sword_flame', .7], ['armor_plate', .7], ['potion', .5]],
};

const SKILLS = {
  power_strike: { cls: 'warrior', icon: '💥', name: '강타',         desc: '즉시 강력한 일격 (공격력 400%)',              type: 'active', cd: 6000,  cost: 400 },
  warcry:       { cls: 'warrior', icon: '🔥', name: '전투의 함성',   desc: '공격력 영구 증가 (+3)',                        type: 'passive', atk: 3,   cost: 500 },
  iron_body:    { cls: 'warrior', icon: '🛡', name: '철벽',         desc: '방어력 영구 증가 (+2)',                        type: 'passive', def: 2,   cost: 450 },
  multishot:    { cls: 'archer',  icon: '🎯', name: '다중 사격',     desc: '주변 모든 적 타격 (공격력 150%)',              type: 'active', cd: 8000,  cost: 450 },
  sharpshooter: { cls: 'archer',  icon: '🔭', name: '정밀 조준',     desc: '공격력 영구 증가 (+3)',                        type: 'passive', atk: 3,   cost: 500 },
  swift_feet:   { cls: 'archer',  icon: '👟', name: '민첩',         desc: '이동속도 증가 (+15)',                          type: 'passive', spd: 15,  cost: 400 },
  shadow_strike:{ cls: 'rogue',   icon: '🌑', name: '그림자 일격',   desc: '단일 처형 일격 (공격력 600%, 필중 크리티컬)',  type: 'active', cd: 7000,  cost: 450 },
  assassination:{ cls: 'rogue',   icon: '🔪', name: '암살 본능',     desc: '치명타 확률 증가 (+7%p)',                      type: 'passive', crit: .07, cost: 550 },
  swift_feet2:  { cls: 'rogue',   icon: '👟', name: '신속',         desc: '이동속도 증가 (+15)',                          type: 'passive', spd: 15,  cost: 400 },
  fireball:     { cls: 'mage',    icon: '☄', name: '화염구',       desc: '광역 폭발 피해 (공격력 220%)',                 type: 'active', cd: 9000,  cost: 500 },
  magic_power:  { cls: 'mage',    icon: '📖', name: '마력 강화',     desc: '공격력 영구 증가 (+4)',                        type: 'passive', atk: 4,   cost: 550 },
  mana_shield:  { cls: 'mage',    icon: '🔮', name: '마나 보호막',   desc: '방어력 영구 증가 (+2)',                        type: 'passive', def: 2,   cost: 450 },
  heal:         { cls: 'all',     icon: '💚', name: '회복술',       desc: '최대 HP의 40% 즉시 회복',                      type: 'active', cd: 20000, cost: 800 },
};
const POTION_COST = 50;
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
const expNeed = lv => Math.floor(25 * Math.pow(lv, 2.2));
const maxHpOf = () => Math.round(cdef().hp + ((me.lv || 1) - 1) * 10 + (me.stHp || 0) * 15);
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
  const items = [];
  for (let i = 0; i < 40; i++) {
    const id = inv[String(i)];
    if (id) items.push(id);
  }
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
let muted = localStorage.getItem('mmorpg_mute') === '1';
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
  localStorage.setItem('mmorpg_mute', muted ? '1' : '0');
  toast(muted ? '🔇 소리 끔' : '🔊 소리 켬');
}

/* ================= 상태 ================= */
let uid = null, myName = '', meRef = null, myCls = 'warrior', googleName = '';
let me = { x: SPAWN.x, y: SPAWN.y, lv: 1, exp: 0, hp: 100, maxHp: 100, atk: 10, gold: 0, inv: {}, equipped: {}, skills: {}, q: {}, qc: {}, dead: false };
let others = {}, lootItems = {};
let sims = [], bossWasAlive = true;
let keys = {};
let cam = { x: SPAWN.x, y: SPAWN.y };
let floats = [], slashes = [], shots = [], rings = [], poofs = [];
let othersPrev = {}, mePrev = { x: SPAWN.x, y: SPAWN.y }, meMovingNow = false;
let mouseDown = false, dest = null, attackTargetSimId = null;
const view = { x: 0, y: 0 };
let lastAttackAt = 0, lastPosWrite = 0, hurtUntil = 0, picking = false;
let ready = false;
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
const totalCrit = () => cdef().crit + passSum('crit') + eqStats('crit');
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
  const p = $('invPanel');
  if (!p) return;
  p.classList.remove('flash');
  void p.offsetWidth;
  p.classList.add('flash');
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
  if ((await getDoc(flag)).exists()) return;
  const pd = pageDef(n);
  const batch = writeBatch(db);
  const zones = [{ cx: 450, cy: 300, spread: 200 }, { cx: 1150, cy: 850, spread: 200 }];
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
    def = { name: k.name, hp: d.maxHp || d.hp || 100, maxHp: d.maxHp || d.hp || 100, atk: 10, exp: 10, gold: 10,
      r: KIND_BASE[k.base].r * (d.boss ? 1.2 : 1), aggro: KIND_BASE[k.base].aggro,
      speed: KIND_BASE[k.base].speed, respawn: KIND_BASE[k.base].respawn, range: KIND_BASE[k.base].range };
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
  return { id, type, page: isPage ? d.page : (id.startsWith('m2') ? 'm2' : 'm1'), boss: !!d.boss, sprId, uniq: !!d.uniq, def,
    x: d.homeX, y: d.homeY, wa: rand(0, Math.PI * 2), nextWander: 0, atkCdUntil: 0, alive: !!d.alive,
    hp: typeof d.hp === 'number' ? d.hp : def.hp, maxHp: def.maxHp, respawnAt: d.respawnAt || 0,
    dirA: Math.PI / 2, movingF: false, aggroF: false, blink: rand(0, 4000) };
}

function sdef(s) {
  if (s.maxHp && s.def.hp !== s.maxHp) s.def.hp = s.maxHp;
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
function watchMonsters() {
  if (unsubMon) unsubMon();
  sims = [];
  othersPrev = {};
  unsubMon = onSnapshot(query(collection(db, 'monsters'), where('page', '==', myPage())), snap => {
    snap.forEach(dc => {
      const d = dc.data();
      let s = sims.find(x => x.id === dc.id);
      if (!s) { s = makeSim(dc.id, d); sims.push(s); }
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
    bossWasAlive = (sims.find(s => s.boss) || { alive: true }).alive;
  });
}

function watchPlayers() {
  onSnapshot(collection(db, 'players'), snap => {
    snap.forEach(dc => { if (dc.id !== uid) others[dc.id] = dc.data(); });
  });
}

function watchLoot() {
  onSnapshot(collection(db, 'loot'), snap => {
    lootItems = {};
    snap.forEach(dc => lootItems[dc.id] = dc.data());
  });
}

function watchRank() {
  onSnapshot(query(collection(db, 'players'), orderBy('lv', 'desc'), limit(10)), snap => {
    const rows = [];
    let i = 0;
    snap.forEach(dc => {
      const p = dc.data();
      i++;
      const medal = ['🥇', '🥈', '🥉'][i - 1] || `${i}`;
      rows.push(`<div><span style="color:#889">${medal}</span> ${esc(p.name || '?')} <b style="color:#ffd700">Lv${p.lv || 1}</b> <span style="color:#667">${CLASSES[p.cls]?.icon || ''}</span></div>`);
    });
    const el = $('rankList');
    if (el) el.innerHTML = rows.join('');
  }, () => {});
}

function watchChat() {
  const log = $('chatLog');
  onSnapshot(query(collection(db, 'chat'), orderBy('ts', 'desc'), limit(40)), snap => {
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
  let lv = p.lv || 1, exp = (p.exp || 0) + expGain, leveled = 0;
  while (lv < 100 && exp >= expNeed(lv)) { exp -= expNeed(lv); lv++; leveled++; }
  const upd = { exp, lv };
  if (leveled) upd.statPts = (p.statPts || 0) + 3 * leveled;
  return { upd, leveled, nlv: lv };
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
    if (leveled) setTimeout(() => {
      float(me.x, me.y - 52, `LEVEL UP! Lv ${nlv}`, '#ffd700', true);
      toast(`✨ 레벨업! 스탯 포인트 +${3 * leveled} (좌측 상단에서 분배)`, 'sysq');
      rings.push({ x: me.x, y: me.y, r: 90, t: 0, max: 600, color: '255,215,0' });
      fxSparks(me.x, me.y, 22, '#ffd700', 180);
      sfx('levelup');
      sysMsg(`${myName}님이 Lv ${nlv} 달성!`);
    }, 0);
  }).catch(() => {});
}

const UNIQ_DROPS = {
  slime: ['crown_slime'], goblin: ['club_chief'], wolf: ['fang_neck'],
  skeleton: ['knight_sword'], boss: ['ring_shadow'], lich: ['orb_lich'],
};

function rollDrops(type) {
  return (DROP_TABLE[type] || []).filter(([, p]) => Math.random() < p).map(([id]) => id);
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
  await gainExp(d2.exp, { type: sim.type, gold });
  dropLoot(sim.type, sim.x, sim.y);
  if (sim.boss && sim.page && sim.page.startsWith('p')) {
    const pn2 = +sim.page.slice(1);
    if (!(me.conq || {})[pn2]) {
      updateDoc(meRef, { ['conq.' + pn2]: true }).catch(() => {});
      toast(`👑 ${pn2}구역 정복! ${pn2 < MAX_PAGE ? (pn2 + 1) + '구역 개방' : '모든 지역 정복 완료!'}`, 'sysq');
      sysMsg(`👑 ${myName}님이 ${pn2}구역을 정복했습니다!`, 'q');
      sfx('levelup');
    }
  }
  if (sim.uniq) {
    for (const itemId of (UNIQ_DROPS[sim.type] || [])) {
      await addDoc(collection(db, 'loot'), { itemId, x: sim.x + rand(-20, 20), y: sim.y + rand(-20, 20), map: myMap(), ts: Date.now() }).catch(() => {});
    }
    sysMsg(`★ 유니크 ${d2.name} 처치! 유니크 아이템 드롭! 🔥`, 'q');
    toast(`★ 유니크 아이템 드롭!`, 'sysq');
  }
  sysMsg(`${myName}님이 ${d2.name}을(를) 처치했습니다!${sim.type === 'boss' || sim.type === 'lich' ? ' 👑👑👑' : ''}`);
}

async function attackResult(sim, dmg, crit) {
  const r = await dealDamage(sim, dmg);
  if (r === null || r === undefined) return;
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

function stepToward(pt, sp) {
  me.face = Math.atan2(pt.y - me.y, pt.x - me.x);
  const d = Math.hypot(pt.x - me.x, pt.y - me.y) || 1;
  me.x = clampN(me.x + (pt.x - me.x) / d * sp, 40, WORLD.w - 40);
  me.y = clampN(me.y + (pt.y - me.y) / d * sp, 40, WORLD.h - 40);
}

function fireShot(tx, ty, color, dur, size = 5) {
  const d = Math.hypot(tx - me.x, ty - me.y) || 1;
  shots.push({ x: me.x, y: me.y, vx: (tx - me.x) / d * 520, vy: (ty - me.y) / d * 520, t: 0, max: dur, color, size });
}

function tryAttack(now, forced = null) {
  if (!ready || me.dead) return;
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
    sfx(myCls === 'archer' ? 'swing' : 'potion');
  }
  if (!target) return;
  const crit = Math.random() < totalCrit();
  const dmg = Math.max(1, Math.round(totalAtk() * rand(.85, 1.15) * (crit ? 1.6 : 1)));
  attackResult(target, dmg, crit);
}

function useSkill(slot) {
  if (!ready || me.dead) return;
  const now = Date.now();
  const id = slot === 2 ? 'heal' : classActiveId();
  if (!id) return;
  const def = SKILLS[id];
  if (skillLv(id) < 1) { float(me.x, me.y - 34, '미습득 스킬 (B: 샵)', '#aaa'); return; }
  if (now < (skillCdUntil[id] || 0)) return;

  if (id === 'heal') {
    const amt = Math.round(me.maxHp * .4);
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
    attackResult(t, Math.max(1, Math.round(totalAtk() * 4 * rand(.9, 1.1))), true);
  } else if (id === 'multishot') {
    const targets = sims.filter(s => s.alive && Math.hypot(s.x - me.x, s.y - me.y) < 240);
    if (!targets.length) { float(me.x, me.y - 34, '대상 없음', '#aaa'); return; }
    for (const t of targets) {
      fireShot(t.x, t.y, '#e8d9a0', Math.hypot(t.x - me.x, t.y - me.y) / 520 * 1000 + 60, 4);
      const dmg = Math.max(1, Math.round(totalAtk() * 1.5 * rand(.9, 1.1)));
      setTimeout(() => attackResult(t, dmg, false), 140);
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
    attackResult(t, Math.max(1, Math.round(totalAtk() * 6)), true);
  } else if (id === 'fireball') {
    const t = nearestSim(340);
    if (!t) { float(me.x, me.y - 34, '대상 없음', '#aaa'); return; }
    fireShot(t.x, t.y, '#ff7f27', Math.hypot(t.x - me.x, t.y - me.y) / 520 * 1000, 10);
    setTimeout(() => {
      rings.push({ x: t.x, y: t.y, r: 150, t: 0, max: 500, color: '255,90,0' });
      rings.push({ x: t.x, y: t.y, r: 90, t: 0, max: 350, color: '255,200,60' });
      fxSparks(t.x, t.y, 24, '#ff7f27', 220);
      doShake(9); sfx('boom');
      const victims = sims.filter(s => s.alive && Math.hypot(s.x - t.x, s.y - t.y) < 145);
      for (const v of victims) {
        const dmg = Math.max(1, Math.round(totalAtk() * 2.2 * rand(.9, 1.1)));
        attackResult(v, dmg, false);
      }
    }, 240);
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
        <div class="sd">${esc(d.desc)}${d.cd ? ` · 재사용 ${d.cd / 1000}s` : ''}</div>
      </div>
      ${maxed ? `<button class="buyBtn" disabled>MAX</button>`
              : `<button class="buyBtn" data-buy="${id}" ${afford ? '' : 'disabled'}>${cost} G</button>`}
    </div>`;
  }).join('');
  const affordP = (me.gold || 0) >= POTION_COST;
  const bagFull = Object.keys(me.inv || {}).length >= bagSize();
  html += `<div class="srow">
      <div class="si">🧪</div>
      <div class="sm">
        <div><span class="st">HP 물약</span><span class="slv">HP +50 회복</span></div>
        <div class="sd">가방에 담아 클릭하면 사용 (${bagFull ? '가방 가득 참' : `${Object.keys(me.inv || {}).length}/${bagSize()}`})</div>
      </div>
      <button class="buyBtn" id="buyPotion" ${affordP && !bagFull ? '' : 'disabled'}>${POTION_COST} G</button>
    </div>`;
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
  const bp = $('buyPotion');
  if (bp) bp.onclick = buyPotion;
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

function buyPotion() {
  runTransaction(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return false;
    const p = snap.data();
    if ((p.gold || 0) < POTION_COST) return false;
    const bs = p.bagSize || 18;
    if (Object.keys(p.inv || {}).length >= bs) return false;
    const inv = { ...(p.inv || {}) };
    for (let i = 0; i < bs; i++) {
      if (inv[String(i)] == null) { inv[String(i)] = 'potion'; break; }
    }
    tx.update(meRef, { gold: p.gold - POTION_COST, inv: sortInvMap(inv) });
    return true;
  }).then(ok => {
    if (ok) { sfx('buy'); toast('🧪 HP 물약 구매'); flashInv(); renderShop(); }
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
    it.heal ? `HP+${it.heal} 회복` : ''].filter(Boolean).join(' · ');
}

async function pickup(lid, l) {
  if (picking) return;
  picking = true;
  try {
    let item = null;
    await runTransaction(db, async tx => {
      const ref = doc(db, 'loot', lid);
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      item = snap.data();
      tx.delete(ref);
    });
    if (!item) return;
    const res = await addToInv(item.itemId);
    if (res === null) { float(me.x, me.y - 30, '가방이 가득 참', '#e74c3c'); toast('🎒 가방이 가득 찼습니다'); return; }
    const it = getItem(item.itemId);
    sfx('pickup');
    flashInv();
    if (res === 'equipped') toast(`${SLOT_ICONS[it.slot] || '📦'} <b style="color:${it.color}">${esc(it.name)}</b> 획득 → <b>자동 장착!</b> <span style="color:#8aa">[${RARITY_KR[it.rarity] || '일반'}]</span>`, 'sysq');
    else toast(`${SLOT_ICONS[it.slot] || '📦'} <b style="color:${it.color}">${esc(it.name)}</b> 획득 <span style="color:#8aa">[${RARITY_KR[it.rarity] || '일반'}]</span> → 가방 <b>${Object.keys(me.inv || {}).length}/${bagSize()}</b>`);
    float(me.x, me.y - 30, `+ ${it.name}`, it.color);
  } finally { picking = false; }
}

function addToInv(itemId) {
  return runTransaction(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return null;
    const p = snap.data();
    const bs = p.bagSize || 18;
    const inv = { ...(p.inv || {}) };
    const eq = { ...(p.equipped || {}) };
    const it = ITEMS[itemId];
    let result = false;
    for (let i = 0; i < bs; i++) {
      if (inv[String(i)] == null) {
        inv[String(i)] = itemId;
        const q = { ...(p.q || {}) };
        q.items = (q.items || 0) + 1;
        const upd = { q };
        if (it.slot && !eq[it.slot]) {
          eq[it.slot] = itemId;
          upd.equipped = eq;
          upd['q.eqflag'] = 1;
          result = 'equipped';
        } else result = 'added';
        upd.inv = sortInvMap(inv);
        tx.update(meRef, upd);
        return result;
      }
    }
    return null;
  }).catch(() => null);
}

function slotClick(idx) {
  runTransaction(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return;
    const p = snap.data();
    const inv = { ...(p.inv || {}) };
    const eq = { ...(p.equipped || {}) };
    const itemId = inv[String(idx)];
    if (!itemId) return;
    const it = getItem(itemId);
    if (it.heal) {
      const nhp = Math.min(maxHpOf(), (me.hp || 0) + it.heal);
      delete inv[String(idx)];
      tx.update(meRef, { inv, hp: nhp });
      setTimeout(() => {
        me.hp = nhp;
        hpDirty = true;
        float(me.x, me.y - 30, `+${it.heal} HP`, '#2ecc71');
        rings.push({ x: me.x, y: me.y, r: 50, t: 0, max: 350, color: '46,204,113' });
        sfx('potion');
      }, 0);
    } else {
      const old = eq[it.slot];
      eq[it.slot] = itemId;
      if (old) inv[String(idx)] = old; else delete inv[String(idx)];
      tx.update(meRef, { inv: sortInvMap(inv), equipped: eq, 'q.eqflag': 1 });
      setTimeout(() => sfx('buy'), 0);
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
    for (let i = 0; i < bs; i++) {
      if (inv[String(i)] == null) { inv[String(i)] = itemId; break; }
    }
    delete eq[slot];
    tx.update(meRef, { inv: sortInvMap(inv), equipped: eq });
  }).catch(() => {});
}

function enhanceItem(idx) {
  runTransaction(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return null;
    const p = snap.data();
    const inv = { ...(p.inv || {}) };
    const eq = { ...(p.equipped || {}) };
    const id = inv[String(idx)];
    if (!id) return null;
    const it = getItem(id);
    if (it.heal) return 'potion';
    const lv = it._lv || 0;
    const rMul = it.rarity === 'unique' ? 4 : it.rarity === 'legend' ? 3 : it.rarity === 'epic' ? 2 : 1;
    const cost = 300 * (lv + 1) * rMul;
    if ((p.gold || 0) < cost) return 'poor';
    const chance = clampN(92 - lv * 8, 25, 92);
    let equippedSlot = null;
    for (const [sl, eid] of Object.entries(eq)) if (eid === id) equippedSlot = sl;
    let result;
    if (Math.random() * 100 < chance) {
      const nid = it._base + '+' + (lv + 1);
      if (equippedSlot) eq[equippedSlot] = nid; else inv[String(idx)] = nid;
      tx.update(meRef, { gold: p.gold - cost, inv: sortInvMap(inv), equipped: eq });
      result = { ok: true, nid };
    } else {
      if (equippedSlot) delete eq[equippedSlot]; else delete inv[String(idx)];
      tx.update(meRef, { gold: p.gold - cost, inv: sortInvMap(inv), equipped: eq });
      result = { ok: false };
    }
    return result;
  }).then(r => {
    if (!r) return;
    if (r === 'poor') { toast('💰 골드가 부족합니다'); return; }
    if (r === 'potion') { toast('소모품은 강화할 수 없습니다'); return; }
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

function renderInvUI() {
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
      div.dataset.r = it.rarity || 'common';
      div.innerHTML = `<span class="ic">${SLOT_ICONS[it.slot] || '🧪'}</span>`;
      div.title = `${it.name} [${RARITY_KR[it.rarity] || '일반'}]\n${itemStat(it)}\n좌클릭: 장착/사용 · 우클릭: 강화`;
      div.onclick = () => slotClick(String(i));
      div.oncontextmenu = e => { e.preventDefault(); enhanceItem(String(i)); };
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
    for (const t of targets) {
      const d = Math.hypot(t.x - s.x, t.y - s.y);
      if (d < s.def.aggro && d < best) { best = d; tgt = t; }
    }
    if (tgt) {
      if (best > s.def.range) {
        const sp = s.def.speed * dt / 1000;
        s.dirA = Math.atan2(tgt.y - s.y, tgt.x - s.x);
        s.movingF = true;
        s.aggroF = true;
        s.x = clampN(s.x + (tgt.x - s.x) / best * sp, 40, WORLD.w - 40);
        s.y = clampN(s.y + (tgt.y - s.y) / best * sp, 40, WORLD.h - 40);
      } else if (now >= s.atkCdUntil) {
        s.atkCdUntil = now + (s.type === 'boss' ? 1800 : 1300);
        s.swingT = now;
        if (tgt.mine) monsterHitMe(s, now);
      }
    } else {
      if (now >= s.nextWander) { s.nextWander = now + rand(1200, 3000); s.wa = rand(0, Math.PI * 2); }
      const sp = s.def.speed * .45 * dt / 1000;
      s.dirA = s.wa;
      s.movingF = true;
      s.aggroF = false;
      s.x = clampN(s.x + Math.cos(s.wa) * sp, 40, WORLD.w - 40);
      s.y = clampN(s.y + Math.sin(s.wa) * sp, 40, WORLD.h - 40);
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
  const stone = (x, y, w, h) => {
    const g = c.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#7d8790'); g.addColorStop(1, '#565f68');
    c.fillStyle = g;
    c.fillRect(x, y, w, h);
    c.strokeStyle = 'rgba(0,0,0,.35)';
    c.strokeRect(x + .5, y + .5, w - 1, h - 1);
    c.fillStyle = 'rgba(255,255,255,.14)';
    c.fillRect(x + 2, y + 2, w - 4, 3);
  };
  for (let x = 0; x < WORLD.w; x += 40) { stone(x, 0, 38, 26); stone(x + 20, WORLD.h - 26, 38, 26); }
  for (let y = 26; y < WORLD.h - 26; y += 40) { stone(0, y, 26, 38); stone(WORLD.w - 26, y + 20, 26, 38); }
  c.fillStyle = 'rgba(0,0,0,.22)';
  c.fillRect(26, 26, WORLD.w - 52, 8);
  c.fillRect(26, 26, 8, WORLD.h - 52);
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
  const stone = (x, y, w, h) => {
    const g = c.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#6d6d7d'); g.addColorStop(1, '#454552');
    c.fillStyle = g;
    c.fillRect(x, y, w, h);
    c.strokeStyle = 'rgba(0,0,0,.4)';
    c.strokeRect(x + .5, y + .5, w - 1, h - 1);
    c.fillStyle = 'rgba(255,255,255,.1)';
    c.fillRect(x + 2, y + 2, w - 4, 3);
  };
  for (let x = 0; x < WORLD.w; x += 40) { stone(x, 0, 38, 26); stone(x + 20, WORLD.h - 26, 38, 26); }
  for (let y = 26; y < WORLD.h - 26; y += 40) { stone(0, y, 26, 38); stone(WORLD.w - 26, y + 20, 26, 38); }
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
  const it = getItem(wid);
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

  const sc = 4, sw2 = 12 * sc, sh2 = 15 * sc;
  ctx.save();
  ctx.translate(o.x, o.y);
  if (o.dead) { ctx.globalAlpha = .45; ctx.rotate(Math.PI / 2); }
  ctx.save();
  if (flip) ctx.scale(-1, 1);
  ctx.imageSmoothingEnabled = false;
  const sy0 = -sh2 + 10 - bobY;
  ctx.drawImage(buildSprite(o.cls || 'warrior').cv, -sw2 / 2, sy0, sw2, sh2);
  const eq = o.equipped || {};
  const px = -sw2 / 2;
  if (eq.helmet) {
    ctx.fillStyle = getItem(eq.helmet).color;
    ctx.globalAlpha = .55;
    ctx.fillRect(px + 1 * sc, sy0 + 1 * sc, 10 * sc, 2.6 * sc);
    ctx.globalAlpha = 1;
  }
  if (eq.armor) {
    ctx.fillStyle = getItem(eq.armor).color;
    ctx.globalAlpha = .72;
    ctx.fillRect(px + 1.2 * sc, sy0 + 7 * sc, 9.6 * sc, 4.6 * sc);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(px + 1.2 * sc, sy0 + 7 * sc, 9.6 * sc, 4.6 * sc);
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.fillRect(px + 2.2 * sc, sy0 + 7.4 * sc, 7.6 * sc, 1.2 * sc);
  }
  if (eq.pants) {
    ctx.fillStyle = getItem(eq.pants).color;
    ctx.globalAlpha = .8;
    ctx.fillRect(px + 1.6 * sc, sy0 + 11.6 * sc, 3.6 * sc, 2.4 * sc);
    ctx.fillRect(px + 6.8 * sc, sy0 + 11.6 * sc, 3.6 * sc, 2.4 * sc);
    ctx.globalAlpha = 1;
  }
  if (eq.boots) {
    ctx.fillStyle = getItem(eq.boots).color;
    ctx.fillRect(px + 1.6 * sc, sy0 + 13 * sc, 3.8 * sc, 1.6 * sc);
    ctx.fillRect(px + 6.6 * sc, sy0 + 13 * sc, 3.8 * sc, 1.6 * sc);
  }
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
  ctx.fillText(d2.name, s.x, s.y + r + (wide ? 24 : 15));
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
  drawSprite(s.sprId || 'slime', s.x, s.y + 9, s.uniq ? 5 : 4, { squashX: 1 + wob * .07, squashY: 1 - wob * .07, flash, bob: s.movingF ? Math.abs(Math.sin(now / 140 + s.blink)) * 3 : 0 });
  mobUI(s, false);
}
function r0(s) { return sdef(s).r; }

function drawGoblin(s, now) {
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(s.x, s.y + 12, r0(s) * .95, r0(s) * .36, 0, 0, 7); ctx.fill();
  if (s.uniq) uniqAura(s, now);
  const flash = s.hitFlash ? clampN(1 - (now - s.hitFlash) / 150, 0, 1) * .85 : 0;
  drawSprite(s.sprId || 'goblin', s.x, s.y + 11, s.uniq ? 5 : 4, { flash, bob: s.movingF ? Math.abs(Math.sin(now / 110)) * 3 : 0 });
  mobUI(s, false);
}

function drawWolf(s, now) {
  const flip = Math.cos(s.dirA ?? 0) < 0 ? -1 : 1;
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(s.x, s.y + 13, r0(s) * 1.2, r0(s) * .32, 0, 0, 7); ctx.fill();
  if (s.uniq) uniqAura(s, now);
  const flash = s.hitFlash ? clampN(1 - (now - s.hitFlash) / 150, 0, 1) * .85 : 0;
  drawSprite(s.sprId || 'wolf', s.x, s.y + 12, s.uniq ? 5 : 4, { flip: flip < 0, flash, bob: s.movingF ? Math.abs(Math.sin(now / 75)) * 2 : 0 });
  mobUI(s, false);
}

function drawSkeleton(s, now) {
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(s.x, s.y + 12, r0(s) * .9, r0(s) * .34, 0, 0, 7); ctx.fill();
  if (s.uniq) uniqAura(s, now);
  const flash = s.hitFlash ? clampN(1 - (now - s.hitFlash) / 150, 0, 1) * .85 : 0;
  drawSprite(s.sprId || 'skeleton', s.x, s.y + 11, s.uniq ? 5.5 : 4.4, { flash, bob: s.movingF ? Math.abs(Math.sin(now / 120)) * 3 : 0 });
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
  drawSprite(s.sprId || 'lich', s.x, s.y + 16 - fl, s.uniq ? 6 : 5, { flash });
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
  drawSprite(s.sprId || 'orc', s.x, s.y + 16, s.uniq ? 6 : 5, { flash, bob: Math.sin(now / 300) * 2 });

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
function draw(now) {
  const vw = cv.width, vh = cv.height;
  let shx = 0, shy = 0;
  if (shakeT && now - shakeT < 180) {
    const p = (1 - (now - shakeT) / 180) * shakePow;
    shx = rand(-p, p); shy = rand(-p, p);
  } else shakePow = 0;
  const cx = WORLD.w >= vw ? clampN(cam.x - vw / 2, 0, WORLD.w - vw) : (WORLD.w - vw) / 2;
  const cy = WORLD.h >= vh ? clampN(cam.y - vh / 2, 0, WORLD.h - vh) : (WORLD.h - vh) / 2;
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
    const glowCol = it.rarity === 'legend' ? '255,215,0' : it.rarity === 'epic' ? '155,89,182' : it.rarity === 'rare' ? '52,152,219' : '255,255,255';
    const pulse = .35 + Math.sin(now / 250 + l.x) * .2;
    ctx.fillStyle = `rgba(${glowCol},${pulse * .5})`;
    ctx.beginPath(); ctx.arc(l.x, l.y + bob, 14, 0, 7); ctx.fill();
    ctx.save();
    ctx.translate(l.x, l.y + bob);
    ctx.rotate(Math.PI / 4);
    const lg = ctx.createLinearGradient(-8, -8, 8, 8);
    lg.addColorStop(0, shade(it.color, 1.3)); lg.addColorStop(1, shade(it.color, .75));
    ctx.fillStyle = lg;
    ctx.fillRect(-7, -7, 14, 14);
    ctx.strokeStyle = `rgba(${glowCol},.95)`;
    ctx.lineWidth = 2;
    ctx.strokeRect(-7, -7, 14, 14);
    ctx.restore();
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
    if (Date.now() - (o.lastSeen || 0) >= OFFLINE_MS || (o.map || 'm1') !== myMap()) continue;
    const pv = othersPrev[id];
    const mv = pv ? Math.hypot(o.x - pv.x, o.y - pv.y) > .6 : false;
    let fc;
    if (mv) fc = Math.atan2(o.y - pv.y, o.x - pv.x);
    else if (pv?.f != null) fc = pv.f;
    else fc = Math.PI / 2;
    othersPrev[id] = { x: o.x, y: o.y, f: fc };
    drawChar({ x: o.x, y: o.y, color: o.color || colorOf(id), name: o.name, hp: o.hp, maxHp: o.maxHp, dead: o.dead, equipped: o.equipped, cls: o.cls || 'warrior', isSelf: false, face: fc, moving: mv });
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
    mctx.strokeRect(cam.x * k - 48, cam.y * k - 36, 96, 72);
  }
}

/* ================= HUD ================= */
function updateHUD() {
  $('uiLv').textContent = me.lv;
  $('uiCls').textContent = cdef().icon + ' ' + cdef().name;
  $('uiName').textContent = myName;
  $('hpbar').style.width = clampN((me.hp || 0) / maxHpOf() * 100, 0, 100) + '%';
  $('hpText').textContent = `${Math.max(0, Math.ceil(me.hp || 0))} / ${maxHpOf()}`;
  $('expbar').style.width = clampN((me.exp || 0) / expNeed(me.lv) * 100, 0, 100) + '%';
  $('expText').textContent = `EXP ${me.exp || 0} / ${expNeed(me.lv)}`;
  $('uiAtk').textContent = totalAtk();
  $('uiDef').textContent = totalDef();
  $('uiCrit').textContent = Math.round(totalCrit() * 100);
  $('uiSpd').textContent = Math.round(moveSpd());
  $('uiGold').textContent = (me.gold || 0).toLocaleString();
  const pr = $('statPtsRow');
  if (pr) {
    const pts = me.statPts || 0;
    pr.style.display = pts > 0 ? 'flex' : 'none';
    if (pts > 0) $('uiPts').textContent = pts;
  }
}

function updateHotbar(now) {
  const ids = [classActiveId(), 'heal'];
  [['hb1', 0], ['hb2', 1]].forEach(([el, i]) => {
    const box = $(el);
    const id = ids[i];
    const nm = box.querySelector('.nm'), ic = box.querySelector('.ic2'), cdEl = box.querySelector('.cd');
    if (!id) { nm.textContent = '-'; ic.textContent = '?'; return; }
    const def = SKILLS[id];
    ic.textContent = def.icon;
    nm.textContent = def.name;
    box.classList.toggle('locked', skillLv(id) < 1);
    const remain = (skillCdUntil[id] || 0) - now;
    if (remain > 0 && skillLv(id) >= 1) {
      cdEl.style.display = 'flex';
      cdEl.textContent = Math.ceil(remain / 1000);
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

function toggleWorldMap() {
  const el = $('worldMap');
  const open = !el.classList.contains('open');
  el.classList.toggle('open', open);
  if (open) renderWorldMap();
}
const BIO_COLORS = ['#2e8455', '#1f6039', '#c9a227', '#aed6f1', '#4a7a5c', '#c0392b', '#5d656e', '#7d8790', '#6c3483', '#5dade2'];
function renderWorldMap() {
  const grid = $('wmGrid');
  let html = '';
  for (let n = 1; n <= MAX_PAGE; n++) {
    const conq = (me.conq || {})[n];
    const cur = n === pageNum();
    const bio = BIOMES[Math.min(9, Math.floor((n - 1) / 10))];
    const cls = cur ? 'wmcur' : conq ? 'wmconq' : 'wmlock';
    html += `<div class="wmcell ${cls}" data-p="${n}" title="${pageDef(n).name}" style="--bc:${BIO_COLORS[BIOMES.indexOf(bio)]}">${n}</div>`;
  }
  grid.innerHTML = html;
  $('wmInfo').textContent = `정복 ${Object.keys(me.conq || {}).filter(k => me.conq[k]).length} / ${MAX_PAGE} · 현재: ${pageDef(pageNum()).name}`;
  grid.querySelectorAll('.wmcell').forEach(c => c.onclick = () => {
    const n = +c.dataset.p;
    if (n === pageNum()) { toggleWorldMap(); return; }
    if (n === 1 || (me.conq || {})[n]) { toggleWorldMap(); gotoPage(n); }
    else toast('🔒 정복하지 않은 구역입니다');
  });
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
document.querySelectorAll('.stbtn').forEach(b => b.onclick = () => addStat(b.dataset.st));
$('shopBtn').onclick = () => { sfx('click'); togglePanel('shopPanel'); };
$('questBtn').onclick = () => { sfx('click'); togglePanel('questPanel'); };
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $(b.dataset.close).classList.remove('open'));

addEventListener('keydown', e => {
  const typing = document.activeElement === chatInput || document.activeElement === $('nameInput');
  if (e.key === 'Escape') {
    chatInput.blur();
    document.querySelectorAll('.sidepanel').forEach(p => p.classList.remove('open'));
    return;
  }
  if (typing) return;
  if (e.key === 'Enter') { chatInput.focus(); e.preventDefault(); return; }
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'Space') tryAttack(Date.now());
  if (e.code === 'Digit1') useSkill(1);
  if (e.code === 'Digit2') useSkill(2);
  if (e.code === 'KeyB') { sfx('click'); togglePanel('shopPanel'); }
  if (e.code === 'KeyQ') { sfx('click'); togglePanel('questPanel'); }
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyV') { sfx('click'); toggleWorldMap(); }
});
addEventListener('keyup', e => keys[e.code] = false);

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
  if (!mouseDown || attackTargetSimId) return;
  dest = screenToWorld(e.clientX, e.clientY);
});
addEventListener('mouseup', () => mouseDown = false);

/* ================= 메인 루프 ================= */
let lastT = 0;
function loop(t) {
  requestAnimationFrame(loop);
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
  if (!frozen && !me.dead && document.activeElement !== chatInput) {
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

  if (now - lastPosWrite > 150 || (hpDirty && now - lastPosWrite > 400)) {
    lastPosWrite = now;
    hpDirty = false;
    updateDoc(meRef, { x: me.x, y: me.y, hp: me.hp, lastSeen: now }).catch(() => {});
  }

  if (!me.dead && now - (me.lastHurtAt || 0) > 4000 && me.hp < maxHpOf()) {
    me.hp = Math.min(maxHpOf(), me.hp + maxHpOf() * .02 * dt / 1000);
    hpDirty = true;
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

function reviveNow() {
  const cost = me.lv * 100;
  if ((me.gold || 0) < cost) { toast('💰 골드가 부족합니다'); return; }
  runTransaction(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return false;
    const p = snap.data();
    if ((p.gold || 0) < cost) return false;
    tx.update(meRef, { gold: p.gold - cost });
    return true;
  }).then(ok => {
    if (!ok) { toast('💰 골드가 부족합니다'); return; }
    me.gold -= cost;
    me.dead = false; me.hp = me.maxHp;
    updateDoc(meRef, { dead: false, hp: me.hp }).catch(() => {});
    $('deadOv').style.display = 'none';
    rings.push({ x: me.x, y: me.y, r: 80, t: 0, max: 500, color: '255,215,0' });
    fxSparks(me.x, me.y, 16, '#ffd700', 150);
    sfx('levelup');
    float(me.x, me.y - 40, '즉시 부활!', '#ffd700');
  }).catch(() => {});
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
    if (k === 'stHp') {
      me.hp = Math.min(maxHpOf(), (me.hp || 0) + 15);
      updateDoc(meRef, { hp: me.hp }).catch(() => {});
    }
    const NM = { stAtk: '힘', stHp: '체력', stDef: '방어', stSpd: '민첩' };
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
        btn.disabled = false;
        btn.innerHTML = '<span style="font-size:20px;">🅶</span>&nbsp; Google로 계속하기';
        reject(e);
      }
    };
  });
}

/* ================= 시작 ================= */
setInterval(() => { if (uid && meRef) updateDoc(meRef, { lastSeen: Date.now() }).catch(() => {}); }, 4000);
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
  let user = auth.currentUser;
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
      dead: false, color: colorOf(uid), map: 'p1', conq: {}, statPts: 0, lastSeen: Date.now(),
    });
    await sysMsg(`${myName}(${c.name})님이 월드에 입장했습니다.`);
  } else {
    const d = snap.data();
    myName = d.name;
    myCls = d.cls || 'warrior';
    if (!d.cls) await updateDoc(meRef, { cls: 'warrior' });
    me.x = d.x || SPAWN.x; me.y = d.y || SPAWN.y;
    cam.x = me.x; cam.y = me.y;
    await updateDoc(meRef, { lastSeen: Date.now(), dead: false });
  }

  await ensureWorld();
  await ensureWorldM2();

  onSnapshot(meRef, s => {
    if (!s.exists()) return;
    const d = s.data();
    const { x, y, hp, ...rest } = d;
    me = { ...me, ...rest };
    renderInvUI();
  });

  watchPlayers();
  watchMonsters();
  watchLoot();
  watchChat();
  watchRank();

  ready = true;
  $('loading').style.display = 'none';
  const mn = $('mapName');
  if (mn) mn.textContent = pageDef(pageNum()).name;
  renderInvUI();
}

buildWorld();
init().catch(err => {
  $('loading').textContent = '초기화 실패: ' + err.message +
    '\n\nFirebase 콘솔에서 확인하세요:\n1. Authentication > Google 로그인 사용\n2. Cloud Firestore 생성\n3. 보안 규칙에서 로그인 사용자 읽기/쓰기 허용';
});

requestAnimationFrame(loop);
