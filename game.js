import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signInAnonymously, onAuthStateChanged, connectAuthEmulator, setPersistence, browserLocalPersistence, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, initializeFirestore, deleteDoc, doc, setDoc, updateDoc, onSnapshot, collection,
  query, orderBy, limit, addDoc, runTransaction, getDoc, writeBatch, increment, where,
  connectFirestoreEmulator
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const app = initializeApp(window.firebaseConfig);
const db = initializeFirestore(app, { ignoreUndefinedProperties: true }); /* 중첩 undefined로 updateDoc이 영구 실패(보류분 고착)하는 것 방지 */
const auth = getAuth(app);

if (location.search.includes('emu=1')) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

/* ================= 상수 ================= */
const WORLD = { w: 1600, h: 1200 };
const SPAWN = { x: 800, y: 600 };
const OFFLINE_MS = 45000; /* 심박 20s 기준 여유 */
const BASE_BAG = 18, MAX_BAG = 100; /* 6칸씩 확장(마지막은 96→100), 비용 500G부터 2배씩 */
const bagSize = () => Math.min(MAX_BAG, me.bagSize || BASE_BAG);
const bagUpCost = () => 500 * Math.pow(2, (bagSize() - BASE_BAG) / 6);
const MAX_SKILL_LV = 5;

const CLASSES = {
  warrior: { name: '전사',   icon: '⚔', weaponName: '장검',   hp: 160, mp: 70, atk: 13, speed: 230, range: 95,  atkCd: 520, crit: .05, color: '#e74c3c', melee: true, rec: 'stAtk',
    stats: ['stAtk', 'stHp', 'stDef', 'stSpd', 'stCrit', 'stAspd', 'stLife', 'stRegen'] },
  archer:  { name: '아처',   icon: '🏹', weaponName: '활',     hp: 110, mp: 90, atk: 11, speed: 255, range: 290, atkCd: 560, crit: .10, color: '#27ae60', proj: 'arrow', rec: 'stSpd',
    stats: ['stAtk', 'stHp', 'stSpd', 'stCrit', 'stAspd', 'stRange', 'stEvade', 'stWis'] },
  rogue:   { name: '로그',   icon: '🗡', weaponName: '단검',   hp: 95,  mp: 80, atk: 9,  speed: 290, range: 66,  atkCd: 300, crit: .25, color: '#f39c12', melee: true, rec: 'stCrit',
    stats: ['stAtk', 'stHp', 'stSpd', 'stCrit', 'stCritDmg', 'stAspd', 'stEvade', 'stLife'] },
  mage:    { name: '마법사', icon: '🪄', weaponName: '지팡이', hp: 85,  mp: 150, atk: 18, speed: 225, range: 270, atkCd: 850, crit: .05, color: '#9b59b6', proj: 'bolt', rec: 'stWis',
    stats: ['stAtk', 'stHp', 'stWis', 'stSpd', 'stCrit', 'stRange', 'stMana', 'stRegen'] },
};
/* 스탯 정의 — 직업별 8종 구성(CLASSES[*].stats). 효과는 아래 파생 공식들에 연결됨 */
const STAT_DEFS = {
  stAtk:     { n: '힘',       d: '공격력 +2' },
  stHp:      { n: '체력',     d: '최대 HP +15' },
  stDef:     { n: '방어',     d: '방어력 +1' },
  stSpd:     { n: '민첩',     d: '이동속도 +4' },
  stWis:     { n: '지혜',     d: '최대 MP +12 · 스킬 위력 +3%' },
  stCrit:    { n: '치명',     d: '치명타 확률 +1%' },
  stAspd:    { n: '공속',     d: '공격속도 +2% (최대 50%)' },
  stCritDmg: { n: '치명피해', s: '치피', d: '치명타 피해 +6%' },
  stLife:    { n: '흡혈',     d: '가한 피해의 1% 회복' },
  stRange:   { n: '사거리',   s: '거리', d: '공격 사거리 +6' },
  stMana:    { n: '절약',     d: '스킬 마나 소모 -2% (최대 60%)' },
  stRegen:   { n: '재생',     d: '비전투 HP 재생 +15%' },
  stEvade:   { n: '회피',     d: '회피 확률 +1% (최대 35%)' },
};
const CLASS_ORDER = ['warrior', 'archer', 'rogue', 'mage'];

const MONSTER_TYPES = {
  slime:  { name: '슬라임', hp: 35,  atk: 6,  speed: 45,  exp: 12, gold: 15, r: 16, color: '#2ecc71', aggro: 160, respawn: 16000,  range: 42 },
  goblin: { name: '고블린', hp: 70,  atk: 11, speed: 70,  exp: 28, gold: 35, r: 18, color: '#e67e22', aggro: 200, respawn: 18000,  range: 46 },
  wolf:   { name: '늑대',   hp: 130, atk: 18, speed: 105, exp: 55, gold: 70, r: 20, color: '#95a5a6', aggro: 260, respawn: 20000, range: 50 },
};
const SPAWN_ZONES = [
  { type: 'slime',  count: 8, cx: 540,  cy: 430, spread: 150 },
  { type: 'goblin', count: 6, cx: 1060, cy: 770, spread: 150 },
  { type: 'wolf',   count: 5, cx: 1250, cy: 250, spread: 180 },
];
const BOSS_DEF = { name: '오크 대족장', hp: 800, atk: 35, speed: 65, exp: 400, gold: 500, r: 42, color: '#c0392b', aggro: 420, respawn: 120000, range: 72 };
const SKELETON_DEF = { name: '스켈레톤', hp: 220, atk: 26, speed: 75, exp: 90, gold: 110, r: 19, color: '#e8e4d8', aggro: 240, respawn: 24000, range: 50 };
const LICH_DEF = { name: '리치 왕', hp: 2000, atk: 55, speed: 55, exp: 1500, gold: 2500, r: 46, color: '#8b6bff', aggro: 460, respawn: 180000, range: 80 };
const M2_ZONES = [
  { type: 'skeleton', count: 8, cx: 450, cy: 300, spread: 200 },
  { type: 'skeleton', count: 6, cx: 1150, cy: 850, spread: 200 },
];
const KINDS = {
  slime: { base: 'slime', name: '슬라임', main: '#2ecc71', shade: '#1e8449' , fx: [], th: 'meadow'},
  rslime: { base: 'slime', name: '레드 슬라임', main: '#e74c3c', shade: '#a93226' , fx: [["cracks"]], th: 'volcano'},
  islime: { base: 'slime', name: '서리 슬라임', main: '#5dade2', shade: '#2e86c1' , fx: [["snowcap"], ["crystals", "#bfe6ff"]], th: 'snow'},
  pslime: { base: 'slime', name: '독 슬라임', main: '#a040b0', shade: '#6c3483' , fx: [["bubbles", "#c07fe8"]], th: 'swamp'},
  dslime: { base: 'slime', name: '암흑 슬라임', main: '#4a4a5a', shade: '#2a2a38' , fx: [["aura", "#5a3fa8"]], th: 'cave'},
  goblin: { base: 'goblin', name: '고블린', main: '#6da34d', shade: '#4f7a36' , fx: [], th: 'forest'},
  hob: { base: 'goblin', name: '홉고블린', main: '#c8a03c', shade: '#9a7828' , fx: [["helm"]], th: 'desert'},
  orcwar: { base: 'goblin', name: '오크 전사', main: '#5d8a41', shade: '#3f5c33' , fx: [["pads"], ["rage"]], th: 'ruin'},
  madorc: { base: 'goblin', name: '광포한 오크', main: '#b05030', shade: '#7a3418' , fx: [["flames", "#ff7f27"], ["rage"]], th: 'volcano'},
  wolf: { base: 'wolf', name: '늑대', main: '#9aa2a8', shade: '#6f777c' , fx: [], th: 'meadow'},
  hound: { base: 'wolf', name: '지옥견', main: '#c0392b', shade: '#7a2418' , fx: [["flames", "#ff5020"], ["rage"]], th: 'volcano'},
  frost: { base: 'wolf', name: '서리늑대', main: '#aed6f1', shade: '#5dade2' , fx: [["snowcap"], ["crystals", "#bfe6ff"]], th: 'snow'},
  nightmare: { base: 'wolf', name: '몽마', main: '#7d5fff', shade: '#4a2fa8' , fx: [["aura", "#7d5fff"], ["trail", "#4a2fa8"]], th: 'abyss'},
  skeleton: { base: 'skeleton', name: '스켈레톤', main: '#e8e4d8', shade: '#b8b4a8' , fx: [], th: 'cave'},
  skarcher: { base: 'skeleton', name: '해골 궁수', main: '#d4c8a8', shade: '#a89878' , fx: [["bow"]], th: 'ruin'},
  knight: { base: 'skeleton', name: '죽음의 기사', main: '#8d93a1', shade: '#565c68' , fx: [["sword"], ["crown", "#565c68"]], th: 'ruin'},
  wraith: { base: 'skeleton', name: '사령', main: '#a8d8d8', shade: '#6aa8a8' , fx: [["trail", "#a8d8d8"]], th: 'swamp'},
  orcchief: { base: 'orc', name: '오크 족장', main: '#5d8a41', shade: '#3f5c33' , fx: [["crown", "#ffd700"]], th: 'meadow'},
  troll: { base: 'orc', name: '트롤', main: '#3d7a5c', shade: '#2a5540' , fx: [["horns", "#7a5c40"], ["moss"]], th: 'forest'},
  ogre: { base: 'orc', name: '오거', main: '#b07030', shade: '#7a4c18' , fx: [["horns", "#d9c8a9"], ["rage"]], th: 'desert'},
  cyclops: { base: 'orc', name: '사이클롭스', main: '#8a6b45', shade: '#5c4527' , fx: [["bigeye"]], th: 'cave'},
  demon: { base: 'orc', name: '마귀', main: '#a03050', shade: '#6a1830' , fx: [["horns", "#3a0f1c"], ["flames", "#ff3040"], ["rage"]], th: 'abyss'},
  lich: { base: 'lich', name: '리치 왕', main: '#8b6bff', shade: '#5a3fd4' , fx: [], th: 'abyss'},
  lichlord: { base: 'lich', name: '리치 로드', main: '#c05fff', shade: '#8a2fd4' , fx: [["crown", "#c05fff"], ["flames", "#c05fff"]], th: 'sky'},
  deathlord: { base: 'lich', name: '죽음 군주', main: '#40c090', shade: '#208a60' , fx: [["flames", "#40c090"]], th: 'abyss'},
  archlich: { base: 'lich', name: '대마령', main: '#ff6b9a', shade: '#d43a6a' , fx: [["aura", "#ff6b9a"], ["crown", "#ff6b9a"]], th: 'abyss'},
};
const KIND_BASE = {
  slime:    { hp: 35, atk: 6, exp: 12, gold: 15, r: 16, aggro: 160, speed: 45, respawn: 16000, range: 42 },
  goblin:   { hp: 70, atk: 11, exp: 28, gold: 35, r: 18, aggro: 200, speed: 70, respawn: 18000, range: 46 },
  wolf:     { hp: 130, atk: 18, exp: 55, gold: 70, r: 20, aggro: 260, speed: 105, respawn: 20000, range: 50 },
  skeleton: { hp: 220, atk: 26, exp: 90, gold: 110, r: 19, aggro: 240, speed: 75, respawn: 24000, range: 50 },
  orc:      { hp: 800, atk: 35, exp: 400, gold: 500, r: 42, aggro: 420, speed: 65, respawn: 120000, range: 72 }, /* 보스는 정복 진행을 막지 않도록 기존 유지 */
  lich:     { hp: 2000, atk: 55, exp: 1500, gold: 2500, r: 46, aggro: 460, speed: 55, respawn: 180000, range: 80 },
};
/* ===== 구역별 몬스터 변형 시스템 =====
   실제 모델(시트) 33종 → 바이옴마다 일반 4종·보스 2종 풀에서 구역 티어별로 골라 색조·이름·능력치를 바꿔
   100구역 × 3 = 300종(★유니크 포함 600)을 결정적으로 생성한다. 저장된 몬스터 문서는 슬롯(z0/z1/boss)으로 해석하므로 마이그레이션 쓰기 없음 */
const MOB_MODELS = { /* base → 역할(스탯 템플릿)·표시명·비행 여부 */
  slime: { role: 'small', kr: '슬라임' }, goblin: { role: 'mid', kr: '고블린' }, wolf: { role: 'fast', kr: '늑대' }, skeleton: { role: 'tank', kr: '스켈레톤' },
  orc: { role: 'boss', kr: '오크' }, lich: { role: 'boss', kr: '리치' },
  mushnub: { role: 'small', kr: '머시넙' }, mushnub2: { role: 'mid', kr: '독버섯' }, mushking: { role: 'boss', kr: '머시룸 킹' },
  cactoro: { role: 'mid', kr: '카투로' }, tribal: { role: 'mid', kr: '트라이벌' }, dino: { role: 'boss', kr: '디노' }, yeti: { role: 'tank', kr: '예티' },
  glub: { role: 'small', kr: '글럽', fly: true }, alpaking: { role: 'boss', kr: '알파킹', fly: true }, frog: { role: 'small', kr: '개구리' }, greenblob: { role: 'small', kr: '점액괴' },
  hywirl: { role: 'fast', kr: '하이월', fly: true }, dragon: { role: 'boss', kr: '드래곤', fly: true }, monkroose: { role: 'tank', kr: '몽크루스' },
  golem: { role: 'tank', kr: '골렘', fly: true }, golem2: { role: 'boss', kr: '대골렘', fly: true }, ninja: { role: 'boss', kr: '닌자' }, ghost: { role: 'fast', kr: '고스트', fly: true },
  bluedemon: { role: 'boss', kr: '청마귀' }, birb: { role: 'fast', kr: '버브' }, armabee: { role: 'mid', kr: '아르마비', fly: true }, dragon2: { role: 'boss', kr: '고룡', fly: true },
  ghostskull: { role: 'mid', kr: '해골 유령', fly: true }, demon: { role: 'tank', kr: '데몬' },
  skelminion: { role: 'small', kr: '해골 병사' }, skelmage: { role: 'mid', kr: '해골 마도사' }, skelrogue: { role: 'fast', kr: '해골 도적' },
};
const ROLE_BASE_KEY = { small: 'slime', mid: 'goblin', fast: 'wolf', tank: 'skeleton', boss: 'orc' }; /* 역할 → KIND_BASE 템플릿·드랍 테이블 */
const ROLE_SHEET_H = { small: 3.6, mid: 4.4, fast: 3.9, tank: 4.6, boss: 4.6 };
const BIOME_MOBS = [
  { normals: ['slime', 'goblin', 'wolf', 'frog'], bosses: ['orc', 'mushking'] },                 /* 초원 */
  { normals: ['wolf', 'mushnub', 'skelminion', 'birb'], bosses: ['mushking', 'monkroose'] },     /* 어두운 숲 */
  { normals: ['cactoro', 'tribal', 'goblin', 'skelrogue'], bosses: ['dino', 'orc'] },           /* 사막 */
  { normals: ['yeti', 'glub', 'wolf', 'birb'], bosses: ['alpaking', 'golem2'] },                 /* 설원 */
  { normals: ['frog', 'greenblob', 'mushnub2', 'ghost'], bosses: ['mushking', 'monkroose'] },   /* 못가 */
  { normals: ['demon', 'hywirl', 'cactoro', 'skeleton'], bosses: ['dragon', 'bluedemon'] },     /* 화산 */
  { normals: ['skelminion', 'golem', 'monkroose', 'ghostskull'], bosses: ['golem2', 'skelmage'] }, /* 동굴 */
  { normals: ['skeleton', 'skelrogue', 'skelmage', 'wolf'], bosses: ['ninja', 'skelmage'] },    /* 폐허 */
  { normals: ['demon', 'ghostskull', 'ghost', 'skelmage'], bosses: ['bluedemon', 'lich'] },     /* 마계 */
  { normals: ['birb', 'armabee', 'glub', 'hywirl'], bosses: ['dragon2', 'alpaking'] },          /* 천공 */
];
/* 구역 형용사: 바이옴별 10개(티어) — 세트가 서로 겹치지 않아 300종 이름이 전부 다르다 */
const ZONE_ADJ = [
  ['풀숲', '들꽃', '햇살', '이슬', '바람', '초록', '들판', '개울', '언덕', '노을'],
  ['그늘', '안개', '가시덤불', '늙은', '이끼', '뒤틀린', '음침한', '검은숲', '달빛', '심야'],
  ['사구', '모래', '작열', '건조', '신기루', '전갈', '메마른', '태양', '황무지', '유적'],
  ['서리', '눈보라', '빙결', '얼음', '동상', '설백', '냉기', '빙하', '극한', '설왕'],
  ['진흙', '늪', '습기', '부패', '독기', '갈대', '물이끼', '수렁', '독안개', '심연늪'],
  ['잿빛', '용암', '불꽃', '화상', '유황', '작열', '분출', '숯', '마그마', '지옥불'],
  ['어둠', '박쥐', '동굴', '종유석', '지하', '암흑', '균열', '심층', '광석', '지저'],
  ['폐허', '무너진', '잊힌', '낡은', '망령', '몰락', '녹슨', '고대', '저주', '봉인'],
  ['마계', '악몽', '혼돈', '타락', '심연', '지옥', '파멸', '역병', '공포', '종말'],
  ['천공', '구름', '창공', '뇌운', '별빛', '바람결', '고공', '광풍', '천상', '창천'],
];
const BOSS_TITLE = ['수장', '대장', '족장', '장군', '군주', '폭군', '수호자', '지배자', '고왕', '제왕'];
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
const pageDiff = n => 1 + (n - 1) * .45; /* (레거시) */
const hpScale = n => 1 + (n - 1) * .36;  /* 몬스터 HP 난이도: 매끄러운 선형(톱니 제거) — 구역당 +36% */
const atkScale = n => 1 + (n - 1) * .18; /* 몬스터 공격 난이도: HP보다 완만 — 후반 원샷 방지 */
const pageExp = n => 1 + (n - 1) * .5 + (n - 1) * (n - 1) * .06;
function pageDef(n) {
  const bi = Math.min(9, Math.floor((n - 1) / 10)), bio = BIOMES[bi];
  const tier = (n - 1) % 10;
  const de = pageExp(n), hM = hpScale(n), aM = atkScale(n);
  const bm = BIOME_MOBS[bi] || BIOME_MOBS[0];
  const pick = (arr, i) => arr[((i % arr.length) + arr.length) % arr.length];
  const baseA = pick(bm.normals, tier);
  let baseB = pick(bm.normals, tier + 1 + (tier >> 1));
  if (baseB === baseA) baseB = pick(bm.normals, tier + 2);
  const bossBase = pick(bm.bosses, tier);
  const mkZ = (base, slot, isBoss) => {
    const M = MOB_MODELS[base] || MOB_MODELS.goblin;
    const b = KIND_BASE[base] || KIND_BASE[ROLE_BASE_KEY[M.role]] || KIND_BASE.goblin;
    const hue = ((n * 37 + slot * 131) % 120) - 60; /* 구역별 색조 -60~+59° */
    /* 이름 고유성: 형용사는 티어에 1:1(바이옴별 세트가 서로 다름) → 같은 베이스가 다른 티어·바이옴에 나와도 이름이 겹치지 않는다.
       보스도 구역 형용사 + 칭호 (예: '풀숲 오크 수장') */
    const adj = ZONE_ADJ[bi][tier];
    const name = isBoss ? `${adj} ${M.kr} ${BOSS_TITLE[tier]}` : `${adj} ${M.kr}`;
    /* 보스는 스프라이트 역할(monkroose=tank 등)과 무관하게 일관된 '보스급' 베이스(오크)를 써 구역이 올라갈수록 반드시 강해지게 한다.
       (이전엔 tank 스프라이트 보스가 20구역인데도 11구역 보스보다 약한 역전이 있었다) */
    const bb = isBoss ? KIND_BASE.orc : b;
    const k = { base, name, main: '#888888', shade: '#444444', hue, fx: [], th: bio.style, role: M.role, fly: !!M.fly, zone: n,
      dropType: KIND_BASE[base] ? base : ROLE_BASE_KEY[M.role],
      hp: Math.round(bb.hp * hM * (isBoss ? 1.6 : 1)),   /* 보스 HP = 오크 베이스 × 난이도 × 1.6 (이전 톱니×3 폐지) */
      atk: Math.round(bb.atk * aM * (isBoss ? 1.2 : 1)), /* 완만한 공격 스케일 — 후반 보스도 3~4대는 버팀 */
      exp: Math.round(bb.exp * de * (isBoss ? 2.2 : 1)),
      gold: Math.round(bb.gold * de * (isBoss ? 2 : 1)),
      r: isBoss ? Math.round(b.r * 1.15) : b.r, aggro: b.aggro, speed: b.speed, respawn: b.respawn, range: b.range };
    return k;
  };
  return {
    n, id: pageId(n), name: `${bio.name} ${tier + 1}구역`, bio,
    kinds: [mkZ(baseA, 0, false), mkZ(baseB, 1, false)], boss: mkZ(bossBase, 2, true),
    spawn: { x: n === 1 ? 800 : 170, y: 600 },
  };
}
/* 이름 → 구역 kind (도감·hue·드랍용). 처음 조회 때 100구역을 훑어 색인 */
let _zoneKindIndex = null;
function zoneKindByName(name) {
  if (!_zoneKindIndex) {
    _zoneKindIndex = {};
    for (let n = 1; n <= MAX_PAGE; n++) { const pd = pageDef(n); for (const k of [...pd.kinds, pd.boss]) _zoneKindIndex[k.name] = k; }
  }
  return _zoneKindIndex[name];
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
/* ================= 아이템 아이콘 (고해상도 2D) =================
   game-icons(CC BY 3.0) 실루엣 SVG를 128px 캔버스에 아이템 색으로 채색 + 베벨·스펙큘러·외곽선·등급 후광을 얹어
   가방/장비/툴팁/퀵슬롯/바닥 루팅 전부에 같은 이미지를 쓴다. 예전 ASCII 픽셀아트는 SVG 로드 전 폴백으로만 남김 */
const ITEM_ICON_PX = 128;
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) { /* 구형 인앱 WebKit 폴리필 */
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(Array.isArray(r) ? r[0] : (r || 0), w / 2, h / 2);
    this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r); this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath();
  };
}
const ITEM_ICON_IMG = {};
let itemIconGen = 0;
function glyphImg(path) {
  let im = ITEM_ICON_IMG[path];
  if (im) return im;
  im = new Image();
  im.onload = () => { im._ok = true; itemIconsChanged(); };
  im.onerror = () => { im._bad = true; };
  im.src = path + '?v=1';
  ITEM_ICON_IMG[path] = im;
  return im;
}
const itemIconImg = name => glyphImg(`assets/icons/items/${name}.svg`);
/* 아이콘이 새로 로드되면 캐시를 비우고 열려 있는 UI를 다시 그림 */
let iconRefreshT = 0;
function itemIconsChanged() {
  itemIconGen++;
  for (const k in thumbCache) delete thumbCache[k];
  for (const k in iconCvCache) delete iconCvCache[k];
  for (const k in skIconCache) delete skIconCache[k];
  for (const k in domCache) if (k.startsWith('pothb') || k.startsWith('hbhb')) delete domCache[k];
  clearTimeout(iconRefreshT);
  iconRefreshT = setTimeout(() => { try {
    if ($('invPanel') && $('invPanel').classList.contains('open')) renderInvUI();
    if ($('shopPanel') && $('shopPanel').classList.contains('open')) renderShop();
    if ($('treePanel') && $('treePanel').classList.contains('open')) renderTree();
  } catch (e) {} }, 60);
}
/* 아이템 → 아이콘 이름 */
function itemIconName(id, it) {
  const base = it._base || id;
  if (it.scroll) return 'scroll-unfurled';
  if (it.heal) return it.heal > 100 ? 'heart-bottle' : 'health-potion';
  if (it.mana) return it.mana > 60 ? 'bubbling-flask' : 'potion-ball'; /* 체력=하트 플라스크(빨강) / 마나=둥근 플라스크(파랑)로 실루엣부터 다르게 */
  const hi = /flame|storm|shadow|crystal|chief|knight/.test(base) || (it.band || 0) >= 4;
  const top = /chief|knight|lich/.test(base) || (it.band || 0) >= 7;
  const cls = it.cls || '';
  switch (it.slot) {
    case 'weapon':
      if (cls === 'archer') return hi ? 'crossbow' : 'bow-arrow';
      if (cls === 'rogue') return hi ? 'curvy-knife' : 'plain-dagger';
      if (cls === 'mage') return hi ? 'crystal-wand' : 'wizard-staff';
      return top ? 'two-handed-sword' : hi ? 'dripping-sword' : 'broadsword';
    case 'armor':
      if (cls === 'warrior' && hi) return 'breastplate';
      if (/plate/.test(base)) return 'breastplate';
      if (cls === 'archer' && hi) return 'chain-mail';
      if (cls === 'mage' || /cloth/.test(base)) return 'leather-vest';
      return 'leather-armor';
    case 'helmet':
      if (/crown|slime/.test(base)) return 'crown';
      if (cls === 'mage') return 'pointy-hat';
      if (cls === 'rogue' || /cloth/.test(base)) return 'hood';
      if (cls === 'warrior' && hi) return 'visored-helm';
      return 'barbute';
    case 'pants': return 'trousers';
    case 'gloves': return (hi || /steel/.test(base)) ? 'gauntlet' : 'gloves';
    case 'boots': return (hi || /wind/.test(base)) ? 'steeltoe-boots' : 'boots';
    case 'bracelet': return 'bracers';
    case 'necklace': return (hi || /ruby|fang/.test(base)) ? 'gem-pendant' : 'pearl-necklace';
    case 'ring': return /lich/.test(base) ? 'emerald' : (hi || /shadow|gem/.test(base)) ? 'diamond-ring' : 'ring';
  }
  return 'ring-box';
}
const iconCvCache = {}, skIconCache = {};
/* 실루엣을 (dx,dy)만큼 밀어 뺀 '테두리 띠'를 만든다 — 베벨용 */
function iconRim(mask, dx, dy, S) {
  const c2 = document.createElement('canvas'); c2.width = S; c2.height = S;
  const g = c2.getContext('2d');
  g.drawImage(mask, 0, 0);
  g.globalCompositeOperation = 'destination-out';
  g.drawImage(mask, dx, dy);
  return c2;
}
/* 아이콘 캔버스(128px). 로드 전이면 null */
function itemIconCanvas(rawId) {
  const [bid] = splitStack(rawId);
  const it = getItem(bid);
  if (it.book) return skillIconCanvas(it.book, skillDef(it.book)); /* 스킬서 = 스킬 배지 그대로 */
  const name = itemIconName(bid, it);
  const im = itemIconImg(name);
  if (!im._ok) return null;
  const col = it.color || '#ccc';
  const rar = it.rarity || 'common';
  const key = `${name}|${col}|${rar}`;
  if (iconCvCache[key]) return iconCvCache[key];
  const S = ITEM_ICON_PX, pad = 7, gs = S - pad * 2; /* 글리프가 셀을 거의 채우게 — 슬롯에서 작아 보이던 것 보정 */
  /* 1) 실루엣 마스크(흰색) */
  const mask = document.createElement('canvas'); mask.width = S; mask.height = S;
  const mg = mask.getContext('2d');
  mg.imageSmoothingEnabled = true; mg.imageSmoothingQuality = 'high';
  mg.drawImage(im, pad, pad, gs, gs);
  /* 2) 채색 본체: 위 밝음 → 아래 어둠 그라데이션 + 스펙큘러 */
  const body = document.createElement('canvas'); body.width = S; body.height = S;
  const bg = body.getContext('2d');
  bg.drawImage(mask, 0, 0);
  bg.globalCompositeOperation = 'source-in';
  const lg = bg.createLinearGradient(0, pad, S * .35, S - pad);
  lg.addColorStop(0, shade(col, 1.55));
  lg.addColorStop(.45, col);
  lg.addColorStop(1, shade(col, .5));
  bg.fillStyle = lg; bg.fillRect(0, 0, S, S);
  bg.globalCompositeOperation = 'source-atop';
  /* 재질 결: 대각선 미세 줄무늬로 평면감 제거 */
  bg.globalAlpha = .06;
  for (let i = -S; i < S * 2; i += 6) { bg.fillStyle = (i / 6 | 0) % 2 ? '#fff' : '#000'; bg.beginPath(); bg.moveTo(i, 0); bg.lineTo(i + 3, 0); bg.lineTo(i + 3 - S, S); bg.lineTo(i - S, S); bg.closePath(); bg.fill(); }
  bg.globalAlpha = 1;
  const sp = bg.createRadialGradient(S * .36, S * .3, 2, S * .36, S * .3, S * .5);
  sp.addColorStop(0, 'rgba(255,255,255,.55)'); sp.addColorStop(.35, 'rgba(255,255,255,.18)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
  bg.fillStyle = sp; bg.fillRect(0, 0, S, S);
  /* 3) 베벨: 좌상 하이라이트 띠 / 우하 그림자 띠 */
  const rimL = iconRim(mask, 3, 3, S), rimD = iconRim(mask, -3, -3, S);
  bg.globalCompositeOperation = 'source-atop';
  bg.globalAlpha = .75; bg.drawImage(rimL, 0, 0);
  const tmpD = document.createElement('canvas'); tmpD.width = S; tmpD.height = S;
  const tg = tmpD.getContext('2d'); tg.drawImage(rimD, 0, 0); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = '#000'; tg.fillRect(0, 0, S, S);
  bg.globalAlpha = .55; bg.drawImage(tmpD, 0, 0);
  bg.globalAlpha = 1;
  /* 4) 최종 합성: 등급 후광 → 외곽선(8방향) → 그림자 → 본체 */
  const out = document.createElement('canvas'); out.width = S; out.height = S;
  const c = out.getContext('2d');
  const rank = RARITY_RANK[rar] || 0;
  if (rank >= 1) {
    const rc = RARITY_COLOR[rar] || '#aaa';
    c.save(); c.filter = `blur(${6 + rank * 2}px)`; c.globalAlpha = .28 + rank * .09;
    const glow = document.createElement('canvas'); glow.width = S; glow.height = S;
    const gg = glow.getContext('2d'); gg.drawImage(mask, 0, 0); gg.globalCompositeOperation = 'source-in'; gg.fillStyle = rc; gg.fillRect(0, 0, S, S);
    for (let i = 0; i < 2; i++) c.drawImage(glow, 0, 0);
    c.restore();
  }
  const ol = document.createElement('canvas'); ol.width = S; ol.height = S;
  const og = ol.getContext('2d'); og.drawImage(mask, 0, 0); og.globalCompositeOperation = 'source-in'; og.fillStyle = '#0c0e14'; og.fillRect(0, 0, S, S);
  c.save(); c.globalAlpha = .5; c.filter = 'blur(3px)'; c.drawImage(ol, 3, 5); c.restore();
  for (let a = 0; a < 8; a++) c.drawImage(ol, Math.round(Math.cos(a * Math.PI / 4) * 2.6), Math.round(Math.sin(a * Math.PI / 4) * 2.6));
  c.drawImage(body, 0, 0);
  /* 전설·유니크: 반짝이 점 */
  if (rank >= 4) {
    c.fillStyle = '#fff';
    for (const [x, y, r] of [[S * .28, S * .22, 3.5], [S * .7, S * .3, 2.4], [S * .62, S * .72, 2.8]]) {
      c.globalAlpha = .9; c.beginPath(); c.moveTo(x, y - r * 2.2); c.lineTo(x + r * .5, y - r * .5); c.lineTo(x + r * 2.2, y); c.lineTo(x + r * .5, y + r * .5); c.lineTo(x, y + r * 2.2); c.lineTo(x - r * .5, y + r * .5); c.lineTo(x - r * 2.2, y); c.lineTo(x - r * .5, y - r * .5); c.closePath(); c.fill();
    }
    c.globalAlpha = 1;
  }
  iconCvCache[key] = out;
  return out;
}
/* 가방용 썸네일 dataURL (고해상도 아이콘 → 로드 전엔 예전 픽셀아트 폴백) */
const thumbCache = {};
function itemThumb(rawId) {
  try {
    const [bid] = splitStack(rawId);
    const cvI = itemIconCanvas(rawId);
    if (cvI) {
      const it = getItem(bid);
      const key = it.book ? 'hib|' + it.book : 'hi|' + itemIconName(bid, it) + '|' + (it.color || '') + '|' + (it.rarity || '');
      if (!thumbCache[key]) thumbCache[key] = cvI.toDataURL();
      return thumbCache[key];
    }
    const key = itemSprite(bid);
    if (thumbCache[key]) return thumbCache[key];
    const url = buildSprite(key).cv.toDataURL();
    thumbCache[key] = url;
    return url;
  } catch (e) { return ''; }
}
/* 인라인 <img> (토스트·퀵슬롯). 아이콘 미로드 시 이모지 폴백 */
function itemIconHtml(rawId, px = 20, cls = '') {
  const th = itemThumb(rawId);
  return th ? `<img class="${cls}" src="${th}" alt="" style="width:${px}px;height:${px}px;vertical-align:middle;object-fit:contain;">` : itemIcon(rawId);
}
/* 월드 캔버스에 아이템 아이콘 — (x, y)는 발밑 기준, size는 월드 px(정사각) */
function drawItemIcon(rawId, x, y, size, opts = {}) {
  const cvI = itemIconCanvas(rawId);
  if (!cvI) { drawSprite(itemSprite(splitStack(rawId)[0]), x, y, size / 10, opts); return; }
  ctx.save();
  ctx.translate(x, y - size / 2);
  if (opts.rot) ctx.rotate(opts.rot);
  ctx.scale(opts.squashX || 1, opts.squashY || 1);
  if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cvI, -size / 2, -size / 2, size, size);
  ctx.restore();
}
/* 시작 시 전부 프리로드 (39개, 총 160KB) — 가방을 열 때쯤엔 전부 준비되어 폴백이 안 보인다 */
setTimeout(() => { for (const n of ['broadsword','bow-arrow','plain-dagger','wizard-staff','breastplate','leather-armor','leather-vest','visored-helm','barbute','pointy-hat','trousers','gloves','boots','ring','health-potion','heart-bottle','magic-potion','round-potion','square-bottle','scroll-unfurled','crown','gem-pendant','emerald','ring-box','dripping-sword','water-drop','crystal-wand','two-handed-sword','crossbow','curvy-knife','hood','chain-mail','steeltoe-boots','gauntlet','bracers','diamond-ring','pearl-necklace','potion-ball','bubbling-flask']) itemIconImg(n);
  for (const n of ['sword-brandish','whirlwind','muscle-up','shield','arrow-cluster','high-shot','eye-target','boots','ninja-mask','daggers','crescent-blade','sprint','fireball','ice-bolt','magic-swirl','shield-reflect','healing','crossed-swords','lightning-branches','heart-plus','punch-blast','bullseye']) glyphImg(`assets/icons/${n}.svg`); }, 0);
/* 리치 호버 툴팁 */
let tipEl = null, tipLastRaw = '', tipLastT = 0;
function itemTipHtml(rawId, compare = false) {
  const [bid, cnt] = splitStack(rawId);
  const it = getItem(bid);
  const col = RARITY_COLOR[it.rarity] || '#aaa';
  const th = itemThumb(rawId);
  let h = `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">`
    + (th ? `<img src="${th}" style="width:48px;height:48px;object-fit:contain;">` : `<span style="font-size:30px;">${itemIcon(rawId)}</span>`)
    + `<div><b style="color:${col};font-size:14px;">${esc(it.name)}</b>${cnt > 1 ? ` <span style="color:#ffd700">x${cnt}</span>` : ''}`
    + `<div style="color:${col};font-size:11px;">${RARITY_KR[it.rarity] || '일반'} · 점수 <b style="color:#fff">${itemScore(rawId).toLocaleString()}</b></div></div></div>`;
  const st = itemStat(it);
  if (st) h += `<div style="color:#cdd;font-size:12px;margin-bottom:4px;">${esc(st)}</div>`;
  /* 가방 아이템 호버: 같은 슬롯에 장착 중인 장비와 능력치 비교 */
  if (compare && it.slot) {
    const eqRaw = (me.equipped || {})[it.slot];
    if (eqRaw && eqRaw !== rawId) {
      const eq = getItem(eqRaw);
      const F = [['atk', '공격', 1], ['def', '방어', 1], ['hp', 'HP', 1], ['mp', 'MP', 1], ['spd', '속도', 1], ['crit', '치명타', 100]];
      const rows = F.map(([k, lbl, m]) => {
        const a = (it[k] || 0) * m, b = (eq[k] || 0) * m;
        if (!a && !b) return '';
        const d = Math.round((a - b) * 10) / 10;
        const c = d > 0 ? '#2ecc71' : d < 0 ? '#ff6b6b' : '#889';
        const sign = d > 0 ? '+' : '';
        return `<div style="display:flex;justify-content:space-between;gap:10px;"><span>${lbl}</span><span style="color:#aab">${Math.round(b * 10) / 10}${m === 100 ? '%' : ''} → ${Math.round(a * 10) / 10}${m === 100 ? '%' : ''}</span><b style="color:${c};min-width:44px;text-align:right;">${sign}${d}${m === 100 ? '%p' : ''}</b></div>`;
      }).filter(Boolean).join('');
      const ds = itemScore(rawId) - itemScore(eqRaw);
      h += `<div style="margin:6px 0 4px;padding:6px 8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:6px;font-size:11.5px;line-height:1.7;">`
        + `<div style="color:#9fd;font-size:11px;margin-bottom:2px;">장착 중: <b style="color:${RARITY_COLOR[eq.rarity] || '#aaa'}">${esc(eq.name)}</b></div>`
        + (rows || '<div style="color:#889">비교할 능력치 없음</div>')
        + `<div style="display:flex;justify-content:space-between;margin-top:2px;"><span>점수</span><b style="color:${ds > 0 ? '#2ecc71' : ds < 0 ? '#ff6b6b' : '#889'}">${ds > 0 ? '+' : ''}${ds.toLocaleString()}</b></div></div>`;
    } else if (!eqRaw) {
      h += `<div style="color:#9fd;font-size:11px;margin:4px 0;">해당 슬롯 비어 있음 — 장착 시 그대로 적용</div>`;
    }
  }
  if (it.heal) h += `<div style="color:#7fe3a0;font-size:12px;">사용: HP +${it.heal} 회복</div>`;
  if (it.mana) h += `<div style="color:#7fc7ff;font-size:12px;">사용: MP +${it.mana} 회복</div>`;
  if (it.scroll) h += `<div style="color:#9fd;font-size:12px;">장비에 끌어다 놓으면 강화 시도</div>`;
  if (it.book) { const sd = skillDef(it.book); if (sd) h += `<div style="color:#cdd;font-size:12px;">${isPassiveSkill(sd) ? '🛡 패시브' : '⚡ 발동'} · ${esc(sd.desc || '')}${sd.mp ? ` · 마나 ${sd.mp}` : ''}</div><div style="color:#ffd700;font-size:12px;">더블 클릭: 스킬 활성화 (습득/레벨업/강화)</div>`; }
  if (it._base) {
    const sl = setLineFor(it._base);
    if (sl) h += `<div style="color:#9fd;font-size:11.5px;margin:4px 0;white-space:pre-line;">${esc(sl)}</div>`;
  }
  h += `<div style="color:#889;font-size:11px;">판매 +${sellPrice(rawId).toLocaleString()} G</div>`;
  h += `<div style="color:#667;font-size:10.5px;margin-top:4px;">좌클릭: 장착/사용 · 우클릭: 강화/판매</div>`;
  return h;
}
function showTip(html, x, y, anchor) {
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.id = 'itemTip'; document.body.appendChild(tipEl); }
  tipEl.innerHTML = html;
  tipEl.style.display = 'block';
  placeTip(x, y, anchor);
}
function placeTip(x, y, anchor) {
  if (!tipEl) return;
  const r = tipEl.getBoundingClientRect();
  const panel = anchor && anchor.closest ? anchor.closest('#invPanel') : null;
  let lx, ly;
  if (panel) {
    /* 가방 팝업이 화면의 90%를 차지하면서 좌/우 바깥에 둘 자리가 없어 툴팁이 화면 밖으로 잘렸다.
       바깥 → 안 되면 커서 옆(공간 넓은 쪽) 순으로 배치하고 마지막에 화면 안으로 클램프 */
    const pr = panel.getBoundingClientRect();
    const outL = pr.left - r.width - 10, outR = pr.right + 10;
    if (outL >= 8) lx = outL;
    else if (outR + r.width <= innerWidth - 8) lx = outR;
    else lx = (x > innerWidth / 2) ? x - r.width - 18 : x + 18; /* 커서 반대쪽 */
    ly = Math.min(Math.max(y - 40, 8), innerHeight - r.height - 8);
  } else {
    lx = (x + 14 + r.width <= innerWidth - 8) ? x + 14 : x - r.width - 14;
    ly = Math.min(y + 16, innerHeight - r.height - 8);
  }
  lx = Math.max(8, Math.min(lx, innerWidth - r.width - 8));
  ly = Math.max(8, Math.min(ly, innerHeight - r.height - 8));
  tipEl.style.left = lx + 'px';
  tipEl.style.top = ly + 'px';
}
function hideTip() { if (tipEl) tipEl.style.display = 'none'; tipLastRaw = ''; }

const ITEMS = {
  /* 무기: 직업 전용(cls) — 드롭 시 사냥한 직업의 변형으로 치환됨(WEAPON_VARIANTS) */
  sword_wood:    { name: '나무 검',   slot: 'weapon', cls: 'warrior', atk: 3,  color: '#a0714f', rarity: 'common' },
  sword_iron:    { name: '철 검',     slot: 'weapon', cls: 'warrior', atk: 8,  color: '#bdc3c7', rarity: 'rare' },
  sword_flame:   { name: '화염검',    slot: 'weapon', cls: 'warrior', atk: 15, color: '#ff7f27', rarity: 'epic' },
  bow_wood:      { name: '나무 활',   slot: 'weapon', cls: 'archer', atk: 3,  color: '#a0714f', rarity: 'common' },
  bow_iron:      { name: '강철 활',   slot: 'weapon', cls: 'archer', atk: 8,  color: '#bdc3c7', rarity: 'rare' },
  bow_storm:     { name: '질풍의 활', slot: 'weapon', cls: 'archer', atk: 15, color: '#5dade2', rarity: 'epic' },
  dagger_wood:   { name: '낡은 단검', slot: 'weapon', cls: 'rogue', atk: 3,  color: '#a0714f', rarity: 'common' },
  dagger_iron:   { name: '철 단검',   slot: 'weapon', cls: 'rogue', atk: 8,  color: '#bdc3c7', rarity: 'rare' },
  dagger_shadow: { name: '그림자 단검', slot: 'weapon', cls: 'rogue', atk: 15, color: '#6c3483', rarity: 'epic' },
  staff_wood:    { name: '나무 지팡이', slot: 'weapon', cls: 'mage', atk: 3,  color: '#a0714f', rarity: 'common' },
  staff_crystal: { name: '수정 지팡이', slot: 'weapon', cls: 'mage', atk: 8,  color: '#aed6f1', rarity: 'rare' },
  staff_flame:   { name: '화염 지팡이', slot: 'weapon', cls: 'mage', atk: 15, color: '#ff7f27', rarity: 'epic' },
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
  club_chief:    { name: '고블린 대장의 몽둥이', slot: 'weapon', cls: 'warrior', atk: 20, color: '#8a6b45', rarity: 'unique' },
  bow_chief:     { name: '고블린 대장의 장궁', slot: 'weapon', cls: 'archer', atk: 20, color: '#8a6b45', rarity: 'unique' },
  dagger_chief:  { name: '고블린 대장의 비수', slot: 'weapon', cls: 'rogue', atk: 20, color: '#8a6b45', rarity: 'unique' },
  staff_chief:   { name: '고블린 대장의 뼈지팡이', slot: 'weapon', cls: 'mage', atk: 20, color: '#8a6b45', rarity: 'unique' },
  fang_neck:     { name: '알파 늑대의 송곳니', slot: 'necklace', atk: 9, crit: .06, color: '#e8e4d8', rarity: 'unique' },
  knight_sword:  { name: '해골 기사의 검', slot: 'weapon', cls: 'warrior', atk: 24, def: 4, color: '#e8e4d8', rarity: 'unique' },
  knight_bow:    { name: '해골 기사의 활', slot: 'weapon', cls: 'archer', atk: 24, def: 4, color: '#e8e4d8', rarity: 'unique' },
  knight_dagger: { name: '해골 기사의 단검', slot: 'weapon', cls: 'rogue', atk: 24, def: 4, color: '#e8e4d8', rarity: 'unique' },
  knight_staff:  { name: '해골 기사의 지팡이', slot: 'weapon', cls: 'mage', atk: 24, def: 4, color: '#e8e4d8', rarity: 'unique' },
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
let itemDefCacheN = 0;
const ITEM_DEF_CACHE_MAX = 900; /* 랜덤롤(~pct)·강화(+lv) id로 키가 무한 증식하던 것 상한 — 초과 시 통째로 비움(순수 파생 캐시라 안전) */
function getItem(id) {
  id = String(id);
  const star = id.indexOf('*');
  if (star >= 0) id = id.slice(0, star);
  const cacheKey = id;
  if (itemDefCache[cacheKey]) return itemDefCache[cacheKey];
  if (itemDefCacheN > ITEM_DEF_CACHE_MAX) { for (const k in itemDefCache) delete itemDefCache[k]; itemDefCacheN = 0; }
  /* 스탯 랜덤롤 접미사 (~85~115): 같은 등급도 능력치 상이 */
  let pct = 100;
  const tilde = id.indexOf('~');
  if (tilde >= 0) { pct = Math.max(50, Math.min(150, +id.slice(tilde + 1) || 100)); id = id.slice(0, tilde); }
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
      if (base.mana) out.mana = Math.round(base.mana * (1 + lv * .15));
      if (base.crit) out.crit = +(base.crit + lv * .01).toFixed(3);
      if (base.spd) out.spd = Math.round(base.spd * m);
    }
  }
  if (pct !== 100 && out && (out.atk || out.def || out.heal || out.mana || out.crit || out.spd)) {
    const m2 = pct / 100;
    out = { ...out };
    for (const k of ['atk', 'def', 'heal', 'mana', 'spd']) if (out[k]) out[k] = Math.max(1, Math.round(out[k] * m2));
    if (out.crit) out.crit = +(out.crit * m2).toFixed(3);
    out._pct = pct;
    out.name = `${out.name} (${pct}%)`;
  }
  itemDefCache[cacheKey] = out; itemDefCacheN++;
  return out;
}
/* 아이템 파워 점수 (등급+스탯+강화+롤 종합) */
function itemScore(rawId) {
  const [bid] = splitStack(rawId);
  const it = getItem(bid);
  const base = (RARITY_RANK[it.rarity] ?? 0) * 100;
  const stats = (it.atk || 0) * 10 + (it.def || 0) * 10 + (it.spd || 0) * 4
    + Math.round((it.crit || 0) * 1000) + (it.heal || 0) + (it.mana || 0);
  return base + stats;
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
/* ================= 세트 아이템 + 증폭 효과 =================
   같은 세트 장비를 여러 부위 장착하면 티어별 보너스 누적 발동.
   flat(고정 수치) + amp(%, 곱연산 증폭) 혼합. 티어는 누적 적용 */
const SETS = {
  cloth:   { name: '천행자', color: '#d9c8a9',
    pieces: ['armor_cloth', 'cap_cloth', 'pants_cloth', 'gloves_cloth', 'boots_cloth'],
    bonus: { 2: { def: 2 }, 4: { hp: 60 }, 5: { defMul: .12 } } },
  leather: { name: '가죽 추적자', color: '#c98a3c',
    pieces: ['armor_leather', 'cap_leather', 'pants_leather', 'gloves_leather', 'boots_leather', 'ring_leather'],
    bonus: { 2: { atk: 3 }, 4: { crit: .04 }, 6: { atkMul: .12 } } },
  steel:   { name: '강철 수호', color: '#9fb2c8',
    pieces: ['armor_plate', 'pants_plate', 'gloves_steel', 'boots_wind'],
    bonus: { 2: { def: 5 }, 3: { hp: 120 }, 4: { takenMul: .12 } } },
  trinket: { name: '빛나는 장신구', color: '#48c9b0',
    pieces: ['bracelet_wood', 'bracelet_jade', 'necklace_copper', 'necklace_ruby', 'ring_leather'],
    bonus: { 2: { crit: .03 }, 3: { expMul: .15, goldMul: .15 } } },
  crown:   { name: '왕의 위엄', color: '#ffd700',
    pieces: ['crown_gold', 'crown_slime', 'ring_shadow'],
    bonus: { 2: { hp: 100, atkMul: .08 } } },
  chief:   { name: '대족장의 분노', color: '#b07030',
    pieces: [['club_chief', 'bow_chief', 'dagger_chief', 'staff_chief'], 'fang_neck'],
    bonus: { 2: { atk: 10, crit: .05, bossMul: .2 } } },
  knight:  { name: '죽음의 기사단', color: '#e8e4d8',
    pieces: [['knight_sword', 'knight_bow', 'knight_dagger', 'knight_staff'], 'orb_lich'],
    bonus: { 2: { atk: 12, def: 6, critDmgMul: .3 } } },
};
/* ===== 직업별 구역 장비 (생성) =====
   밴드(10구역 단위) × 직업 × 슬롯 9종(무기·갑옷·투구·바지·장갑·부츠·팔찌·목걸이·반지) = 360종, 밴드·직업마다 8부위 세트 40개.
   id 는 `${slot}_${cls}_b${band}` 로 고정(저장된 인벤토리와 항상 일치). 능력치는 밴드에 따라 상승, 희귀도는 밴드 구간별 */
const SET_BANDS = { cloth: [0], leather: [1], trinket: [2, 3], chief: [4, 5], steel: [6], knight: [7], crown: [8, 9] };
const GEAR_BAND_ADJ = ['풋내기', '견습', '숙련', '정예', '수호', '영웅', '전설', '고대', '심연', '신성'];
const GEAR_RARITY_BY_BAND = ['common', 'uncommon', 'rare', 'rare', 'epic', 'epic', 'legend', 'legend', 'legend', 'unique'];
const GEAR_CLASS = {
  warrior: { setName: '전사단', hue: '#c0392b', pieces: { weapon: '대검', armor: '판금 갑옷', helmet: '강철 투구', pants: '판금 각반', gloves: '건틀릿', boots: '철화', bracelet: '완갑', necklace: '군표', ring: '인장 반지' }, stat: { def: 1.4, atk: 1.0, hp: 1.3, crit: .4, spd: .6 } },
  archer:  { setName: '추적자', hue: '#27ae60', pieces: { weapon: '장궁', armor: '가죽 조끼', helmet: '깃털 두건', pants: '사냥 바지', gloves: '사수 장갑', boots: '경보화', bracelet: '활팔찌', necklace: '송곳니 목걸이', ring: '매의 반지' }, stat: { def: .8, atk: 1.1, hp: .9, crit: 1.2, spd: 1.4 } },
  rogue:   { setName: '암살자', hue: '#f39c12', pieces: { weapon: '쌍단검', armor: '그림자 외투', helmet: '복면', pants: '은신 바지', gloves: '독날 장갑', boots: '무음화', bracelet: '독침 팔찌', necklace: '밤의 목걸이', ring: '그림자 반지' }, stat: { def: .7, atk: 1.2, hp: .8, crit: 1.6, spd: 1.2 } },
  mage:    { setName: '마도사', hue: '#9b59b6', pieces: { weapon: '지팡이', armor: '로브', helmet: '마법사 모자', pants: '마법 바지', gloves: '주문 장갑', boots: '부유화', bracelet: '마력 팔찌', necklace: '비전 목걸이', ring: '마도 반지' }, stat: { def: .7, atk: 1.4, hp: .9, crit: .8, spd: .8, mp: 1.5 } },
};
const GEAR_SLOTS = ['weapon', 'armor', 'helmet', 'pants', 'gloves', 'boots', 'bracelet', 'necklace', 'ring'];
const zoneGearId = (band, cls, slot) => `${slot}_${cls}_b${band}`;
(function genZoneGear() {
  const shadeHex = (hex, f) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0')).join(''); };
  for (let band = 0; band < 10; band++) {
    const k = 1 + band * .9; /* 밴드 배율: 0밴드 1.0 → 9밴드 9.1 */
    for (const [cls, G] of Object.entries(GEAR_CLASS)) {
      const color = shadeHex(G.hue, .75 + band * .05);
      const pieces = [];
      for (const slot of GEAR_SLOTS) {
        const id = zoneGearId(band, cls, slot);
        const it = { name: `${GEAR_BAND_ADJ[band]} ${G.pieces[slot]}`, slot, cls, color, rarity: GEAR_RARITY_BY_BAND[band], band };
        if (slot === 'weapon') it.atk = Math.round(4 * k * G.stat.atk);
        else if (slot === 'armor') { it.def = Math.round(2.2 * k * G.stat.def); it.hp = Math.round(12 * k * G.stat.hp); }
        else if (slot === 'helmet') { it.def = Math.round(1.4 * k * G.stat.def); if (G.stat.mp) it.mp = Math.round(8 * k); }
        else if (slot === 'pants') it.def = Math.round(1.6 * k * G.stat.def);
        else if (slot === 'gloves') { it.def = Math.round(.8 * k * G.stat.def); it.atk = Math.round(1.2 * k * G.stat.atk); }
        else if (slot === 'boots') { it.def = Math.round(.8 * k * G.stat.def); it.spd = Math.round(6 * k * G.stat.spd / 3); }
        else if (slot === 'bracelet') { it.def = Math.round(.6 * k * G.stat.def); it.atk = Math.round(.8 * k * G.stat.atk); }
        else if (slot === 'necklace') { it.atk = Math.round(1.4 * k * G.stat.atk); if (G.stat.mp) it.mp = Math.round(6 * k); }
        else if (slot === 'ring') it.crit = +(0.012 * k * G.stat.crit).toFixed(3);
        ITEMS[id] = it;
        if (slot !== 'weapon') pieces.push(id);
      }
      SETS[`b${band}_${cls}`] = { name: `${GEAR_BAND_ADJ[band]} ${G.setName}`, color, pieces,
        bonus: { 2: { def: Math.round(2 * k) }, 4: { hp: Math.round(40 * k), atk: Math.round(2 * k) }, 6: { crit: +(.02 + band * .004).toFixed(3), atkMul: .06 + band * .01 }, 8: { defMul: .08 + band * .01, critDmgMul: .1 + band * .02 } } };
      SET_BANDS[`b${band}_${cls}`] = [band];
    }
  }
})();
const SET_PIECE_TO_SET = {};
for (const [sid, s] of Object.entries(SETS)) for (const pid of s.pieces.flat()) SET_PIECE_TO_SET[pid] = sid;
/* 세트 지역락: 밴드(10구역 단위) — 해당 지역에서만 드랍 */
const SET_PIECE_BAND = {};
for (const [sid, bands] of Object.entries(SET_BANDS)) for (const pid of (SETS[sid].pieces || []).flat()) SET_PIECE_BAND[pid] = bands;
const bandOfPage = n => Math.min(9, Math.max(0, Math.floor((((n || 1) - 1)) / 10)));
const setRegionText = sid => (SET_BANDS[sid] || []).map(b => `${BIOMES[b].name} ${b * 10 + 1}~${b * 10 + 10}`).join(' · ');
const BONUS_LABEL = { atk: ['공격', 0], def: ['방어', 0], crit: ['치명타', 1], spd: ['속도', 0], hp: ['HP', 0], mp: ['MP', 0],
  atkMul: ['공격 증폭', 2], defMul: ['방어 증폭', 2], critDmgMul: ['치명피해 증폭', 2],
  bossMul: ['보스 피해', 2], takenMul: ['받는 피해 감소', 2], expMul: ['경험치', 2], goldMul: ['골드', 2] };
function bonusText(bo) {
  return Object.entries(bo).map(([k, v]) => {
    const [label, kind] = BONUS_LABEL[k] || [k, 0];
    const val = kind === 1 ? `+${Math.round(v * 100)}%p` : kind === 2 ? `+${Math.round(v * 100)}%` : `+${v}`;
    return `${label}${val}`;
  }).join(' · ');
}
function equippedSetCounts() {
  const counts = {};
  for (const id of Object.values(me.equipped || {})) {
    if (!id) continue;
    const sid = SET_PIECE_TO_SET[getItem(id)._base || id];
    if (sid) counts[sid] = (counts[sid] || 0) + 1;
  }
  return counts;
}
let setMemoKey = '', setMemoVal = null;
let setPrevCounts = {}; /* 세트 발동 토스트용 이전 장착 카운트 */
function setBonus() {
  /* 매 프레임 스탯 계산에서 호출되므로 장착이 바뀔 때만 재계산 */
  const eq = me.equipped || {}; const key = eq.weapon + '|' + eq.armor + '|' + eq.helmet + '|' + eq.pants + '|' + eq.gloves + '|' + eq.boots + '|' + eq.bracelet + '|' + eq.necklace + '|' + eq.ring; /* 슬롯 고정(9칸) — JSON.stringify보다 가벼운 키 */
  if (key === setMemoKey && setMemoVal) return setMemoVal;
  setMemoKey = key;
  const counts = equippedSetCounts();
  const b = { atk: 0, def: 0, crit: 0, spd: 0, hp: 0, mp: 0, atkMul: 0, defMul: 0, critDmgMul: 0, bossMul: 0, takenMul: 0, expMul: 0, goldMul: 0 };
  const tiers = [];
  for (const [sid, n] of Object.entries(counts)) {
    const s = SETS[sid];
    for (const [tier, bo] of Object.entries(s.bonus)) {
      if (n >= +tier) { for (const [k, v] of Object.entries(bo)) b[k] = (b[k] || 0) + v; tiers.push(sid + ':' + tier); }
    }
  }
  setMemoVal = { b, counts, tiers };
  return setMemoVal;
}
/* 툴팁용: 이 아이템의 세트 소속 + 현재 진행도 */
function setLineFor(baseId) {
  const sid = SET_PIECE_TO_SET[baseId];
  if (!sid) return '';
  const s = SETS[sid];
  const n = setBonus().counts[sid] || 0;
  const total = s.pieces.length;
  const next = Object.keys(s.bonus).map(Number).sort((a, b) => a - b).find(t => t > n);
  let line = `◈ ${s.name} 세트 (${n}/${total})`;
  if (next) line += `\n다음: ${next}셋 — ${bonusText(s.bonus[next])}`;
  line += `\n드랍: ${setRegionText(sid)}`;
  return line;
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
  whirlwind:    { cls: 'warrior', icon: '🌪', name: '회오리 베기',   desc: '주변 광역 회전 참격 (공격력 200%)',            type: 'active', cd: 10000, cost: 550, mp: 22 },
  warcry:       { cls: 'warrior', icon: '🔥', name: '전투의 함성',   desc: '공격력 영구 증가 (+3)',                        type: 'passive', atk: 3,   cost: 500 },
  iron_body:    { cls: 'warrior', icon: '🛡', name: '철벽',         desc: '방어력 영구 증가 (+2)',                        type: 'passive', def: 2,   cost: 450 },
  multishot:    { cls: 'archer',  icon: '🎯', name: '다중 사격',     desc: '주변 모든 적 타격 (공격력 150%)',              type: 'active', cd: 8000,  cost: 450, mp: 20 },
  piercing:     { cls: 'archer',  icon: '💘', name: '관통 사격',     desc: '전방 직선 관통 (공격력 240%, 거리순 연쇄)',      type: 'active', cd: 9000,  cost: 550, mp: 22 },
  sharpshooter: { cls: 'archer',  icon: '🔭', name: '정밀 조준',     desc: '공격력 영구 증가 (+3)',                        type: 'passive', atk: 3,   cost: 500 },
  swift_feet:   { cls: 'archer',  icon: '👟', name: '민첩',         desc: '이동속도 증가 (+15)',                          type: 'passive', spd: 15,  cost: 400 },
  shadow_strike:{ cls: 'rogue',   icon: '🌑', name: '그림자 일격',   desc: '단일 처형 일격 (공격력 600%, 필중 크리티컬)',  type: 'active', cd: 7000,  cost: 450, mp: 20 },
  phantom:      { cls: 'rogue',   icon: '⚡', name: '팬텀 대거',     desc: '순간 3연타 (공격력 170%×3, 막타 크리)',         type: 'active', cd: 9000,  cost: 550, mp: 22 },
  assassination:{ cls: 'rogue',   icon: '🔪', name: '암살 본능',     desc: '치명타 확률 증가 (+7%p)',                      type: 'passive', crit: .07, cost: 550 },
  swift_feet2:  { cls: 'rogue',   icon: '👟', name: '신속',         desc: '이동속도 증가 (+15)',                          type: 'passive', spd: 15,  cost: 400 },
  fireball:     { cls: 'mage',    icon: '☄', name: '화염구',       desc: '광역 폭발 피해 (공격력 220%)',                 type: 'active', cd: 9000,  cost: 500, mp: 25 },
  frost_nova:   { cls: 'mage',    icon: '❄', name: '서리 폭발',     desc: '주변 빙결 폭발 (공격력 200%, 넓은 범위)',       type: 'active', cd: 11000, cost: 600, mp: 24 },
  magic_power:  { cls: 'mage',    icon: '📖', name: '마력 강화',     desc: '공격력 영구 증가 (+4)',                        type: 'passive', atk: 4,   cost: 550 },
  mana_shield:  { cls: 'mage',    icon: '🔮', name: '마나 보호막',   desc: '방어력 영구 증가 (+2)',                        type: 'passive', def: 2,   cost: 450 },
  heal:         { cls: 'all',     icon: '💚', name: '회복술',       desc: '최대 HP의 40% 즉시 회복',                      type: 'active', cd: 20000, cost: 800, mp: 30 },
};

/* ================= 스킬 트리 (직업별 100종) =================
   결정적 생성(난수 없음): 저장된 tree{id:true}와 항상 일치.
   구성/티어: 10티어×10노드 = 액티브4+패시브4+스탯2 */
const TREE_ARCHS = ['nuke', 'cleave', 'storm', 'chain', 'dash', 'volley', 'heal'];
const TREE_PSTATS = ['atk', 'def', 'crit', 'spd'];
const TREE_ADJ = {
  warrior: ['파괴의', '처형의', '분쇄의', '강철의', '광전사의', '수호자의', '파멸의', '불굴의', '전장의', '피의', '승리의', '심판의', '격노의', '대지의', '맹렬한', '고고한'],
  archer: ['추적자의', '매의', '바람의', '달빛의', '숲의', '예리한', '신속의', '명중의', '야생의', '은빛의', '폭풍의', '정밀한', '질풍의', '황혼의', '새벽의', '무자비한'],
  rogue: ['그림자의', '암살자의', '독사의', '밤의', '은밀한', '치명적인', '교활한', '월광의', '맹독의', '무형의', '적막의', '비열한', '날랜', '어둠의', '비밀의', '잔인한'],
  mage: ['화염의', '얼음의', '번개의', '비전의', '별빛의', '심연의', '마력의', '폭풍의', '신비한', '고대의', '영혼의', '수정핵의', '용암의', '극광의', '혼돈의', '지혜의'],
};
const TREE_NOUN_A = {
  warrior: ['참격', '일격', '베기', '돌진', '포효', '연격', '격파', '휩쓸기'],
  archer: ['사격', '저격', '연사', '화살비', '조준', '관통', '속사', '곡사'],
  rogue: ['일격', '베기', '독침', '급습', '연무', '참수', '비수', '그림자걸음'],
  mage: ['화염구', '폭발', '창', '폭풍', '별똥', '노바', '빔', '메테오'],
};
const TREE_NOUN_P = { atk: ['격투 수련', '무기 단련'], def: ['호신 수련', '갑주 단련'], crit: ['집중', '통찰'], spd: ['신속', '민첩'] };
const TREE_ICONS = {
  warrior: ['⚔️', '🪓', '🔨', '💥', '🌪️', '🛡️', '🔥', '💢', '🌀', '⚡'],
  archer: ['🏹', '🎯', '💘', '🌪️', '⚡', '🦅', '🌙', '💨', '🔭', '✨'],
  rogue: ['🗡️', '🌑', '⚡', '🐍', '🌙', '💜', '🌀', '🔪', '💨', '☠️'],
  mage: ['🔥', '❄️', '⚡', '☄️', '🌟', '💫', '🔮', '🌪️', '✨', '💎'],
};
const TREE_COL = { warrior: '#ffb347', archer: '#e8d9a0', rogue: '#b388ff', mage: '#ff7f27' };
const TREES = {};
const TREES_ALL = {};
(function buildTrees() {
  const used = new Set();
  const uniq = base => { let n = base, k = 2; while (used.has(n)) n = `${base} ${k++}`; used.add(n); return n; };
  const suf = t => (t >= 8 ? ' · 진' : t >= 5 ? ' · 강' : '');
  const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ'];
  for (const cls of ['warrior', 'archer', 'rogue', 'mage']) {
    TREES[cls] = {};
    const adj = TREE_ADJ[cls], nouns = TREE_NOUN_A[cls], icons = TREE_ICONS[cls];
    for (let tier = 1; tier <= 10; tier++) {
      for (let i = 0; i < 10; i++) {
        const id = `${cls}_t${tier}_${String(i + 1).padStart(2, '0')}`;
        const slot = (tier + i) % 10;
        let d;
        if (slot < 4) {
          const arch = TREE_ARCHS[(tier + i) % TREE_ARCHS.length];
          const baseM = { nuke: 3.2, cleave: 1.8, storm: 1.35, chain: 1.5, dash: 2.4, volley: 1.15, heal: 0 }[arch];
          const mult = arch === 'heal' ? 0 : +(baseM * (1 + (tier - 1) * .32)).toFixed(2);
          const hitDesc = arch === 'heal' ? `HP ${(20 + tier * 2)}% 회복`
            : arch === 'chain' ? `3연타 ${Math.round(mult * 100)}%` : arch === 'volley' ? `5발 ${Math.round(mult * 100)}%`
            : arch === 'dash' ? `돌진 ${Math.round(mult * 100)}%` : `${Math.round(mult * 100)}%`;
          const aoeDesc = (arch === 'cleave' || arch === 'storm') ? ` (주변 ${arch === 'storm' ? 150 + tier * 10 : 120 + tier * 6})` : '';
          d = { cls, tier, kind: 'active', arch, icon: icons[(tier * 3 + i) % icons.length],
            name: uniq(`${adj[(tier * 5 + i * 3) % adj.length]} ${nouns[(tier * 2 + i) % nouns.length]}${suf(tier)}`),
            desc: hitDesc + aoeDesc, mp: 14 + tier * 2, cd: 6000 + tier * 900,
            mult, aoe: arch === 'storm' ? 150 + tier * 10 : arch === 'cleave' ? 120 + tier * 6 : 0,
            hits: arch === 'chain' ? 3 : arch === 'volley' ? 5 : 1,
            dash: arch === 'dash', self: arch === 'cleave' || arch === 'storm',
            healPct: arch === 'heal' ? (.2 + tier * .02) : 0 };
        } else if (slot < 8) {
          const st = TREE_PSTATS[(tier + i) % 4];
          const v = st === 'crit' ? +(tier * .008).toFixed(3) : st === 'spd' ? 2 + ((tier / 2) | 0) : 1 + ((tier / 3) | 0);
          const lbl = st === 'atk' ? '공격' : st === 'def' ? '방어' : st === 'crit' ? '치명타' : '속도';
          const val = st === 'crit' ? `+${Math.round(v * 100)}%p` : `+${v}`;
          d = { cls, tier, kind: 'passive', icon: '📈', stat: st,
            name: uniq(`${adj[(tier * 7 + i * 2) % adj.length]} ${TREE_NOUN_P[st][(tier + i) % 2]}${suf(tier)}`),
            desc: `${lbl} 영구 증가 (${val})`, [st]: v };
        } else {
          const hp = (tier + i) % 2 === 0;
          d = { cls, tier, kind: 'stat', icon: hp ? '❤️' : '💧',
            name: `${hp ? '체력' : '마나'} 강화 ${ROMAN[tier - 1]}`,
            desc: `최대 ${hp ? 'HP' : 'MP'} +${hp ? 20 * tier : 10 * tier}`, [hp ? 'hp' : 'mp']: hp ? 20 * tier : 10 * tier };
        }
        TREES[cls][id] = d; TREES_ALL[id] = d;
      }
    }
  }
})();
const skillDef = id => SKILLS[id] || TREES_ALL[id];
/* ================= 스킬 등급 =================
   기본 스킬은 고정 등급, 트리 스킬은 티어로 결정. 등급은 위력 배율·아이콘 테두리·스킬서 등급에 쓰인다 */
const SKILL_GRADE_BASE = { power_strike: 'rare', whirlwind: 'epic', warcry: 'uncommon', iron_body: 'uncommon',
  multishot: 'rare', piercing: 'epic', sharpshooter: 'uncommon', swift_feet: 'uncommon',
  shadow_strike: 'rare', phantom: 'epic', assassination: 'uncommon', swift_feet2: 'uncommon',
  fireball: 'rare', frost_nova: 'epic', magic_power: 'uncommon', mana_shield: 'uncommon', heal: 'epic' };
const SKILL_GRADE_MUL = { common: 1, uncommon: 1.05, rare: 1.1, epic: 1.18, legend: 1.28, unique: 1.4 };
function skillGrade(id, def) {
  if (SKILL_GRADE_BASE[id]) return SKILL_GRADE_BASE[id];
  const t = (def || skillDef(id) || {}).tier || 1;
  return t <= 2 ? 'common' : t <= 4 ? 'uncommon' : t <= 6 ? 'rare' : t <= 8 ? 'epic' : t <= 9 ? 'legend' : 'unique';
}
const isPassiveSkill = def => !!def && (def.type === 'passive' || def.kind === 'passive' || def.kind === 'stat');
/* 스킬서 아이템: 유니크(보스) 몬스터가 간헐적으로 드랍. 가방에서 더블 클릭하면 해당 스킬 습득/레벨업/강화 */
(function genSkillBooks() {
  const add = (id, d) => {
    const cls = d.cls && CLASSES[d.cls] ? d.cls : null;
    ITEMS['sb_' + id] = { name: `${d.name} 스킬서`, book: id, bookCls: d.cls || 'all', rarity: skillGrade(id, d),
      color: (cls && CLASSES[cls].color) || '#ffd700' };
  };
  for (const [id, d] of Object.entries(SKILLS)) add(id, d);
  for (const [id, d] of Object.entries(TREES_ALL)) add(id, d);
})();
const hasSkill = id => SKILLS[id] ? skillLv(id) >= 1 : !!((me.tree || {})[id]);
const treeCost = tier => 150 * tier * tier;
const treeTierReq = tier => ({ lv: 1 + (tier - 1) * 2, pts: (tier - 1) * 3 });
function treeStat(f) {
  let a = 0;
  const t = me.tree || {};
  for (const id in t) { const d = TREES_ALL[id]; if (d && t[id]) a += d[f] || 0; }
  return a;
}
function treeOwnedCount(cls) {
  let n = 0;
  const t = me.tree || {};
  for (const id in t) if (t[id] && TREES_ALL[id] && TREES_ALL[id].cls === cls) n++;
  return n;
}
function buyTreeNode(id) {
  const d = TREES_ALL[id];
  if (!d || (me.tree || {})[id]) return;
  const cost = treeCost(d.tier), req = treeTierReq(d.tier);
  if ((me.lv || 1) < req.lv) { toast(`🔒 Lv ${req.lv}부터 해금`); return; }
  if (treeOwnedCount(d.cls) < req.pts) { toast(`🔒 같은 계열 ${req.pts}개 선행 습득 필요`); return; }
  runTx(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return false;
    const p = snap.data();
    if (((p.tree || {})[id]) || (p.gold || 0) < cost) return false;
    tx.update(meRef, { gold: p.gold - cost, [`tree.${id}`]: true, q: { ...(p.q || {}), skills_bought: ((p.q || {}).skills_bought || 0) + 1 } });
    return true;
  }).then(ok => {
    if (!ok) { toast('💰 골드가 부족합니다'); return; }
    sfx('buy'); toast(`✦ ${d.name} 습득!`, 'sysq'); float(me.x, me.y - 34, `${d.name} 습득!`, '#7fe3a0');
    renderTree();
  }).catch(() => {});
}
/* 스킬 이름의 속성어 → 이펙트 색 (같은 아키타입이라도 화염/서리/번개/그림자… 색이 다르게) */
function skillElemColor(def) {
  const n = def.name || '';
  if (/화염|용암|불|맹렬|격노|피의/.test(n)) return '#ff7f27';
  if (/얼음|서리|극광|은빛|달빛/.test(n)) return '#7fd8ff';
  if (/번개|폭풍|질풍|바람|신속|날랜/.test(n)) return '#ffe66d';
  if (/그림자|어둠|밤|암살|무형|적막|심연|혼돈/.test(n)) return '#b388ff';
  if (/독사|맹독|독/.test(n)) return '#7ddc7d';
  if (/별빛|새벽|황혼|비전|신비|영혼|수정/.test(n)) return '#e8f4ff';
  if (/대지|강철|분쇄|파괴|격파/.test(n)) return '#d9a066';
  return TREE_COL[def.cls] || '#ffd700';
}
const hexRgb = h => { const x = h.replace('#', ''); const f = x.length === 3 ? x.split('').map(c => c + c).join('') : x; return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16) || 0).join(','); };
let bolts = [], meteors = [];
/* 번개: 두 점 사이 지그재그 폴리라인 (체인/번개 속성) */
function fxBolt(x0, y0, x1, y1, color, w = 3) {
  const pts = [[x0, y0]]; const n = 7 + Math.floor(Math.hypot(x1 - x0, y1 - y0) / 30);
  for (let i = 1; i < n; i++) { const k = i / n; const nx = -(y1 - y0), ny = (x1 - x0); const L = Math.hypot(nx, ny) || 1; const j = rand(-14, 14); pts.push([x0 + (x1 - x0) * k + nx / L * j, y0 + (y1 - y0) * k + ny / L * j]); }
  pts.push([x1, y1]);
  bolts.push({ pts, color, t: 0, max: 240, w });
}
/* 메테오: 하늘에서 떨어지는 구체 + 낙하 후 폭발 링 */
function fxMeteor(x, y, color, size = 10, onLand) {
  meteors.push({ x, y, color, size, t: 0, max: 380, sx: x + rand(-90, -40), onLand });
}
/* 트리 스킬 아키타입별 연출 — nuke=메테오 / cleave=대검 참격+충격파 / storm=회전 3연참 / chain=번개 연쇄 / dash=잔상 돌진 / volley=화살비 */
function treeSkillFx(id, d, t, cx, cy, castPage) {
  const col = skillElemColor(d), rgb = hexRgb(col), tierK = 1 + (d.tier - 1) * .06;
  fxFlash(rgb, 220, .16 + d.tier * .012);
  switch (d.arch) {
    case 'nuke':
      fxMeteor(cx, cy, col, 9 + d.tier, () => {
        rings.push({ x: cx, y: cy, r: 110 * tierK, t: 0, max: 480, color: rgb });
        rings.push({ x: cx, y: cy, r: 60 * tierK, t: 0, max: 320, color: '255,240,200' });
        fxSparks(cx, cy, 20 + d.tier * 2, col, 220); doShake(8); sfx('boom');
      });
      sfx('shoot');
      break;
    case 'cleave':
      slashes.push({ x: me.x, y: me.y, a: Math.atan2(t.y - me.y, t.x - me.x), t: 0, w: 13, len: (d.aoe || 120) * .62, color: col });
      setTimeout(() => { if (myPage() === castPage) slashes.push({ x: me.x, y: me.y, a: Math.atan2(t.y - me.y, t.x - me.x) + .5, t: 0, w: 8, len: (d.aoe || 120) * .5, color: '#ffffff' }); }, 90);
      rings.push({ x: me.x, y: me.y, r: d.aoe || 120, t: 0, max: 380, color: rgb });
      fxSparks(cx, cy, 12, col, 180); doShake(7); sfx('crit');
      break;
    case 'storm':
      for (let k = 0; k < 3; k++) setTimeout(() => {
        if (myPage() !== castPage) return;
        slashes.push({ x: me.x, y: me.y, a: me.face + k * 2.09 + k * .3, t: 0, w: 9, len: (d.aoe || 150) * .55, color: k % 2 ? '#ffffff' : col });
        for (let i = 0; i < 8; i++) { const a = k * 2.09 + i * .78; const r = (d.aoe || 150) * .6; poofs.push({ x: me.x + Math.cos(a) * r, y: me.y + Math.sin(a) * r, vx: -Math.sin(a) * 140, vy: Math.cos(a) * 140, r: 2.2, t: 0, color: col, g: 0 }); }
      }, k * 110);
      rings.push({ x: me.x, y: me.y, r: d.aoe || 150, t: 0, max: 520, color: rgb });
      doShake(6); sfx('boom');
      break;
    case 'chain': {
      fxBolt(me.x, me.y - 18, t.x, t.y - 10, col, 3.5);
      const others = sims.filter(s => s.alive && s !== t && Math.hypot(s.x - t.x, s.y - t.y) < 150).slice(0, 2);
      let px = t.x, py = t.y;
      others.forEach((o, i) => setTimeout(() => { if (myPage() === castPage) { fxBolt(px, py - 10, o.x, o.y - 10, col, 2.5); fxSparks(o.x, o.y, 6, col, 120); } px = o.x; py = o.y; }, 90 + i * 90));
      for (let h = 0; h < 3; h++) setTimeout(() => { if (myPage() === castPage) { fxSparks(t.x, t.y - 8, 7, h % 2 ? '#ffffff' : col, 150); rings.push({ x: t.x, y: t.y, r: 34, t: 0, max: 220, color: rgb }); } }, h * 130);
      doShake(4); sfx('crit');
      break;
    }
    case 'dash': {
      /* 잔상: 출발점→도착점 사이에 흐려지는 실루엣 점 */
      const sx = t.x - (me.x - t.x) * 0, sy = t.y; const ox = me.x, oy = me.y;
      for (let i = 0; i < 7; i++) { const k = i / 6; poofs.push({ x: ox + (t.x - ox) * k, y: oy + (t.y - oy) * k - 14, vx: 0, vy: -20, r: 5 - k * 2, t: 0, color: col, g: 0 }); }
      slashes.push({ x: t.x, y: t.y, a: Math.atan2(t.y - oy, t.x - ox), t: 0, w: 8, len: 56, color: col });
      slashes.push({ x: t.x, y: t.y, a: Math.atan2(t.y - oy, t.x - ox) + Math.PI, t: 0, w: 5, len: 40, color: '#ffffff' });
      rings.push({ x: t.x, y: t.y, r: 60, t: 0, max: 300, color: rgb });
      fxSparks(t.x, t.y, 14, col, 200); doShake(6); sfx('crit');
      break;
    }
    case 'volley':
      for (let k = 0; k < d.hits; k++) setTimeout(() => {
        if (myPage() !== castPage) return;
        const ax = t.x + rand(-34, 34), ay = t.y + rand(-26, 26);
        shots.push({ x: ax + 30, y: ay - 240, vx: -30 / .26, vy: 240 / .26, t: 0, max: 260, color: col, size: 4 });
        setTimeout(() => { if (myPage() === castPage) { rings.push({ x: ax, y: ay, r: 22, t: 0, max: 200, color: rgb }); fxSparks(ax, ay, 4, col, 90); } }, 250);
      }, k * 70);
      sfx('shoot');
      break;
    default:
      rings.push({ x: cx, y: cy, r: Math.max(50, d.aoe || 60), t: 0, max: 400, color: rgb });
      fxSparks(cx, cy, 14, col, 170); doShake(6); sfx('boom');
  }
}
function castTreeSkill(id) {
  const d = TREES_ALL[id];
  if (!d) return false;
  const now = Date.now(), castPage = myPage();
  const col = TREE_COL[d.cls] || '#ffd700';
  const pow = totalAtk() * skillPow() * (SKILL_GRADE_MUL[skillGrade(id, d)] || 1); /* 등급 배율 */
  const hit = (t, m, crit) => attackResult(t, Math.max(1, Math.round(pow * m * rand(.9, 1.1))), crit);
  me.swing = now;
  if (d.arch === 'heal') {
    const amt = Math.round(maxHpOf() * d.healPct * skillPow());
    me.hp = Math.min(maxHpOf(), (me.hp || 0) + amt);
    updX(meRef, { hp: me.hp }).catch(() => {});
    float(me.x, me.y - 34, `+${amt} HP`, '#2ecc71');
    rings.push({ x: me.x, y: me.y, r: 70, t: 0, max: 450, color: '46,204,113' });
    fxSparks(me.x, me.y - 10, 12, '#7fe3a0', 110);
    sfx('heal');
    return true;
  }
  const t = nearestSim(d.self ? (d.aoe + 40) : 340);
  if (!t) { float(me.x, me.y - 34, '대상 없음', '#aaa'); return false; }
  if (d.dash) {
    poofs.push({ x: me.x, y: me.y, vx: 0, vy: 0, r: 16, t: 0, color: '#34495e', g: -60 });
    me.x = clampN(t.x + rand(-40, 40), 40, WORLD.w - 40);
    me.y = clampN(t.y + rand(-40, 40), 40, WORLD.h - 40);
    cam.x = me.x; cam.y = me.y;
  }
  const cx = d.self ? me.x : t.x, cy = d.self ? me.y : t.y;
  treeSkillFx(id, d, t, cx, cy, castPage);
  const victims = d.aoe ? sims.filter(s => s.alive && Math.hypot(s.x - cx, s.y - cy) < d.aoe) : [t];
  if (!victims.length) { float(me.x, me.y - 34, '대상 없음', '#aaa'); return false; }
  const land = d.arch === 'nuke' ? 300 : 0; /* 메테오 낙하 시간 뒤에 피해 */
  victims.forEach((v, vi) => {
    for (let h = 0; h < (d.hits > 1 && !d.aoe ? d.hits : 1); h++) {
      setTimeout(() => {
        if (myPage() !== castPage || !v.alive) return;
        hit(v, d.mult, h === (d.hits > 1 && !d.aoe ? d.hits : 1) - 1 && Math.random() < totalCrit());
      }, land + (vi * 60) + h * 130);
    }
  });
  if (d.aoe && d.hits > 1) {
    for (let h = 1; h < d.hits; h++) {
      setTimeout(() => {
        if (myPage() !== castPage) return;
        for (const v of sims.filter(s => s.alive && Math.hypot(s.x - cx, s.y - cy) < d.aoe)) hit(v, d.mult, false);
      }, land + h * 200);
    }
  }
  return true;
}
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
const maxHpOf = () => Math.round(cdef().hp + ((me.lv || 1) - 1) * 10 + (me.stHp || 0) * 15 + setBonus().b.hp);
const maxMpOf = () => (cdef().mp || 100) + ((me.lv || 1) - 1) * 5 + (me.stWis || 0) * 12 + setBonus().b.mp; /* 직업별 기본 MP: 마법사 150 · 아처 90 · 로그 80 · 전사 70 */
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
  for (let i = 0; i < MAX_BAG; i++) { /* 이전엔 40칸까지만 훑어 뒤쪽 슬롯 아이템이 정렬 시 소실됐다(가방은 최대 MAX_BAG칸) */
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
  if (meRef) updX(meRef, { muted }).catch(() => {});
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
/* 스킬 화면 플래시: 시전 위치 중심의 방사형 섬광 (가산 블렌딩) */
let flashes = [];
function fxFlash(rgb, ms, str = .35) { flashes.push({ rgb, t: 0, max: ms, str, x: me.x, y: me.y }); }
let othersPrev = {}, mePrev = { x: SPAWN.x, y: SPAWN.y }, meMovingNow = false;
let mouseDown = false, dest = null, attackTargetSimId = null;
/* 설정(로컬 저장) + 자동 사냥 */
let horde = null; /* 쇄도(생존 웨이브) 런 상태 — 아래 쇄도 섹션 참고 */
const hordeOn = () => !!horde && horde.st === 'run';
const hb = k => (horde && horde.st === 'run' && horde.b[k]) || 0; /* 각인 배율(런 밖에서는 0) */
let autoHunt = false, autoSkillT = 0, autoPotT = 0, targetT0 = 0; const simSkip = {}; /* 자동 사냥: 8초 안에 못 닿는 몬스터는 20초 제외 */
const settings = { autoPotHp: 45, autoPotMp: 20, dmgText: true, screenShake: true, autoSell: {} }; /* autoSell: 등급별 자동 판매 on/off */
try { const sv = JSON.parse(localStorage.getItem('settings') || '{}'); Object.assign(settings, sv); } catch (e) {}
const saveSettings = () => { try { localStorage.setItem('settings', JSON.stringify(settings)); } catch (e) {} };
const view = { x: 0, y: 0, z: 1 };
/* 사용자 확대/축소 배율 (핀치·휠). 실제 배율은 draw()에서 화면 채움 배율과 곱해 clamp된다. */
let userZoom = 1, pinchD0 = 0, pinchZ0 = 1;
const USER_ZOOM_MIN = .5, USER_ZOOM_MAX = 3;
const MOBILE_VIEW_W = 820; /* 모바일에서 화면 가로에 담을 월드 px */
function setUserZoom(v) {
  if (innerWidth <= 640) { userZoom = 1; return; } /* 모바일: 인앱 뷰포트 해상도 고정 — 핀치/휠 확대·축소 없음 */
  userZoom = clampN(v, USER_ZOOM_MIN, USER_ZOOM_MAX);
  try { localStorage.setItem('zoom2', String(userZoom)); } catch (e) {} /* 'zoom' 키는 휠 폭주 버그 값이 남아 있어 폐기 */
}
userZoom = USER_ZOOM_MIN; /* 시작은 항상 가장 넓은 화면(최대 시야) — 세션 중 Ctrl/⌘+휠로만 확대 */
try { localStorage.removeItem('zoom'); localStorage.removeItem('zoom2'); } catch (e) {}
let lastAttackAt = 0, lastPosWrite = 0, hurtUntil = 0, picking = false;
let sentX = -1, sentY = -1, sentHp = -1, sentMp = null;
let ready = false;
let loginAt = Date.now();
let shakeT = 0, shakePow = 0, lastRegenWrite = 0, dustT = 0, hpDirty = false;
let goldHintShown = false;
let hitStopUntil = 0, mapFading = false, portalHintT = 0;
let quotaHitAt = 0; /* Firestore resource-exhausted 감지 시각 */
function onQuotaExceeded() {
  quotaHitAt = Date.now();
  let el = document.getElementById('quotaBar');
  if (!el) { el = document.createElement('div'); el.id = 'quotaBar'; el.title = '탭하면 닫힘'; el.onclick = () => { el.style.display = 'none'; }; document.body.appendChild(el); }
  if (el.style.display === 'none' && Date.now() - quotaHitAt < 300000) { quotaHitAt = Date.now(); return; } /* 닫은 뒤 5분간은 다시 띄우지 않음 */
  el.textContent = '⚠️ 서버 저장 한도 초과 — 로컬 모드로 계속 플레이합니다. 진행은 이 기기에 저장되고, 한도가 풀리면(매일 16~17시 KST) 자동으로 서버에 동기화됩니다.';
  el.style.display = 'block';
}

/* ================= 저장 계층: 온라인 쓰기 ↔ 한도 초과 시 로컬 폴백 =================
   Spark 플랜 일일 쓰기 한도(2만)를 넘으면 모든 쓰기가 resource-exhausted로 실패해 '피가 안 달고 아이템을 못 먹는' 상태가 됐다.
   → 쓰기 실패를 감지하면 '로컬 모드'로 전환: 내 문서(me)·몬스터·루팅에 대한 트랜잭션/업데이트를 로컬 상태에 그대로 적용하고,
     바뀐 최상위 필드 이름을 기억(localStorage)해 두었다가 쓰기가 다시 통하는 시점에 그 필드들을 한 번에 서버로 밀어 넣는다.
   몬스터 HP는 평시에도 클라이언트가 권위(서버 쓰기는 처치·리스폰 1회) → 쓰기량 자체가 이전의 1/5 이하 */
let offline = false, offlineSince = 0, lastProbe = 0, pendSaveT = 0, lastSyncAt = 0;
const pendKeys = new Set();
/* 서버 절약 모드: 온라인이어도 쓰기를 로컬에 모아 20초마다 한 번에 동기화 — Spark 일일 쓰기 한도(2만)를 수십 시간 플레이로 늘린다 */
const ecoOn = () => !offline; /* 항상 켜짐(설정 없음): 로컬 저장 후 1분마다 DB에 일괄 저장 */
const isQuotaErr = e => !!e && (e.code === 'resource-exhausted' || e.code === 'timeout' || /quota|resource-exhausted/i.test(String(e.message || e)));
/* Firestore SDK는 resource-exhausted 쓰기를 지수 백오프로 무한 재시도해 promise가 수십 초 매달린다 → 시간 제한을 걸어 로컬 모드로 넘긴다
   (네트워크 단절도 같은 경로로 로컬 모드가 된다) */
const TX_TIMEOUT = 8000, UPD_TIMEOUT = 6000, OFFLINE_DWELL = 300000, ECO_SYNC_MS = 60000; /* 절약 모드 저장 주기 1분 */
const PEND_VOLATILE = new Set(['x', 'y', 'hp', 'mp', 'dead', 'deadUntil', 'lastSeen', 'lastHurtAt', 'power', 'map']);
function withTimeout(p, ms) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(Object.assign(new Error('write-timeout'), { code: 'timeout' })), ms);
    p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
  });
}
const inc = n => ({ __inc: n }); /* increment() 대체 — 로컬 적용이 가능해야 해서 자체 표식 사용 */
const PEND_KEY = () => 'pend_' + uid;
function getPath(o, k) { return k.split('.').reduce((a, p) => (a == null ? undefined : a[p]), o); }
/* 점 경로·증분 표식을 지원하는 로컬 업데이트 적용 */
function applyUpd(target, upd) {
  for (const [k, raw] of Object.entries(upd)) {
    const v = (raw && typeof raw === 'object' && '__inc' in raw) ? ((+getPath(target, k) || 0) + raw.__inc) : raw;
    if (k.includes('.')) {
      const parts = k.split('.');
      let o = target;
      for (let i = 0; i < parts.length - 1; i++) {
        o[parts[i]] = (o[parts[i]] && typeof o[parts[i]] === 'object') ? { ...o[parts[i]] } : {};
        o = o[parts[i]];
      }
      o[parts[parts.length - 1]] = v;
    } else target[k] = v;
  }
}
function toServerUpd(upd) { const o = {}; for (const [k, v] of Object.entries(upd)) o[k] = (v && typeof v === 'object' && '__inc' in v) ? increment(v.__inc) : v; return o; }
function savePend() {
  clearTimeout(pendSaveT);
  pendSaveT = setTimeout(() => {
    try {
      if (!uid) return;
      if (!pendKeys.size) { localStorage.removeItem(PEND_KEY()); return; }
      const snap = {}; for (const k of pendKeys) if (me[k] !== undefined) snap[k] = me[k];
      snap.x = me.x; snap.y = me.y; snap.hp = me.hp; if (me.mp != null) snap.mp = Math.round(me.mp);
      localStorage.setItem(PEND_KEY(), JSON.stringify({ keys: [...pendKeys], me: snap, ts: Date.now() }));
    } catch (e) {}
  }, 150);
}
function enterOffline(err) {
  if (!offline) {
    offline = true; offlineSince = Date.now();
    toast('☁️ 서버 저장 한도 초과 → <b>로컬 모드</b>로 전환. 계속 플레이할 수 있고, 진행은 한도가 풀리면 자동 동기화됩니다.', 'sysq');
  }
  onQuotaExceeded();
  window.__lastErr = { at: Date.now(), where: 'enterOffline', code: err && err.code, msg: String(err && err.message || err) };
}
/* 로컬 적용: 내 문서 */
let invRerenderT = 0, syncSoonT = 0;
function applyLocalMe(upd) {
  applyUpd(me, upd);
  for (const k of Object.keys(upd)) { const top = k.split('.')[0]; if (!PEND_VOLATILE.has(top)) pendKeys.add(top); } /* 위치·HP·생사 같은 휘발 필드는 동기화 때 현재값으로 실린다 */
  if (syncing) for (const k of Object.keys(upd)) dirtyDuringSync.add(k.split('.')[0]); /* 동기화 전송 중 바뀐 키는 성공 후에도 보류 유지 */
  savePend();
  if (!offline && Date.now() - lastSyncAt >= ECO_SYNC_MS) { clearTimeout(syncSoonT); syncSoonT = setTimeout(() => trySync(true), 1200); } /* 마지막 저장 후 1분 지났으면 곧 저장, 아니면 주기 저장에 실림(쓰기 절약) */
  clearTimeout(invRerenderT);
  invRerenderT = setTimeout(() => { try { renderInvUI(); renderRank(); if ($('shopPanel')?.classList.contains('open')) renderShop(); if ($('treePanel')?.classList.contains('open')) renderTree(); } catch (e) {} }, 30);
}
const simDoc = s => ({ alive: !!s.alive, hp: s.hp, maxHp: s.maxHp, page: s.page, kind: s.kind, uniq: !!s.uniq, boss: !!s.boss, respawnAt: s.respawnAt || 0, homeX: s.homeX, homeY: s.homeY });
function applyLocalSim(id, upd) {
  const s = sims.find(x => x.id === id);
  if (!s) return;
  if ('alive' in upd) {
    if (upd.alive && !s.alive) { s.x = s.homeX; s.y = s.homeY; if (s.boss) bossAlert(true); }
    if (!upd.alive && s.alive) { spawnPoof(s); s.deadT = Date.now(); if (s.boss) bossAlert(false); }
    s.alive = !!upd.alive;
  }
  if ('uniq' in upd) { s.uniq = !!upd.uniq; s._ud = null; }
  if ('maxHp' in upd) s.maxHp = upd.maxHp;
  if ('hp' in upd) s.hp = upd.hp;
  if ('respawnAt' in upd) s.respawnAt = upd.respawnAt;
  s.srvHp = s.hp;
}
const snapOf = (data, id) => ({ id, exists: () => data != null, data: () => data == null ? undefined : JSON.parse(JSON.stringify(data)) });
/* 가짜 트랜잭션: 읽기는 로컬 상태, 쓰기는 콜백이 끝난 뒤 로컬에 반영 */
function localTx(fn) {
  const ops = [];
  const pathOf = ref => ref.path || (ref._key && ref._key.path && ref._key.path.canonicalString()) || '';
  const tx = {
    get: async ref => {
      const p = pathOf(ref);
      if (meRef && p === pathOf(meRef)) return snapOf(me, uid);
      const [col, id] = p.split('/');
      if (col === 'monsters') { const sm = sims.find(x => x.id === id); return snapOf(sm ? simDoc(sm) : null, id); }
      if (col === 'loot') return snapOf(lootItems[id] || null, id);
      return snapOf(null, id);
    },
    update: (ref, upd) => ops.push(['update', pathOf(ref), upd]),
    set: (ref, data) => ops.push(['set', pathOf(ref), data]),
    delete: ref => ops.push(['delete', pathOf(ref)]),
  };
  return Promise.resolve().then(() => fn(tx)).then(r => {
    for (const [op, p, data] of ops) {
      const [col, id] = p.split('/');
      if (meRef && p === pathOf(meRef)) { if (op !== 'delete') applyLocalMe(data); }
      else if (col === 'monsters') { if (op !== 'delete') applyLocalSim(id, data); }
      else if (col === 'loot') { if (op === 'delete') delete lootItems[id]; else lootItems[id] = data; }
    }
    return r;
  });
}
/* 트랜잭션 진입점: 온라인이면 서버, 한도 초과면 로컬 */
function runTx(dbArg, fn) {
  if (offline || ecoOn()) return localTx(fn); /* 절약 모드: 로컬 적용 + 보류 → 주기 동기화 */
  return withTimeout(runTransaction(dbArg, fn), TX_TIMEOUT).catch(err => {
    if (!isQuotaErr(err)) throw err;
    enterOffline(err);
    return localTx(fn);
  });
}
/* 내 문서 단순 업데이트 */
function updX(ref, upd) {
  if (offline || ecoOn()) { applyLocalMe(upd); return Promise.resolve(); }
  return withTimeout(updateDoc(ref, toServerUpd(upd)), UPD_TIMEOUT).catch(err => {
    if (!isQuotaErr(err)) throw err;
    enterOffline(err);
    applyLocalMe(upd);
  });
}
/* 바닥 루팅 생성 */
let localLootN = 0;
function addLoot(data) {
  const local = () => { lootItems['local_' + Date.now().toString(36) + '_' + (localLootN++)] = data; };
  if (offline || ecoOn()) { local(); return Promise.resolve(); }
  return withTimeout(addDoc(collection(db, 'loot'), data), UPD_TIMEOUT).catch(err => { if (isQuotaErr(err)) { enterOffline(err); local(); } });
}
/* 보류분 동기화 시도 — 로컬 모드이거나 보류 필드가 있으면 45초마다 (실패한 쓰기는 한도를 소비하지 않음) */
let syncing = false, syncQueued = false, syncP = null; const dirtyDuringSync = new Set();
async function trySync(force) {
  if (!meRef || !uid) return false;
  if (syncing) { if (force) syncQueued = true; return syncP || false; } /* 전송 중 강제 요청(종료·구역이동)은 큐에 넣고 같은 약속을 돌려줘 await 가능 */
  const now = Date.now();
  if (offline && now - offlineSince < OFFLINE_DWELL) return false; /* 한 번 로컬 모드가 되면 최소 5분 유지 — 처치마다 8초씩 매달리는 왕복 방지 */
  if (!force && now - lastProbe < (ecoOn() ? ECO_SYNC_MS : 45000)) return false; /* 절약 모드: 1분 주기(레벨업·구역이동·종료 시엔 즉시) */
  lastProbe = now;
  syncing = true;
  syncP = (async () => {
    try {
      let r = await trySyncInner(now);
      for (let i = 0; i < 3 && r && syncQueued; i++) { syncQueued = false; if (pendKeys.size) r = await trySyncInner(Date.now()); }
      syncQueued = false;
      return r;
    } finally { syncing = false; syncP = null; }
  })();
  return syncP;
}
async function trySyncInner(now) {
  if (!offline && !pendKeys.size) return true;
  const payload = {};
  for (const k of pendKeys) if (me[k] !== undefined) payload[k] = me[k];
  payload.x = me.x; payload.y = me.y; payload.hp = me.hp; if (me.mp != null) payload.mp = Math.round(me.mp);
  payload.dead = !!me.dead; payload.deadUntil = me.deadUntil || 0; if (me.map) payload.map = me.map;
  payload.power = Math.round(totalAtk() * (1 + totalCrit()) * skillPow()) || 0; /* 랭킹 ⚔ 탭용(위치 심박은 절약 모드에서 꺼져 있음) */
  payload.lastSeen = now;
  const sent = [...pendKeys]; dirtyDuringSync.clear();
  try {
    if (offline) /* 실패했던 것과 같은 종류(트랜잭션)로 시험 — 단순 update만 통하는 상태에서 온라인으로 오판하면 다음 처치가 또 8초 매달린다 */
      await withTimeout(runTransaction(db, async tx => { await tx.get(meRef); tx.update(meRef, payload); }), 12000);
    else await withTimeout(updateDoc(meRef, payload), 12000); /* 절약 모드 주기 저장: 쓰기 1회 */
    lastSyncAt = now;
    const was = offline;
    offline = false;
    for (const k of sent) if (!dirtyDuringSync.has(k)) pendKeys.delete(k); /* 전송 중 다시 바뀐 키는 보류 유지 → 다음 저장에 실림 */
    dirtyDuringSync.clear(); savePend();
    if (!pendKeys.size) try { localStorage.removeItem(PEND_KEY()); } catch (e) {} /* 종료 직전 저장 성공 시 디바운스 없이 즉시 제거(다음 로그인에 옛 보류분 복원 방지) */
    const el = document.getElementById('quotaBar'); if (el) el.style.display = 'none';
    if (was) toast('☁️ 서버 연결 복구 — 로컬 진행분을 동기화했습니다.', 'sysq');
    return true;
  } catch (err) {
    if (isQuotaErr(err)) { if (!offline) enterOffline(err); }
    else window.__lastErr = { at: now, where: 'trySync', code: err && err.code, msg: String(err && err.message || err) };
    return false;
  }
}
/* 시작 시: 이전 세션의 보류분 복원 (서버 문서 위에 덧씌움) */
function restorePend(srv) {
  try {
    const raw = localStorage.getItem(PEND_KEY());
    if (!raw) return;
    const st = JSON.parse(raw);
    if (!st || !st.keys || !st.me) return;
    if (srv && Number(srv.lastSeen) > Number(st.ts || 0)) { localStorage.removeItem(PEND_KEY()); return; } /* 다른 기기에서 그 뒤에 저장했으면 이 보류분은 옛것 → 폐기(주 단위 롤백 방지) */
    for (const k of st.keys) { if (st.me[k] !== undefined) { me[k] = st.me[k]; pendKeys.add(k); } }
    if (Number.isFinite(st.me.x) && Number.isFinite(st.me.y)) { me.x = st.me.x; me.y = st.me.y; }
    if (Number.isFinite(st.me.hp) && st.me.hp > 0) me.hp = st.me.hp;
    if (Number.isFinite(st.me.mp)) me.mp = st.me.mp;
    toast(`💾 저장되지 않은 진행분(${st.keys.length}항목)을 복원했습니다 — 서버 동기화 대기 중`, 'sysq');
  } catch (e) {}
}
const skillCdUntil = {};

const PALETTE = ['#e74c3c', '#3498db', '#9b59b6', '#1abc9c', '#f39c12', '#e91e63', '#00bcd4'];
const colorOf = id => PALETTE[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];

const skillLv = id => ((me.skills || {})[id] || 0) + (((me.skillEnh || {})[id]) || 0); /* 강화분 포함 */
const sLv = id => (1 + (skillLv(id) - 1) * .1) * (SKILL_GRADE_MUL[skillGrade(id)] || 1); /* 액티브 위력 스케일: 레벨·강화 +10%/Lv × 등급 배율 */
/* 마나 소모도 위력과 같은 비율로 증가 — 강화할수록 세지는 만큼 더 먹는다 */
function skillMp(id, def) {
  def = def || skillDef(id);
  if (!def || !def.mp) return 0;
  const lv = Math.max(1, skillLv(id));
  return Math.round(def.mp * (1 + (lv - 1) * .1));
}
const passSum = f => Object.keys(SKILLS).reduce((a, id) => a + (SKILLS[id][f] || 0) * skillLv(id), 0);
const eqStats = f => Object.values(me.equipped || {}).reduce((a, id) => a + (getItem(id)[f] || 0), 0);
const cdef = () => CLASSES[myCls] || CLASSES.warrior;
const totalAtk = () => Math.round(((me.atk || 10) + (me.stAtk || 0) * 2 + eqStats('atk') + passSum('atk') + setBonus().b.atk) * (1 + setBonus().b.atkMul) * (1 + hb('atk')));
const totalDef = () => Math.round(((me.stDef || 0) + eqStats('def') + passSum('def') + setBonus().b.def) * (1 + setBonus().b.defMul));
const totalCrit = () => Math.min(.95, cdef().crit + (me.stCrit || 0) * .01 + passSum('crit') + eqStats('crit') + setBonus().b.crit + hb('crit'));
const skillPow = () => 1 + (me.stWis || 0) * .03; /* 지혜: 스킬 피해/회복 +3%씩 */
const critDmgMul = () => (1.6 + (me.stCritDmg || 0) * .06) * (1 + setBonus().b.critDmgMul); /* 치명피해(세트 증폭) */
const atkCdOf = () => cdef().atkCd * Math.max(.5, 1 - (me.stAspd || 0) * .02) / (1 + hb('aspd')); /* 공속 */
const atkRange = () => cdef().range + (me.stRange || 0) * 6 + hb('range');   /* 사거리 */
const mpCostOf = base => Math.max(1, Math.round(base * Math.max(.4, 1 - (me.stMana || 0) * .02))); /* 절약 */
const evadeChance = () => Math.min(.35, (me.stEvade || 0) * .01); /* 회피 */
const moveSpd = () => (cdef().speed + (me.stSpd || 0) * 4 + passSum('spd') + eqStats('spd') + setBonus().b.spd) * (1 + hb('spd'));
const classActiveId = () => Object.keys(SKILLS).find(k => SKILLS[k].cls === myCls && SKILLS[k].type === 'active');
/* 번호키 슬롯: 1·2 = 직업 액티브, 3 = 회복술 */
const classActiveIds = () => Object.keys(SKILLS).filter(k => SKILLS[k].cls === myCls && SKILLS[k].type === 'active');

function float(x, y, text, color = '#fff', big = false) { floats.push({ x, y, text, color, t: 0, big }); }
const localSys = []; /* 절약/로컬 모드에서 서버에 쓰지 않은 시스템 메시지(내 화면에만 표시) */
function sysLocal(text, k) {
  localSys.push({ text, k }); while (localSys.length > 8) localSys.shift();
  const log = $('chatLog'); if (!log) return;
  const d = document.createElement('div'); d.className = k === 'q' ? 'sysq' : 'sys'; d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight;
}
async function sysMsg(text, k = '') {
  if (offline || ecoOn()) { sysLocal(text, k); return; } /* 처치마다 채팅 문서를 쓰던 것 제거 — 절약 모드에선 내 화면에만 */
  await addDoc(collection(db, 'chat'), { from: '', text, ts: Date.now(), k }).catch(e => { if (isQuotaErr(e)) enterOffline(e); });
}

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
  for (const p of [$('invPanel'), document.querySelector('#dockL [data-p="invPanel"]')]) { /* 패널이 닫혀 있으면 독의 가방 버튼이 대신 번쩍 */
    if (!p) continue;
    p.classList.remove('flash');
    void p.offsetWidth;
    p.classList.add('flash');
  }
}
function doShake(pow) { if (!settings.screenShake) return; shakePow = Math.max(shakePow, pow); shakeT = Date.now(); }

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
  if (offline) return;
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
  return Object.values(KINDS).find(k => k.name === name) || zoneKindByName(name) || KINDS.slime;
}
/* 종류(kind) 전용 스프라이트 id — 없으면 베이스 팔레트를 바꿔 등록. 도감 썸네일도 이걸 쓴다 */
function kindSprId(k) {
  const sprId = k.base + '::' + k.name;
  if (!SPRITE_DEFS[k.base]) return 'goblin';
  if (!SPRITE_DEFS[sprId]) {
    const bp = SPRITE_DEFS[k.base].pal;
    const keys = Object.keys(bp);
    SPRITE_DEFS[sprId] = { pal: { ...bp, [keys[1]]: k.main, [keys[2]]: k.shade }, rows: SPRITE_DEFS[k.base].rows };
  }
  return sprId;
}
/* 시트가 없을 때 쓰는 종별 실루엣 — 예전에는 정체를 알 수 없는 '초록 고블린 픽셀'이 27종에 공용으로 쓰여
   도감이 같은 그림으로 도배되고 종마다 품질이 널뛰었다. 역할(체형)·비행 여부·구역 색조로 종마다 다른 형태를 그린다. */
function silPath(g, role, fly, S, body, edge, dark) {
  const cx = S / 2, gy = S * .86, u = S / 128; /* u: 128px 기준 배율 */
  g.lineJoin = 'round'; g.lineCap = 'round';
  const fill = p => { g.fillStyle = body; g.strokeStyle = edge; g.lineWidth = 2.4 * u; p(); g.fill(); g.stroke(); };
  const ell = (x, y, rx, ry) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); };
  /* 발밑 그림자 */
  g.fillStyle = 'rgba(0,0,0,.28)'; ell(cx, gy + 4 * u, 30 * u, 9 * u); g.fill();
  if (fly) { /* 날개 */
    fill(() => { g.beginPath(); g.moveTo(cx - 14 * u, gy - 46 * u); g.quadraticCurveTo(cx - 54 * u, gy - 70 * u, cx - 46 * u, gy - 34 * u); g.quadraticCurveTo(cx - 32 * u, gy - 34 * u, cx - 14 * u, gy - 40 * u); g.closePath(); });
    fill(() => { g.beginPath(); g.moveTo(cx + 14 * u, gy - 46 * u); g.quadraticCurveTo(cx + 54 * u, gy - 70 * u, cx + 46 * u, gy - 34 * u); g.quadraticCurveTo(cx + 32 * u, gy - 34 * u, cx + 14 * u, gy - 40 * u); g.closePath(); });
  }
  if (role === 'small') { /* 물렁한 덩어리 */
    fill(() => { g.beginPath(); g.moveTo(cx - 30 * u, gy); g.quadraticCurveTo(cx - 34 * u, gy - 44 * u, cx, gy - 46 * u); g.quadraticCurveTo(cx + 34 * u, gy - 44 * u, cx + 30 * u, gy); g.closePath(); });
  } else if (role === 'fast') { /* 네발 짐승 */
    fill(() => { ell(cx + 2 * u, gy - 26 * u, 28 * u, 15 * u); });
    fill(() => { ell(cx - 26 * u, gy - 34 * u, 13 * u, 11 * u); }); /* 머리 */
    g.strokeStyle = body; g.lineWidth = 7 * u;
    for (const dx of [-18, -6, 10, 22]) { g.beginPath(); g.moveTo(cx + dx * u, gy - 18 * u); g.lineTo(cx + (dx + 2) * u, gy - 2 * u); g.stroke(); }
    g.lineWidth = 5 * u; g.beginPath(); g.moveTo(cx + 28 * u, gy - 30 * u); g.quadraticCurveTo(cx + 44 * u, gy - 40 * u, cx + 40 * u, gy - 52 * u); g.stroke(); /* 꼬리 */
    fill(() => { g.beginPath(); g.moveTo(cx - 32 * u, gy - 44 * u); g.lineTo(cx - 28 * u, gy - 56 * u); g.lineTo(cx - 22 * u, gy - 44 * u); g.closePath(); }); /* 귀 */
  } else { /* 인간형: mid / tank / boss */
    const big = role === 'boss', tank = role === 'tank';
    const w = big ? 26 : tank ? 24 : 18, hh = big ? 62 : tank ? 54 : 50;
    g.strokeStyle = body; g.lineWidth = (big ? 9 : 7) * u; /* 다리 */
    g.beginPath(); g.moveTo(cx - 9 * u, gy - 18 * u); g.lineTo(cx - 11 * u, gy - 2 * u); g.stroke();
    g.beginPath(); g.moveTo(cx + 9 * u, gy - 18 * u); g.lineTo(cx + 11 * u, gy - 2 * u); g.stroke();
    fill(() => { g.beginPath(); g.moveTo(cx - w * u, gy - 16 * u); g.lineTo(cx - (w - 4) * u, gy - hh * u); g.lineTo(cx + (w - 4) * u, gy - hh * u); g.lineTo(cx + w * u, gy - 16 * u); g.closePath(); }); /* 몸통 */
    g.strokeStyle = body; g.lineWidth = (big ? 8 : 6) * u; /* 팔 */
    g.beginPath(); g.moveTo(cx - (w - 2) * u, gy - (hh - 8) * u); g.lineTo(cx - (w + 8) * u, gy - 24 * u); g.stroke();
    g.beginPath(); g.moveTo(cx + (w - 2) * u, gy - (hh - 8) * u); g.lineTo(cx + (w + 8) * u, gy - 24 * u); g.stroke();
    fill(() => { ell(cx, gy - (hh + 12) * u, (big ? 17 : 14) * u, (big ? 16 : 13) * u); }); /* 머리 */
    if (big || tank) { /* 뿔: 굵은 삼각 — 얇으면 화면에서 안 보인다 */
      const hy = gy - (hh + 16) * u, hl = (big ? 20 : 15) * u;
      fill(() => { g.beginPath(); g.moveTo(cx - 12 * u, hy); g.lineTo(cx - 12 * u - hl, hy - hl * .95); g.lineTo(cx - 4 * u, hy - 5 * u); g.closePath(); });
      fill(() => { g.beginPath(); g.moveTo(cx + 12 * u, hy); g.lineTo(cx + 12 * u + hl, hy - hl * .95); g.lineTo(cx + 4 * u, hy - 5 * u); g.closePath(); });
    }
    if (big) { fill(() => { g.beginPath(); g.moveTo(cx - w * u, gy - (hh - 6) * u); g.lineTo(cx - (w + 12) * u, gy - 14 * u); g.lineTo(cx - (w - 2) * u, gy - 16 * u); g.closePath(); }); } /* 보스 망토 */
  }
  /* 눈 2개 — 미발견이면 생략해 '정체불명' 느낌 */
  if (!dark) {
    const ey = role === 'fast' ? gy - 36 * u : role === 'small' ? gy - 26 * u : gy - (role === 'boss' ? 76 : role === 'tank' ? 68 : 64) * u;
    const ex = role === 'fast' ? cx - 26 * u : cx;
    g.fillStyle = '#fff8d0';
    ell(ex - 5 * u, ey, 3.2 * u, 3.6 * u); g.fill();
    ell(ex + 5 * u, ey, 3.2 * u, 3.6 * u); g.fill();
  }
}
const _silCache = {};
function mobSilhouette(k, seen) {
  const M = MOB_MODELS[k.base] || {};
  const role = M.role || 'mid';
  const hue = (((280 + (k.hue || 0)) % 360) + 360) % 360;
  const ck = `${k.base}|${role}|${M.fly ? 1 : 0}|${Math.round(hue)}|${seen ? 1 : 0}`;
  if (_silCache[ck]) return _silCache[ck];
  const S = 128, c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d');
  const body = seen ? `hsl(${hue},38%,46%)` : `hsl(${hue},22%,24%)`;
  const edge = seen ? `hsl(${hue},52%,68%)` : `hsl(${hue},34%,40%)`;
  silPath(g, role, !!M.fly, S, body, edge, !seen);
  if (!seen) { g.fillStyle = 'rgba(255,255,255,.5)'; g.font = `bold ${Math.round(S * .3)}px sans-serif`; g.textAlign = 'center'; g.fillText('?', S / 2, S * .55); }
  const url = c.toDataURL();
  if (Object.keys(_silCache).length > 400) for (const k2 of Object.keys(_silCache).slice(0, 100)) delete _silCache[k2];
  return (_silCache[ck] = url);
}
/* 인게임 폴백: 시트 도착 전에도 종별 실루엣으로 그린다(예전엔 전부 초록 고블린 픽셀) */
function drawMobFallback(s, x, y, r) {
  const d = sdef(s), M = MOB_MODELS[s.type] || {};
  const hue = (((280 + (typeof s.def.hue === 'number' ? s.def.hue : 0)) % 360) + 360) % 360;
  const S = r * 4.2;
  ctx.save();
  ctx.translate(x - S / 2, y - S * .86);
  silPath(ctx, M.role || 'mid', !!M.fly, S, `hsl(${hue},34%,42%)`, `hsl(${hue},48%,64%)`, false);
  ctx.restore();
}

const mobThumbCache = {};
/* 도감 썸네일: VARCO 시트가 있으면 정면(d=2) 셀 + 변종 색조 회전, 없으면 픽셀 스프라이트 */
function mobThumb(k, allowSheet = true) {
  try {
    const sh = allowSheet ? heroSheet('mob_' + k.base) : null; /* 미발견 몬스터는 무거운 시트를 받지 않고 벡터 폴백만 사용 */
    if (sh) {
      const ck = 'S:' + k.name;
      if (mobThumbCache[ck]) return mobThumbCache[ck];
      const m = sh.meta, F = m.fr, S = 128;
      const c = document.createElement('canvas'); c.width = S; c.height = S;
      const g = c.getContext('2d');
      const bk = Object.values(KINDS).find(x => x.base === k.base);
      let dh = 0;
      if (typeof k.hue === 'number') dh = k.hue;
      else if (bk && bk !== k) { dh = hueOf(k.main) - hueOf(bk.main); if (dh > 180) dh -= 360; if (dh < -180) dh += 360; if (Math.abs(dh) < 8) dh = 0; }
      if (dh && 'filter' in g) g.filter = `hue-rotate(${Math.round(dh)}deg)`;
      const kk = (S * .86) / Math.max(1, m.feet - m.top);
      g.drawImage(sh.img, 2 * F, 0, F, F, S / 2 - F * kk / 2, S * .94 - m.feet * kk, F * kk, F * kk);
      return (mobThumbCache[ck] = c.toDataURL());
    }
    if (SPRITE_DEFS[k.base]) { /* 픽셀 원본이 실제로 있는 6종만 픽셀 폴백 */
      const key = kindSprId(k);
      if (!mobThumbCache[key]) mobThumbCache[key] = buildSprite(key).cv.toDataURL();
      return mobThumbCache[key];
    }
    return mobSilhouette(k, allowSheet); /* 나머지는 종별 실루엣 */
  } catch (e) { return ''; }
}
function makeSim(id, d) {
  const isPage = (d.page || '').startsWith('p');
  let def, type, sprId;
  if (isPage) {
    const pn3 = +(d.page.slice(1)) || 1;
    const pd3 = pageDef(pn3);
    const zm = /_z(\d+)_/.exec(id);
    /* 문서의 kind 이름 대신 슬롯(z0/z1/boss)으로 해석 — 구역 변형 도입 후에도 기존 문서를 다시 쓰지 않는다 */
    const kk = (d.boss || /_boss$/.test(id)) ? pd3.boss : (pd3.kinds[zm ? +zm[1] : 0] || pd3.kinds[0]);
    d = { ...d, kind: kk.name };
    const k = kk;
    type = k.base;
    sprId = SPRITE_DEFS[k.base] ? kindSprId(k) : 'goblin'; /* 픽셀 폴백은 기존 6종만 있음 */
    /* 구역 스케일링(pageDiff/pageExp)이 적용된 정본 def 사용 — 이전엔 atk/exp/gold가 10으로 하드코딩돼
       전 구역 밸런스가 죽어 있었음. HP도 문서의 (유니크 인플레이션 가능한) maxHp 대신 정본 기준 */
    def = { ...kk, maxHp: kk.hp };
  } else {
    def = d.type === 'boss' ? BOSS_DEF : d.type === 'skeleton' ? SKELETON_DEF : d.type === 'lich' ? LICH_DEF : (MONSTER_TYPES[d.type] || MONSTER_TYPES.slime);
    type = d.type || 'slime';
    sprId = type;
  }
  const mapId = isPage ? d.page : (id.startsWith('m2') ? 'm2' : 'm1');
  return { id, type, page: mapId, map: mapId, boss: !!d.boss, sprId, uniq: !!d.uniq, def, kind: d.kind || null,
    homeX: d.homeX ?? 800, homeY: d.homeY ?? 600,
    x: d.homeX, y: d.homeY, wa: rand(0, Math.PI * 2), nextWander: 0, atkCdUntil: 0, alive: !!d.alive,
    hp: Math.min(def.maxHp || def.hp, typeof d.hp === 'number' ? d.hp : def.hp), maxHp: def.maxHp, respawnAt: d.respawnAt || 0,
    dirA: Math.PI / 2, movingF: false, aggroF: false, blink: rand(0, 4000) };
}

function sdef(s) {
  if (!s.uniq) return s.def;
  if (!s._ud) s._ud = { ...s.def, name: '★' + s.def.name, hp: Math.round(s.def.hp * 3.5), maxHp: Math.round(s.def.hp * 3.5), atk: Math.round(s.def.atk * 1.4), exp: s.def.exp * 8, gold: s.def.gold * 15, r: Math.round(s.def.r * 1.15), aggro: Math.round(s.def.aggro * 1.15) };
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
    window.__snapN = (window.__snapN || 0) + 1; window.__snapT = Date.now(); /* 진단: 스냅샷 도착 횟수/시각 */
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
      if (!s.alive && d.alive && s.respawnAt > Date.now()) return; /* 내가 로컬에서 잡은 몬스터(리스폰 대기)는 서버의 옛 alive로 되살리지 않음 */
      if (!d.alive && s.alive) spawnPoof(s);
      if (d.alive && !s.alive) {
        s.x = d.homeX; s.y = d.homeY;
        if (dc.id === 'boss' && !bossWasAlive) bossAlert(true);
      }
      if (!d.alive && s.alive && dc.id === 'boss') bossAlert(false);
      if (s.alive && !d.alive) s.deadT = Date.now(); /* 사망 애니메이션 시작 시각 */
      const aliveChanged = s.alive !== !!d.alive;
      s.alive = !!d.alive;
      s.uniq = !!d.uniq;
      /* 몬스터 HP는 클라이언트가 권위(서버 쓰기는 처치/리스폰만) — 서버 hp 값이 실제로 바뀌었거나 생사 전환일 때만 덮어쓴다.
         (매 스냅샷마다 덮어쓰면 다른 문서 변경 때문에 내가 깎아 둔 HP가 만피로 되돌아간다) */
      if (aliveChanged || s.srvHp !== d.hp || s.srvHp === undefined) {
        s.srvHp = d.hp;
        s.hp = Math.min(sdef(s).maxHp || sdef(s).hp, typeof d.hp === 'number' ? d.hp : sdef(s).hp); /* 변형 도입 전 문서의 큰 hp 클램프 */
      }
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

let unsubPlayers = null;
function watchPlayers() {
  /* 현재 구역 플레이어만 구독 — 전체 players 컬렉션 무필터 구독은 접속자가 늘수록 읽기·메모리가 무한 증가했다.
     스냅샷마다 others를 통째로 다시 만들어(현 구역 한정) 떠난 플레이어가 쌓이지 않게 한다 */
  if (unsubPlayers) unsubPlayers();
  others = {}; othersPrev = {};
  const sub = () => unsubPlayers = onSnapshot(query(collection(db, 'players'), where('map', '==', myPage())), snap => {
    const next = {};
    snap.forEach(dc => { if (dc.id !== uid) next[dc.id] = dc.data(); });
    others = next;
  }, err => { console.error('[players]', err); noteErr(err); setTimeout(() => { if (unsubPlayers) watchPlayers(); }, 5000); });
  sub();
}

let unsubLoot = null;
function watchLoot() {
  /* 현재 구역만 구독 — 전체 컬렉션 구독은 읽기 쿼터를 세계 전체 드랍에 비례해 소모 */
  if (unsubLoot) unsubLoot();
  lootItems = {};
  const sub = () => unsubLoot = onSnapshot(query(collection(db, 'loot'), where('map', '==', myPage())), snap => {
    const keep = {}; for (const [k, v] of Object.entries(lootItems)) if (k.startsWith('local_')) keep[k] = v; /* 로컬 모드에서 떨어진 루팅 유지 */
    lootItems = keep;
    snap.forEach(dc => lootItems[dc.id] = dc.data());
  }, err => { console.error('[loot]', err); noteErr(err); setTimeout(() => { if (unsubLoot) watchLoot(); }, 5000); });
  sub();
}

let rankMode = 'lv';
let rankCache = [];
const curPower = () => { try { return Math.round(totalAtk() * (1 + totalCrit()) * skillPow()) || 0; } catch (e) { return 0; } };
function renderRank() {
  /* 내 행은 로컬 값(레벨·전투력)을 즉시 반영 — 서버에는 1분 주기/레벨업 때 실린다 */
  const src = rankCache.map(p => p._id === uid ? { ...p, lv: me.lv || p.lv, power: curPower() } : p);
  const list = [...src].sort((a, b) => rankMode === 'lv' ? (b.lv || 1) - (a.lv || 1) : (b.power || 0) - (a.power || 0)).slice(0, 10);
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
    snap.forEach(dc => rankCache.push({ ...dc.data(), _id: dc.id }));
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
             : `<div class="${m.k === 'q' ? 'sysq' : 'sys'}">${esc(m.text)}</div>`).join('')
      + localSys.map(m => `<div class="${m.k === 'q' ? 'sysq' : 'sys'}">${esc(m.text)}</div>`).join(''); /* 로컬 시스템 메시지 유지 */
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
  const gb = setBonus().b;
  if (gb.expMul) expGain = Math.round(expGain * (1 + gb.expMul));       /* 세트: 경험치 증폭 */
  if (kill && gb.goldMul) kill = { ...kill, gold: Math.round((kill.gold || 0) * (1 + gb.goldMul)) }; /* 세트: 골드 증폭 */
  await runTx(db, async tx => {
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
    trySync(true); /* 레벨업은 즉시 저장 */
    toast(`✨ 레벨업! 스탯 포인트 +${3 * r.leveled} (좌측 상단에서 분배)`, 'sysq');
    rings.push({ x: me.x, y: me.y, r: 90, t: 0, max: 600, color: '255,215,0' });
    fxSparks(me.x, me.y, 22, '#ffd700', 180);
    sfx('levelup');
    sysMsg(`${myName}님이 Lv ${r.nlv} 달성!`);
  }).catch(() => {});
}

/* 무기 드롭은 사냥한 직업의 변형으로 치환 — 직업에 맞는 무기만 나옴 */
const WEAPON_VARIANTS = {
  sword_wood:   { warrior: 'sword_wood', archer: 'bow_wood', rogue: 'dagger_wood', mage: 'staff_wood' },
  sword_iron:   { warrior: 'sword_iron', archer: 'bow_iron', rogue: 'dagger_iron', mage: 'staff_crystal' },
  sword_flame:  { warrior: 'sword_flame', archer: 'bow_storm', rogue: 'dagger_shadow', mage: 'staff_flame' },
  club_chief:   { warrior: 'club_chief', archer: 'bow_chief', rogue: 'dagger_chief', mage: 'staff_chief' },
  knight_sword: { warrior: 'knight_sword', archer: 'knight_bow', rogue: 'knight_dagger', mage: 'knight_staff' },
};
/* 어떤 변형이든(예: 활을 마법사가 획득) 내 직업 무기로 상호 치환 가능하도록 역방향 색인 */
const WEAPON_FAMILY_OF = {};
for (const fam of Object.values(WEAPON_VARIANTS)) for (const vid of Object.values(fam)) WEAPON_FAMILY_OF[vid] = fam;
const classWeapon = raw => {
  let suf = '';
  let id = String(raw);
  const ti = id.indexOf('~');
  if (ti >= 0) { suf = id.slice(ti); id = id.slice(0, ti); }
  const fam = WEAPON_FAMILY_OF[id];
  if (fam && fam[myCls]) return fam[myCls] + suf;
  const zm = /^(\w+?)_(warrior|archer|rogue|mage)_b(\d)$/.exec(id); /* 구역 장비(방어구 포함)도 내 직업 변형으로 — 타 직업 방어구가 가방에 쌓이지 않게 */
  if (zm && zm[2] !== myCls && ITEMS[`${zm[1]}_${myCls}_b${zm[3]}`]) return `${zm[1]}_${myCls}_b${zm[3]}` + suf;
  return id + suf;
};
function rollDrops(type) {
  /* orc 계열(페이지 보스)은 전용 테이블이 없어 빈손 버그 — boss 테이블 공유 */
  const table = DROP_TABLE[type] || (type === 'orc' ? DROP_TABLE.boss : []);
  const band = bandOfPage(pageNum());
  const allow = id => { const b = SET_PIECE_BAND[getItem(id)._base || id]; return !b || b.includes(band); };
  const drops = table.filter(([, p]) => Math.random() < p).map(([id]) => classWeapon(id)).filter(allow);
  const uniqPool = UNIQUE_POOL.filter(id => allow(classWeapon(id)));
  if (Math.random() < UNIQUE_RATE && uniqPool.length) drops.push(classWeapon(uniqPool[Math.floor(Math.random() * uniqPool.length)]));
  /* 구역 장비: 일반 몹 7% / 보스 60% 확률로 현재 밴드·내 직업 장비 1종(슬롯 무작위) */
  const gearP = (type === 'boss' || type === 'orc' || type === 'lich') ? .6 : .07;
  if (Math.random() < gearP) drops.push(zoneGearId(band, myCls, GEAR_SLOTS[Math.floor(Math.random() * GEAR_SLOTS.length)]));
  /* 스킬서: 유니크(보스급) 처치 시 30% — 내 직업 트리 스킬(현재 밴드 티어 ±1, 미습득 우선) 70% / 기본 스킬 30% */
  if (type === 'boss' || type === 'orc' || type === 'lich') {
    if (Math.random() < .30) {
      let pick = null;
      if (Math.random() < .7) {
        const tiers = [band + 1, band + 2, band].map(t => Math.max(1, Math.min(10, t)));
        const pool = Object.entries(TREES[myCls] || {}).filter(([, d]) => tiers.includes(d.tier)).map(([id]) => id);
        const fresh = pool.filter(id => !((me.tree || {})[id]));
        const src = fresh.length ? fresh : pool;
        if (src.length) pick = src[Math.floor(Math.random() * src.length)];
      }
      if (!pick) { const base = Object.entries(SKILLS).filter(([, d]) => d.cls === myCls || d.cls === 'all').map(([id]) => id); pick = base[Math.floor(Math.random() * base.length)]; }
      if (pick && ITEMS['sb_' + pick]) drops.push('sb_' + pick);
    }
  }
  const legPool = LEGEND_POOL.filter(id => allow(classWeapon(id)));
  if (Math.random() < LEGEND_RATE && legPool.length) drops.push(classWeapon(legPool[Math.floor(Math.random() * legPool.length)]));
  return drops;
}

async function dropLoot(type, x, y) {
  for (const itemId of rollDrops(type)) {
    let gid = itemId;
    const it0 = getItem(itemId);
    if (it0.slot && !it0.scroll) {
      const roll = 85 + Math.floor(Math.random() * 31); /* 85~115% 랜덤롤 (장비만, 소모품은 스택 유지) */
      if (roll !== 100) gid = `${itemId}~${roll}`;
    }
    await addLoot({ itemId: gid, x: x + rand(-24, 24), y: y + rand(-24, 24), map: myMap(), ts: Date.now() }).catch(() => {});
  }
}

/* ================= 전투 ================= */
function dealDamage(sim, dmg, kill) {
  /* 처치 확정만 서버에 쓴다. 중간 피해는 로컬 HP(attackResult)가 권위 */
  if (!kill) return Promise.resolve(false);
  if (sim.horde) return Promise.resolve(true); /* 쇄도 몬스터는 서버에 존재하지 않음 */
  return runTx(db, async tx => {
    const ref = doc(db, 'monsters', sim.id);
    const g = await tx.get(ref);
    if (!g.exists()) return null;
    const m = g.data();
    if (!m.alive) return null;
    tx.update(ref, { hp: 0, alive: false, killedBy: uid, respawnAt: Date.now() + sdef(sim).respawn });
    return true;
  }).catch(err => {
    /* 쓰기 실패가 조용히 묻히면 '공격은 되는데 피가 안 단다'로 보인다 — 화면에 1회 알리고 진단 훅에 남긴다 */
    window.__lastErr = { at: Date.now(), where: 'dealDamage', code: err && err.code, msg: String(err && err.message || err) };
    if (err && err.code === 'resource-exhausted') onQuotaExceeded();
    else if (!dealDamage._warned) { dealDamage._warned = true; try { toast('⚠️ 서버 쓰기 실패: ' + esc((err && err.code) || (err && err.message) || err) + ' — 피해가 반영되지 않습니다'); } catch (e) {} }
    return null;
  });
}

async function handleKill(sim) {
  if (sim.horde) return hordeKill(sim); /* 쇄도: 보상은 런 누적으로만(서버 쓰기 0) */
  const d2 = sdef(sim);
  const gold = Math.round((d2.gold || 0) * rand(.8, 1.25));
  float(sim.x, sim.y - d2.r - 30, `+${d2.exp} EXP`, '#3498db');
  float(sim.x, sim.y - d2.r - 52, `+${gold} G`, '#ffd700');
  sfx('coin');
  const dropType = (sim.def && sim.def.dropType) || sim.type; /* 신규 베이스는 역할별 레거시 테이블(slime/goblin/wolf/skeleton/orc) */
  await gainExp(d2.exp, { type: sim.boss ? 'boss' : dropType, gold }); /* 보스 퀘스트(q.boss) 카운트 */
  dropLoot(dropType, sim.x, sim.y);
  if (sim.boss && sim.page && sim.page.startsWith('p')) {
    const pn2 = +sim.page.slice(1);
    if (!(me.conq || {})[pn2]) {
      runTx(db, async tx => {
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
        updX(meRef, { hp: me.hp }).catch(() => {});
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
    updX(meRef, { 'q.uniq': inc(1) }).catch(() => {}); /* 업적: 유니크 처치 카운트 — updX가 온/오프라인 모두 1회만 반영(로컬 중복 가산 제거) */
  }
  /* 도감 해금: 처음 잡은 종류를 기록 (맵 통째로 저장 — 이름에 공백이 있어 점 경로를 못 씀) */
  const dexKey = (sim.kind || d2.name || '').replace(/^★/, '');
  if (dexKey && !(me.dex || {})[dexKey]) {
    me.dex = { ...(me.dex || {}), [dexKey]: true };
    updX(meRef, { dex: me.dex }).catch(() => {});
    if ($('dexPanel')?.classList.contains('open')) renderDex();
  }
  sysMsg(`${myName}님이 ${d2.name}을(를) 처치했습니다!${sim.type === 'boss' || sim.type === 'lich' ? ' 👑👑👑' : ''}`);
}

const DEX_DMG_BONUS = .05; /* 도감 효과: 처치 기록이 있는 종에게 주는 피해 +5% */
/* 피해 쓰기 묶음: 예전엔 타격마다 트랜잭션 1회(= 읽기 1 + 쓰기 1)라 전투 1시간에 4천 쓰기 — Firestore 무료 한도(하루 2만)를 두 시간이면 소진했다.
   이제 타격은 로컬에서 즉시 반영(HP바·숫자·넉백)하고, 서버 반영은 몬스터별로 1.1초마다 합산 1회. 처치가 예상되면 즉시 flush. 서버가 권위(스냅샷이 로컬 값을 덮어씀) */
const dmgQueue = new Map();
const DMG_FLUSH_MS = 1800; /* 로컬 예측이 즉시 보이므로 서버 확정은 1.8초 합산으로 충분 */
async function attackResult(sim, dmg, crit) {
  const sb = setBonus().b;
  if (sim.boss && sb.bossMul) dmg = Math.round(dmg * (1 + sb.bossMul)); /* 세트: 보스 특효 증폭 */
  { const dk = (sim.kind || (sdef(sim).name || '')).replace(/^★/, ''); if (dk && (me.dex || {})[dk]) dmg = Math.round(dmg * (1 + DEX_DMG_BONUS)); }
  if (!sim.alive) return;
  /* 즉시 시각 피드백 (로컬 예측) */
  sim.hp = Math.max(0, (typeof sim.hp === 'number' ? sim.hp : sim.maxHp) - dmg);
  sim.hitFlash = Date.now();
  { const lf = (me.stLife || 0) * .01 + hb('life'); /* 흡혈: 스탯 1%/pt + 쇄도 각인 */
    if (lf && !me.dead && me.hp < maxHpOf()) { me.hp = Math.min(maxHpOf(), me.hp + dmg * lf); hpDirty = true; } }
  sim.angry = true;
  const kdx = sim.x - me.x, kdy = sim.y - me.y, kd = Math.hypot(kdx, kdy) || 1;
  sim.kbx = kdx / kd * (crit ? 7 : 4.2);
  sim.kby = kdy / kd * (crit ? 7 : 4.2);
  sim.punchT = Date.now();
  if (settings.dmgText) float(sim.x + rand(-8, 8), sim.y - sdef(sim).r - 10, String(dmg) + (crit ? '!' : ''), crit ? '#ffd700' : '#fff', crit);
  fxSparks(sim.x, sim.y - sdef(sim).r * .3, crit ? 12 : 6, crit ? '#ffd700' : '#ffecb3', crit ? 160 : 100);
  if (crit) { doShake(7); hitStopUntil = Math.max(hitStopUntil, Date.now() + 42); }
  sfx(crit ? 'crit' : 'hit');
  /* 서버 반영은 묶어서 */
  let q = dmgQueue.get(sim.id);
  if (!q) { q = { sim, total: 0, timer: 0 }; dmgQueue.set(sim.id, q); }
  q.total += dmg;
  if (sim.hp <= 0) flushDamage(sim.id); /* 처치 예상 → 즉시 확정 */
  else if (!q.timer) q.timer = setTimeout(() => flushDamage(sim.id), DMG_FLUSH_MS);
}
async function flushDamage(id) {
  const q = dmgQueue.get(id);
  if (!q) return;
  dmgQueue.delete(id); clearTimeout(q.timer);
  const kill = q.sim.hp <= 0 && q.sim.alive && !q.sim._killing;
  if (!kill) { window.__lastDmg = { id, dmg: q.total, r: 'local', at: Date.now() }; return; } /* 중간 피해/이미 처치 진행 중: 서버 쓰기 없음 */
  q.sim._killing = true; /* 처치 쓰기 진행 중 표식 — 같은 몹에 대한 중복 처치(더블 XP/골드/루팅) 방지 */
  let r = null;
  try { r = await dealDamage(q.sim, q.total, true); } /* 처치 확정(서버 1회 쓰기 / 로컬 모드면 즉시) */
  finally { q.sim._killing = false; }
  window.__lastDmg = { id, dmg: q.total, r, at: Date.now() }; /* 진단: null=문서없음/이미 죽음, true=처치 */
  if (r === true) { hitStopUntil = Math.max(hitStopUntil, Date.now() + 72); doShake(9); await handleKill(q.sim); }
}

const lootSkip = {}; /* lid → 재시도 가능 시각: 못 줍는(가방 가득) 루팅은 자동 사냥이 잠시 건너뜀 */
function nearestLoot(maxD) {
  let best = null, bd = maxD; const now = Date.now();
  for (const [lid, l] of Object.entries(lootItems)) {
    if ((l.map || 'm1') !== myMap() || pickHide.has(lid)) continue;
    if ((lootSkip[lid] || 0) > now) continue;
    const d = Math.hypot(l.x - me.x, l.y - me.y);
    if (d < bd) { bd = d; best = { ...l, lid }; }
  }
  return best;
}
function nearestSim(maxD, skip) {
  let best = null, bestD = maxD;
  for (const s of sims) {
    if (!s.alive || s.map !== myMap()) continue;
    if (skip && (skip[s.id] || 0) > Date.now()) continue;
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
/* ===== 자연스러운 이동: 속도 기반 가속/감속 + 도착 감속 + 회전 보간 =====
   me.vx/vy(픽셀/초)를 둬서 급출발·급정지를 없앰. dt 무관 시상수 방식 */
function glideToward(tx, ty, maxSpd, dt, arrive = 0) {
  const dx = tx - me.x, dy = ty - me.y;
  const d = Math.hypot(dx, dy);
  if (d < .5) return;
  let want = maxSpd;
  if (arrive > 0) want = Math.min(maxSpd, Math.max(maxSpd * .15, d * 5)); /* 도착 감속 */
  const k = 1 - Math.exp(-dt / 110);   /* 가속 시상수 110ms */
  me.vx += (dx / d * want - me.vx) * k;
  me.vy += (dy / d * want - me.vy) * k;
  if (Math.hypot(me.vx, me.vy) > 25) me.face = angLerp(me.face, Math.atan2(me.vy, me.vx), Math.min(1, dt * .02));
  me.x = clampN(me.x + me.vx * dt / 1000, 40, WORLD.w - 40);
  me.y = clampN(me.y + me.vy * dt / 1000, 40, WORLD.h - 40);
}
function brake(dt) {
  const k = 1 - Math.exp(-dt / 70);    /* 정지는 가속보다 빠르게 */
  me.vx -= me.vx * k; me.vy -= me.vy * k;
  if (Math.hypot(me.vx, me.vy) < 8) { me.vx = 0; me.vy = 0; }
  else {
    me.x = clampN(me.x + me.vx * dt / 1000, 40, WORLD.w - 40);
    me.y = clampN(me.y + me.vy * dt / 1000, 40, WORLD.h - 40);
  }
}
function stepToward(pt, sp, dt) {
  /* sp: 기존 호출(프레임당 픽셀)과 신규(dt 전달) 둘 다 지원 */
  if (dt) { glideToward(pt.x, pt.y, sp * 1000 / dt, dt, 1); return; }
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

/* 자동 사냥 중 스킬·물약 자동 사용 */
function autoCombat(now) {
  if (me.dead) return;
  /* 자동 물약 */
  if (now - autoPotT > 900) {
    autoPotT = now;
    if ((me.hp || 0) < maxHpOf() * (settings.autoPotHp / 100) && potCount('hp') > 0) usePotion('hp');
    else if ((me.mp ?? maxMpOf()) < maxMpOf() * (settings.autoPotMp / 100) && potCount('mp') > 0) usePotion('mp');
  }
  /* 자동 스킬: 타깃이 사거리 근처면 배운 액티브를 순환 시전 */
  const t = sims.find(v => v.id === attackTargetSimId && v.alive);
  if (t && Math.hypot(t.x - me.x, t.y - me.y) < atkRange() * 2.2 && now - autoSkillT > 700) {
    for (let s2 = 1; s2 <= 5; s2++) {
      const id = boundId(s2);
      if (id && id !== 'heal' && hasSkill(id) && now >= (skillCdUntil[id] || 0)) {
        const def = skillDef(id); const mpc = def && def.mp ? mpCostOf(skillMp(id, def)) : 0;
        if ((me.mp ?? maxMpOf()) >= mpc) { useSkill(s2); autoSkillT = now; break; }
      }
    }
  }
}
function toggleAuto() { if (hordeOn()) { toast('🌀 쇄도 중에는 자동 사냥을 쓸 수 없습니다 (평타는 자동으로 나갑니다)'); return; } autoHunt = !autoHunt; if (autoHunt) { dest = null; } updateAutoBtn(); toast(autoHunt ? '⚔️ 자동 사냥 켜짐 — 이동 키를 누르면 해제' : '자동 사냥 꺼짐', 'sysq'); sfx('click'); }
function updateAutoBtn() { const b = $('autoBtn'); if (b) b.classList.toggle('on', autoHunt); }
function tryAttack(now, forced = null) {
  if (!ready || me.dead || worldMapOpen() || paused) return; /* 지도 오버레이 뒤에서 눈먼 전투 방지 */
  const cd = atkCdOf();
  if (now < lastAttackAt + cd) return;
  lastAttackAt = now;
  const target = forced && forced.alive ? forced : nearestSim(atkRange());
  if (target) me.face = angLerp(me.face, Math.atan2(target.y - me.y, target.x - me.x), .6); /* 공격 조준도 스냅 대신 고속 보간 */
  if (cdef().melee) {
    slashes.push({ x: me.x, y: me.y, a: target ? me.face : -Math.PI / 2, t: 0, w: myCls === 'rogue' ? 2.4 : 3.6, len: myCls === 'rogue' ? 30 : 38 });
    sfx('swing');
    me.swing = now; me.atkSlowUntil = now + 180; /* 공격 모션 재생 트리거 (없어서 평타 모션이 죽어 있었음) */
  } else if (target) {
    fireShot(target.x, target.y, myCls === 'archer' ? '#e8d9a0' : '#c89bff', Math.min(600, Math.hypot(target.x - me.x, target.y - me.y) / 520 * 1000), myCls === 'archer' ? 4 : 8);
    sfx(myCls === 'archer' ? 'shoot' : 'cast');
    me.swing = now; me.atkSlowUntil = now + 180;
  }
  if (!target) return;
  const crit = Math.random() < totalCrit();
  const dmg = Math.max(1, Math.round(totalAtk() * rand(.85, 1.15) * (crit ? critDmgMul() : 1)));
  attackResult(target, dmg, crit);
}

function useSkill(slot) {
  if (!ready || me.dead || worldMapOpen() || paused) return;
  const now = Date.now();
  const id = boundId(slot);
  if (!id) { if (slot <= 5) toast('⌨️ 빈 슬롯 — 스킬샵/트리에서 등록'); return; }
  const def = skillDef(id);
  if (!def) return;
  if (!hasSkill(id)) { float(me.x, me.y - 34, '미습득 스킬 (B: 샵)', '#aaa'); return; }
  if (now < (skillCdUntil[id] || 0)) return;
  if (mapFading) return; /* 맵 전환 중 시전 금지 — 지연 콜백이 새 구역 몬스터를 때리는 사고 방지 */
  const castPage = myPage(); /* 지연 폭발/발사 콜백용 구역 스냅샷 */
  const mpc = def.mp ? mpCostOf(skillMp(id, def)) : 0; /* 레벨·강화 비례 + 절약 스탯 반영 */
  if ((me.mp ?? maxMpOf()) < mpc) { float(me.x, me.y - 34, '마나 부족!', '#5dade2'); return; }

  if (id === 'heal') {
    fxFlash('120,255,170', 380, .24);
    const amt = Math.round(maxHpOf() * .4 * sLv('heal') * skillPow()); /* me.maxHp는 생성 시점 값이라 낡음 */
    me.hp = Math.min(maxHpOf(), (me.hp || 0) + amt);
    updX(meRef, { hp: me.hp }).catch(() => {});
    float(me.x, me.y - 34, `+${amt} HP`, '#2ecc71');
    rings.push({ x: me.x, y: me.y, r: 70, t: 0, max: 450, color: '46,204,113' });
    fxSparks(me.x, me.y - 10, 12, '#7fe3a0', 110);
    sfx('heal');
  } else if (id === 'power_strike') {
    fxFlash('255,210,130', 180, .28);
    const t = nearestSim(atkRange() * 1.35);
    if (!t) { float(me.x, me.y - 34, '대상 없음', '#aaa'); return; }
    slashes.push({ x: me.x, y: me.y, a: Math.atan2(t.y - me.y, t.x - me.x), t: 0, w: 8, len: 52, color: '#ffb347' });
    rings.push({ x: t.x, y: t.y, r: 48, t: 0, max: 320, color: '255,140,0' });
    fxSparks(t.x, t.y, 14, '#ffb347', 160);
    doShake(6); sfx('crit');
    attackResult(t, Math.max(1, Math.round(totalAtk() * 4 * sLv('power_strike') * skillPow() * rand(.9, 1.1))), true);
  } else if (id === 'multishot') {
    fxFlash('240,230,180', 180, .18);
    const targets = sims.filter(s => s.alive && Math.hypot(s.x - me.x, s.y - me.y) < 240);
    if (!targets.length) { float(me.x, me.y - 34, '대상 없음', '#aaa'); return; }
    for (const t of targets) {
      fireShot(t.x, t.y, '#e8d9a0', Math.hypot(t.x - me.x, t.y - me.y) / 520 * 1000 + 60, 4);
      const dmg = Math.max(1, Math.round(totalAtk() * 1.5 * sLv('multishot') * skillPow() * rand(.9, 1.1)));
      setTimeout(() => { if (myPage() === castPage) attackResult(t, dmg, false); }, 140);
    }
    sfx('swing');
  } else if (id === 'shadow_strike') {
    fxFlash('140,70,220', 220, .32);
    const t = nearestSim(190);
    if (!t) { float(me.x, me.y - 34, '대상 없음', '#aaa'); return; }
    poofs.push({ x: me.x, y: me.y, vx: 0, vy: 0, r: 16, t: 0, color: '#34495e', g: -60 });
    me.x = clampN(t.x + rand(-44, 44), 40, WORLD.w - 40);
    me.y = clampN(t.y + rand(-44, 44), 40, WORLD.h - 40);
    cam.x = me.x; cam.y = me.y;
    slashes.push({ x: me.x, y: me.y, a: Math.atan2(t.y - me.y, t.x - me.x), t: 0, w: 7, len: 50, color: '#b388ff' });
    fxSparks(t.x, t.y, 16, '#9b59b6', 170);
    doShake(6); sfx('boom');
    attackResult(t, Math.max(1, Math.round(totalAtk() * 6 * sLv('shadow_strike') * skillPow())), true);
  } else if (id === 'fireball') {
    fxFlash('255,140,40', 320, .40);
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
        const dmg = Math.max(1, Math.round(totalAtk() * 2.2 * sLv('fireball') * skillPow() * rand(.9, 1.1)));
        attackResult(v, dmg, false);
      }
    }, 240);
  } else if (id === 'whirlwind') {
    fxFlash('255,220,120', 260, .28);
    const victims = sims.filter(s => s.alive && Math.hypot(s.x - me.x, s.y - me.y) < 135);
    if (!victims.length) { float(me.x, me.y - 34, '대상 없음', '#aaa'); return; }
    rings.push({ x: me.x, y: me.y, r: 130, t: 0, max: 400, color: '255,180,80' });
    slashes.push({ x: me.x, y: me.y, a: me.face, t: 0, w: 9, len: 60, color: '#ffb347' });
    fxSparks(me.x, me.y, 18, '#ffb347', 200);
    doShake(7); sfx('boom');
    me.swing = now;
    for (const v of victims) {
      const dmg = Math.max(1, Math.round(totalAtk() * 2 * sLv('whirlwind') * skillPow() * rand(.9, 1.1)));
      attackResult(v, dmg, Math.random() < totalCrit());
    }
  } else if (id === 'piercing') {
    fxFlash('255,245,180', 180, .2);
    const range = 330, half = 34;
    const dx = Math.cos(me.face), dy = Math.sin(me.face);
    const victims = sims.filter(s => {
      if (!s.alive) return false;
      const rx = s.x - me.x, ry = s.y - me.y;
      const along = rx * dx + ry * dy;
      if (along < 0 || along > range) return false;
      return Math.abs(rx * dy - ry * dx) < half + (sdef(s).r || 16);
    }).sort((a, b) => (Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y)));
    if (!victims.length) { float(me.x, me.y - 34, '대상 없음', '#aaa'); return; }
    fireShot(me.x + dx * range, me.y + dy * range, '#ffd27f', 420, 5);
    fxSparks(me.x + dx * 30, me.y + dy * 30, 10, '#ffd27f', 150);
    sfx('shoot');
    me.swing = now;
    const dmg = Math.max(1, Math.round(totalAtk() * 2.4 * sLv('piercing') * skillPow() * rand(.9, 1.1)));
    victims.forEach((v, i) => {
      setTimeout(() => { if (myPage() === castPage) attackResult(v, dmg, Math.random() < totalCrit()); }, i * 90);
    });
  } else if (id === 'phantom') {
    fxFlash('180,120,255', 220, .28);
    const t = nearestSim(210);
    if (!t) { float(me.x, me.y - 34, '대상 없음', '#aaa'); return; }
    slashes.push({ x: me.x, y: me.y, a: Math.atan2(t.y - me.y, t.x - me.x), t: 0, w: 7, len: 50, color: '#b388ff' });
    sfx('crit');
    me.swing = now;
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        if (myPage() !== castPage || !t.alive) return;
        fxSparks(t.x, t.y, 8, '#b388ff', 140);
        attackResult(t, Math.max(1, Math.round(totalAtk() * 1.7 * sLv('phantom') * skillPow() * rand(.9, 1.1))), i === 2);
      }, i * 130);
    }
  } else if (id === 'frost_nova') {
    fxFlash('150,220,255', 320, .36);
    const victims = sims.filter(s => s.alive && Math.hypot(s.x - me.x, s.y - me.y) < 165);
    if (!victims.length) { float(me.x, me.y - 34, '대상 없음', '#aaa'); return; }
    rings.push({ x: me.x, y: me.y, r: 170, t: 0, max: 500, color: '140,220,255' });
    rings.push({ x: me.x, y: me.y, r: 110, t: 0, max: 380, color: '220,245,255' });
    fxSparks(me.x, me.y, 26, '#9fdcff', 230);
    doShake(8); sfx('boom');
    me.swing = now;
    for (const v of victims) {
      const dmg = Math.max(1, Math.round(totalAtk() * 2 * sLv('frost_nova') * skillPow() * rand(.9, 1.1)));
      attackResult(v, dmg, false);
    }
  } else if (TREES_ALL[id]) { if (castTreeSkill(id) === false) return; } /* 대상 없음이면 MP·쿨다운 소모 없이 종료 */
  if (mpc) me.mp = (me.mp ?? maxMpOf()) - mpc; /* 서버 반영은 위치 심박(mp 변화 ≥5)에 묶임 */
  heroCast = { id, t0: now, dur: CAST_DUR[id] || 450 }; /* 스킬 시전 모션 트리거 */
  skillCdUntil[id] = now + def.cd;
}

/* ================= 스킬 샵 ================= */

/* ================= 종합 스탯 창 · 가방 정렬 ================= */
function openStats() {
  let m = $('statsModal');
  if (!m) { m = document.createElement('div'); m.id = 'statsModal'; m.className = 'modalWrap'; m.onclick = e => { if (e.target === m) m.hidden = true; }; document.body.appendChild(m); }
  const dps = Math.round(totalAtk() / (atkCdOf() / 1000) * (1 + totalCrit() * (critDmgMul() - 1)));
  const row = (k, v, c) => `<div class="strow2"><span>${k}</span><b style="color:${c || '#fff'}">${v}</b></div>`;
  const sb = setBonus();
  let setHtml = '';
  for (const [sid, n] of Object.entries(sb.counts)) { const st = SETS[sid]; setHtml += `<div class="stset">${esc(st.name)} (${n}/${st.pieces.length})</div>`; }
  m.innerHTML = `<div class="modalBox"><div class="modalHd">📊 상세 능력치 <button onclick="this.closest('.modalWrap').hidden=true">✕</button></div>
    ${row('⚔️ 초당 피해(DPS)', dps.toLocaleString(), '#ffd700')}
    ${row('공격력', totalAtk().toLocaleString())}
    ${row('방어력', totalDef().toLocaleString())}
    ${row('최대 HP', maxHpOf().toLocaleString(), '#e74c3c')}
    ${row('최대 MP', maxMpOf().toLocaleString(), '#3498db')}
    ${row('치명타 확률', Math.round(totalCrit() * 100) + '%')}
    ${row('치명타 피해', Math.round(critDmgMul() * 100) + '%')}
    ${row('공격 속도', (1000 / atkCdOf()).toFixed(2) + '/s')}
    ${row('이동 속도', Math.round(moveSpd()))}
    ${row('공격 사거리', Math.round(atkRange()))}
    ${row('회피 확률', Math.round(evadeChance() * 100) + '%')}
    ${(me.stLife ? row('흡혈', me.stLife + '%', '#e74c3c') : '')}
    ${(me.stRegen ? row('재생 강화', '+' + (me.stRegen * 15) + '%', '#2ecc71') : '')}
    ${(me.stMana ? row('마나 절약', Math.min(60, me.stMana * 2) + '%', '#3498db') : '')}
    ${(Object.keys(sb.counts).length ? '<div class="stsetHd">🔥 세트 효과</div>' + setHtml + `<div class="strow2"><span>세트 종합</span><b style="color:#9fd">${esc(bonusText(sb.b)) || '-'}</b></div>` : '')}
    <div class="setNote">스탯 포인트는 좌측 상단 HUD에서 분배 · 리셋은 스킬샵 보석 상점</div></div>`;
  m.hidden = false;
}
function sortBag() {
  runTx(db, async tx => {
    const snap = await tx.get(meRef); if (!snap.exists()) return null;
    tx.update(meRef, { inv: sortInvMap(snap.data().inv || {}) });
    return true;
  }).then(r => { if (r) { sfx('click'); toast('🎒 가방을 정렬했습니다'); renderInvUI(); } }).catch(() => {});
}
/* ================= 보석 상점 · 분해 · 스탯 리셋 ================= */
const STAT_KEYS = ['stAtk','stHp','stDef','stSpd','stWis','stCrit','stAspd','stCritDmg','stLife','stRange','stMana','stRegen','stEvade'];
const GEM_SHOP = [
  { id: 'respec',   icon: '🌀', name: '스탯 리셋',        desc: '분배한 스탯 포인트를 전부 회수해 다시 분배', gem: 5 },
  { id: 'sc_adv',   icon: '📜', name: '고급 강화 주문서',  desc: '가방에 지급 · 강화 성공률↑',            gem: 3, item: 'scroll_adv' },
  { id: 'sc_top',   icon: '📜', name: '최고급 강화 주문서', desc: '가방에 지급 · 최고 성공률',            gem: 8, item: 'scroll_top' },
  { id: 'potpack',  icon: '🧪', name: '상급 물약 꾸러미',   desc: '상급 체력 물약 ×5 + 상급 마나 ×5',      gem: 4, pack: [['potion_hi', 5], ['potion_mm', 5]] },
  { id: 'baggem',   icon: '🎒', name: '가방 확장 (보석)',   desc: '가방 확장 +6칸 (마지막 단계 +4, 골드 대신 보석으로)',         gem: 6, bag: true },
];
function respecStats() {
  runTx(db, async tx => {
    const snap = await tx.get(meRef); if (!snap.exists()) return null;
    const p = snap.data();
    if ((p.gem || 0) < 5) return 'poor';
    let refund = 0; const upd = { gem: (p.gem || 0) - 5 };
    for (const k of STAT_KEYS) { refund += (p[k] || 0); upd[k] = 0; }
    if (refund === 0) return 'none';
    upd.statPts = (p.statPts || 0) + refund;
    tx.update(meRef, upd);
    return refund;
  }).then(r => {
    if (r === 'poor') { toast('💎 보석이 부족합니다 (5개 필요)'); return; }
    if (r === 'none') { toast('회수할 스탯 포인트가 없습니다'); return; }
    if (!r) return;
    me.hp = Math.min(me.hp || 1, maxHpOf()); /* stHp 회수로 최대 HP가 줄면 현재 HP도 클램프 */
    sfx('levelup'); toast(`🌀 스탯 리셋! 포인트 ${r}개를 회수했습니다`, 'sysq');
    try { renderStatButtons(); updateHUD(); } catch (e) {}
    renderShop();
  }).catch(() => {});
}
function buyGem(id) {
  const g = GEM_SHOP.find(x => x.id === id); if (!g) return;
  if (id === 'respec') return respecStats();
  runTx(db, async tx => {
    const snap = await tx.get(meRef); if (!snap.exists()) return null;
    const p = snap.data();
    if ((p.gem || 0) < g.gem) return 'poor';
    let upd = { gem: (p.gem || 0) - g.gem };
    if (g.bag) { if ((p.bagSize || BASE_BAG) >= MAX_BAG) return 'maxbag'; upd.bagSize = Math.min(MAX_BAG, (p.bagSize || BASE_BAG) + 6); }
    else if (g.item) { const r = computeAddToInv(p, g.item); if (!r) return 'full'; upd = { ...upd, ...r.upd }; }
    else if (g.pack) {
      let pp = { ...p };
      for (const [iid, cnt] of g.pack) for (let i = 0; i < cnt; i++) { const r = computeAddToInv(pp, iid); if (!r) return 'full'; pp = { ...pp, inv: r.upd.inv || pp.inv, equipped: r.upd.equipped || pp.equipped, q: r.upd.q || pp.q }; }
      upd.inv = pp.inv; upd.q = pp.q;
    }
    tx.update(meRef, upd);
    return true;
  }).then(r => {
    if (r === 'poor') { toast('💎 보석이 부족합니다'); return; }
    if (r === 'full') { toast('🎒 가방에 빈 칸이 없습니다'); return; }
    if (r === 'maxbag') { toast('가방이 이미 최대치입니다'); return; }
    if (!r) return;
    sfx('buy'); toast(`💎 「${esc(g.name)}」 구매 완료!`, 'sysq'); renderShop(); renderInvUI();
  }).catch(() => {});
}
/* 장비 일괄 분해: 미장착 장비 중 선택 등급 이하를 골드+보석(희귀 이상)으로 분해 */
const SALVAGE_GEM = { rare: 1, epic: 2, legend: 4, unique: 8 };
function salvageBulk(maxRank) {
  runTx(db, async tx => {
    const snap = await tx.get(meRef); if (!snap.exists()) return null;
    const p = snap.data();
    const inv = { ...(p.inv || {}) };
    let gold = 0, gem = 0, n = 0;
    for (const [k, v] of Object.entries(inv)) {
      const it = getItem(v);
      if (!it.slot || it.scroll || it.heal || it.mana || it.book) continue; /* 장비만 */
      if ((RARITY_RANK[it.rarity] ?? 0) > maxRank) continue;
      gold += Math.round(sellPrice(v) * 0.8); gem += SALVAGE_GEM[it.rarity] || 0; n++; delete inv[k];
    }
    if (!n) return { n: 0 };
    tx.update(meRef, { inv: sortInvMap(inv), gold: (p.gold || 0) + gold, gem: (p.gem || 0) + gem });
    return { n, gold, gem };
  }).then(r => {
    if (!r) return;
    if (!r.n) { toast('분해할 장비가 없습니다'); return; }
    sfx('coin'); toast(`🔨 장비 ${r.n}개 분해 → 💰${r.gold.toLocaleString()}${r.gem ? ' 💎' + r.gem : ''}`, 'sysq');
    renderInvUI();
  }).catch(() => {});
}

function renderShop() {
  const body = $('shopBody');
  const sg = $('shopGold'); if (sg) sg.textContent = `💰 ${(me.gold || 0).toLocaleString()} G`;
  const list = Object.entries(SKILLS).filter(([, d]) => d.cls === myCls || d.cls === 'all');
  const rowOf = ([id, d]) => {
    const lv = skillLv(id);
    const baseLv = (me.skills || {})[id] || 0;
    const enhLv = ((me.skillEnh || {})[id]) || 0;
    const maxed = baseLv >= MAX_SKILL_LV;
    const cost = skillCost(d, baseLv);
    const afford = (me.gold || 0) >= cost;
    const stat = d.atk ? `공격 +${d.atk}` : d.def ? `방어 +${d.def}` : d.spd ? `속도 +${d.spd}` : d.crit ? `치명타 +${Math.round(d.crit * 100)}%p` : '';
    const enhCost = Math.round(d.cost * 2 * (1 + enhLv));
    const gr = skillGrade(id, d), gcol = RARITY_COLOR[gr] || '#aaa';
    const pas = isPassiveSkill(d);
    const mpNow = d.mp ? skillMp(id, d) : 0;
    const powPct = Math.round(sLv(id) * 100);
    return `<div class="srow ${pas ? 'pas' : 'act'}" data-grade="${gr}">
      <div class="si">${skillIconHtml(id, d)}</div>
      <div class="sm">
        <div><span class="st" style="color:${gcol}">${esc(d.name)}</span><span class="sgr" style="color:${gcol};border-color:${gcol}">${RARITY_KR[gr] || '일반'}</span><span class="skind ${pas ? 'pas' : 'act'}">${pas ? '패시브' : '발동'}</span>${pas ? `<span class="slv">${stat}</span>` : ''}<span class="slv">Lv ${baseLv}${enhLv ? `+${enhLv}` : ''}/${MAX_SKILL_LV}</span></div>
        <div class="sd">${esc(d.desc)}${!pas && lv >= 1 ? ` · 위력 <b style="color:#fff">${powPct}%</b>` : ''}${d.mp ? ` · 마나 <b style="color:#7fc7ff">${mpNow}</b>${mpNow !== d.mp ? `<span style="color:#667">(기본 ${d.mp})</span>` : ''}` : ''}${d.cd ? ` · 재사용 ${d.cd / 1000}s` : ''}</div>
        ${(lv >= 1 && !pas) ? bindBtns(id) : ''}
      </div>
      ${!maxed ? `<button class="buyBtn" data-buy="${id}" ${afford ? '' : 'disabled'}>${cost} G</button>`
              : enhLv >= 5 ? `<button class="buyBtn" disabled>MAX</button>`
              : `<button class="buyBtn" data-enh="${id}">${enhCost}G<br>강화+${enhLv + 1}</button>`}
    </div>`;
  };
  const actRows = list.filter(([, d]) => !isPassiveSkill(d)).map(rowOf).join('');
  const pasRows = list.filter(([, d]) => isPassiveSkill(d)).map(rowOf).join('');
  let html = `<div class="shopCols">
    <div class="shopCol"><div class="colHd act">⚡ 발동 스킬 <span>퀵슬롯 [1]~[5] 등록 · 마나 소모</span></div>${actRows}</div>
    <div class="shopCol"><div class="colHd pas">🛡 패시브 스킬 <span>배우면 항상 적용</span></div>${pasRows}</div>
  </div>
  <div class="colHd">🧪 소모품 · 가방</div>`;
  for (const [pid, picon, pcost] of POTION_SHOP) {
    const pd = ITEMS[pid];
    const affordP = (me.gold || 0) >= pcost;
    const bagFull = Object.keys(me.inv || {}).length >= bagSize();
    html += `<div class="srow">
      <div class="si">${itemIconHtml(pid, 40) || picon}</div>
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
        <div><span class="st">가방 확장</span><span class="slv">${bagSize()}칸 → ${Math.min(MAX_BAG, bagSize() + 6)}칸</span></div>
        <div class="sd">가방 슬롯을 영구적으로 ${Math.min(6, MAX_BAG - bagSize())}칸 늘립니다${canExpand ? '' : ' · 최대치 도달'}</div>
      </div>
      ${canExpand ? `<button class="buyBtn" id="buyBag" ${(me.gold || 0) >= upCost ? '' : 'disabled'}>${upCost} G</button>`
                  : `<button class="buyBtn" disabled>MAX</button>`}
    </div>`;
  html += `<div class="colHd">💎 보석 상점 <span style="color:#778;font-weight:normal;font-size:10.5px">보유 💎 ${(me.gem || 0).toLocaleString()} · 업적·일일·분해로 획득</span></div>`;
  for (const g of GEM_SHOP) {
    const afford = (me.gem || 0) >= g.gem;
    html += `<div class="srow">
      <div class="si">${g.icon}</div>
      <div class="sm"><div><span class="st">${esc(g.name)}</span></div><div class="sd">${esc(g.desc)}</div></div>
      <button class="buyBtn gembuy" data-gem="${g.id}" ${afford ? '' : 'disabled'}>💎 ${g.gem}</button>
    </div>`;
  }
  body.innerHTML = html;
  body.querySelectorAll('[data-gem]').forEach(b => b.onclick = () => buyGem(b.dataset.gem));
  body.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => buySkill(b.dataset.buy));
  body.querySelectorAll('[data-enh]').forEach(b => b.onclick = () => enhanceSkill(b.dataset.enh));
  body.querySelectorAll('[data-bind]').forEach(b => b.onclick = () => { const [s, id] = b.dataset.bind.split(':'); bindSet(s, id); renderShop(); });
  body.querySelectorAll('[data-potion]').forEach(b => b.onclick = () => buyPotion(b.dataset.potion));
  const bb = $('buyBag');
  if (bb) bb.onclick = buyBag;
}

function buyBag() {
  runTx(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return false;
    const p = snap.data();
    const bs = p.bagSize || BASE_BAG;
    if (bs >= MAX_BAG) return false;
    const cost = 500 * Math.pow(2, (bs - 18) / 6);
    if ((p.gold || 0) < cost) return false;
    const add = Math.min(6, MAX_BAG - bs);
    tx.update(meRef, { gold: p.gold - cost, bagSize: bs + add });
    return add;
  }).then(ok => {
    if (ok) { sfx('buy'); toast(`🎒 가방이 <b>${ok}칸</b> 확장되었습니다!`, 'sysq'); renderShop(); }
    else toast('💰 골드가 부족합니다');
  }).catch(() => {});
}

function buySkill(id) {
  runTx(db, async tx => {
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
    return { ok: true, gold: p.gold - cost, lv: lv + 1, q };
  }).then(r => {
    if (r && r.ok) {
      /* 스냅샷을 기다리지 않고 바로 반영 — 이전엔 골드/레벨/핫바 잠금이 스냅샷 도착까지 옛 값이었음 */
      me.gold = r.gold; me.skills = { ...(me.skills || {}), [id]: r.lv }; me.q = r.q;
      sfx('buy'); toast(`✦ ${SKILLS[id].name} 습득!`, 'sysq'); float(me.x, me.y - 34, `${SKILLS[id].name} 습득!`, '#7fe3a0');
      renderShop(); try { updateHUD(); } catch (e) {}
    }
    else if (r === 'poor') { float(me.x, me.y - 34, '골드가 부족합니다', '#ff6b6b'); toast('💰 골드가 부족합니다'); }
  }).catch(() => {});
}

function buyPotion(itemId = 'potion') {
  const pcost = (POTION_SHOP.find(([p]) => p === itemId) || [])[2] || 0;
  runTx(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return false;
    const p = snap.data();
    if ((p.gold || 0) < pcost) return false;
    const bs = p.bagSize || BASE_BAG;
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

/* ================= 일일 콘텐츠 (출석 · 일일 퀘스트) ================= */
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const dayNum = str => { const [y, m, d] = str.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400000); };
/* 7일 출석 보상 (순환) */
const DAILY_ATTEND = [
  { gold: 300 }, { gold: 500 }, { gold: 700, gem: 2 }, { gold: 1000 }, { gold: 1500, gem: 3 }, { gold: 2000 }, { gold: 4000, gem: 8, item: 'scroll_adv' },
];
const DAILY_QUEST_POOL = [
  { id: 'dq_kill', type: 'total', goal: 30, icon: '⚔️', name: '몬스터 30마리 처치', gold: 600, gem: 1 },
  { id: 'dq_kill2', type: 'total', goal: 60, icon: '⚔️', name: '몬스터 60마리 처치', gold: 1000, gem: 2 },
  { id: 'dq_boss', type: 'boss', goal: 1, icon: '👑', name: '보스 1마리 처치', gold: 900, gem: 2 },
  { id: 'dq_gold', type: 'gold_earned', goal: 3000, icon: '💰', name: '골드 3,000 획득', gold: 500, gem: 1 },
  { id: 'dq_enh', type: 'enh', goal: 3, icon: '🔨', name: '장비 3회 강화 성공', gold: 700, gem: 1 },
  { id: 'dq_uniq', type: 'uniq', goal: 1, icon: '★', name: '유니크 몬스터 처치', gold: 1200, gem: 3 },
  { id: 'dq_item', type: 'items', goal: 15, icon: '🎒', name: '아이템 15개 획득', gold: 500, gem: 1 },
];
/* 날짜가 바뀌면 일일 초기화: 연속 출석 유지/리셋, 일일 퀘스트 3종 선택, 카운터 기준선 스냅샷 */
function checkDaily() {
  const t = todayStr();
  const d = me.daily || {};
  if (d.date === t) return;
  const consecutive = d.date && (dayNum(t) - dayNum(d.date) === 1);
  const base = { total: (me.q || {}).total || 0, boss: (me.q || {}).boss || 0, gold_earned: (me.q || {}).gold_earned || 0, enh: (me.q || {}).enh || 0, uniq: (me.q || {}).uniq || 0, items: (me.q || {}).items || 0 };
  /* 날짜 해시로 3종 선택(같은 날 재접속 시 동일) */
  let h = 0; for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const pool = [...DAILY_QUEST_POOL];
  const qs = [], usedType = new Set();
  for (let guard = 0; qs.length < 3 && pool.length; guard++) {
    const idx = (h + guard * 7) % pool.length;
    const q = pool.splice(idx, 1)[0];
    if (usedType.has(q.type)) continue; /* 같은 종류(예: 처치) 중복 방지 */
    usedType.add(q.type); qs.push(q.id);
  }
  me.daily = { date: t, streak: (consecutive && d.attended) ? (d.streak || 0) : 0, attended: false, base, quests: qs, claimed: {} }; /* 어제 출석을 안 했으면 연속 끊김 */
  updX(meRef, { daily: me.daily }).catch(() => {});
}
const dailyQDef = id => DAILY_QUEST_POOL.find(q => q.id === id);
const dailyQProgress = dq => Math.max(0, qCounter(dq.type) - (((me.daily || {}).base || {})[dq.type] || 0)); /* base에 없는 종류여도 0 기준으로 안전 */
function claimAttend() {
  if ((me.daily || {}).attended) return;
  runTx(db, async tx => {
    const snap = await tx.get(meRef); if (!snap.exists()) return null;
    const p = snap.data();
    const dl = p.daily || {};
    if (dl.date !== todayStr()) return { stale: true };
    if (dl.attended) return { already: true };
    const streak = (dl.streak || 0) + 1;
    const rw = DAILY_ATTEND[(streak - 1) % 7];
    const upd = { gold: (p.gold || 0) + rw.gold, daily: { ...dl, attended: true, streak } };
    if (rw.gem) upd.gem = (p.gem || 0) + rw.gem;
    if (rw.item) { const r = computeAddToInv(p, rw.item); if (r) Object.assign(upd, r.upd); }
    tx.update(meRef, upd);
    return { streak, rw };
  }).then(res => {
    if (!res) return;
    if (res.stale) { checkDaily(); renderQuests(); toast('날짜가 바뀌어 일일 정보를 새로 고쳤습니다'); return; }
    if (res.already) { me.daily = { ...(me.daily || {}), attended: true }; renderQuests(); toast('오늘 출석은 이미 완료했습니다'); return; }
    me.daily = { ...(me.daily || {}), attended: true, streak: res.streak }; /* 스냅샷 전에 즉시 확정(대입) */
    sfx('levelup'); enhFxFx(true);
    rings.push({ x: me.x, y: me.y, r: 90, t: 0, max: 600, color: '255,215,0' });
    fxSparks(me.x, me.y - 10, 20, '#ffd700', 190);
    toast(`📅 ${res.streak}일차 출석! 💰${res.rw.gold}${res.rw.gem ? ' 💎' + res.rw.gem : ''}${res.rw.item ? ' · 📜 고급 강화 주문서' : ''}`, 'sysq');
    renderQuests();
  }).catch(e => { toast('⚠️ 출석 처리 실패: ' + esc((e && e.code) || e)); });
}
function claimDailyQuest(id) {
  const dq = dailyQDef(id); if (!dq) return;
  if (dailyQProgress(dq) < dq.goal) return;
  runTx(db, async tx => {
    const snap = await tx.get(meRef); if (!snap.exists()) return null;
    const p = snap.data();
    const dl = p.daily || {};
    if (dl.date !== todayStr()) return 'stale';
    if ((dl.claimed || {})[id]) return 'already';
    if (dailyQProgress(dq) < dq.goal) return 'short';
    const claimed = { ...(dl.claimed || {}), [id]: true };
    const upd = { gold: (p.gold || 0) + dq.gold, gem: (p.gem || 0) + (dq.gem || 0), daily: { ...dl, claimed } };
    tx.update(meRef, upd);
    return true;
  }).then(ok => {
    if (!ok) return;
    if (ok === 'stale') { checkDaily(); renderQuests(); return; }
    if (ok === 'already') { me.daily = { ...(me.daily || {}), claimed: { ...((me.daily || {}).claimed || {}), [id]: true } }; renderQuests(); toast('이미 수령한 일일 퀘스트입니다'); return; }
    if (ok === 'short') { toast('아직 조건을 달성하지 않았습니다'); renderQuests(); return; }
    me.daily = { ...(me.daily || {}), claimed: { ...((me.daily || {}).claimed || {}), [id]: true } }; /* 즉시 확정(대입) */
    sfx('coin');
    toast(`✅ 일일 「${esc(dq.name)}」 완료! 💰${dq.gold}${dq.gem ? ' 💎' + dq.gem : ''}`, 'sysq');
    float(me.x, me.y - 40, '일일 완료!', '#7fe3a0');
    renderQuests();
  }).catch(() => {});
}
function dailyPanelHtml() {
  checkDaily();
  const dl = me.daily || {};
  const streak = dl.streak || 0;
  /* 출석 캘린더 7칸 */
  let cal = '<div class="dcal">';
  for (let i = 0; i < 7; i++) {
    const rw = DAILY_ATTEND[i];
    const got = dl.attended ? (i < ((streak - 1) % 7 + 1)) : (i < (streak % 7));
    const isNext = !dl.attended && i === (streak % 7);
    cal += `<div class="dcell ${got ? 'got' : ''} ${isNext ? 'next' : ''}"><div class="dcd">${i + 1}일</div><div class="dcr">💰${rw.gold >= 1000 ? (rw.gold / 1000) + 'k' : rw.gold}${rw.gem ? '<br>💎' + rw.gem : ''}${rw.item ? '<br>📜' : ''}</div></div>`;
  }
  cal += '</div>';
  const attendBtn = dl.attended
    ? `<button class="claimBtn" disabled>출석 완료</button>`
    : `<button class="claimBtn ready" id="attendBtn">${streak + 1}일차 출석</button>`;
  let dqRows = '';
  for (const id of (dl.quests || [])) {
    const dq = dailyQDef(id); if (!dq) continue;
    const cur = Math.min(dailyQProgress(dq), dq.goal), done = dailyQProgress(dq) >= dq.goal, claimed = (dl.claimed || {})[id];
    const pct = clampN(cur / dq.goal * 100, 0, 100);
    dqRows += `<div class="srow ${claimed ? 'qdone' : ''}">
      <div class="si">${dq.icon}</div>
      <div class="sm"><div class="st">${esc(dq.name)}</div>
        <div class="sd">${cur}/${dq.goal} · 보상 💰${dq.gold}${dq.gem ? ' 💎' + dq.gem : ''}</div>
        <div class="qbar"><div style="width:${pct}%"></div></div></div>
      ${claimed ? '<button class="claimBtn" disabled>완료</button>' : `<button class="claimBtn ${done ? 'ready' : ''}" data-dq="${id}" ${done ? '' : 'disabled'}>수령</button>`}
    </div>`;
  }
  return `<div class="dailyBox"><div class="dailyHd">📅 출석 체크 <span>연속 ${streak}일</span></div>${cal}<div style="text-align:center;margin:8px 0">${attendBtn}</div>
    <div class="dailyHd">🎯 오늘의 일일 퀘스트 <span>매일 자정 초기화</span></div>${dqRows}</div>
    <div class="dailyHd" style="margin-top:12px">📜 도전 퀘스트</div>`;
}

function renderQuests() {
  const body = $('questBody');
  body.innerHTML = dailyPanelHtml() + QUESTS.map(q => {
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
  const ab = $('attendBtn'); if (ab) ab.onclick = claimAttend;
  body.querySelectorAll('[data-dq]').forEach(b => b.onclick = () => claimDailyQuest(b.dataset.dq));
}

function claimQuest(id) {
  const qdef = QUESTS.find(q => q.id === id);
  if (!qdef) return;
  runTx(db, async tx => {
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

/* ================= 업적 · 칭호 ================= */
const TITLES = {
  novice:    { name: '초심자',       color: '#9aa' },
  slayer:    { name: '학살자',       color: '#e74c3c' },
  bosshunter:{ name: '보스 헌터',     color: '#c0392b' },
  uniquehunter:{ name: '유니크 사냥꾼', color: '#ff4d4d' },
  rich:      { name: '대부호',       color: '#ffd700' },
  collector: { name: '수집가',       color: '#3498db' },
  scholar:   { name: '박물학자',     color: '#1abc9c' },
  conqueror: { name: '정복자',       color: '#9b59b6' },
  legend:    { name: '살아있는 전설', color: '#f39c12' },
  immortal:  { name: '불멸자',       color: '#e8e4d8' },
  master:    { name: '무기 장인',     color: '#5dade2' },
};
/* stat: q 카운터/파생값. tiers: [목표, 골드, 보석, 칭호?] 여러 단계 */
const ACHIEVEMENTS = [
  { id: 'kills',  icon: '⚔️', name: '몬스터 사냥',   stat: 'total',        tiers: [[50,300,1],[500,1500,3,'slayer'],[5000,8000,10]] },
  { id: 'boss',   icon: '👑', name: '보스 토벌',     stat: 'boss',         tiers: [[5,500,2],[30,3000,5,'bosshunter'],[100,12000,15]] },
  { id: 'uniq',   icon: '★',  name: '유니크 처치',   stat: 'uniq',         tiers: [[3,600,3],[25,4000,8,'uniquehunter'],[100,15000,20]] },
  { id: 'zones',  icon: '🗺️', name: '구역 정복',     stat: 'zones',        tiers: [[5,400,2],[30,4000,8,'conqueror'],[100,30000,40,'legend']] },
  { id: 'level',  icon: '⭐', name: '성장',          stat: 'lv',           tiers: [[10,300,1],[50,5000,10],[100,20000,30,'immortal']] },
  { id: 'gold',   icon: '💰', name: '재산 축적',     stat: 'gold_earned',  tiers: [[5000,300,1],[100000,3000,6,'rich'],[2000000,20000,25]] },
  { id: 'dex',    icon: '📖', name: '몬스터 도감',   stat: 'dex',          tiers: [[20,500,2,'collector'],[100,4000,10],[300,25000,30,'scholar']] },
  { id: 'items',  icon: '🎒', name: '아이템 수집',   stat: 'items',        tiers: [[50,300,1],[500,2500,6],[3000,12000,18]] },
  { id: 'enh',    icon: '🔨', name: '장비 강화',     stat: 'enh',          tiers: [[10,400,2],[100,4000,10,'master'],[500,18000,22]] },
  { id: 'skills', icon: '✦',  name: '스킬 연마',     stat: 'skills_bought',tiers: [[5,300,1],[30,3000,8],[100,12000,15]] },
];
const achvValue = stat => {
  const q = me.q || {};
  if (stat === 'lv') return me.lv || 1; /* q 카운터 외 파생값 */
  if (stat === 'zones') return Object.keys(me.conq || {}).length;
  if (stat === 'dex') return Object.keys(me.dex || {}).length;
  return q[stat] || 0;
};
/* 다음 미수령 단계 인덱스 (0-based), 전 단계 수령했는지 기준 */
function achvStage(a) {
  const cl = (me.achv || {})[a.id] || 0; /* 수령한 단계 수 */
  return cl;
}
function achvClaimable(a) {
  const cl = achvStage(a);
  if (cl >= a.tiers.length) return false;
  return achvValue(a.stat) >= a.tiers[cl][0];
}
function achvClaimableCount() { return ACHIEVEMENTS.filter(achvClaimable).length; }
function renderAchv() {
  const body = $('achvBody'); if (!body) return;
  const title = me.title || '';
  let owned = ownedTitles();
  const titleBar = `<div class="achvTitles"><div class="atHd">🎖️ 칭호 <span>이름 앞에 표시 · 클릭해 장착/해제</span></div><div class="atList">`
    + `<button class="atChip ${!title ? 'on' : ''}" data-title="">없음</button>`
    + owned.map(t => `<button class="atChip ${title === t ? 'on' : ''}" data-title="${t}" style="--tc:${TITLES[t].color}">${esc(TITLES[t].name)}</button>`).join('')
    + (owned.length ? '' : '<span class="atNone">업적을 달성해 칭호를 획득하세요</span>') + `</div></div>`;
  const rows = ACHIEVEMENTS.map(a => {
    const cl = achvStage(a);
    const done = cl >= a.tiers.length;
    const stage = done ? a.tiers[a.tiers.length - 1] : a.tiers[cl];
    const cur = achvValue(a.stat);
    const goal = stage[0];
    const pct = clampN(cur / goal * 100, 0, 100);
    const claim = achvClaimable(a);
    const rw = [`💰${stage[1]}`, stage[2] ? `💎${stage[2]}` : '', stage[3] ? `🎖️${TITLES[stage[3]].name}` : ''].filter(Boolean).join(' ');
    return `<div class="srow ${done ? 'qdone' : ''}">
      <div class="si">${a.icon}</div>
      <div class="sm">
        <div class="st">${esc(a.name)} <span class="astage">${done ? 'MAX' : (cl + 1) + '단계'}</span></div>
        <div class="sd">${Math.min(cur, goal).toLocaleString()}/${goal.toLocaleString()}${done ? ' · 전 단계 달성!' : ' · 보상 ' + rw}</div>
        <div class="qbar"><div style="width:${pct}%"></div></div>
      </div>
      ${done ? `<button class="claimBtn" disabled>완료</button>`
        : `<button class="claimBtn ${claim ? 'ready' : ''}" data-achv="${a.id}" ${claim ? '' : 'disabled'}>수령</button>`}
    </div>`;
  }).join('');
  body.innerHTML = titleBar + rows;
  body.querySelectorAll('[data-achv]').forEach(b => b.onclick = () => claimAchv(b.dataset.achv));
  body.querySelectorAll('[data-title]').forEach(b => b.onclick = () => setTitle(b.dataset.title));
}
function ownedTitles() {
  const set = new Set();
  for (const a of ACHIEVEMENTS) { const cl = (me.achv || {})[a.id] || 0; for (let i = 0; i < cl; i++) { const t = a.tiers[i][3]; if (t) set.add(t); } }
  return [...set];
}
function setTitle(t) {
  if (t && !ownedTitles().includes(t)) return;
  me.title = t;
  updX(meRef, { title: t }).catch(() => {});
  sfx('click'); renderAchv();
}
function claimAchv(id) {
  const a = ACHIEVEMENTS.find(x => x.id === id); if (!a) return;
  runTx(db, async tx => {
    const snap = await tx.get(meRef); if (!snap.exists()) return null;
    const p = snap.data();
    const cl = (p.achv || {})[id] || 0;
    if (cl >= a.tiers.length) return { done: true };
    const val = Math.max(achvValue(a.stat), achvValueOf(p, a.stat)); /* 로컬·서버 카운터 중 큰 값 — 어느 쪽이 늦어도 정당한 수령이 막히지 않게 */
    if (val < a.tiers[cl][0]) return { short: a.tiers[cl][0] - val };
    const stage = a.tiers[cl];
    const achv = { ...(p.achv || {}), [id]: cl + 1 };
    const upd = { achv, gold: (p.gold || 0) + stage[1] };
    if (stage[2]) upd.gem = (p.gem || 0) + stage[2];
    tx.update(meRef, upd);
    return { stage, next: cl + 1 };
  }).then(r => {
    if (!r) return;
    if (r.done) { toast('이미 모든 단계를 수령했습니다'); renderAchv(); return; }
    if (r.short) { toast(`조건 미달 — ${r.short.toLocaleString()} 남음`); renderAchv(); return; }
    const stage = r.stage;
    /* 단계는 '대입'으로 즉시 확정(증가 아님 → 오프라인 localTx가 이미 반영했어도 이중 없음). 골드/보석은 스냅샷·localTx가 반영 */
    me.achv = { ...(me.achv || {}), [id]: Math.max((me.achv || {})[id] || 0, r.next) };
    sfx('levelup'); enhFxFx(true);
    rings.push({ x: me.x, y: me.y, r: 90, t: 0, max: 600, color: '255,215,0' });
    fxSparks(me.x, me.y - 10, 22, '#ffd700', 200);
    toast(`🏆 업적 「${esc(a.name)}」 달성! 💰${stage[1]}${stage[2] ? ' 💎' + stage[2] : ''}${stage[3] ? ' · 칭호 <b>' + esc(TITLES[stage[3]].name) + '</b> 획득!' : ''}`, 'sysq');
    if (stage[3]) sysMsg(`🎖️ ${myName}님이 칭호 「${TITLES[stage[3]].name}」을(를) 획득했습니다!`, 'q');
    renderAchv();
  }).catch(e => { window.__lastErr = { at: Date.now(), where: 'claimAchv', code: e && e.code, msg: String(e && e.message || e) }; toast('⚠️ 업적 수령 실패: ' + esc((e && e.code) || (e && e.message) || e)); });
}
/* 서버 문서 p 기준 업적 진행값 (로컬 me와 비교용) */
function achvValueOf(p, stat) {
  const q = p.q || {};
  if (stat === 'lv') return p.lv || 1;
  if (stat === 'zones') return Object.keys(p.conq || {}).length;
  if (stat === 'dex') return Object.keys(p.dex || {}).length;
  return q[stat] || 0;
}
/* 칭호 표시 문자열 */
const titleTag = t => (t && TITLES[t]) ? `[${TITLES[t].name}] ` : '';

/* ================= 인벤토리/루팅 ================= */
function itemStat(it) {
  return [it.atk ? `공격+${it.atk}` : '', it.def ? `방어+${it.def}` : '',
    it.crit ? `치명타+${Math.round(it.crit * 100)}%p` : '', it.spd ? `속도+${it.spd}` : '',
    it.heal ? `HP+${it.heal} 회복` : '', it.mana ? `MP+${it.mana} 회복` : ''].filter(Boolean).join(' · ');
}

let bagFullUntil = 0;
/* 줍기 연출: 자석 비행 + 도착 피드백 */
const PICK_MS = 260;
const pickFx = [];
const pickHide = new Set();
async function pickup(lid, l) {
  if (picking) return;
  picking = true;
  try {
    let item = null, res = null, soldG = 0;
    /* 루팅 삭제와 인벤토리 추가를 한 트랜잭션으로 — 가방이 가득이면 삭제하지 않고 바닥에 남김
       (이전엔 먼저 삭제 후 추가 실패 시 아이템이 영구 소실) */
    await (lid.startsWith('local_') ? localTx : fn => runTx(db, fn))(async tx => {
      item = null; res = null;
      const ref = doc(db, 'loot', lid);
      const lsnap = await tx.get(ref);
      if (!lsnap.exists()) return;
      const psnap = await tx.get(meRef);
      if (!psnap.exists()) return;
      const cand = lsnap.data();
      /* 바닥의 타 직업 무기(다른 플레이어 드롭/과거 드롭)도 줍는 순간 내 직업 무기로 치환 */
      const giveId = classWeapon(cand.itemId);
      const gi = getItem(giveId);
      /* 등급 자동 판매: 설정에 켠 등급의 장비는 가방에 담지 않고 즉시 판매(골드만) */
      if (gi.slot && !gi.scroll && !gi.heal && !gi.mana && !gi.book && settings.autoSell && settings.autoSell[gi.rarity]) {
        const price = sellPrice(giveId);
        const pq = { ...(psnap.data().q || {}) }; pq.items = (pq.items || 0) + 1; /* 자동 판매도 '아이템 획득'으로 집계(업적·일일퀘) */
        tx.delete(ref);
        tx.update(meRef, { gold: (psnap.data().gold || 0) + price, q: pq });
        item = { ...cand, itemId: giveId }; res = 'autosold'; soldG = price;
        return;
      }
      const r = computeAddToInv(psnap.data(), giveId);
      if (!r) { res = 'full'; return; }
      tx.delete(ref);
      tx.update(meRef, r.upd);
      item = { ...cand, itemId: giveId }; res = r.res; soldG = r.sold || 0;
    });
    if (item && res !== 'full' && !lid.startsWith('local_')) deleteDoc(doc(db, 'loot', lid)).catch(() => {}); /* 서버 루팅 문서(구버전 드롭)는 실제로 지워야 스냅샷마다 되살아나 무한 획득되지 않음 */
    if (!item && res === null) { /* 루팅 문서가 이미 사라진 유령 항목: 자동 사냥이 그 자리에서 맴돌지 않게 건너뛰고, 로컬 항목이면 제거 */
      lootSkip[lid] = Date.now() + 5000;
      delete lootItems[lid]; /* 서버에 실제로 있으면 루팅 스냅샷이 다시 채운다 */
      return;
    }
    if (res === 'full') {
      bagFullUntil = Date.now() + 2500; /* 자동 루팅 재시도 폭주 방지 */
      lootSkip[lid] = Date.now() + 20000; /* 자동 사냥이 이 루팅 앞에 멈춰 서지 않게 */
      float(me.x, me.y - 30, '가방이 가득 참', '#e74c3c');
      toast('🎒 가방이 가득 찼습니다 — 아이템은 바닥에 남아있습니다');
      return;
    }
    if (!item) return;
    const it = getItem(item.itemId);
    /* 데이터는 즉시 확정(선점 방지), 연출·알림은 도착 시점에 */
    const map0 = myMap();
    pickFx.push({ lid, itemId: item.itemId, x0: l.x, y0: l.y, t0: Date.now() });
    pickHide.add(lid);
    setTimeout(() => {
      pickHide.delete(lid);
      for (let i = pickFx.length - 1; i >= 0; i--) if (pickFx[i].lid === lid) pickFx.splice(i, 1);
      if (myMap() !== map0) return; /* 날아오는 중 맵 이동 시 알림 생략 */
      sfx('pickup');
      if (res !== 'autosold') flashInv();
      heroPickT = Date.now(); /* 줍기 숙이기 모션 */
      fxSparks(me.x, me.y - 22, 8, it.color || '#ffd700', 90);
      if (res === 'autosold') { toast(`💰 <span style="color:#8aa">[${RARITY_KR[it.rarity] || '일반'}]</span> ${esc(it.name)} 자동 판매 <b style="color:#ffd700">+${soldG.toLocaleString()} G</b>`); float(me.x, me.y - 30, `+${soldG} G`, '#ffd700'); }
      else if (res === 'equipped') toast(`${itemIconHtml(item.itemId, 22)} <b style="color:${it.color}">${esc(it.name)}</b> 획득 → <b>자동 장착!</b> <span style="color:#8aa">[${RARITY_KR[it.rarity] || '일반'}]</span>`, 'sysq');
      else if (res === 'swapped') toast(`${itemIconHtml(item.itemId, 22)} <b style="color:${it.color}">${esc(it.name)}</b> 획득 → <b>자동 장착!</b> 기존 장비 자동판매 <b style="color:#ffd700">+${soldG.toLocaleString()} G</b>`, 'sysq');
      else if (res === 'stacked') toast(`${itemIconHtml(item.itemId, 22)} <b style="color:${it.color}">${esc(it.name)}</b> 보유 수량 +1 <span style="color:#8aa">[${RARITY_KR[it.rarity] || '일반'}]</span>`);
      else toast(`${itemIconHtml(item.itemId, 22)} <b style="color:${it.color}">${esc(it.name)}</b> 획득 <span style="color:#8aa">[${RARITY_KR[it.rarity] || '일반'}]</span> → 가방 <b>${Object.keys(me.inv || {}).length}/${bagSize()}</b>`);
      if (res !== 'autosold') float(me.x, me.y - 30, `+ ${it.name}`, it.color);
    }, PICK_MS);
  } catch (e) {
    lootSkip[lid] = Date.now() + 10000; /* 트랜잭션 오류 시 같은 루팅을 매 프레임 재시도하지 않게 */
    window.__lastErr = { at: Date.now(), where: 'pickup', code: e && e.code, msg: String(e && e.message || e) };
  } finally { picking = false; }
}

/* 플레이어 데이터 p에 itemId를 추가했을 때의 갱신 계산 (순수 함수) — null이면 가방 가득 */
function computeAddToInv(p, itemId) {
  const bs = p.bagSize || BASE_BAG;
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
  const usable = !it.cls || it.cls === (p.cls || myCls); /* 직업 전용 무기: 타 직업은 자동장착 제외 */
  for (let i = 0; i < bs; i++) {
    if (inv[String(i)] == null) {
      let res, sold = 0;
      inv[String(i)] = itemId;
      if (it.slot && usable && !eq[it.slot]) {
        delete inv[String(i)];
        eq[it.slot] = itemId;
        upd.equipped = eq;
        upd['q.eqflag'] = 1;
        res = 'equipped';
      } else if (it.slot && usable && eq[it.slot]) {
        const cur = getItem(eq[it.slot]);
        const cR = RARITY_RANK[cur.rarity] ?? 0, nR = RARITY_RANK[it.rarity] ?? 0;
        const cP = (cur.atk || 0) + (cur.def || 0), nP = (it.atk || 0) + (it.def || 0);
        if (nR > cR || (nR === cR && (it._lv || 0) > (cur._lv || 0)) || (nR === cR && (it._lv || 0) === (cur._lv || 0) && nP > cP)) {
          /* 더 좋은 장비 자동 장착 + 기존 장비는 자동 판매 */
          sold = sellPrice(eq[it.slot]);
          upd.gold = (p.gold || 0) + sold;
          delete inv[String(i)];
          eq[it.slot] = itemId;
          upd.equipped = eq;
          upd['q.eqflag'] = 1;
          res = 'swapped';
        } else res = 'added';
      } else res = 'added';
      upd.inv = sortInvMap(inv);
      return { upd, res, sold };
    }
  }
  return null;
}

function addToInv(itemId) {
  return runTx(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return null;
    const r = computeAddToInv(snap.data(), itemId);
    if (!r) return null;
    tx.update(meRef, r.upd);
    return r.res;
  }).catch(() => null);
}

let selPotKey = null, selPotT = 0;
function slotClick(rawId) {
  if (me.dead) { toast('사망 상태에서는 아이템을 사용할 수 없습니다'); return; }
  runTx(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return;
    const p = snap.data();
    const inv = { ...(p.inv || {}) };
    const eq = { ...(p.equipped || {}) };
    const key = findInvKey(inv, rawId);
    if (!key) return;
    const itemId = inv[key];
    const it = getItem(itemId);
    if (it.heal || it.mana) {
      /* 가방에서 실수로 먹는 것 방지: 첫 탭은 선택만, 1.5초 내 다시 누르면 사용 */
      const selK = key + ':' + itemId;
      if (selPotKey !== selK || Date.now() - selPotT > 1500) {
        selPotKey = selK; selPotT = Date.now();
        setTimeout(() => {
          toast(`${it.heal ? '🧪' : '💧'} ${it.name} (${it.heal ? 'HP +' + it.heal : 'MP +' + it.mana}) — 한 번 더 누르면 사용`);
          sfx('click');
        }, 0);
        return;
      }
      selPotKey = null;
    }
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
    } else if (it.slot && it.cls && it.cls !== myCls) {
      setTimeout(() => toast(`⚠️ ${CLASSES[it.cls]?.name || '타 직업'} 전용 무기라 장착할 수 없습니다`), 0);
    } else if (it.slot) {
      const old = eq[it.slot];
      eq[it.slot] = itemId;
      if (old) inv[key] = old; else delete inv[key];
      tx.update(meRef, { inv: sortInvMap(inv), equipped: eq, 'q.eqflag': 1 });
      setTimeout(() => sfx('buy'), 0);
    } else if (it.book) {
      setTimeout(() => toast('📘 스킬서는 더블 클릭으로 활성화합니다'), 0);
    } else {
      /* 슬롯 정의가 없는(레거시/알 수 없는) 아이템 — 장착하면 eq["undefined"]로 증발하므로 차단 */
      setTimeout(() => toast('사용할 수 없는 아이템입니다 (판매만 가능)'), 0);
    }
  }).catch(() => {});
}

/* 스킬서 사용: 트리 스킬 → 습득(골드 불필요) / 기본 스킬 → 레벨업(MAX면 강화+1, 주문서·골드 불필요) */
function useSkillBook(rawId) {
  const [bid] = splitStack(rawId);
  const it = getItem(bid);
  const sid = it.book;
  const d = skillDef(sid);
  if (!d) return;
  if (d.cls && d.cls !== 'all' && d.cls !== myCls) { toast(`⚠️ ${CLASSES[d.cls]?.name || '타 직업'} 전용 스킬서입니다`); return Promise.resolve('cls'); }
  return runTx(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return null;
    const p = snap.data();
    const inv = { ...(p.inv || {}) };
    const key = findInvKey(inv, rawId);
    if (!key) return 'nokey';
    let res;
    if (TREES_ALL[sid]) {
      if ((p.tree || {})[sid]) return 'have';
      delete inv[key];
      tx.update(meRef, { inv: sortInvMap(inv), [`tree.${sid}`]: true, q: { ...(p.q || {}), skills_bought: ((p.q || {}).skills_bought || 0) + 1 } });
      res = 'learn';
    } else {
      const skills = { ...(p.skills || {}) }, enh = { ...(p.skillEnh || {}) };
      const lv = skills[sid] || 0;
      if (lv < MAX_SKILL_LV) { skills[sid] = lv + 1; res = lv ? 'lvup' : 'learn'; }
      else if ((enh[sid] || 0) < 5) { enh[sid] = (enh[sid] || 0) + 1; res = 'enh'; }
      else return 'max';
      delete inv[key];
      tx.update(meRef, { inv: sortInvMap(inv), skills, skillEnh: enh });
    }
    return res;
  }).then(r => {
    window.__lastBook = r;
    if (!r || r === 'nokey') return r;
    if (r === 'have') { toast('이미 습득한 스킬입니다 (판매 가능)'); return; }
    if (r === 'max') { toast('이미 최대 강화 상태입니다 (판매 가능)'); return; }
    sfx('levelup'); enhFxFx(true);
    fxFlash('255,215,0', 420, .3);
    rings.push({ x: me.x, y: me.y, r: 90, t: 0, max: 600, color: '255,215,0' });
    fxSparks(me.x, me.y - 10, 26, '#ffd700', 200);
    const nm = esc(d.name);
    toast(`${skillIconHtml(sid, d)} <b>${nm}</b> ${r === 'learn' ? '습득!' : r === 'lvup' ? `Lv ${skillLv(sid) + 1}!` : `강화 +${(((me.skillEnh || {})[sid]) || 0) + 1}!`}`, 'sysq');
    float(me.x, me.y - 40, `${d.name} ${r === 'learn' ? '습득!' : '강화!'}`, '#ffd700', true);
    setTimeout(() => { if ($('shopPanel')?.classList.contains('open')) renderShop(); if ($('treePanel')?.classList.contains('open')) renderTree(); }, 300);
  }).catch(err => { window.__lastErr = { at: Date.now(), where: 'useSkillBook', code: err && err.code, msg: String(err && err.message || err) }; if (err && err.code === 'resource-exhausted') onQuotaExceeded(); });
}
function unequip(slot) {
  runTx(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return;
    const p = snap.data();
    const eq = { ...(p.equipped || {}) };
    const itemId = eq[slot];
    if (!itemId) return;
    const bs = p.bagSize || BASE_BAG;
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

let salvArmed = -1, salvAway = null;
function toggleSalvageMenu() {
  const ex = $('salvMenu'); if (ex) { ex.remove(); salvArmed = -1; return; }
  const opts = [[0, '일반 이하'], [1, '고급 이하'], [2, '희귀 이하']];
  const count = rank => Object.values(me.inv || {}).filter(v => { const it = getItem(v); return it.slot && !it.scroll && !it.heal && !it.mana && !it.book && (RARITY_RANK[it.rarity] ?? 0) <= rank; }).length;
  const m = document.createElement('div'); m.id = 'salvMenu';
  m.style.cssText = 'position:fixed;z-index:9999;background:#141a26;border:1px solid #3a4a66;border-radius:8px;padding:8px;min-width:220px;box-shadow:0 8px 24px rgba(0,0,0,.6);';
  m.innerHTML = `<div style="color:#5dade2;font-size:12px;font-weight:bold;margin-bottom:6px;">🔨 장비 분해 (장착 제외)</div>`
    + opts.map(([r, lbl]) => `<button data-salv="${r}" style="display:flex;justify-content:space-between;gap:12px;width:100%;padding:7px 10px;font-size:12px;background:#1c2536;color:#cde;border:1px solid #2b3547;border-radius:6px;margin-bottom:4px;"><span>■ ${lbl} ${count(r)}개</span><span style="color:#5dade2">💰+💎</span></button>`).join('')
    + `<div style="color:#667;font-size:10.5px;margin-top:2px;">같은 항목을 한 번 더 누르면 분해 · 희귀+는 보석 지급</div>`;
  const btn = $('salvageBtn'); const br = btn ? btn.getBoundingClientRect() : { left: 100, bottom: 100 };
  m.style.left = Math.min(br.left, innerWidth - 240) + 'px'; m.style.top = (br.bottom + 6) + 'px';
  document.body.appendChild(m);
  m.querySelectorAll('[data-salv]').forEach(b => b.onclick = ev => {
    ev.stopPropagation(); const r = +b.dataset.salv;
    if (salvArmed === r) { salvArmed = -1; m.remove(); salvageBulk(r); }
    else { salvArmed = r; m.querySelectorAll('[data-salv]').forEach(x => x.style.borderColor = '#2b3547'); b.style.borderColor = '#ff6b6b'; setTimeout(() => { if (salvArmed === r && document.body.contains(b)) { salvArmed = -1; b.style.borderColor = '#2b3547'; } }, 3000); }
  });
  if (salvAway) document.removeEventListener('pointerdown', salvAway);
  salvAway = e => { const mm = $('salvMenu'); if (mm && !mm.contains(e.target) && e.target.id !== 'salvageBtn') { mm.remove(); salvArmed = -1; } };
  setTimeout(() => document.addEventListener('pointerdown', salvAway), 0);
}
function openEnhModal(scrollRaw, targetRaw) {
  closeEnhModal();
  const [sb] = splitStack(scrollRaw);
  const sc = getItem(sb);
  const t = getItem(targetRaw);
  if (!sc.scroll || t.scroll) return;
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
  const it0 = getItem(rawId);
  if (!(it0.heal || it0.mana || it0.scroll)) return null; /* 장비는 정확히 같은 항목만 — '같은 계열' 대체는 소모품(수량 표기 차이)에만 (장착템 판매·강화가 가방의 다른 +강화 사본을 건드리던 버그) */
  const want = normId(rawId);
  for (const [k, v] of Object.entries(inv)) if (normId(v) === want) return k;
  return null;
}

/* 등급별 일괄판매 */
let bulkArmed = '', bulkAway = null;
function sellByGrade(grade) {
  runTx(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return null;
    const p = snap.data();
    const inv = { ...(p.inv || {}) };
    let gain = 0, n = 0;
    for (const [k, v] of Object.entries(inv)) {
      const [bid] = splitStack(v);
      const gi = getItem(bid);
      if ((gi.rarity || 'common') !== grade) continue;
      if (gi.scroll || gi.book) continue; /* 주문서·스킬북은 장비 등급 일괄판매에서 제외(25G에 헐값 처분 방지) */
      gain += sellPrice(v); n++;
      delete inv[k];
    }
    if (!n) return null;
    tx.update(meRef, { gold: (p.gold || 0) + gain, inv: sortInvMap(inv) });
    return { gain, n };
  }).then(r => {
    if (!r) return;
    sfx('coin');
    toast(`💰 ${RARITY_KR[grade]} ${r.n}개 일괄판매 → <b style="color:#ffd700">+${r.gain.toLocaleString()} G</b>`);
    renderInvUI();
  }).catch(() => {});
}
function toggleBulkMenu() {
  closeEnhMenu();
  let m = $('bulkMenu');
  if (m) { m.remove(); bulkArmed = ''; return; }
  const byGrade = {};
  for (const v of Object.values(me.inv || {})) {
    const [bid] = splitStack(v);
    const r = getItem(bid).rarity || 'common';
    if (!byGrade[r]) byGrade[r] = { n: 0, gain: 0 };
    byGrade[r].n += 1; byGrade[r].gain += sellPrice(v);
  }
  const grades = Object.keys(byGrade);
  if (!grades.length) { toast('가방이 비어 있습니다'); return; }
  m = document.createElement('div');
  m.id = 'bulkMenu';
  m.style.cssText = 'position:fixed;z-index:9999;background:#141a26;border:1px solid #3a4a66;border-radius:8px;padding:8px;min-width:220px;box-shadow:0 8px 24px rgba(0,0,0,.6);';
  const btn = $('bulkSellBtn');
  const br = btn ? btn.getBoundingClientRect() : { left: 100, bottom: 100 };
  m.style.left = Math.min(br.left, innerWidth - 240) + 'px';
  m.style.top = (br.bottom + 6) + 'px';
  m.innerHTML = `<div style="color:#ffd700;font-size:12px;font-weight:bold;margin-bottom:6px;">등급별 일괄판매 (장착 제외)</div>` + grades.map(g =>
    `<button data-grade="${g}" style="display:flex;justify-content:space-between;gap:12px;width:100%;padding:7px 10px;font-size:12px;background:#1c2536;color:${RARITY_COLOR[g]};border:1px solid #2b3547;border-radius:6px;margin-bottom:4px;cursor:pointer;">`
    + `<span>■ ${RARITY_KR[g]} ${byGrade[g].n}개</span><span style="color:#ffd700">+${byGrade[g].gain.toLocaleString()}G</span></button>`).join('')
    + `<div style="color:#667;font-size:10.5px;margin-top:2px;">같은 등급을 한 번 더 누르면 판매</div>`;
  document.body.appendChild(m);
  m.querySelectorAll('[data-grade]').forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    if (bulkArmed === b.dataset.grade) { const g = b.dataset.grade; bulkArmed = ''; m.remove(); sellByGrade(g); }
    else {
      bulkArmed = b.dataset.grade;
      m.querySelectorAll('[data-grade]').forEach(x => x.style.borderColor = '#2b3547');
      b.style.borderColor = '#ff6b6b';
      setTimeout(() => { if (bulkArmed === b.dataset.grade) { bulkArmed = ''; if (document.body.contains(b)) b.style.borderColor = '#2b3547'; } }, 3000);
    }
  });
  if (bulkAway) document.removeEventListener('pointerdown', bulkAway);
  bulkAway = e => { const mm = $('bulkMenu'); if (mm && !mm.contains(e.target) && e.target.id !== 'bulkSellBtn') { mm.remove(); bulkArmed = ''; } };
  setTimeout(() => document.addEventListener('pointerdown', bulkAway), 0);
}
function sellItem(itemId) {
  runTx(db, async tx => {
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
  const noEnh = !!(it0.scroll || it0.heal || it0.mana || it0.book); /* 소모품은 강화 불가(강화된 물약은 단축바 수량·자동물약에서 빠짐) */
  const lv = it0._lv || 0;
  enhMenuEl = document.createElement('div');
  enhMenuEl.id = 'enhMenu';
  enhMenuEl.style.cssText = 'position:fixed;z-index:9999;background:#141a26;border:1px solid #3a4a66;border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:6px;box-shadow:0 8px 24px rgba(0,0,0,.6);min-width:180px;';
  if (!noEnh) for (const [g, label, col] of ENH_GRADES) {
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
  runTx(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return null;
    const p = snap.data();
    const inv = { ...(p.inv || {}) };
    const eq = { ...(p.equipped || {}) };
    const key = findInvKey(inv, itemId);
    let eqSlot = null;
    if (!key) {
      /* 장착 중 강화: 가방에 없으면 장착칸에서 탐색 */
      for (const [s, v] of Object.entries(eq)) if (v === itemId) { eqSlot = s; break; }
      if (!eqSlot) return 'gone';
    }
    const id = eqSlot ? eq[eqSlot] : inv[key];
    const it = getItem(id);
    if (it.scroll) return 'no';
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
    const [, tcnt] = splitStack(id);
    let result;
    if (Math.random() * 100 < chance) {
      const nid = it._base + '+' + (lv + 1) + (it._pct && it._pct !== 100 ? `~${it._pct}` : '');
      if (eqSlot) eq[eqSlot] = nid;
      else if (tcnt > 1) {
        inv[key] = splitStack(id)[0] + (tcnt - 1 > 1 ? '*' + (tcnt - 1) : '');
        let placed = false;
        for (let i = 0; i < (p.bagSize || BASE_BAG); i++) if (inv[String(i)] == null) { inv[String(i)] = nid; placed = true; break; }
        if (!placed) return 'full';
      } else inv[key] = nid;
      tx.update(meRef, { gold: p.gold - cost, inv: sortInvMap(inv), ...(eqSlot ? { equipped: eq } : {}) });
      result = { ok: true, nid };
    } else {
      if (eqSlot) delete eq[eqSlot]; else delete inv[key];
      tx.update(meRef, { gold: p.gold - cost, inv: sortInvMap(inv), ...(eqSlot ? { equipped: eq } : {}) });
      result = { ok: false };
    }
    return result;
  }).then(r => {
    if (!r) return;
    if (r === 'gone') { toast('아이템을 찾을 수 없습니다'); renderInvUI(); return; }
    if (r === 'poor') { toast('💰 골드가 부족합니다'); return; }
    if (r === 'noscroll') { toast('📜 강화 주문서가 없습니다'); return; }
    if (r === 'full') { toast('🎒 빈 슬롯이 없습니다'); renderInvUI(); return; }
    if (r === 'no') return;
    if (r === null) { toast('강화에 실패했습니다 — 다시 시도하세요'); return; }
    if (r.ok) {
      updX(meRef, { 'q.enh': inc(1) }).catch(() => {}); /* 업적: 강화 성공 카운트 — updX가 1회만 반영 */
      sfx('levelup');
      enhFxFx(true);
      toast(`🔨 강화 성공! <b style="color:${RARITY_COLOR[getItem(r.nid).rarity]}">${getItem(r.nid).name}</b>`, 'sysq');
      float(me.x, me.y - 40, '강화 성공!', '#ffd700');
      rings.push({ x: me.x, y: me.y, r: 70, t: 0, max: 450, color: '255,215,0' });
      fxSparks(me.x, me.y - 10, 14, '#ffd700', 140);
    } else {
      sfx('die');
      enhFxFx(false);
      doShake(10);
      toast('💥 <b>강화 실패 — 아이템이 파괴되었습니다!</b>');
      float(me.x, me.y - 40, '파괴...', '#ff5050');
      fxSparks(me.x, me.y - 10, 18, '#ff5050', 180);
    }
    renderInvUI();
  }).catch(() => {});
}

let invUIKey = '';
if (typeof $ !== 'undefined' && $('invPanel') && !$('invPanel')._tipBound) {
  $('invPanel')._tipBound = true;
  $('invPanel').addEventListener('mousemove', e => {
    const t = e.target.closest ? e.target.closest('.islot[data-raw], .eslot[data-raw]') : null;
    if (!t || !t.dataset.raw) { hideTip(); return; }
    const now = Date.now();
    if (t.dataset.raw !== tipLastRaw || now - tipLastT > 150) {
      tipLastRaw = t.dataset.raw; tipLastT = now;
      showTip(itemTipHtml(t.dataset.raw, t.classList.contains('islot')), e.clientX, e.clientY, t);
    } else placeTip(e.clientX, e.clientY, t);
  });
  $('invPanel').addEventListener('mouseleave', hideTip);
}
/* 퀵슬롯 바인딩 (1~5) */
function boundId(slot) {
  const b = (me.binds || {})[slot];
  if (b) return b;
  if (+slot === 3) return 'heal';
  const acts = classActiveIds();
  return acts[+slot - 1];
}
function bindSet(slot, id) {
  if (!meRef) return;
  me.binds = { ...(me.binds || {}), [slot]: id }; /* 즉시 반영 */
  updX(meRef, { [`binds.${slot}`]: id }).catch(() => {});
  toast(`⌨️ ${slot}번에 ${skillDef(id).name} 등록`);
}
function bindBtns(id) {
  let h = '<div class="bindrow">';
  for (let s = 1; s <= 5; s++) {
    const cur = ((me.binds || {})[s]) || (s === 3 ? 'heal' : (classActiveIds()[s - 1] || ''));
    h += `<button data-bind="${s}:${id}" class="${cur === id ? 'cur' : ''}">[${s}]</button>`;
  }
  return h + '</div>';
}
/* 물약 퀵슬롯 (6 체력 / 7 마나) */
function potCount(kind) {
  const ids = kind === 'hp' ? ['potion', 'potion_hi'] : ['potion_mp', 'potion_mm'];
  let n = 0;
  for (const v of Object.values(me.inv || {})) { const [bid, cnt] = splitStack(v); if (ids.includes(normId(bid))) n += cnt; }
  return n;
}
function usePotion(kind) {
  if (!ready || me.dead) return;
  const ids = kind === 'hp' ? ['potion', 'potion_hi'] : ['potion_mp', 'potion_mm'];
  const pref = (me.potPref || {})[kind];
  const order = pref ? [pref, ...ids.filter(x => normId(x) !== normId(pref))] : ids;
  runTx(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return;
    const p = snap.data();
    const inv = { ...(p.inv || {}) };
    for (const pid of order) { /* 선호 물약(potPref)을 먼저 소비 — 이전엔 order를 만들고도 ids를 돌아 무시됐다 */
      for (const [k, v] of Object.entries(inv)) {
        const [bid, cnt] = splitStack(v);
        if (normId(bid) !== pid) continue;
        const it = getItem(bid);
        if (kind === 'hp' && it.heal) {
          const nhp = Math.min(maxHpOf(), (me.hp || 0) + it.heal);
          if (cnt > 1) inv[k] = bid + '*' + (cnt - 1); else delete inv[k];
          tx.update(meRef, { inv, hp: nhp });
          setTimeout(() => { me.hp = nhp; hpDirty = true; float(me.x, me.y - 30, `+${it.heal} HP`, '#2ecc71'); rings.push({ x: me.x, y: me.y, r: 50, t: 0, max: 350, color: '46,204,113' }); sfx('potion'); }, 0);
          return;
        }
        if (kind === 'mp' && it.mana) {
          const nmp = Math.min(maxMpOf(), (me.mp ?? 0) + it.mana);
          if (cnt > 1) inv[k] = bid + '*' + (cnt - 1); else delete inv[k];
          tx.update(meRef, { inv, mp: Math.round(nmp) });
          setTimeout(() => { me.mp = nmp; float(me.x, me.y - 30, `+${it.mana} MP`, '#3498db'); rings.push({ x: me.x, y: me.y, r: 50, t: 0, max: 350, color: '52,152,219' }); sfx('potion'); }, 0);
          return;
        }
      }
    }
    setTimeout(() => toast(kind === 'hp' ? '🧪 체력 물약이 없습니다' : '💧 마나 물약이 없습니다'), 0);
  }).catch(() => {});
}
/* 스킬 트리 UI */
function renderTree() {
  const body = $('treeBody');
  if (!body) return;
  const cls = myCls;
  const owned = treeOwnedCount(cls);
  let html = `<div class="srow"><div class="si">🌳</div><div class="sm">`
    + `<div><span class="st">${CLASSES[cls].name} 트리</span><span class="slv">${owned}/100</span></div>`
    + `<div class="sd">공격 <b style="color:#fff">+${treeStat('atk')}</b> · 방어 +${treeStat('def')} · 치명 +${Math.round(treeStat('crit') * 100)}%p · 속도 +${treeStat('spd')} · HP +${treeStat('hp')} · MP +${treeStat('mp')}</div>`
    + `<div class="sd" style="margin-top:4px"><span class="skind act">발동</span> 둥근 사각 배지 · <span class="skind pas">패시브</span> 원형 배지 · 이름 색 = 등급 (T1~2 일반 → T10 유니크) · 보스가 <b style="color:#ffd700">스킬서</b>를 떨굽니다 (가방에서 더블 클릭)</div>`
    + `</div></div>`;
  for (let tier = 1; tier <= 10; tier++) {
    const req = treeTierReq(tier), cost = treeCost(tier);
    html += `<div class="tier"><div class="tTier">T${tier} <span>Lv${req.lv} · ${req.pts}pts · ${cost.toLocaleString()}G</span></div><div class="tGrid">`;
    for (const [id, d] of Object.entries(TREES[cls])) {
      if (d.tier !== tier) continue;
      const has = (me.tree || {})[id];
      const can = has || (owned >= req.pts && (me.lv || 1) >= req.lv && (me.gold || 0) >= cost);
      const gr = skillGrade(id, d), pas = isPassiveSkill(d);
      html += `<div class="tnode ${has ? 'owned' : can ? 'can' : 'lock'} ${pas ? 'pas' : 'act'}" data-tree="${id}" title="${esc(d.name)} [${RARITY_KR[gr] || '일반'} · ${pas ? '패시브' : '발동'}] — ${esc(d.desc)}${d.mp ? ` · 마나 ${d.mp}` : ''}">`
        + `<div class="ti">${skillIconHtml(id, d)}</div><div class="tn" style="color:${RARITY_COLOR[gr] || '#cdd'}">${esc(d.name)}</div>`
        + `<div class="tc">${has ? '✔' : cost.toLocaleString() + 'G'}</div>`
        + (has && d.kind === 'active' ? bindBtns(id) : '') + `</div>`;
    }
    html += `</div></div>`;
  }
  body.innerHTML = html;
  body.querySelectorAll('[data-tree]').forEach(el => el.onclick = () => buyTreeNode(el.dataset.tree));
  body.querySelectorAll('[data-bind]').forEach(el => el.onclick = ev => { ev.stopPropagation(); const [s, id] = el.dataset.bind.split(':'); bindSet(s, id); renderTree(); });
}
let treeT = 0;
function renderTreeThrottled() { if (Date.now() - treeT > 700) { treeT = Date.now(); renderTree(); } }
/* 스킬 강화 (MAX 이후 +1~+5, 주문서+성공률) */
function enhanceSkill(id) {
  const def = SKILLS[id];
  if (!def) return;
  const base = (me.skills || {})[id] || 0;
  if (base < MAX_SKILL_LV) { toast('MAX까지 먼저 배우세요'); return; }
  const enh = ((me.skillEnh || {})[id]) || 0;
  if (enh >= 5) { toast('강화 최대치입니다'); return; }
  const grade = enh < 2 ? 'normal' : enh < 4 ? 'adv' : 'top';
  const cost = Math.round(def.cost * 2 * (1 + enh));
  runTx(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return null;
    const p = snap.data();
    if (((p.skills || {})[id] || 0) < MAX_SKILL_LV) return 'nolvl';
    if ((((p.skillEnh || {})[id]) || 0) >= 5) return 'maxed';
    if ((p.gold || 0) < cost) return 'poor';
    const inv = { ...(p.inv || {}) };
    let scIdx = null, scBase = null, scCnt = 0;
    for (const [k, v] of Object.entries(inv)) {
      const [b, c] = splitStack(v);
      const sc = getItem(b);
      if (sc.scroll && (sc.grade || 'normal') === grade) { scIdx = k; scBase = b; scCnt = c; break; }
    }
    if (scIdx === null) return 'noscroll';
    if (scCnt > 1) inv[scIdx] = scBase + '*' + (scCnt - 1); else delete inv[scIdx];
    const ok = Math.random() * 100 < (90 - enh * 12);
    if (ok) { const se = { ...((p.skillEnh) || {}) }; se[id] = enh + 1; tx.update(meRef, { gold: p.gold - cost, inv: sortInvMap(inv), skillEnh: se }); }
    else tx.update(meRef, { gold: p.gold - cost, inv: sortInvMap(inv) });
    return ok ? 'ok' : 'fail';
  }).then(r => {
    if (r === 'ok') { sfx('levelup'); toast(`✦ ${def.name} 강화 +${enh + 1}!`, 'sysq'); enhFxFx(true); renderShop(); }
    else if (r === 'fail') { sfx('die'); toast(`💥 ${def.name} 강화 실패 (재료 소멸)`); enhFxFx(false); renderShop(); }
    else if (r === 'poor') toast('💰 골드가 부족합니다');
    else if (r === 'noscroll') toast('📜 강화 주문서가 없습니다');
  }).catch(() => {});
}
/* 강화 성공/실패 이펙트 (장비·스킬 공용) */
function enhFxFx(ok) {
  let ov = $('enhFx');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'enhFx';
    ov.style.cssText = 'position:fixed;inset:0;z-index:200;pointer-events:none;opacity:0;transition:opacity .12s;';
    document.body.appendChild(ov);
  }
  ov.style.background = ok
    ? 'radial-gradient(ellipse at center, rgba(255,215,0,.28), transparent 70%)'
    : 'radial-gradient(ellipse at center, rgba(255,40,40,.32), transparent 70%)';
  ov.style.opacity = 1;
  setTimeout(() => { ov.style.opacity = 0; }, ok ? 450 : 650);
  doShake(ok ? 12 : 18);
  hitStopUntil = Math.max(hitStopUntil, Date.now() + (ok ? 150 : 300));
  fxSparks(me.x, me.y - 10, ok ? 26 : 34, ok ? '#ffd700' : '#ff5050', ok ? 220 : 260);
  rings.push({ x: me.x, y: me.y, r: 90, t: 0, max: 550, color: ok ? '255,215,0' : '255,60,60' });
  float(me.x, me.y - 64, ok ? '강화 성공!' : '파괴...', ok ? '#ffd700' : '#ff5050', true);
}
/* 세트 네온: 같은 세트를 2개 이상 착용 중이면 그 세트 아이템 슬롯에 세트 색 발광 */
function markSetGlow(div, rawId) {
  try {
    const base = getItem(rawId)._base || splitStack(rawId)[0];
    const sid = SET_PIECE_TO_SET[base];
    if (!sid) return;
    const n = setBonus().counts[sid] || 0;
    if (n >= 2) { div.classList.add('setglow'); div.style.setProperty('--sc', SETS[sid].color); }
  } catch (e) {}
}
function renderInvUI() {
  /* 위치 저장 에코 스냅샷마다 호출되므로 실제 내용이 바뀐 경우에만 DOM 재구축 */
  hideTip();
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
    if (itemId) markSetGlow(div, itemId);
    if (itemId) {
      count++;
      const it = getItem(itemId);
      const [, scnt] = splitStack(itemId);
      div.dataset.r = it.rarity || 'common';
      const th = itemThumb(itemId);
      div.innerHTML = (th ? `<img class="ic" src="${th}" alt="">` : `<span class="ic">${itemIcon(itemId)}</span>`) + (scnt > 1 ? `<span class="scnt">${scnt}</span>` : '');
      div.dataset.raw = itemId;
      { const sl = it._base ? setLineFor(it._base) : '';
        div.title = `${it.name} [${RARITY_KR[it.rarity] || '일반'}]\n${itemStat(it) || '소모품'}${sl ? '\n' + sl : ''}\n좌클릭: 장착/사용 · 우클릭: 강화/판매`; }
      let lastTap = 0;
      div.onclick = () => {
        if (it.scroll) { toast('📜 주문서를 장비 위로 끌어다 놓으세요'); return; }
        if (it.book) { const d = skillDef(it.book); toast(`${skillIconHtml(it.book, d)} <b>${esc(d ? d.name : it.book)}</b> 스킬서 — <b>더블 클릭</b>하면 스킬이 활성화됩니다`); return; }
        slotClick(itemId);
      };
      if (it.book) div.ondblclick = e => { e.preventDefault(); useSkillBook(itemId); };
      div.oncontextmenu = e => { e.preventDefault(); showEnhMenu(e.clientX, e.clientY, itemId); };
      let lpT = null;
      div.addEventListener('touchstart', e => {
        const t = e.changedTouches[0];
        clearTimeout(lpT);
        lpT = setTimeout(() => { lpT = null; showEnhMenu(t.clientX, t.clientY, itemId); }, 450);
        if (it.book) { const nowT = Date.now(); if (nowT - lastTap < 350) { clearTimeout(lpT); lpT = null; useSkillBook(itemId); } lastTap = nowT; } /* 터치 더블탭 */
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
  /* 세트 현황판 (장비창 상단, 최초 1회 생성) */
  let setRow = $('setRow');
  if (!setRow) {
    setRow = document.createElement('div');
    setRow.id = 'setRow';
    setRow.style.cssText = 'margin:0 2px 8px;padding:7px 10px;background:rgba(255,215,0,.05);border:1px solid rgba(255,215,0,.22);border-radius:6px;font-size:11.5px;line-height:1.7;color:#cdb;display:none;';
    eg.parentNode.insertBefore(setRow, eg);
  }
  const sb2 = setBonus();
  const setHtml = Object.entries(sb2.counts).map(([sid, n]) => {
    const s = SETS[sid];
    const total = s.pieces.length;
    const lines = Object.keys(s.bonus).map(Number).sort((a, b) => a - b).map(t =>
      `<span class="${n >= t ? 'on' : 'off'}">${n >= t ? '✔' : '○'} ${t}셋 ${esc(bonusText(s.bonus[t]))}</span>`).join('');
    const worn = s.pieces.flat().filter(pid => Object.values(me.equipped || {}).some(eid => (getItem(eid)._base || eid) === pid)).map(pid => esc(getItem(pid).name.replace(/^\S+\s/, ''))).join(' · ');
    return `<div class="setline"><div class="seteff">${lines}</div><div class="setcnt"><b style="color:${s.color}">◈ ${esc(s.name)}</b> <span style="color:#ffd700">${n}/${total}</span><div class="setworn">${worn}</div></div></div>`;
  }).join('');
  if (setHtml) { setRow.innerHTML = setHtml; setRow.style.display = 'block'; }
  else setRow.style.display = 'none';
  /* 세트 티어 신규 발동 토스트 */
  for (const [sid, n] of Object.entries(sb2.counts)) {
    const prev = setPrevCounts[sid] || 0;
    if (n > prev) {
      for (const [tier, bo] of Object.entries(SETS[sid].bonus)) {
        if (prev < +tier && n >= +tier) {
          toast(`◈ <b style="color:${SETS[sid].color}">${esc(SETS[sid].name)}</b> ${tier}셋 효과 발동! <b>${esc(bonusText(bo))}</b>`, 'sysq');
          sfx('levelup');
        }
      }
    }
  }
  setPrevCounts = { ...sb2.counts };
  for (const [slot, label] of SLOTS) {
    const div = document.createElement('div');
    div.className = 'eslot';
    const itemId = (me.equipped || {})[slot];
    if (itemId) {
      const it = getItem(itemId);
      div.dataset.r = it.rarity || 'common';
      const th2 = itemThumb(itemId);
      div.innerHTML = `<span class="slbl">${label}</span>` + (th2 ? `<img class="eic" src="${th2}" alt="">` : `<span style="color:${it.color}">${SLOT_ICONS[slot]}</span>`) + `<span class="enm" style="color:${it.color}">${esc(it.name)}</span>`;
      div.dataset.raw = itemId;
      markSetGlow(div, itemId); /* 장착 슬롯 세트 네온 */
      const sl = it._base ? setLineFor(it._base) : '';
      div.title = `${it.name} [${RARITY_KR[it.rarity] || '일반'}]\n${itemStat(it)}${sl ? '\n' + sl : ''}\n클릭: 해제 · 우클릭: 강화`;
      div.onclick = () => unequip(slot);
      div.oncontextmenu = e => { e.preventDefault(); showEnhMenu(e.clientX, e.clientY, itemId); };
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
    if (s.horde) { if (s.alive) hordeSimTick(s, now, dt); continue; } /* 쇄도 몬스터: 리스폰·홈 복귀 없이 항상 추격 */
    if (!s.alive) {
      if (!s.respawnAt && s.deadT) s.respawnAt = s.deadT + (sdef(s).respawn || 15000); /* 로컬 처치 후 서버 확정 전이라도 리스폰 예약 */
      if (s.respawnAt > 0 && now > s.respawnAt) {
        s.respawnAt = now + 5000;
        runTx(db, async tx => {
          const ref = doc(db, 'monsters', s.id);
          const g = await tx.get(ref);
          if (!g.exists() || g.data().alive) return;
          const isUniq = Math.random() < .1;
          const d2 = sdef(s);
          const mh = isUniq ? Math.round(s.def.hp * 3.5) : s.def.hp; /* sdef()의 유니크 HP 배율(3.5)과 일치 — 이전 6배는 클램프로 버려지던 사문(死文) 값 */
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
        if (!s.aggroF && tgt.mine) s.alertT = now;   /* 첫 조준 느낌표 */
        s.cur = ((s.cur ?? 0) + (s.def.speed - (s.cur ?? 0)) * Math.min(1, dt * .008));
        const sp = s.cur * dt / 1000;
        s.dirA = angLerp(s.dirA, Math.atan2(tgt.y - s.y, tgt.x - s.x), dt * .012);
        s.movingF = true;
        s.aggroF = true;
        s.x = clampN(s.x + Math.cos(s.dirA) * sp, 40, WORLD.w - 40);
        s.y = clampN(s.y + Math.sin(s.dirA) * sp, 40, WORLD.h - 40);
      } else if (now >= s.atkCdUntil) {
        s.atkCdUntil = now + (s.type === 'boss' ? 1800 : 1300);
        s.atkAnimT = now; /* 애니메이션 시트: 공격 행 재생 */
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
        s.cur = ((s.cur ?? 0) + (s.def.speed * .8 - (s.cur ?? 0)) * Math.min(1, dt * .008));
        const sp = s.cur * dt / 1000;
        s.x = clampN(s.x + Math.cos(s.dirA) * sp, 40, WORLD.w - 40);
        s.y = clampN(s.y + Math.sin(s.dirA) * sp, 40, WORLD.h - 40);
      } else if (now < (s.restUntil || 0)) {
        s.movingF = false; /* 가끔 멈춰 서 있기 */
        s.cur = ((s.cur ?? 0) - (s.cur ?? 0) * Math.min(1, dt * .01));
      } else {
        if (now >= s.nextWander) {
          s.nextWander = now + rand(1400, 3200);
          if (Math.random() < .35) s.restUntil = now + rand(800, 2200);
          else s.wa = s.dirA + rand(-1.7, 1.7);
        }
        s.cur = ((s.cur ?? 0) + (s.def.speed * .45 - (s.cur ?? 0)) * Math.min(1, dt * .008));
        const sp = s.cur * dt / 1000;
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
  if (Math.random() < evadeChance()) { /* 회피 */
    float(me.x, me.y - 30, '회피!', '#7fc7ff');
    return;
  }
  const takenMul = setBonus().b.takenMul || 0;
  const dmg = Math.max(1, Math.round((Math.round(sdef(s).atk * rand(.85, 1.15)) - totalDef()) * (1 - Math.min(.6, takenMul)) * (1 - Math.min(.7, hb('dr'))))); /* 세트·각인: 받는 피해 감소 */
  hurtUntil = now + 300;
  heroHurtT = now; /* 피격 플린치 모션 트리거 */
  me.lastHurtAt = now;
  doShake(4);
  sfx('hurt');
  float(me.x, me.y - 30, String(dmg), '#ff6b6b');
  const nhp = (me.hp || 0) - dmg;
  if (nhp <= 0 && hordeOn()) { hordeEnd('death'); return; } /* 쇄도에서 쓰러지면 사망 패널티 없이 런만 종료 */
  if (nhp <= 0 && !me.dead) {
    me.dead = true; me.hp = 0; me.deadUntil = now + 1800000;
    updX(meRef, { dead: true, deadUntil: me.deadUntil, hp: 0, 'q.deaths': inc(1) }).catch(() => {});
    sfx('die');
    sysMsg(`${myName}님이 ${d2(s).name}에게 쓰러졌습니다...`);
  } else {
    me.hp = nhp;
    hpDirty = true;
    updX(meRef, { hp: nhp }).catch(() => {});
  }
}


/* ================= 픽셀 아트 스프라이트 ================= */
const SPRITE_DEFS = {
  warrior: {
    pal: { O: '#1a1d24', H: '#a8b2bd', h: '#5d656e', S: '#f2c79a', s: '#d9a878', E: '#1a1d24', A: '#c0392b', D: '#8e2a20', G: '#d9b23c', B: '#6b4a2f', L: '#3a3f4a', l: '#262b33', W: '#ffffff' },
    rows: [
      '...OOOOOOOOOOOOOO...',
      '...OHHHHHHHHHHHHO...',
      '...OHHHHHHHHHHHHO...',
      '...OhhhhhhhhhhhhO...',
      '...OhhhhhhhhhhhhO...',
      '....OHHHHHHHHHHO....',
      '....OSESSSSSESSO....',
      '....OSWSSSSSESSO....',
      '....OSSSssssSSSO....',
      '....OOSSSSSSSSOO....',
      '...OOAAAAAAAAAAOO...',
      '..OOOAAAAAAAAAAOOO..',
      '..OOAAAAAAAAAAAAOO..',
      '..OAAAAAAAAAAAAAAO..',
      '..OOSSAAAAAAAASSOO..',
      '..OAAAAAAAAAAAAAAO..',
      '..OAAAAAAAAAAAAAAO..',
      '...OAAAAAAAAAAAAO...',
      '...OOBBGGGGGGBBOO...',
      '...OOOLLLLLLLLOOO...',
      '...OOLLLLLLLLLLOO...',
      '...OOLLLLLLLLLLOO...',
      '...OOllllllllllOO...',
      '...OOllllllllllOO...',
      '..OOOllll..llllOOO..',
      '..OOOOOOO..OOOOOOO..',
    ],
  },
  archer: {
    pal: { O: '#1a1d24', C: '#2e7d52', c: '#1e5c3a', F: '#e74c3c', S: '#f2c79a', s: '#d9a878', E: '#1a1d24', A: '#27ae60', D: '#1e8449', G: '#d9b23c', B: '#6b4a2f', L: '#4a6b3a', l: '#2c3e2a', W: '#ffffff' },
    rows: [
      '...OOOOOOOOOOOOOO...',
      '...OCCCCCCCCCCCCO...',
      '...OCCCCCCCCCCCCO...',
      '...OccccccccccccO...',
      '...OCCCCFCCFCCCCO...',
      '....OCCCCCCCCCCO....',
      '....OSESSSSSESSO....',
      '....OSWSSSSSESSO....',
      '....OSSSssssSSSO....',
      '....OOSSSSSSSSOO....',
      '...OOAAAAAAAAAAOO...',
      '..OOOAAAAAAAAAAOOO..',
      '..OOAAAAAAAAAAAAOO..',
      '..OAAAAAAAAAAAAAAO..',
      '..OOSSAAAAAAAASSOO..',
      '..OAAAAAAAAAAAAAAO..',
      '..OAAAAAAAAAAAAAAO..',
      '...OAAAAAAAAAAAAO...',
      '...OOBBGGGGGGBBOO...',
      '...OOOLLLLLLLLOOO...',
      '...OOLLLLLLLLLLOO...',
      '...OOLLLLLLLLLLOO...',
      '...OOllllllllllOO...',
      '...OOllllllllllOO...',
      '..OOOllll..llllOOO..',
      '..OOOOOOO..OOOOOOO..',
    ],
  },
  rogue: {
    pal: { O: '#1a1d24', K: '#34495e', k: '#22303f', S: '#e8bd93', s: '#c49a6c', E: '#1a1d24', A: '#5d6d7e', D: '#43505c', G: '#d9b23c', B: '#2c2620', L: '#2c3e50', l: '#1a2530', W: '#ffffff' },
    rows: [
      '...OOOOOOOOOOOOOO...',
      '...OKKKKKKKKKKKKO...',
      '...OKKKKKKKKKKKKO...',
      '...OKkkkkkkkkkkKO...',
      '...OKKKKKKKKKKKKO...',
      '.OKKSSSSSSSSSSSSKKO.',
      '....OSESSSSSESSO....',
      '....OSWSSSSSESSO....',
      '....OSSSssssSSSO....',
      '....OOSSSSSSSSOO....',
      '...OOAAAAAAAAAAOO...',
      '..OOOAAAAAAAAAAOOO..',
      '..OOAAAAAAAAAAAAOO..',
      '..OAAAAAAAAAAAAAAO..',
      '..OOSSAAAAAAAASSOO..',
      '..OAAAAAAAAAAAAAAO..',
      '..OAAAAAAAAAAAAAAO..',
      '...OAAAAAAAAAAAAO...',
      '...OOBBGGGGGGBBOO...',
      '...OOOLLLLLLLLOOO...',
      '...OOLLLLLLLLLLOO...',
      '...OOLLLLLLLLLLOO...',
      '...OOllllllllllOO...',
      '...OOllllllllllOO...',
      '..OOOllll..llllOOO..',
      '..OOOOOOO..OOOOOOO..',
    ],
  },
  mage: {
    pal: { O: '#1a1d24', P: '#6c3483', p: '#4a235a', G: '#ffd700', S: '#f2c79a', s: '#d9a878', E: '#1a1d24', A: '#6c3483', D: '#4a235a', W: '#ffffff' },
    rows: [
      '.........OO.........',
      '....OPPPPPPPPPPO....',
      '...OPPPPPPPPPPPPO...',
      '..OPPPPPPPPPPPPPPO..',
      '.OGPPPPPPPPPPPPPPGO.',
      '.OpppppppSSpppppppO.',
      '....OSESSSSSESSO....',
      '....OSWSSSSSESSO....',
      '....OSSSssssSSSO....',
      '....OOSSSSSSSSOO....',
      '...OOAAAAAAAAAAOO...',
      '..OOOAAAAAAAAAAOOO..',
      '..OOAAAAAAAAAAAAOO..',
      '..OAAAAAAAAAAAAAAO..',
      '..OOSSAAAAAAAASSOO..',
      '..OAAAAAAAAAAAAAAO..',
      '..OAAAAAAAAAAAAAAO..',
      '...OAAAAAAAAAAAAO...',
      '...OOBBGGGGGGBBOO...',
      '...OOOLLLLLLLLOOO...',
      '...OOLLLLLLLLLLOO...',
      '...OOLLLLLLLLLLOO...',
      '...OOllllllllllOO...',
      '...OOllllllllllOO...',
      '..OOOllll..llllOOO..',
      '..OOOOOOO..OOOOOOO..',
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
  /* 검 */
  w_sword_wood: ['...M...', '..MMM..', '..MMM..', '..MMM..', '..MMM..', '..MMM..', '.BBBBB.', '...B...'],
  w_sword_iron: ['...M...', '..MMM..', '..MLM..', '..MLM..', '..MLM..', '..MLM..', '..MLM..', '.GGGGG.', '...G...', '...B...'],
  w_sword_epic: ['...M...', '..MLM..', '..MLM..', '..MLM..', '..MLM..', '..MLM..', '..MLM..', '..MLM..', '.GGGGG.', '...G...', '...G...'],
  w_sword_chief: ['..MMMM..', '..MLMM..', '..MLMM..', '..MLMM..', '..MLMM..', '..MLMM..', 'GGGGGGGG', '...GG...', '...WW...'],
  w_sword_knight: ['...MM...', '..MMMM..', '..MLMM..', '..MLMM..', '..MLMM..', '..MLMM..', '..MLMM..', 'GGGGGGGG', '...WW...', '...BB...'],
  /* 활 */
  w_bow_wood: ['..MM...', '...MMW.', '....MW.', '....MW.', '...MMW.', '..MM...'],
  w_bow_iron: ['.GMMM..', '..MMMW.', '...MMW.', '...MMW.', '..MMMW.', '.GMMM..'],
  w_bow_epic: ['.GGMM..', '..MMLW.', '...MLW.', '...MLW.', '..MMLW.', '.GGMM..'],
  w_bow_chief: ['.GGMMM...', '..MMMLW..', '...MMMW..', '...MMMW..', '..MMMLW..', '.GGMMM...'],
  w_bow_knight: ['.GGMMM...', '..MMMLW..', '...MMMW..', '...MMMW..', '..MMMLW..', '.GGMMM...'],
  /* 단검 */
  w_dagger_wood: ['..M..', '..M..', '.BBB.', '..B..'],
  w_dagger_iron: ['..M..', '..M..', '..M..', '.GGG.', '..B..'],
  w_dagger_epic: ['..M..', '..M..', '..M..', '..M..', '.GGG.', '..B..'],
  w_dagger_chief: ['..MM..', '..MM..', '..MM..', '.GGGG.', '..WW..', '..BB..'],
  w_dagger_knight: ['..MM..', '..MM..', '..MM..', '.GGGG.', '..WW..', '..BB..'],
  /* 지팡이 */
  w_staff_wood: ['..MM..', '..MM..', '...M...', '...M...', '...M...', '...M...', '...M...', '...M...', '...M...'],
  w_staff_iron: ['.MMMM.', 'MMWMMM', '.MMMM.', '...M...', '...M...', '...M...', '...M...', '...M...', '...M...', '...B...'],
  w_staff_epic: ['.MMMM.', 'MMWMMM', '.MMMM.', '..GGG..', '...M...', '...ML..', '...M...', '...ML..', '...M...', '...B...'],
  w_staff_chief: ['.WWWW.', 'WWMWWW', '.WWWW.', '...M...', '...M...', '...M...', '...M...', '...B...'],
  w_staff_knight: ['.MMMM.', 'MMWMMM', '.MMMM.', 'GGGGGGG', '...M...', '...M...', '...M...', '...M...', '...B...'],
  /* 방어구 */
  armor_leather: ['MM.....MM', 'MMM...MMM', 'MMMMMMMMM', 'MLMMMMMDM', 'MLMMMMMDM', '.MMMMMMM.', '.MGMMMMGM.', '.DMMMMMD.', '..DDDDD..'],
  armor_plate: ['.MM...MM.', 'MMMMMMMMM', 'MLMMGMMDM', 'MLMMMMMDM', 'MLMMMMMDM', '.MMMMMMM.', '.MMMGMMM.', '.DMMMMMD.', '..DDDDD..'],
  helmet_horn: ['..MMMM..', '.MMMMMM.', 'MMMMMMMM', '.MLMMDM.', '.MMMMMM.'],
  helmet_crown: ['.G.G.G.', 'GGGGGGG', '.MMMMM.', '.MWWWM.'],
  pants_leather: ['.MMMMM.', '.MMMMM.', '.MLMDM.', '.MMMMM.', '.MMDMM.', '.MM.MM.', '.MM.MM.', '.DD.DD.'],
  pants_plate: ['.MMMMM.', 'MLMMMMDM', '.MLMDM.', 'MLMMMMDM', '.MMMMM.', '.MM.MM.', '.MM.MM.', '.DD.DD.'],
  gloves_leather: ['..MMM..', '.MMMMM.', '.MLMMM.', '.MMMMM.', 'DDDDDDD', '.MMMMM.', '..DDD..'],
  gloves_steel: ['..MMM..', '.MGGGM.', '.MMMMM.', '.MDMDM.', '.MMMMM.', '.MMMMM.', '..DDD..'],
  boots_leather: ['.MM..MM.', '.MMGGMM.', '.MMGGMM.', '.ML..MD.', '.MMMMMM.', '.DDDDDD.'],
  boots_wind: ['WMM..MMW', '.MMGGMM.', '.MMGGMM.', '.ML..MD.', '.MMMMMM.', '.DDDDDD.'],
  bracelet_jade: ['..MMMM..', '.MLLMDM.', '.MLGMDM.', '.MLGMDM.', '.MLLMDM.', '..MMMM..'],
  necklace_ruby: ['G.....G', '.G...G.', '..GGGG.', '...MM...', '..MMMM..', '..MWWMM.', '...MMM..', '....D....'],
  ring_gem: ['..LL..', '.LLLL.', '..MM..', '.MWWMM.', 'M....M', '.MMMM.'],
  potion_hi: ['..GGG..', '...G...', '..MMM..', '.MLMMD.', '.MGMMGM.', '.MMMMM.', '.MMMMM.', '.MMMMM.', '..DDD..'],
  potion_mp: ['...G...', '..MMM..', '.MMMMM.', 'MLMWMDM', 'MMMMMMM', '.MMMMM.', '..DDD..'],
  potion_mm: ['..GGG..', '...G...', '..MMM..', '.MMMMM.', 'MLMWMDM', 'MMMMMMM', '.MMMMM.', '..DDD..'],
  scroll_adv: ['..WWW..', '.WWWWW.', '.WBBBB.', '.WWWWW.', '.WBBBW.', '.WWWWW.', '..WWW..'],
  scroll_top: ['..WWW..', '.WWWWW.', '.WGGGW.', '.WWWWW.', '.WGGGW.', '.WWWWW.', '..WWW..'],
};
function itemShapeKey(id, it) {
  const base = it._base || id;
  if (it.scroll) return 'scroll_' + (it.grade || 'normal');
  if (it.heal) return it.heal > 100 ? 'potion_hi' : 'potion';
  if (it.mana) return it.mana > 60 ? 'potion_mm' : 'potion_mp';
  if (it.slot === 'weapon') {
    const cls = it.cls || '';
    const kind = cls === 'archer' ? 'bow' : cls === 'rogue' ? 'dagger' : cls === 'mage' ? 'staff' : 'sword';
    const tier = /flame|storm|shadow/.test(base) ? 'epic' : /iron|crystal/.test(base) ? 'iron' : /chief/.test(base) ? 'chief' : /knight/.test(base) ? 'knight' : 'wood';
    return `w_${kind}_${tier}`;
  }
  if (it.slot === 'helmet' && /crown|slime/i.test(base)) return 'helmet_crown';
  if (it.slot === 'helmet' && /leather/.test(base)) return 'helmet_horn';
  if (it.slot === 'armor' && /leather/.test(base)) return 'armor_leather';
  if (it.slot === 'armor' && /plate/.test(base)) return 'armor_plate';
  if (it.slot === 'pants' && /leather/.test(base)) return 'pants_leather';
  if (it.slot === 'pants' && /plate/.test(base)) return 'pants_plate';
  if (it.slot === 'gloves' && /leather/.test(base)) return 'gloves_leather';
  if (it.slot === 'gloves' && /steel/.test(base)) return 'gloves_steel';
  if (it.slot === 'boots' && /leather/.test(base)) return 'boots_leather';
  if (it.slot === 'boots' && /wind/.test(base)) return 'boots_wind';
  if (it.slot === 'bracelet' && /jade/.test(base)) return 'bracelet_jade';
  if (it.slot === 'necklace' && /ruby/.test(base)) return 'necklace_ruby';
  if (it.slot === 'ring' && /shadow|lich/.test(base)) return 'ring_gem';
  return it.slot;
}
function itemSprite(id) {
  const it = getItem(id);
  const shape = itemShapeKey(id, it);
  const col = it.color || '#ccc';
  const key = 'itspr_' + shape + '_' + col;
  if (!SPRITE_DEFS[key]) SPRITE_DEFS[key] = { pal: { M: col, D: shade(col, .55), L: shade(col, 1.5), G: '#d9b23c', W: '#e8e4d8', B: '#8a6b45' }, rows: ITEM_SHAPES[shape] || ITEM_SHAPES[it.slot] || ITEM_SHAPES.bracelet };
  return key;
}

const spriteCache = {};
/* 셀당 서브픽셀 분할 수 — 실루엣 모따기·베벨·외곽선·내부 음영을 원본 셀보다 잘게 그려 디테일을 올린다.
   sp.w/sp.h는 예전처럼 '셀' 단위로 유지하므로 호출부(스케일·3D 비율)는 그대로 동작한다. */
const SPR_SUB = 8;
function buildSprite(name) {
  if (spriteCache[name]) return spriteCache[name];
  const def = SPRITE_DEFS[name];
  const h = def.rows.length;
  const w = Math.max(...def.rows.map(r => r.length));
  const S = SPR_SUB, cw = w + 2, chh = h + 2; /* 외곽선 여백 1셀 */
  const cv2 = document.createElement('canvas');
  cv2.width = cw * S; cv2.height = chh * S;
  const c = cv2.getContext('2d');
  c.imageSmoothingEnabled = false;
  const chAt = (y, x) => { const r = def.rows[y]; if (!r) return null; const k = r[x]; return (k && k !== '.' && k !== ' ' && def.pal[k]) ? k : null; };
  const any = (y, x) => chAt(y, x) !== null;          /* 외곽선 셀('O') 포함 */
  const body = (y, x) => { const k = chAt(y, x); return !!k && k !== 'O'; };
  const OL = def.outline || '#14161c';
  const OW = Math.max(1, Math.round(S * .375));       /* 외곽선 두께: 3/8 셀 */

  /* 1) 셀 본체 + 내부 음영(서브픽셀 그라데이션) + 모서리 모따기 */
  for (let y = 0; y < h; y++) {
    const row = def.rows[y] || '';
    for (let x = 0; x < row.length; x++) {
      const k = chAt(y, x);
      if (!k) continue;
      const px = (x + 1) * S, py = (y + 1) * S;
      c.fillStyle = def.pal[k];
      c.fillRect(px, py, S, S);
      if (k === 'O') continue;                        /* 원본 외곽선 셀은 음영 제외 */
      /* 내부 세로 그라데이션 — 셀 안에서도 위가 밝고 아래가 어둡게 */
      for (let i = 0; i < S; i++) {
        const t = i / (S - 1) - .5;                   /* -0.5 ~ +0.5 */
        c.fillStyle = t < 0 ? `rgba(255,255,255,${(-t * .13).toFixed(3)})` : `rgba(0,0,0,${(t * .15).toFixed(3)})`;
        c.fillRect(px, py + i, S, 1);
      }
      /* 노출된 면의 베벨: 위=하이라이트, 아래=셰이드, 좌우=약한 명암 (서브픽셀 두께) */
      const BV = Math.max(1, Math.round(S / 8));
      if (!any(y - 1, x)) { c.fillStyle = 'rgba(255,255,255,.34)'; c.fillRect(px, py, S, BV); }
      if (!any(y + 1, x)) { c.fillStyle = 'rgba(0,0,0,.30)'; c.fillRect(px, py + S - BV, S, BV); }
      if (!any(y, x - 1)) { c.fillStyle = 'rgba(255,255,255,.14)'; c.fillRect(px, py, BV, S); }
      if (!any(y, x + 1)) { c.fillStyle = 'rgba(0,0,0,.16)'; c.fillRect(px + S - BV, py, BV, S); }
      /* 모서리 모따기: 노출된 코너를 계단식 삼각형으로 깎아 45° 실루엣을 만든다 */
      const K = Math.max(1, Math.round(S / 4));
      if (!any(y - 1, x) && !any(y, x - 1)) for (let i = 0; i < K; i++) c.clearRect(px, py + i, K - i, 1);
      if (!any(y - 1, x) && !any(y, x + 1)) for (let i = 0; i < K; i++) c.clearRect(px + S - (K - i), py + i, K - i, 1);
      if (!any(y + 1, x) && !any(y, x - 1)) for (let i = 0; i < K; i++) c.clearRect(px, py + S - 1 - i, K - i, 1);
      if (!any(y + 1, x) && !any(y, x + 1)) for (let i = 0; i < K; i++) c.clearRect(px + S - (K - i), py + S - 1 - i, K - i, 1);
      /* 안쪽 오목 모서리: 대각만 비었으면 그 코너를 살짝 깎아 각을 살린다 */
      if (any(y - 1, x) && any(y, x - 1) && !any(y - 1, x - 1)) { c.fillStyle = 'rgba(0,0,0,.12)'; c.fillRect(px, py, Math.max(1, Math.round(S / 4)), Math.max(1, Math.round(S / 4))); }
    }
  }

  /* 2) 외곽선: 빈 셀에서 실체와 맞닿은 쪽만 반 셀 두께로 — 예전 1셀 통짜보다 얇아 원본 디테일이 덜 먹힌다 */
  c.globalAlpha = .92;
  c.fillStyle = OL;
  for (let y = -1; y <= h; y++) {
    for (let x = -1; x <= w; x++) {
      if (any(y, x)) continue;
      const px = (x + 1) * S, py = (y + 1) * S;
      const up = body(y - 1, x), dn = body(y + 1, x), lf = body(y, x - 1), rt = body(y, x + 1);
      if (up) c.fillRect(px, py, S, OW);
      if (dn) c.fillRect(px, py + S - OW, S, OW);
      if (lf) c.fillRect(px, py, OW, S);
      if (rt) c.fillRect(px + S - OW, py, OW, S);
      if (!up && !lf && body(y - 1, x - 1)) c.fillRect(px, py, OW, OW);
      if (!up && !rt && body(y - 1, x + 1)) c.fillRect(px + S - OW, py, OW, OW);
      if (!dn && !lf && body(y + 1, x - 1)) c.fillRect(px, py + S - OW, OW, OW);
      if (!dn && !rt && body(y + 1, x + 1)) c.fillRect(px + S - OW, py + S - OW, OW, OW);
    }
  }
  c.globalAlpha = 1;

  const white = document.createElement('canvas');
  white.width = cv2.width; white.height = cv2.height;
  const wc = white.getContext('2d');
  wc.drawImage(cv2, 0, 0);
  wc.globalCompositeOperation = 'source-in';
  wc.fillStyle = '#fff';
  wc.fillRect(0, 0, white.width, white.height);
  spriteCache[name] = { cv: cv2, white, w: cw, h: chh, sub: S };
  return spriteCache[name];
}
function drawSprite(name, x, y, scale = 4, opts = {}) {
  const sp = buildSprite(name);
  const bob = opts.bob || 0;
  ctx.save();
  ctx.translate(x, y + bob);
  if (opts.flip) ctx.scale(-1, 1);
  /* 피격 스쿼시: 맞은 순간 찌그러졌다 복원 (flash 강도에 비례, 전 몬스터 공통) */
  const hsq = (opts.flash || 0) * .22;
  ctx.scale((opts.squashX || 1) + hsq, (opts.squashY || 1) - hsq * .9);
  /* 레티나 백버퍼에선 서브픽셀 1개 ≈ 1 기기픽셀이라 최근접 샘플링이 가장 선명. 저DPR(1x)만 보간 */
  ctx.imageSmoothingEnabled = (dpr || 1) < 1.5;
  ctx.imageSmoothingQuality = 'high';
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
/* 백버퍼를 기기 픽셀비만큼 키워 렌더 — cvW/cvH는 CSS 픽셀 기준(기존 코드 의미 유지) */
let dpr = 1, cvW = 0, cvH = 0, resizeT = 0;
let WSS = 2; /* 지형 텍스처 배율 — 아래 calcWSS()가 해상도에 맞춰 정하고, resize마다 갱신된다(함수 선언은 호이스팅되므로 첫 resize에서도 안전) */
function resize() {
  const mob = innerWidth <= 640;
  let d = Math.min(devicePixelRatio || 1, mob ? 2 : 3);
  /* 백버퍼 픽셀 예산: 모바일 2.4M / 데스크톱 16M — 초과하면 배율을 낮춰 인앱 브라우저 메모리 멈춤 방지.
     9M이던 시절엔 2K 이상 창(레티나)에서 배율이 2→1.75/1.5로 깎여 화면 전체가 흐릿하게 확대됐다. UI는 CSS px 기준이라 크기 변화 없음 */
  const budget = mob ? 2.4e6 : 16e6;
  while (d > 1 && innerWidth * innerHeight * d * d > budget) d = Math.max(1, d - .25);
  const W = Math.round(innerWidth * d), H = Math.round(innerHeight * d);
  if (W === cv.width && H === cv.height && d === dpr) { cvW = innerWidth; cvH = innerHeight; return; } /* 치수 동일 → 재할당 생략 */
  dpr = d; cvW = innerWidth; cvH = innerHeight;
  { const nw = calcWSS(); if (nw !== WSS) { WSS = nw; try { bioTexCache.clear(); worldColliders[myMap()] = null; } catch (e) {} } } /* 해상도가 바뀌면 지형 텍스처 배율도 따라간다(최초 resize는 캐시가 아직 없어 catch로 넘어간다) */
  cv.width = W; cv.height = H;
  cv.style.width = cvW + 'px'; cv.style.height = cvH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
/* 핀치/회전 중 resize가 연속으로 터지면 매번 백버퍼를 재할당해 멈춤 → 120ms 디바운스 */
addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(resize, 120); });
resize();
WSS = calcWSS();

/* ================= 월드 텍스처 (프리렌더) ================= */
/* 지형 텍스처 슈퍼샘플링 배율 — 확대/레티나에서 나무·바위·길이 뭉개지지 않게 원본을 크게 굽는다 */
/* 지형 텍스처 배율: '지금 플레이 중인 해상도'에 맞춘다.
   월드(1600px)를 화면 가로에 꽉 채워 보여주므로 필요한 텍셀 = 화면 가로 실제 픽셀(innerWidth × 배율).
   창을 키우거나 줄이면 resize에서 다시 계산해 지형을 새로 굽는다(예전엔 시작 시점 값에 고정돼, 폰 크기로 열었다 최대화하면 계속 흐릿했다). */
function calcWSS() {
  if (innerWidth <= 640) return 1.0; /* 모바일: 월드를 축소해 보여 1.0으로 충분(메모리 우선) */
  const need = (innerWidth * Math.min(devicePixelRatio || 1, 3)) / WORLD.w;
  return clampN(Math.ceil(need * 4) / 4, 1.5, 2.75); /* 0.25 단위 올림 — 텍셀이 화면 픽셀보다 모자라지 않게(내림하면 살짝 흐려진다) */
}
const worldTex = document.createElement('canvas');
worldTex.width = Math.round(WORLD.w * WSS); worldTex.height = Math.round(WORLD.h * WSS);

function buildWorld() {
  const c = worldTex.getContext('2d');
  c.setTransform(WSS, 0, 0, WSS, 0, 0); /* 이하 그리기는 전부 월드 좌표 그대로 */
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
/* 바이옴별 지형 색보정 — 이전엔 100구역 전부 초원 텍스처 하나를 써서 '사막·설원·화산'이 이름뿐이었다.
   filter(색조·채도·밝기) + 색 오버레이로 같은 지형을 구역 분위기에 맞게 물들인다(Safari는 filter 미지원 → 오버레이만) */
const BIOME_GRADE = [
  null,                                                                                   /* 초원: 원본 */
  { f: 'hue-rotate(-8deg) saturate(1.1) brightness(.72)', o: 'rgba(15,45,30,.30)' },      /* 어두운 숲 */
  { f: 'hue-rotate(-70deg) saturate(.75) brightness(1.18)', o: 'rgba(214,176,96,.32)' },   /* 사막 */
  { f: 'saturate(.18) brightness(1.55)', o: 'rgba(222,236,255,.40)' },                     /* 설원 */
  { f: 'hue-rotate(22deg) saturate(.85) brightness(.72)', o: 'rgba(40,72,44,.34)' },       /* 못가 */
  { f: 'hue-rotate(-118deg) saturate(1.05) brightness(.62)', o: 'rgba(130,28,12,.36)' },   /* 화산 */
  { f: 'saturate(.3) brightness(.42)', o: 'rgba(28,34,60,.50)' },                          /* 동굴 */
  { f: 'saturate(.55) brightness(.78)', o: 'rgba(96,94,84,.30)' },                         /* 폐허 */
  { f: 'hue-rotate(150deg) saturate(1.1) brightness(.55)', o: 'rgba(64,18,96,.42)' },      /* 마계 */
  { f: 'saturate(.9) brightness(1.18)', o: 'rgba(150,196,255,.30)' },                      /* 천공 */
];
/* ===== 구역별 지형 생성 =====
   100구역 각각을 결정적 시드로 생성: 바이옴 팔레트(땅·풀·나무·바위·물) + 구역 고유 지형 요소(연못/강/폭포/절벽/용암/구름틈)
   + 장식 밀도(밀림·사막·설원…). 물·절벽·나무·바위는 worldColliders[pid]에 충돌체로 등록된다. */
const BIOME_PAL = [
  { ground: '#26492f', tints: ['#2a5034', '#224329', '#2d5538', '#1f3f26'], grass: ['rgba(46,94,58,.5)', 'rgba(64,120,74,.45)'], path: ['#8a7a52', '#6e6040'], trunk: '#4a3524', leaf: ['#173f28', '#1a4a2e', '#1f6039', '#257047', '#2e8455'], rock: ['#7a8288', '#5c646a', '#98a0a6'], flowers: ['#e8da7a', '#d98cb3', '#8ecae6', '#f4f1de'], water: ['#1d4e6b', '#2a6f95', '#7fc7e8'], style: 'meadow', trees: 30, bushes: 18, rocks: 16, grass: 2600 },
  { ground: '#17301f', tints: ['#1a3a25', '#12281a', '#1f4229', '#0f2216'], grass: ['rgba(30,70,44,.5)', 'rgba(44,90,58,.45)'], path: ['#5f5540', '#4a4330'], trunk: '#332318', leaf: ['#0f2a1a', '#123421', '#164028', '#1a4d30', '#205a38'], rock: ['#5a6066', '#40464c', '#737a80'], flowers: ['#7a6fa8', '#4f6d8a', '#3f5f4a', '#8a8fa8'], water: ['#0e2f3a', '#164a58', '#4f8fa0'], style: 'jungle', trees: 62, bushes: 40, rocks: 14, grass: 3400 },
  { ground: '#c9ac6e', tints: ['#d4b878', '#bfa062', '#dcc184', '#b3945a'], grass: ['rgba(150,120,70,.35)', 'rgba(170,140,90,.3)'], path: ['#a88d5a', '#8c7448'], trunk: '#6b5230', leaf: ['#5d7a3a', '#6b8a42', '#7a9a4c', '#86a656', '#94b262'], rock: ['#b39a70', '#8f7a56', '#cbb48c'], flowers: ['#e8b04a', '#d97a5a', '#f2d68a', '#c9a0c0'], water: ['#2a6f7a', '#3e95a3', '#a6dfe8'], style: 'desert', trees: 8, bushes: 6, rocks: 34, grass: 500, cacti: 26, dunes: 14 },
  { ground: '#dfe8ef', tints: ['#eef4f8', '#cdd9e3', '#f5f9fb', '#c2d0dc'], grass: ['rgba(200,215,225,.5)', 'rgba(170,190,205,.4)'], path: ['#b9c2c9', '#9aa5ad'], trunk: '#4a3a30', leaf: ['#2f5a45', '#3a6b52', '#eaf2f6', '#f4f8fa', '#ffffff'], rock: ['#9fb0bd', '#7c8c99', '#c5d2dc'], flowers: ['#ffffff', '#cfe6f5', '#e8eef2', '#b9d7ea'], water: ['#5a86a8', '#7fb0d0', '#d6ecf7'], style: 'snow', trees: 26, bushes: 10, rocks: 20, grass: 900, snowPiles: 40, ice: 6 },
  { ground: '#2b3b2a', tints: ['#324532', '#243424', '#3a4f36', '#1e2c1e'], grass: ['rgba(80,110,60,.5)', 'rgba(100,130,70,.45)'], path: ['#5a5a40', '#46462f'], trunk: '#3a3024', leaf: ['#2a4a2a', '#345a30', '#3e6a38', '#4a7a40', '#5a8a48'], rock: ['#6a7060', '#4e5448', '#868c7a'], flowers: ['#a0c060', '#c8d070', '#7fb07a', '#e0e090'], water: ['#243d2c', '#35583e', '#6f9a7a'], style: 'swamp', trees: 34, bushes: 30, rocks: 10, grass: 3000, reeds: 60, murk: true },
  { ground: '#3a2622', tints: ['#472c26', '#2e1c19', '#52322b', '#241614'], grass: ['rgba(80,50,40,.5)', 'rgba(110,70,50,.4)'], path: ['#5a4a3c', '#463a2e'], trunk: '#2a1a14', leaf: ['#3a2a1a', '#4a3320', '#5a3c24', '#6a4a2c', '#7a5a34'], rock: ['#5a4a44', '#3e3230', '#7a6a62'], flowers: ['#ff7f27', '#ff4d2e', '#ffb347', '#e0522a'], water: ['#7a1e0c', '#c9440f', '#ffb04a'], style: 'volcano', trees: 10, bushes: 4, rocks: 40, grass: 600, lava: true, embers: 120 },
  { ground: '#1d2130', tints: ['#242a3c', '#181c2a', '#2a3044', '#141826'], grass: ['rgba(60,70,100,.45)', 'rgba(80,90,120,.4)'], path: ['#3e4457', '#2f3444'], trunk: '#2a2e3a', leaf: ['#20263a', '#283048', '#303a56', '#3a4664', '#465274'], rock: ['#4a5062', '#343a4a', '#626a7e'], flowers: ['#6fb0ff', '#8ad0ff', '#4fd0c0', '#a0a8ff'], water: ['#0f1a2a', '#1a2e48', '#4f7aa8'], style: 'cave', trees: 0, bushes: 8, rocks: 56, grass: 400, stalagmites: 40, crystals: 24, walls: true },
  { ground: '#4a4a44', tints: ['#555550', '#3f3f3a', '#606058', '#383834'], grass: ['rgba(110,110,80,.45)', 'rgba(130,130,100,.4)'], path: ['#6a6a60', '#54544a'], trunk: '#3a3028', leaf: ['#3a4a30', '#465a38', '#556a42', '#647a4c', '#748a58'], rock: ['#8a8a82', '#6a6a64', '#a8a8a0'], flowers: ['#c9c0a0', '#a89a78', '#d8d0b8', '#8a8878'], water: ['#2a3a3a', '#3e5a5a', '#7fa0a0'], style: 'ruin', trees: 14, bushes: 12, rocks: 22, grass: 1400, pillars: 22, walls: true },
  { ground: '#24122e', tints: ['#2e1840', '#1a0c22', '#381c4c', '#140a1a'], grass: ['rgba(120,60,160,.45)', 'rgba(150,80,190,.4)'], path: ['#4a2a5a', '#3a2046'], trunk: '#2a1a34', leaf: ['#3a1a4a', '#4a2460', '#5a2e74', '#6a3a88', '#7a469c'], rock: ['#5a4a6a', '#40344e', '#7a6a8a'], flowers: ['#ff5fd0', '#c05fff', '#8a2fd4', '#ff8ae0'], water: ['#1a0a2a', '#3a1660', '#a04fff'], style: 'abyss', trees: 16, bushes: 10, rocks: 24, grass: 1200, cracks: 30, embers: 60 },
  { ground: '#a9c8e8', tints: ['#bcd6f0', '#98b8dc', '#cfe2f5', '#8aaed4'], grass: ['rgba(200,225,245,.5)', 'rgba(170,205,235,.4)'], path: ['#d8e6f2', '#bccbdb'], trunk: '#6a5a4a', leaf: ['#6aa070', '#7ab080', '#8ac090', '#9ad0a0', '#aae0b0'], rock: ['#c8d8e8', '#a8bcd0', '#e4eef8'], flowers: ['#ffffff', '#ffe9a0', '#ffd0e8', '#d0ecff'], water: ['#2a4a7a', '#3a6aa8', '#8fc0f0'], style: 'sky', trees: 18, bushes: 12, rocks: 10, grass: 900, clouds: 40, gaps: 5 },
];
function zoneRng(n) { let t = (n * 2654435761 + 12345) >>> 0; return () => { t = (t + 0x6D2B79F5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
function buildZoneWorld(n) {
  const bi = Math.min(9, Math.floor((n - 1) / 10)), P = BIOME_PAL[bi], tier = (n - 1) % 10;
  const rng = zoneRng(n), R = (a, b) => a + rng() * (b - a);
  const cv2 = document.createElement('canvas');
  cv2.width = Math.round(WORLD.w * WSS); cv2.height = Math.round(WORLD.h * WSS);
  const c = cv2.getContext('2d');
  c.setTransform(WSS, 0, 0, WSS, 0, 0);
  const cols = []; /* 충돌체 */
  const blocked = []; /* 장식 배치 금지 영역 {x,y,r} */
  const pid = pageId(n);
  const waters = zoneWaters[pid] = [];
  const spawn = n === 1 ? { x: 800, y: 600 } : { x: 170, y: 600 };
  const mobZones = [{ x: 540, y: 430 }, { x: 1060, y: 770 }, { x: 800, y: 1000 }];
  const gates = [{ x: 110, y: 600 }, { x: 1490, y: 600 }];
  for (const z of [spawn, ...mobZones]) blocked.push({ x: z.x, y: z.y, r: 150 });
  for (const g of gates) blocked.push({ x: g.x, y: g.y, r: 90 });
  const isBlocked = (x, y, pad = 0) => blocked.some(b => Math.hypot(b.x - x, b.y - y) < b.r + pad);

  /* 1) 땅 */
  c.fillStyle = P.ground; c.fillRect(0, 0, WORLD.w, WORLD.h);
  paintGround(c, P, rng, P.style); /* 노이즈 지면 + 바이옴별 미세 질감 (예전: 방사형 얼룩 90개 + 체커보드) */
  const PS = PROP_SETS[P.style] || PROP_SETS.meadow, pick = arr => arr[Math.floor(rng() * arr.length)];
  if (P.dunes) for (let i = 0; i < P.dunes; i++) { /* 사막 사구: 밝은 호 */
    const x = rng() * WORLD.w, y = rng() * WORLD.h, w = 120 + rng() * 260;
    c.strokeStyle = 'rgba(255,240,200,.22)'; c.lineWidth = 10 + rng() * 14; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x - w / 2, y); c.quadraticCurveTo(x, y - w * .18, x + w / 2, y); c.stroke();
    c.strokeStyle = 'rgba(120,90,40,.15)'; c.lineWidth = 4;
    c.beginPath(); c.moveTo(x - w / 2, y + 8); c.quadraticCurveTo(x, y - w * .18 + 8, x + w / 2, y + 8); c.stroke();
  }
  if (P.cracks) for (let i = 0; i < P.cracks; i++) { /* 마계: 균열(빛나는 틈) */
    let x = rng() * WORLD.w, y = rng() * WORLD.h;
    c.strokeStyle = 'rgba(200,80,255,.55)'; c.lineWidth = 1.6; c.shadowColor = '#c05fff'; c.shadowBlur = 8;
    c.beginPath(); c.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += R(-40, 40); y += R(-30, 30); c.lineTo(x, y); }
    c.stroke(); c.shadowBlur = 0;
  }

  /* 2) 물/용암/구름틈 — 구역 고유 요소 */
  const water = (x, y, rx, ry, rot, lava) => {
    waters.push({ x, y, rx, ry, rot, lava: !!lava });
    const [deep, mid, light] = lava ? P.water : P.water;
    c.save(); c.translate(x, y); c.rotate(rot);
    /* 물가 (모래/진흙/얼음 테두리) */
    c.fillStyle = P.style === 'snow' ? 'rgba(180,200,215,.9)' : P.style === 'volcano' ? 'rgba(30,18,14,.9)' : P.style === 'swamp' ? 'rgba(60,70,40,.9)' : 'rgba(190,170,120,.75)';
    c.beginPath(); c.ellipse(0, 0, rx + 16, ry + 14, 0, 0, 7); c.fill();
    const g = c.createRadialGradient(-rx * .2, -ry * .2, 4, 0, 0, Math.max(rx, ry));
    g.addColorStop(0, mid); g.addColorStop(.7, deep); g.addColorStop(1, deep);
    c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, 7); c.fill();
    c.strokeStyle = light; c.globalAlpha = .55; c.lineWidth = 1.6;
    for (let i = 0; i < 6; i++) { c.beginPath(); c.ellipse(R(-rx * .5, rx * .5), R(-ry * .5, ry * .5), R(6, 22), R(2, 6), R(0, 3), 0, 7); c.stroke(); } /* 물결/용암 거품 */
    if (lava) { c.globalAlpha = .35; c.shadowColor = '#ff7f27'; c.shadowBlur = 40; c.fillStyle = '#ff9a3a'; c.beginPath(); c.ellipse(0, 0, rx * .6, ry * .6, 0, 0, 7); c.fill(); c.shadowBlur = 0; }
    c.globalAlpha = 1; c.restore();
    /* 충돌체: 타원 둘레를 원으로 근사 */
    const steps = Math.max(8, Math.round((rx + ry) / 18));
    for (let i = 0; i < steps; i++) { const a = i / steps * Math.PI * 2; const px = Math.cos(a) * rx * .82, py = Math.sin(a) * ry * .82; const wx = x + px * Math.cos(rot) - py * Math.sin(rot), wy = y + px * Math.sin(rot) + py * Math.cos(rot); cols.push({ x: wx, y: wy, r: 18 }); }
    cols.push({ x, y, r: Math.min(rx, ry) * .7 });
    blocked.push({ x, y, r: Math.max(rx, ry) + 40 });
  };
  const river = (vertical) => { /* 지도를 가로지르는 강 — 스폰·관문·사냥터를 피해 흐르고, 길과 만나는 지점마다 다리 */
    const [deep, mid, light] = P.water;
    const pts = [];
    const keep = [{ x: spawn.x, y: spawn.y, r: 150 }, ...mobZones.map(z => ({ x: z.x, y: z.y, r: 150 })), ...gates.map(g => ({ x: g.x, y: g.y, r: 120 }))];
    const dodge = p => { for (const b of keep) { if (Math.hypot(p.x - b.x, p.y - b.y) < b.r + 40) { if (vertical) p.x = clampN(b.x + (p.x >= b.x ? 1 : -1) * (b.r + 40), 380, 1220); else p.y = clampN(b.y + (p.y >= b.y ? 1 : -1) * (b.r + 40), 220, 980); } } return p; };
    if (vertical) { let x = R(560, 1040); for (let y = -20; y <= WORLD.h + 20; y += 60) { x += R(-40, 40); const p = dodge({ x: clampN(x, 380, 1220), y }); x = p.x; pts.push(p); } }
    else { let y = R(300, 900); for (let x = -20; x <= WORLD.w + 20; x += 60) { y += R(-30, 30); const p = dodge({ x, y: clampN(y, 220, 980) }); y = p.y; pts.push(p); } }
    const stroke = (col, w) => { c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.stroke(); };
    stroke(P.style === 'snow' ? 'rgba(180,200,215,.9)' : 'rgba(150,140,100,.7)', 92); stroke(deep, 68); stroke(mid, 40);
    c.globalAlpha = .5; stroke(light, 3); c.globalAlpha = 1;
    /* 다리: 각 길이 강에 가장 가까이 닿는 지점(48px 이내)마다 하나 — 없으면 지도 중앙 교차점에 하나 */
    const bridges = [];
    for (const path of paths) { let best = null, bd = 1e9; for (const q of path) for (const p of pts) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = p; } } if (best && bd < 48 && !bridges.some(b => Math.hypot(b.x - best.x, b.y - best.y) < 120)) bridges.push(best); }
    if (!bridges.length) bridges.push(vertical ? pts.reduce((b, p) => Math.abs(p.y - 600) < Math.abs(b.y - 600) ? p : b) : pts.reduce((b, p) => Math.abs(p.x - 800) < Math.abs(b.x - 800) ? p : b));
    for (const b of bridges) {
      c.save(); c.translate(b.x, b.y); if (!vertical) c.rotate(Math.PI / 2);
      c.fillStyle = '#6b4a2f'; c.fillRect(-44, -60, 88, 120); c.fillStyle = '#8a6b45';
      for (let k = -54; k < 60; k += 12) c.fillRect(-40, k, 80, 8);
      c.fillStyle = '#4a3524'; c.fillRect(-46, -60, 6, 120); c.fillRect(40, -60, 6, 120); c.restore();
      blocked.push({ x: b.x, y: b.y, r: 90 });
    }
    const nearBridge = p => bridges.some(b => Math.hypot(p.x - b.x, p.y - b.y) < 70);
    for (const p of pts) { if (nearBridge(p)) continue; cols.push({ x: p.x, y: p.y, r: 30 }); blocked.push({ x: p.x, y: p.y, r: 80 }); }
    for (let i = 1; i < pts.length - 1; i += 2) { const a = pts[i - 1], b = pts[i + 1]; if (nearBridge(pts[i])) continue; waters.push({ x: pts[i].x, y: pts[i].y, rx: 46, ry: 18, rot: Math.atan2(b.y - a.y, b.x - a.x), lava: false }); } /* 강 물결 하이라이트 등록 */
  };
  const waterfall = () => { /* 상단 절벽에서 떨어지는 폭포 + 웅덩이 */
    const x = R(500, 1100), cliffY = 120;
    c.fillStyle = P.rock[1]; c.fillRect(x - 220, 60, 440, cliffY); c.fillStyle = P.rock[0]; c.fillRect(x - 220, 60, 440, 18);
    c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(x - 220, 60 + cliffY - 10, 440, 10);
    for (let k = 0; k < 9; k++) { c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(x - 210 + k * 48, 78, 3, cliffY - 30); }
    const [deep, mid, light] = P.water;
    const g = c.createLinearGradient(0, 78, 0, 60 + cliffY + 30); g.addColorStop(0, light); g.addColorStop(.5, mid); g.addColorStop(1, deep);
    c.fillStyle = g; c.fillRect(x - 34, 78, 68, cliffY - 8);
    c.fillStyle = 'rgba(255,255,255,.55)'; for (let k = 0; k < 10; k++) c.fillRect(x - 30 + k * 6.5, 78, 2, cliffY - 8 - (k % 3) * 8);
    water(x, 60 + cliffY + 62, 120, 58, 0, false);
    c.fillStyle = 'rgba(255,255,255,.35)'; for (let k = 0; k < 14; k++) { c.beginPath(); c.arc(x + R(-40, 40), 60 + cliffY + R(4, 30), R(2, 5), 0, 7); c.fill(); }
    for (let cx = x - 210; cx <= x + 210; cx += 40) cols.push({ x: cx, y: 60 + cliffY / 2, r: cliffY / 2 });
    blocked.push({ x, y: 60 + cliffY / 2, r: 300 });
  };
  /* 2) 길 (스폰 → 관문/보스) — 물보다 먼저 그려 연못이 길을 피하고, 강은 길과 만나는 곳에 다리를 놓는다 */
  const paths = []; /* 길 표본(강 다리 위치 계산용) */
  const pathTo = (sx, sy, tx, ty) => {
    const pp = []; paths.push(pp);
    const mx = (sx + tx) / 2 + (rng() - .5) * 260, my = (sy + ty) / 2 + (rng() - .5) * 200;
    c.strokeStyle = P.path[0]; c.lineWidth = 44; c.lineCap = 'round'; c.beginPath(); c.moveTo(sx, sy); c.quadraticCurveTo(mx, my, tx, ty); c.stroke();
    c.strokeStyle = P.path[1]; c.lineWidth = 36; c.beginPath(); c.moveTo(sx, sy); c.quadraticCurveTo(mx, my, tx, ty); c.stroke();
    c.strokeStyle = 'rgba(0,0,0,.10)'; c.lineWidth = 46; c.setLineDash([3, 9]); c.beginPath(); c.moveTo(sx, sy); c.quadraticCurveTo(mx, my, tx, ty); c.stroke(); c.setLineDash([]); /* 가장자리 결 */
    for (let i = 0; i < 70; i++) { const t = rng(), px = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * mx + t * t * tx, py = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * my + t * t * ty; c.fillStyle = i % 2 ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.16)'; c.beginPath(); c.arc(px + (rng() - .5) * 26, py + (rng() - .5) * 26, 1.2 + rng() * 1.8, 0, 7); c.fill(); } /* 자갈 */
    for (let i = 0; i <= 24; i++) { const t = i / 24; const px = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * mx + t * t * tx, py = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * my + t * t * ty; blocked.push({ x: px, y: py, r: 34 }); pp.push({ x: px, y: py }); c.fillStyle = 'rgba(0,0,0,.18)'; c.beginPath(); c.ellipse(px + R(-12, 12), py + R(-12, 12), R(2, 4.5), R(1.5, 3), R(0, 3), 0, 7); c.fill(); }
  };
  pathTo(spawn.x, spawn.y, 540, 430); pathTo(spawn.x, spawn.y, 1060, 770); pathTo(spawn.x, spawn.y, 800, 1000); pathTo(spawn.x, spawn.y, 1490, 600); if (n !== 1) pathTo(spawn.x, spawn.y, 110, 600);
  const pond = (rx0, rx1, ry0, ry1, pad, tries = 24) => { for (let t = 0; t < tries; t++) { const x = R(300, 1300), y = R(250, 1000); if (!isBlocked(x, y, pad)) { water(x, y, R(rx0, rx1), R(ry0, ry1), R(0, 3), false); return true; } } return false; };
  const feat = rng();
  if (P.lava) { for (let i = 0; i < 3 + (tier % 3); i++) for (let t = 0; t < 8; t++) { const x = R(200, 1400), y = R(200, 1050); if (!isBlocked(x, y, 110)) { water(x, y, R(60, 130), R(40, 80), R(0, 3), true); break; } } } /* 용암 웅덩이: 빈 자리 8회 탐색 */
  else if (P.gaps) { for (let i = 0; i < P.gaps; i++) { const x = R(150, 1450), y = R(150, 1050); if (!isBlocked(x, y, 140)) { /* 구름 사이 틈(낙하 불가 영역) */ const rx = R(70, 140), ry = rx * R(.5, .8); c.save(); c.translate(x, y); const g = c.createRadialGradient(0, 0, 4, 0, 0, rx); g.addColorStop(0, '#1a2a4a'); g.addColorStop(.85, '#2a4a7a'); g.addColorStop(1, 'rgba(255,255,255,.9)'); c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, 7); c.fill(); c.restore(); const steps = 10; for (let k = 0; k < steps; k++) { const a = k / steps * 6.283; cols.push({ x: x + Math.cos(a) * rx * .8, y: y + Math.sin(a) * ry * .8, r: 18 }); } cols.push({ x, y, r: Math.min(rx, ry) * .7 }); blocked.push({ x, y, r: rx + 40 }); } } }
  else if (P.style === 'cave') { /* 동굴: 지하 호수 */ pond(feat < .5 ? 90 : 55, feat < .5 ? 150 : 95, feat < .5 ? 60 : 38, feat < .5 ? 100 : 62, 120); }
  else if (feat < .30) { if (!pond(90, 170, 60, 110, 130)) pond(55, 95, 38, 62, 110); }
  else if (feat < .58) river(rng() < .5);
  else if (feat < .72 && P.style !== 'desert') waterfall();
  else if (P.style === 'swamp' || P.murk) { for (let i = 0; i < 3; i++) pond(50, 100, 35, 70, 100, 4); }
  else if (P.style !== 'desert' || feat > .9) pond(55, 95, 38, 62, 110); /* 나머지: 작은 연못(사막은 10% 오아시스) */

  for (const z of mobZones) { const g = c.createRadialGradient(z.x, z.y, 10, z.x, z.y, 210); g.addColorStop(0, 'rgba(0,0,0,.10)'); g.addColorStop(.75, 'rgba(0,0,0,.05)'); g.addColorStop(1, 'transparent'); c.fillStyle = g; c.beginPath(); c.arc(z.x, z.y, 210, 0, 7); c.fill(); }
  c.strokeStyle = P.style === 'volcano' ? 'rgba(255,120,40,.35)' : 'rgba(120,60,40,.25)'; c.lineWidth = 6; c.beginPath(); c.arc(800, 1000, 130, 0, 7); c.stroke();

  /* 4) 풀·꽃·잔디 */
  for (let i = 0; i < (P.grassN || 0); i++) { const x = rng() * WORLD.w, y = rng() * WORLD.h; if (blocked.some(b => b.r > 60 && Math.hypot(b.x - x, b.y - y) < b.r - 40)) continue; c.strokeStyle = P.grass[i % 2]; c.lineWidth = 1.4; c.beginPath(); c.moveTo(x, y); c.lineTo(x + R(-2, 2), y - R(3, 7)); c.stroke(); }
  for (let i = 0; i < 240; i++) { const x = rng() * WORLD.w, y = rng() * WORLD.h; if (isBlocked(x, y, -60)) continue; const col = P.flowers[i % 4]; c.fillStyle = col; c.beginPath(); c.arc(x, y, 2.6, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.arc(x, y, 1, 0, 7); c.fill(); }
  if (P.reeds) for (let i = 0; i < P.reeds; i++) { const x = rng() * WORLD.w, y = rng() * WORLD.h; c.strokeStyle = 'rgba(110,140,70,.8)'; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y); c.lineTo(x + R(-3, 3), y - R(14, 26)); c.stroke(); c.fillStyle = '#6b4a2f'; c.fillRect(x - 2, y - R(20, 26), 4, 7); }
  if (P.embers) for (let i = 0; i < P.embers; i++) { const x = rng() * WORLD.w, y = rng() * WORLD.h; c.fillStyle = P.style === 'volcano' ? 'rgba(255,140,60,.75)' : 'rgba(200,120,255,.7)'; c.beginPath(); c.arc(x, y, R(.8, 2), 0, 7); c.fill(); }
  if (P.snowPiles) for (let i = 0; i < P.snowPiles; i++) { const x = rng() * WORLD.w, y = rng() * WORLD.h; if (isBlocked(x, y, -30)) continue; c.fillStyle = 'rgba(255,255,255,.85)'; c.beginPath(); c.ellipse(x, y, R(14, 34), R(6, 12), 0, 0, 7); c.fill(); c.fillStyle = 'rgba(160,185,205,.5)'; c.beginPath(); c.ellipse(x, y + 4, R(14, 30), 4, 0, 0, Math.PI); c.fill(); }
  if (P.clouds) for (let i = 0; i < P.clouds; i++) { const x = rng() * WORLD.w, y = rng() * WORLD.h; c.fillStyle = 'rgba(255,255,255,.35)'; for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(x + k * 16 - 24, y + (k % 2) * 5, R(14, 26), 0, 7); c.fill(); } }

  /* 5) 장식 오브젝트 (충돌체 포함) */
  const tree = (x, y, s, pine) => {
    cols.push({ x, y: y + 2, r: 13 * s });
    if (drawPropTex(c, pick(PS.trees), x, y + 2, 74 * s, PS.tint, rng() < .5)) return; /* 스프라이트 프롭(로드 전엔 벡터 폴백) */
    c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(x + 9 * s, y + 16 * s, 28 * s, 10 * s, 0, 0, 7); c.fill();
    c.fillStyle = P.trunk; c.beginPath(); c.moveTo(x - 6.5 * s, y + 15 * s); c.quadraticCurveTo(x - 4 * s, y, x - 3.5 * s, y - 16 * s); c.lineTo(x + 3.5 * s, y - 16 * s); c.quadraticCurveTo(x + 4 * s, y, x + 6.5 * s, y + 15 * s); c.closePath(); c.fill();
    if (pine) { for (let L = 2; L >= 0; L--) { const ly = y - 14 * s - L * 15 * s, lw = (26 - L * 6.5) * s; c.fillStyle = P.leaf[L]; c.beginPath(); c.moveTo(x - lw, ly + 14 * s); c.quadraticCurveTo(x, ly - 4 * s, x + lw, ly + 14 * s); c.quadraticCurveTo(x, ly + 8 * s, x - lw, ly + 14 * s); c.closePath(); c.fill(); c.strokeStyle = 'rgba(0,0,0,.22)'; c.lineWidth = 1.4; c.stroke(); } }
    else { const cy = y - 32 * s; const blob = (bx, by, br, col) => { c.fillStyle = col; c.beginPath(); c.arc(bx, by, br, 0, 7); c.fill(); }; blob(x - 16 * s, cy + 7 * s, 18 * s, P.leaf[0]); blob(x + 16 * s, cy + 7 * s, 18 * s, P.leaf[0]); blob(x, cy + 10 * s, 19 * s, P.leaf[1]); blob(x, cy - 4 * s, 22 * s, P.leaf[2]); blob(x - 12 * s, cy - 12 * s, 14 * s, P.leaf[3]); blob(x + 12 * s, cy - 10 * s, 13 * s, P.leaf[3]); blob(x - 2 * s, cy - 16 * s, 12 * s, P.leaf[4]); for (let L2 = 0; L2 < 10; L2++) { const a = rng() * 6.283, rr2 = 10 + rng() * 16; blob(x + Math.cos(a) * rr2 * s * 1.15, cy - 4 * s + Math.sin(a) * rr2 * s * .6, 2.6 * s, 'rgba(255,255,255,.18)'); } }
  };
  const rock = (x, y, s) => { cols.push({ x, y, r: 10 * s }); if (drawPropTex(c, pick(PS.rocks), x, y + 6 * s, 26 * s, PS.tint, rng() < .5)) return; c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.ellipse(x + 3, y + 8 * s, 14 * s, 6 * s, 0, 0, 7); c.fill(); const g = c.createLinearGradient(x - 11 * s, y - 12 * s, x + 11 * s, y + 8 * s); g.addColorStop(0, P.rock[2]); g.addColorStop(.5, P.rock[0]); g.addColorStop(1, P.rock[1]); c.fillStyle = g; c.beginPath(); c.moveTo(x - 12 * s, y + 6 * s); c.lineTo(x - 9 * s, y - 8 * s); c.lineTo(x - 1 * s, y - 13 * s); c.lineTo(x + 9 * s, y - 7 * s); c.lineTo(x + 13 * s, y + 4 * s); c.lineTo(x + 6 * s, y + 9 * s); c.closePath(); c.fill(); c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 1.2; c.stroke(); };
  const bush = (x, y, s) => { cols.push({ x, y, r: 8 * s }); if (drawPropTex(c, pick(PS.bushes), x, y + 5 * s, 22 * s, PS.tint, rng() < .5)) return; c.fillStyle = 'rgba(0,0,0,.22)'; c.beginPath(); c.ellipse(x + 3 * s, y + 7 * s, 13 * s, 5 * s, 0, 0, 7); c.fill(); c.fillStyle = P.leaf[2]; c.beginPath(); c.arc(x - 6 * s, y, 8 * s, 0, 7); c.arc(x + 6 * s, y - 1 * s, 9 * s, 0, 7); c.arc(x, y - 6 * s, 8 * s, 0, 7); c.fill(); c.fillStyle = P.leaf[4]; c.beginPath(); c.arc(x - 2 * s, y - 5 * s, 5.5 * s, 0, 7); c.fill(); if (((x * 7 + y * 13) | 0) % 2) { c.fillStyle = P.flowers[0]; c.beginPath(); c.arc(x + 4 * s, y - 7 * s, 1.6 * s, 0, 7); c.arc(x - 5 * s, y - 3 * s, 1.6 * s, 0, 7); c.fill(); } };
  const cactus = (x, y, s) => { cols.push({ x, y, r: 9 * s }); if (drawPropTex(c, pick(['cactus_short', 'cactus_tall']), x, y + 4 * s, 36 * s, PS.tint, rng() < .5)) return; c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(x + 3, y + 6 * s, 12 * s, 5 * s, 0, 0, 7); c.fill(); c.fillStyle = '#5d8a41'; c.strokeStyle = '#3f5c33'; c.lineWidth = 1.2; roundRect(c, x - 6 * s, y - 34 * s, 12 * s, 40 * s, 6 * s); c.fill(); c.stroke(); roundRect(c, x - 20 * s, y - 22 * s, 10 * s, 18 * s, 5 * s); c.fill(); c.stroke(); c.fillRect(x - 15 * s, y - 10 * s, 12 * s, 6 * s); roundRect(c, x + 10 * s, y - 28 * s, 10 * s, 20 * s, 5 * s); c.fill(); c.stroke(); c.fillRect(x + 4 * s, y - 12 * s, 10 * s, 6 * s); c.fillStyle = 'rgba(255,255,255,.35)'; for (let k = 0; k < 6; k++) c.fillRect(x - 1, y - 30 * s + k * 6 * s, 2, 2); };
  const stalagmite = (x, y, s) => { cols.push({ x, y, r: 8 * s }); c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(x + 2, y + 5 * s, 11 * s, 4 * s, 0, 0, 7); c.fill(); const g = c.createLinearGradient(x - 8 * s, y, x + 8 * s, y); g.addColorStop(0, P.rock[1]); g.addColorStop(.5, P.rock[2]); g.addColorStop(1, P.rock[1]); c.fillStyle = g; c.beginPath(); c.moveTo(x - 9 * s, y + 4 * s); c.lineTo(x - 3 * s, y - 30 * s); c.lineTo(x + 2 * s, y - 36 * s); c.lineTo(x + 5 * s, y - 28 * s); c.lineTo(x + 10 * s, y + 4 * s); c.closePath(); c.fill(); c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 1; c.stroke(); };
  const crystal = (x, y, s) => { c.fillStyle = P.flowers[i2 % 4]; c.shadowColor = P.flowers[0]; c.shadowBlur = 10; c.beginPath(); c.moveTo(x, y - 18 * s); c.lineTo(x + 5 * s, y - 4 * s); c.lineTo(x + 2 * s, y + 4 * s); c.lineTo(x - 3 * s, y + 4 * s); c.lineTo(x - 6 * s, y - 6 * s); c.closePath(); c.fill(); c.shadowBlur = 0; c.fillStyle = 'rgba(255,255,255,.5)'; c.beginPath(); c.moveTo(x, y - 16 * s); c.lineTo(x + 2 * s, y - 6 * s); c.lineTo(x - 1 * s, y - 6 * s); c.closePath(); c.fill(); };
  const pillar = (x, y, s, broken) => { cols.push({ x, y, r: 9 * s }); if (drawPropTex(c, broken ? 'statue_columnDamaged' : 'statue_column', x, y + 4 * s, 52 * s, PS.tint, false)) return; c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(x + 4, y + 6 * s, 14 * s, 5 * s, 0, 0, 7); c.fill(); const h = (broken ? 22 : 46) * s; c.fillStyle = P.rock[0]; c.fillRect(x - 7 * s, y - h, 14 * s, h); c.fillStyle = P.rock[2]; c.fillRect(x - 7 * s, y - h, 4 * s, h); c.fillStyle = P.rock[1]; c.fillRect(x + 3 * s, y - h, 4 * s, h); c.fillStyle = P.rock[2]; c.fillRect(x - 9 * s, y - 4 * s, 18 * s, 5 * s); if (!broken) c.fillRect(x - 9 * s, y - h - 4 * s, 18 * s, 5 * s); else { c.fillStyle = P.rock[1]; c.beginPath(); c.moveTo(x - 7 * s, y - h); c.lineTo(x - 2 * s, y - h - 8 * s); c.lineTo(x + 3 * s, y - h - 3 * s); c.lineTo(x + 7 * s, y - h); c.closePath(); c.fill(); } };
  let i2 = 0;
  const place = (count, fn, pad, sMin, sMax) => { let tries = 0; for (let k = 0; k < count && tries < count * 6; tries++) { const x = 70 + rng() * (WORLD.w - 140), y = 90 + rng() * (WORLD.h - 180); if (isBlocked(x, y, pad)) continue; if (cols.some(o => Math.hypot(o.x - x, o.y - y) < 36)) continue; i2++; fn(x, y, sMin + rng() * (sMax - sMin)); k++; } };
  if (P.walls) { /* 동굴/폐허: 가장자리 벽 덩이 */
    for (let k = 0; k < 26; k++) { const side = k % 4, t = rng(); const x = side === 0 ? 40 + rng() * 60 : side === 1 ? WORLD.w - 40 - rng() * 60 : 60 + t * (WORLD.w - 120), y = side === 2 ? 40 + rng() * 50 : side === 3 ? WORLD.h - 40 - rng() * 50 : 60 + t * (WORLD.h - 120); if (isBlocked(x, y, 40)) continue; const r = 26 + rng() * 30; c.fillStyle = P.rock[1]; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.fillStyle = P.rock[0]; c.beginPath(); c.arc(x - r * .2, y - r * .25, r * .6, 0, 7); c.fill(); cols.push({ x, y, r: r * .85 }); }
  }
  place(Math.round(P.trees * 1.7), (x, y, s) => tree(x, y, s, P.style === 'snow' ? rng() < .7 : rng() < .38), 16, 1.05, 1.9); /* 밀도 1.7배·크기 상향 — 스프라이트 프롭 기준 */
  place(Math.round(P.rocks * 1.4), rock, 0, .9, 1.7);
  place(Math.round(P.bushes * 1.6), bush, -20, .9, 1.5);
  /* 가장자리 숲 벨트: 지도 테두리를 따라 큰 나무를 촘촘히 — 세계 끝이 허전하지 않게 (관문 근처 제외) */
  for (let k = 0, tries = 0; k < 70 && tries < 420; tries++) {
    const side = tries % 4; let x, y;
    if (side === 0) { x = 40 + rng() * 110; y = 60 + rng() * (WORLD.h - 120); }
    else if (side === 1) { x = WORLD.w - 40 - rng() * 110; y = 60 + rng() * (WORLD.h - 120); }
    else if (side === 2) { x = 60 + rng() * (WORLD.w - 120); y = 40 + rng() * 90; }
    else { x = 60 + rng() * (WORLD.w - 120); y = WORLD.h - 40 - rng() * 90; }
    if (isBlocked(x, y, 30) || gates.some(g2 => Math.hypot(g2.x - x, g2.y - y) < 150)) continue;
    if (P.style === 'desert' && rng() < .6) { rock(x, y, 1.2 + rng() * .8); k++; continue; }
    tree(x, y, 1.3 + rng() * .8, P.style === 'snow' ? rng() < .7 : rng() < .38); k++;
  }
  if (P.cacti) place(P.cacti, cactus, 0, .8, 1.3);
  if (P.stalagmites) place(P.stalagmites, stalagmite, 0, .8, 1.5);
  if (P.crystals) place(P.crystals, crystal, -40, .8, 1.4);
  if (P.pillars) place(P.pillars, (x, y, s) => pillar(x, y, s, rng() < .55), 0, .9, 1.3);
  if (P.ice) for (let k = 0; k < P.ice; k++) { const x = R(200, 1400), y = R(200, 1050); if (isBlocked(x, y, 60)) continue; c.fillStyle = 'rgba(200,235,255,.55)'; c.beginPath(); c.ellipse(x, y, R(50, 100), R(30, 60), R(0, 3), 0, 7); c.fill(); c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x - 30, y - 10); c.lineTo(x + 10, y + 5); c.lineTo(x + 35, y - 12); c.stroke(); }
  /* 5b) 세트 드레싱: 소품(꽃·버섯·통나무…) + 스폰 캠프 + 관문 표지판 + 길가 울타리 */
  { const extras = 10 + (tier % 4) * 3;
    for (let k = 0, tries = 0; k < extras && tries < extras * 5; tries++) { const x = 70 + rng() * (WORLD.w - 140), y = 70 + rng() * (WORLD.h - 140); if (isBlocked(x, y, -30)) continue; const ek = pick(PS.extra); const eh = ek === 'log' ? 9 + rng() * 4 : 16 + rng() * 12; /* 통나무는 납작·넓어 작게 */ drawPropTex(c, ek, x, y, eh, PS.tint, rng() < .5); k++; } /* 로드 전이면 건너뛰되 난수 소비는 동일(로드 후 재빌드 시 배치 불변) */
    if (PS.dress.includes('campfire_logs')) { /* 스폰 캠프: 모닥불 + 통나무 + 그루터기 (텐트 모델은 정면이 벽처럼 구워져 제외) */
      const cx0 = n === 1 ? spawn.x - 90 : spawn.x + 40, cy0 = n === 1 ? spawn.y + 30 : spawn.y + 120; /* 2구역부터 스폰이 좌측 벽 옆 → 캠프는 스폰 아래쪽(테두리·관문 겹침 방지) */
      drawPropTex(c, 'campfire_logs', cx0, cy0, 20, null, false);
      drawPropTex(c, 'log', cx0 - 40, cy0 + 26, 12, PS.tint, false);
      drawPropTex(c, 'stump_round', cx0 + 38, cy0 + 32, 16, PS.tint, true);
    }
    for (const g2 of gates) if (PS.dress.includes('sign')) drawPropTex(c, 'sign', g2.x + (g2.x < 800 ? 46 : -46), g2.y - 40, 30, PS.tint, g2.x > 800);
    const fenceKey = PS.dress.find(k => k.startsWith('fence'));
    if (fenceKey) for (let k = 0; k < 6; k++) { const x = 300 + k * 44, y = 130 + Math.sin(k) * 4; if (!isBlocked(x, y, 0)) drawPropTex(c, fenceKey, x, y, 22, PS.tint, false); }
    for (const dk of PS.dress.filter(k => !/tent|campfire|sign|fence/.test(k)).slice(0, 2)) { const x = 200 + rng() * 1200, y = 180 + rng() * 800; if (!isBlocked(x, y, 40)) { const dh0 = dk === 'log' ? 13 : dk.startsWith('stump') ? 18 : 40; /* 통나무·그루터기는 납작해 작게 */ if (drawPropTex(c, dk, x, y, dh0, PS.tint, false)) cols.push({ x, y: y - 6, r: dh0 < 20 ? 10 : 16 }); } }
  }
  /* 6) 테두리 */
  try { drawBrickBorder(c, P.style === 'volcano' ? 15 : P.style === 'abyss' ? 280 : P.style === 'snow' ? 205 : P.style === 'desert' ? 40 : 30, P.style === 'cave' ? 12 : 30); } catch (e) {}
  worldColliders[pid] = cols;
  return cv2;
}
const bioTexCache = new Map(); /* 바이옴 텍스처는 크므로(데스크톱 3200x2400) 최근 2개만 보관 */
const zoneWaters = {}; /* pid → 물/용암 웅덩이 목록(런타임 반짝임용) */
/* ===== 런타임 배경 연출: 물 반짝임 · 바이옴 입자 ===== */
function drawWaterFx(now) {
  const ws = zoneWaters[myMap()]; if (!ws || !ws.length) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const w of ws) {
    if (w.lava) { const p = .5 + Math.sin(now / 420 + w.x) * .5; const g = ctx.createRadialGradient(w.x, w.y, 2, w.x, w.y, Math.max(w.rx, w.ry) * 1.4); g.addColorStop(0, `rgba(255,150,60,${.10 + p * .12})`); g.addColorStop(1, 'rgba(255,90,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(w.x, w.y, w.rx * 1.4, w.ry * 1.4, w.rot, 0, 7); ctx.fill(); continue; }
    for (let i = 0; i < 3; i++) { /* 흘러가는 하이라이트 3줄 */
      const t = ((now / 2600) + i / 3 + w.x * .001) % 1, a = Math.sin(t * Math.PI) * .32;
      const ox = (t - .5) * w.rx * 1.2, len = w.rx * (.35 + .25 * Math.sin(now / 900 + i));
      ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(w.rot);
      ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ox - len / 2, (i - 1) * w.ry * .35); ctx.lineTo(ox + len / 2, (i - 1) * w.ry * .35); ctx.stroke(); ctx.restore();
    }
  }
  ctx.restore();
}
/* 바이옴 입자: 낙엽/눈/불씨/포자/먼지/반짝이/물방울 — 뷰포트 주변 월드 좌표에서 순환 */
const AMB_N = innerWidth <= 640 ? 18 : 40; let ambient = [], ambStyle = '';
function ambientKind(style) { return { meadow: 'leaf', jungle: 'leaf', swamp: 'spore', snow: 'snow', volcano: 'ember', desert: 'dust', cave: 'drip', ruin: 'dust', abyss: 'spark', sky: 'spark' }[style] || 'leaf'; }
function updateAmbient(now, dt) {
  const pn = pageNum(), style = (BIOME_PAL[Math.min(9, Math.floor((pn - 1) / 10))] || BIOME_PAL[0]).style; const kind = ambientKind(style); /* 팔레트 스타일 기준(BIOMES.style은 구형 meadow/grave 2종) */
  const vw = cvW / view.z, vh = cvH / view.z, x0 = view.x - 60, y0 = view.y - 80;
  if (ambStyle !== style) { ambStyle = style; ambient = []; }
  const spawnOne = () => ({ x: x0 + Math.random() * (vw + 120), y: kind === 'ember' ? y0 + vh + Math.random() * 60 : y0 - Math.random() * 60, vx: (Math.random() - .5) * 30 + (kind === 'leaf' ? 22 : kind === 'dust' ? 60 : 0), vy: kind === 'ember' ? -(30 + Math.random() * 40) : kind === 'spark' ? (Math.random() - .5) * 12 : (18 + Math.random() * 30) * (kind === 'snow' ? .8 : kind === 'drip' ? 3 : 1), r: kind === 'spark' ? 1.2 + Math.random() * 1.6 : 1.5 + Math.random() * 2.2, ph: Math.random() * 7, life: 0, col: kind === 'leaf' ? (Math.random() < .5 ? '#c9803a' : '#7fa34a') : kind === 'spore' ? '#a8e070' : kind === 'ember' ? '#ff9a3a' : kind === 'dust' ? '#e8d8b0' : kind === 'drip' ? '#9fd8ff' : kind === 'spark' ? (style === 'abyss' ? '#d9a3ff' : '#ffffff') : '#ffffff' });
  while (ambient.length < AMB_N) ambient.push(spawnOne());
  for (const p of ambient) {
    p.life += dt; p.x += (p.vx + Math.sin(now / 700 + p.ph) * (kind === 'snow' || kind === 'leaf' ? 18 : 6)) * dt / 1000; p.y += p.vy * dt / 1000;
    if (kind === 'spark') { p.x += Math.sin(now / 500 + p.ph) * 10 * dt / 1000; }
    if (p.x < x0 - 80 || p.x > x0 + vw + 200 || p.y > y0 + vh + 120 || p.y < y0 - 120 || p.life > 14000) Object.assign(p, spawnOne(), { life: 0 });
  }
}
function drawAmbient(now) {
  if (!ambient.length) return;
  const kind = ambientKind(ambStyle);
  ctx.save();
  if (kind === 'ember' || kind === 'spark' || kind === 'spore') ctx.globalCompositeOperation = 'lighter';
  for (const p of ambient) {
    const a = kind === 'spark' ? .35 + .65 * Math.abs(Math.sin(now / 300 + p.ph)) : kind === 'dust' ? .22 : .75;
    ctx.globalAlpha = a; ctx.fillStyle = p.col;
    if (kind === 'leaf') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(now / 600 + p.ph); ctx.fillRect(-p.r * 1.4, -p.r * .6, p.r * 2.8, p.r * 1.2); ctx.restore(); }
    else if (kind === 'dust') { ctx.fillRect(p.x, p.y, p.r * 3, 1); }
    else if (kind === 'drip') { ctx.fillRect(p.x, p.y, 1, p.r * 3); }
    else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); }
  }
  ctx.restore(); ctx.globalAlpha = 1;
}
/* ===== 배경 프롭 스프라이트(Kenney CC0 GLB → 256px 베이크) ===== */
const PROP_KEYS = ['tree_default','tree_default_dark','tree_default_fall','tree_detailed','tree_detailed_dark','tree_detailed_fall','tree_cone','tree_cone_dark','tree_pineDefaultA','tree_pineTallA','tree_pineRoundA','tree_palm','tree_palmTall','tree_oak','tree_tall','tree_thin','tree_plateau','rock_largeA','rock_largeC','rock_smallA','rock_smallC','stone_largeA','stone_smallA','plant_bush','plant_bushLarge','plant_bushSmall','mushroom_redGroup','mushroom_tanGroup','flower_purpleA','flower_redA','flower_yellowA','fence_simple','fence_planks','tent_detailedClosed','campfire_logs','log','stump_round','statue_column','statue_columnDamaged','statue_obelisk','cactus_short','cactus_tall','lily_large','grass_leafs','sign','hanging_moss'];
const propSheet = k => heroSheet('prop_' + k.toLowerCase()); /* 베이크 서버가 파일명을 소문자로 저장하므로 키도 소문자로. 매니페스트 게이트·LRU는 heroSheet 공용 */
let propRebuildT = 0;
function onPropLoaded() { /* 프롭이 로드되면 현재 구역 지형을 다시 구워 벡터 폴백을 스프라이트로 교체 */
  clearTimeout(propRebuildT);
  const allDone = PROP_KEYS.every(k => { const e = HERO_SHEETS['prop_' + k.toLowerCase()]; return e && (e.img || e.failed); });
  propRebuildT = setTimeout(() => { try { bioTexCache.delete(pageNum()); worldColliders[myMap()] = null; } catch (e) {} }, allDone ? 0 : 1500); /* 46장이 따로따로 도착해도 재빌드는 한 번(전부 도착 시 즉시, 아니면 1.5초 정지 후) */
}
/* 바이옴별 프롭 세트 */
const PROP_SETS = {
  meadow:  { trees: ['tree_default', 'tree_detailed', 'tree_oak', 'tree_tall', 'tree_default_fall'], bushes: ['plant_bush', 'plant_bushLarge', 'plant_bushSmall'], rocks: ['rock_smallA', 'rock_smallC', 'stone_smallA', 'rock_largeA'], extra: ['flower_purpleA', 'flower_redA', 'flower_yellowA', 'grass_leafs', 'stump_round', 'log'], dress: ['campfire_logs', 'fence_simple', 'sign'], tint: 'rgba(160,230,110,.16)' },
  jungle:  { trees: ['tree_default_dark', 'tree_detailed_dark', 'tree_detailed', 'tree_palm', 'tree_oak'], bushes: ['plant_bush', 'plant_bushSmall'], rocks: ['rock_largeC', 'stone_largeA', 'rock_smallC'], extra: ['mushroom_redGroup', 'mushroom_tanGroup', 'hanging_moss', 'stump_round', 'log'], dress: ['fence_planks', 'sign', 'sign'], tint: 'rgba(20,40,60,.28)' },
  desert:  { trees: ['tree_palm', 'tree_palmTall'], bushes: ['cactus_short', 'cactus_tall', 'plant_bushSmall'], rocks: ['rock_largeA', 'rock_largeC', 'stone_largeA', 'stone_smallA'], extra: ['cactus_short', 'rock_smallA', 'grass_leafs'], dress: ['log', 'sign'], tint: 'rgba(255,200,120,.18)' },
  snow:    { trees: ['tree_pineDefaultA', 'tree_pineTallA', 'tree_pineRoundA', 'tree_cone'], bushes: ['plant_bushSmall', 'stump_round'], rocks: ['rock_largeA', 'stone_largeA', 'rock_smallA'], extra: ['log', 'stump_round'], dress: ['campfire_logs', 'fence_simple', 'sign'], tint: 'rgba(200,225,255,.30)' },
  swamp:   { trees: ['tree_default_dark', 'tree_thin', 'tree_detailed_dark'], bushes: ['plant_bushLarge', 'grass_leafs', 'lily_large'], rocks: ['stone_largeA', 'rock_smallC'], extra: ['mushroom_tanGroup', 'lily_large', 'log', 'hanging_moss'], dress: ['fence_planks', 'sign'], tint: 'rgba(60,90,40,.22)' },
  volcano: { trees: ['tree_default_fall', 'tree_thin', 'tree_thin'], bushes: ['rock_smallC', 'stone_smallA'], rocks: ['rock_largeA', 'rock_largeC', 'stone_largeA'], extra: ['campfire_logs', 'rock_smallA', 'log'], dress: ['statue_obelisk', 'statue_obelisk'], tint: 'rgba(120,30,10,.38)' },
  cave:    { trees: ['tree_thin', 'tree_thin'], bushes: ['mushroom_tanGroup', 'mushroom_redGroup'], rocks: ['rock_largeA', 'rock_largeC', 'stone_largeA', 'stone_smallA', 'rock_smallC'], extra: ['mushroom_tanGroup', 'stone_smallA'], dress: ['statue_columnDamaged', 'sign'], tint: 'rgba(30,40,70,.40)' },
  ruin:    { trees: ['tree_thin', 'tree_default_fall', 'tree_thin'], bushes: ['plant_bushSmall', 'grass_leafs'], rocks: ['stone_largeA', 'stone_smallA', 'rock_largeC'], extra: ['statue_columnDamaged', 'statue_column', 'log', 'log'], dress: ['statue_column', 'statue_obelisk', 'fence_planks', 'statue_obelisk', 'sign'], tint: 'rgba(80,80,60,.25)' },
  abyss:   { trees: ['tree_thin', 'tree_thin', 'tree_cone_dark'], bushes: ['mushroom_redGroup', 'stone_smallA'], rocks: ['rock_largeC', 'stone_largeA', 'rock_smallC'], extra: ['statue_obelisk', 'statue_obelisk', 'hanging_moss'], dress: ['statue_obelisk', 'statue_obelisk', 'statue_column'], tint: 'rgba(120,30,180,.42)' },
  sky:     { trees: ['tree_plateau', 'tree_cone', 'tree_default', 'tree_pineRoundA'], bushes: ['plant_bushSmall', 'flower_purpleA'], rocks: ['stone_smallA', 'rock_smallA'], extra: ['flower_yellowA', 'flower_purpleA', 'grass_leafs', 'sign'], dress: ['sign', 'sign', 'fence_simple'], tint: 'rgba(220,240,255,.22)' },
};
/* 프롭 1개를 지형 텍스처에 그림: (x,y)=발밑, h=원하는 월드 높이. 그림자 + 바이옴 틴트. 시트 미로드면 false */
const propTintCv = document.createElement('canvas');
function drawPropTex(c, key, x, y, h, tint, flip) {
  const sh = propSheet(key); if (!sh) return false;
  const m = sh.meta, F = m.fr, vis = Math.max(1, m.feet - m.top), k = h / vis;
  const dw = F * k, dh = F * k, dx = x - dw / 2, dy = y - m.feet * k;
  c.save();
  c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.ellipse(x + h * .08, y + 2, h * .30, h * .11, 0, 0, 7); c.fill();
  if (flip) { c.translate(x * 2, 0); c.scale(-1, 1); }
  if (tint) { /* 바이옴 색조: 스프라이트 알파에만 틴트 */
    propTintCv.width = F; propTintCv.height = F; const g = propTintCv.getContext('2d');
    g.clearRect(0, 0, F, F); g.drawImage(sh.img, 0, 0, F, F, 0, 0, F, F); g.globalCompositeOperation = 'source-atop'; g.fillStyle = tint; g.fillRect(0, 0, F, F);
    c.drawImage(propTintCv, dx, dy, dw, dh);
  } else c.drawImage(sh.img, 0, 0, F, F, dx, dy, dw, dh);
  c.restore();
  return true;
}
/* ===== 노이즈 지면: 저해상 값-노이즈 → 확대 보간으로 자연스러운 얼룩 + 미세 질감 ===== */
function paintGround(c, P, rng, style) {
  const W = WORLD.w, H = WORLD.h, cw = 80, ch = 60;
  const small = document.createElement('canvas'); small.width = cw; small.height = ch;
  const g = small.getContext('2d'); const img = g.createImageData(cw, ch); const d = img.data;
  const grid = 8, gx = Math.ceil(cw / grid) + 2, gy = Math.ceil(ch / grid) + 2;
  const lat = []; for (let i = 0; i < gx * gy; i++) lat.push(rng());
  const lat2 = []; for (let i = 0; i < gx * gy * 4; i++) lat2.push(rng());
  const sm = t => t * t * (3 - 2 * t);
  const vn = (arr, x, y, sz, stride) => { const x0 = Math.floor(x / sz), y0 = Math.floor(y / sz), fx = sm(x / sz - x0), fy = sm(y / sz - y0); const a = arr[(y0 * stride + x0) % arr.length], b = arr[(y0 * stride + x0 + 1) % arr.length], c2 = arr[((y0 + 1) * stride + x0) % arr.length], d2 = arr[((y0 + 1) * stride + x0 + 1) % arr.length]; return (a * (1 - fx) + b * fx) * (1 - fy) + (c2 * (1 - fx) + d2 * fx) * fy; };
  const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const cols = [hex(P.ground), ...P.tints.map(hex)];
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const n1 = vn(lat, x, y, grid, gx), n2 = vn(lat2, x * 2.3, y * 2.3, grid, gx * 2);
    const t = Math.min(.999, Math.max(0, n1 * .7 + n2 * .3));
    const fi = t * (cols.length - 1), i0 = Math.floor(fi), f = fi - i0, ca = cols[i0], cb = cols[Math.min(cols.length - 1, i0 + 1)];
    const o = (y * cw + x) * 4; d[o] = ca[0] * (1 - f) + cb[0] * f; d[o + 1] = ca[1] * (1 - f) + cb[1] * f; d[o + 2] = ca[2] * (1 - f) + cb[2] * f; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(small, 0, 0, W, H);
  /* 미세 질감: 스타일별 */
  const R = (a, b) => a + rng() * (b - a);
  if (style === 'meadow' || style === 'jungle' || style === 'swamp' || style === 'sky') { /* 잔디 결 */
    for (let i = 0; i < 2000; i++) { const x = rng() * W, y = rng() * H; c.strokeStyle = i % 2 ? P.grass[0] : P.grass[1]; c.lineWidth = 1.1; c.globalAlpha = .55; c.beginPath(); c.moveTo(x, y); c.lineTo(x + R(-2, 2), y - R(4, 9)); c.stroke(); } c.globalAlpha = 1;
  } else if (style === 'desert') { /* 모래 알갱이 + 물결 */
    for (let i = 0; i < 2200; i++) { c.fillStyle = i % 3 ? 'rgba(255,245,215,.35)' : 'rgba(120,90,50,.25)'; c.fillRect(rng() * W, rng() * H, 1.5, 1.5); }
    for (let i = 0; i < 160; i++) { const x = rng() * W, y = rng() * H, w = R(60, 160); c.strokeStyle = 'rgba(255,240,200,.14)'; c.lineWidth = 3; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + w / 2, y - 6, x + w, y); c.stroke(); }
  } else if (style === 'snow') { /* 눈 결정 반짝임 + 바람결 */
    for (let i = 0; i < 1600; i++) { c.fillStyle = 'rgba(255,255,255,.55)'; c.fillRect(rng() * W, rng() * H, 1.4, 1.4); }
    for (let i = 0; i < 120; i++) { const x = rng() * W, y = rng() * H, w = R(80, 220); c.strokeStyle = 'rgba(160,185,205,.18)'; c.lineWidth = 4; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + w / 2, y + 5, x + w, y); c.stroke(); }
  } else if (style === 'cave' || style === 'ruin') { /* 돌바닥 균열·자갈 */
    for (let i = 0; i < 260; i++) { let x = rng() * W, y = rng() * H; c.strokeStyle = 'rgba(0,0,0,.22)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x, y); for (let k = 0; k < 4; k++) { x += R(-16, 16); y += R(-12, 12); c.lineTo(x, y); } c.stroke(); }
    for (let i = 0; i < 1400; i++) { c.fillStyle = i % 2 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.14)'; c.beginPath(); c.arc(rng() * W, rng() * H, R(1, 2.6), 0, 7); c.fill(); }
  } else if (style === 'volcano') { /* 흑요석 균열 + 잔열 */
    for (let i = 0; i < 220; i++) { let x = rng() * W, y = rng() * H; c.strokeStyle = 'rgba(255,110,40,.30)'; c.lineWidth = 1.4; c.shadowColor = '#ff7f27'; c.shadowBlur = 6; c.beginPath(); c.moveTo(x, y); for (let k = 0; k < 4; k++) { x += R(-18, 18); y += R(-14, 14); c.lineTo(x, y); } c.stroke(); }
    c.shadowBlur = 0; for (let i = 0; i < 1600; i++) { c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(rng() * W, rng() * H, 2, 2); }
  } else if (style === 'abyss') { /* 공허 줄무늬 + 룬 점 */
    for (let i = 0; i < 140; i++) { const x = rng() * W, y = rng() * H, w = R(80, 240); c.strokeStyle = 'rgba(150,80,220,.12)'; c.lineWidth = R(2, 6); c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + w / 2, y + R(-30, 30), x + w, y); c.stroke(); }
    for (let i = 0; i < 700; i++) { c.fillStyle = 'rgba(220,160,255,.35)'; c.fillRect(rng() * W, rng() * H, 1.5, 1.5); }
  }
}
function gradeWorld(src, gr) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  if ('filter' in g) g.filter = gr.f;
  g.drawImage(src, 0, 0);
  g.filter = 'none';
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = gr.o;
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-over';
  return c;
}
function biomeIndexOf(mp) {
  const m = /^p(\d+)$/.exec(mp || '');
  return m ? Math.min(BIOMES.length - 1, Math.floor((+m[1] - 1) / 10)) : 0;
}
function getTex(mp) {
  if (mp === 'm2') { if (!mapTexs.m2) mapTexs.m2 = buildWorldM2(); return mapTexs.m2; }
  const m = /^p(\d+)$/.exec(mp || '');
  if (!m) return worldTex;
  const n = +m[1];
  let t = bioTexCache.get(n);
  if (t && t.wss !== WSS) { bioTexCache.delete(n); t = null; } /* 창 크기가 바뀌어 배율이 달라졌으면 다시 굽는다 */
  if (!t) {
    t = buildZoneWorld(n); /* 구역별 지형(팔레트·물·장식·충돌체) */
    bioTexCache.set(n, t);
    const texCap = (innerWidth <= 640 || WSS > 2) ? 1 : 2; while (bioTexCache.size > texCap) { const old = bioTexCache.keys().next().value; bioTexCache.delete(old); } /* 모바일·고배율 텍스처는 1장만 캐시(메모리 상쇄) */
    t.wss = WSS;
  }
  return t;
}

function buildWorldM2() {
  const cv2 = document.createElement('canvas');
  cv2.width = Math.round(WORLD.w * WSS); cv2.height = Math.round(WORLD.h * WSS);
  const c = cv2.getContext('2d');
  c.setTransform(WSS, 0, 0, WSS, 0, 0);
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
  if (hordeOn()) { toast('🌀 쇄도 중에는 구역을 이동할 수 없습니다'); return; } /* 런 도중 이탈 방지 */
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
    pickFx.length = 0; pickHide.clear(); /* 비행 중 연출 정리 */
    cam.x = sp.x; cam.y = sp.y;
    updX(meRef, { map: pageId(n), x: sp.x, y: sp.y }).catch(() => {});
    trySync(true); /* 구역 이동은 즉시 저장 */
    const mn = $('mapName');
    if (mn) mn.textContent = pageDef(n).name;
    watchMonsters();
    watchLoot(); /* 루팅도 구역별 구독 재설정 */
    watchPlayers(); /* 플레이어 구독도 새 구역 기준으로 재설정 */
    sysMsg(`${myName}님이 ${pageDef(n).name}(으)로 이동했습니다.`);
    try {
      const b = bandOfPage(n);
      const seen = JSON.parse(localStorage.getItem('seenBands') || '[]');
      if (!seen.includes(b)) {
        seen.push(b);
        localStorage.setItem('seenBands', JSON.stringify(seen));
        const sets = Object.keys(SET_BANDS).filter(sid => SET_BANDS[sid].includes(b));
        if (sets.length) toast(`📍 ${BIOMES[b].name}: ${sets.map(sid => `◈${SETS[sid].name}`).join(' ')} 세트 드랍 지역!`, 'sysq');
      }
    } catch (e) {}
    setTimeout(() => { if (ov) ov.style.opacity = 0; mapFading = false; }, 300);
  }, 380);
}

/* ================= 쇄도(HORDE): 생존 웨이브 던전 =================
   서버 쓰기 0회 — 몬스터·보상 전부 로컬에서 굴리고, 종료 시 한 번만 합산 지급한다.
   30초마다 각인(임시 강화) 3장 중 1장을 고르고, 10분을 버티면 완주. 죽으면 그 자리에서 끝(사망 penalty 없음). */
const HORDE_MS = 600000, HORDE_WAVE_MS = 30000, HORDE_R = 520, HORDE_C = { x: 800, y: 620 };
const hordeCap = () => innerWidth <= 640 ? 18 : 32; /* 동시 생존 몬스터 상한 — 모바일 프레임 보호 */
const HORDE_BUFFS = [
  { id: 'rage',  n: '광폭', ic: '🔥', max: 6, k: 'atk',   v: .25, d: l => `공격력 +${25 * l}%` },
  { id: 'haste', n: '신속', ic: '⚡', max: 5, k: 'aspd',  v: .18, d: l => `공격 속도 +${18 * l}%` },
  { id: 'dash',  n: '질주', ic: '💨', max: 5, k: 'spd',   v: .12, d: l => `이동 속도 +${12 * l}%` },
  { id: 'focus', n: '정밀', ic: '🎯', max: 5, k: 'crit',  v: .08, d: l => `치명타 +${8 * l}%` },
  { id: 'reach', n: '확장', ic: '📏', max: 4, k: 'range', v: 30,  d: l => `사거리 +${30 * l}` },
  { id: 'steel', n: '강철', ic: '🛡', max: 5, k: 'dr',    v: .10, d: l => `받는 피해 -${10 * l}%` },
  { id: 'leech', n: '흡혈', ic: '🩸', max: 5, k: 'life',  v: .03, d: l => `가한 피해의 ${3 * l}% 회복` },
  { id: 'boom',  n: '폭발', ic: '💥', max: 4, k: 'boom',  v: .5,  d: l => `처치 시 폭발 (공격력 ${50 * l}%)` },
  { id: 'greed', n: '탐욕', ic: '💰', max: 4, k: 'greed', v: .4,  d: l => `골드 +${40 * l}%` },
  { id: 'regen', n: '재생', ic: '💚', max: 5, k: 'regen', v: .015, d: l => `초당 최대 HP ${1.5 * l}% 회복` },
];
const hordeFmt = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

function hordeStart() {
  if (!ready || hordeOn()) return;
  if (me.dead) { toast('⚠️ 부활 후 입장할 수 있습니다'); return; }
  if ((me.lv || 1) < 5) { toast('⚠️ 쇄도는 Lv5부터 입장할 수 있습니다'); return; }
  document.querySelectorAll('.sidepanel').forEach(p => p.classList.remove('open'));
  /* 서버 구독 해제: 쇄도 동안 구역 몬스터·전리품·플레이어를 받지 않는다(쓰기·읽기 0) */
  if (unsubMon) { try { unsubMon(); } catch (e) {} unsubMon = null; }
  if (unsubLoot) { try { unsubLoot(); } catch (e) {} unsubLoot = null; }
  if (unsubPlayers) { try { unsubPlayers(); } catch (e) {} unsubPlayers = null; }
  sims = []; others = {}; othersPrev = {}; lootItems = {}; pickHide.clear(); attackTargetSimId = null; dest = null; /* 구역의 남은 전리품은 쇄도에 들고 들어가지 않음(복귀 시 구독으로 복원) */
  if (autoHunt) { autoHunt = false; updateAutoBtn(); } /* 이동은 직접 — 대신 사거리 안의 적은 자동 공격(아래 hordeTick) */
  horde = { st: 'run', left: HORDE_MS, waveLeft: HORDE_WAVE_MS, wave: 1, kills: 0, gold: 0, exp: 0,
    b: {}, lv: {}, seq: 0, spawnT: 0, boomDepth: 0, hpBefore: me.hp };
  me.hp = maxHpOf(); me.mp = maxMpOf(); hpDirty = true;
  me.x = HORDE_C.x; me.y = HORDE_C.y; me.vx = 0; me.vy = 0; cam.x = me.x; cam.y = me.y;
  fxFlash('255,90,60', 600, .4); sfx('boom'); doShake(8);
  toast('🌀 <b>쇄도</b> 시작! 10분을 버티세요 — 30초마다 각인을 하나 얻습니다', 'sysq');
  hordeHudShow(true);
}

function hordeEnd(reason) {
  if (!horde || horde.st !== 'run') return;
  horde.st = 'end';
  const survived = clampN(HORDE_MS - horde.left, 0, HORDE_MS); /* 마지막 프레임에서 left가 음수가 될 수 있음 */
  const rec = me.horde || {};
  const bestBefore = rec.best || 0;
  const isBest = survived > bestBefore;
  const gems = Math.max(0, Math.floor(survived / 120000) - Math.floor(bestBefore / 120000)); /* 2분 단위 최고 기록 갱신분만 보석 */
  const gold = horde.gold, exp = horde.exp, kills = horde.kills, wave = horde.wave;
  me.horde = { best: Math.max(bestBefore, survived), kills: Math.max(rec.kills || 0, kills), runs: (rec.runs || 0) + 1, clears: (rec.clears || 0) + (reason === 'clear' ? 1 : 0) };
  sims = sims.filter(s => !s.horde);
  lootItems = {};
  hordeHudShow(false);
  /* 보상 지급: 런 전체를 한 번에(쓰기 1회 분량) */
  if (exp > 0 || gold > 0) gainExp(exp, { type: 'horde', gold });
  const upd = { horde: me.horde };
  if (gems > 0) upd.gem = inc(gems);
  updX(meRef, upd).catch(() => {});
  me.hp = Math.max(1, Math.round(maxHpOf() * (reason === 'death' ? .35 : 1)));
  hpDirty = true;
  /* 구역 복귀 */
  const sp = pageDef(pageNum()).spawn;
  me.x = sp.x; me.y = sp.y; me.vx = 0; me.vy = 0; cam.x = sp.x; cam.y = sp.y;
  attackTargetSimId = null; dest = null;
  watchMonsters(); watchLoot(); watchPlayers();
  trySync(true);
  hordeResult({ reason, survived, kills, wave, gold, exp, gems, isBest });
  horde = null;
}

function hordeSpawn() {
  const pn = pageNum(), pd = pageDef(pn);
  const min = (HORDE_MS - horde.left) / 60000;
  const elite = horde.seq > 0 && horde.seq % 16 === 0;
  const base = elite ? pd.boss : pd.kinds[horde.seq % 2];
  const hpM = (elite ? 2.6 : .30) * (1 + min * .55);   /* 다수가 몰려오는 대신 개체는 물렁하게 */
  const atkM = (elite ? 1.0 : .55) * (1 + min * .22);
  const def = { ...base,
    hp: Math.max(6, Math.round(base.hp * hpM)), atk: Math.max(1, Math.round(base.atk * atkM)),
    exp: Math.max(1, Math.round(base.exp * (elite ? 2.5 : .40))), gold: Math.max(1, Math.round(base.gold * (elite ? 2.5 : .45))),
    aggro: 4000, speed: Math.round(base.speed * (elite ? 1 : 1.18)), respawn: 1999998 };
  def.maxHp = def.hp;
  const a = rand(0, Math.PI * 2), rr = HORDE_R + rand(30, 90);
  const x = clampN(HORDE_C.x + Math.cos(a) * rr, 50, WORLD.w - 50), y = clampN(HORDE_C.y + Math.sin(a) * rr, 50, WORLD.h - 50);
  sims.push({ id: 'hd_' + (horde.seq++), type: base.base, page: myMap(), map: myMap(), boss: false, horde: true, elite,
    sprId: SPRITE_DEFS[base.base] ? kindSprId(base) : 'goblin', uniq: false, def, kind: base.name,
    homeX: x, homeY: y, x, y, wa: rand(0, 6.28), off: rand(-.45, .45), nextWander: 0, atkCdUntil: 0,
    alive: true, hp: def.hp, maxHp: def.hp, respawnAt: 0, dirA: Math.PI / 2, movingF: true, aggroF: true, angry: true, blink: rand(0, 4000) });
}

/* 쇄도 몬스터 AI: 홈 복귀·어그로 판정 없이 항상 플레이어로 직진 */
function hordeSimTick(s, now, dt) {
  if (s.kbx) {
    s.x = clampN(s.x + s.kbx, 40, WORLD.w - 40); s.y = clampN(s.y + s.kby, 40, WORLD.h - 40);
    s.kbx *= .8; s.kby *= .8;
    if (Math.abs(s.kbx) < .3) { s.kbx = 0; s.kby = 0; }
  }
  if (me.dead) { s.movingF = false; return; }
  const dx = me.x - s.x, dy = me.y - s.y, d = Math.hypot(dx, dy) || 1;
  const rng = s.def.range || 34;
  if (d > rng) {
    s.cur = (s.cur ?? 0) + (s.def.speed - (s.cur ?? 0)) * Math.min(1, dt * .008);
    const sp = s.cur * dt / 1000;
    const ta = Math.atan2(dy, dx) + (d > 140 ? s.off : 0); /* 멀리서는 살짝 벌어져 접근(한 줄로 겹치는 것 완화) */
    s.dirA = angLerp(s.dirA, ta, dt * .014);
    s.movingF = true;
    s.x = clampN(s.x + Math.cos(s.dirA) * sp, 40, WORLD.w - 40);
    s.y = clampN(s.y + Math.sin(s.dirA) * sp, 40, WORLD.h - 40);
  } else {
    s.movingF = false;
    s.dirA = angLerp(s.dirA, Math.atan2(dy, dx), dt * .02);
    if (now >= s.atkCdUntil) {
      s.atkCdUntil = now + (s.elite ? 1500 : 1150);
      s.atkAnimT = now; s.swingT = now;
      monsterHitMe(s, now);
    }
  }
}

function hordeKill(s) {
  if (!horde || horde.st !== 'run') { s.alive = false; return; }
  const d = sdef(s);
  horde.kills++;
  const g = Math.round((d.gold || 0) * (1 + (horde.b.greed || 0)));
  const e = d.exp || 0;
  horde.gold += g; horde.exp += e;
  s.alive = false; s.deadT = Date.now();
  spawnPoof(s);
  if (s.elite) { float(s.x, s.y - d.r - 30, `정예 처치! +${g}G`, '#ffd700', true); doShake(7); }
  const bm = horde.b.boom || 0;
  if (bm && horde.boomDepth < 2) { /* 처치 폭발: 연쇄는 2단계까지만(무한 재귀 방지) */
    horde.boomDepth++;
    const dmg = Math.max(1, Math.round(totalAtk() * bm));
    rings.push({ x: s.x, y: s.y, r: 110, t: 0, max: 320, color: '255,150,60' });
    fxSparks(s.x, s.y, 14, '#ff9a3c', 190);
    sfx('boom');
    for (const o of sims) if (o.horde && o.alive && o !== s && Math.hypot(o.x - s.x, o.y - s.y) < 115) attackResult(o, dmg, false);
    horde.boomDepth--;
  }
}

function hordeTick(now, dt) {
  if (!hordeOn()) return;
  horde.left -= dt;
  horde.waveLeft -= dt;
  if (!me.dead && !paused) tryAttack(now); /* 사거리 안 자동 평타 — 사방에서 몰려오는 모드라 조준은 이동에 맡긴다 */
  /* 재생 각인 */
  const rg = horde.b.regen || 0;
  if (rg && !me.dead && me.hp < maxHpOf()) { me.hp = Math.min(maxHpOf(), me.hp + maxHpOf() * rg * dt / 1000); hpDirty = true; }
  /* 스폰: 경과 시간에 따라 목표 개체수·간격 조절 */
  const min = (HORDE_MS - horde.left) / 60000;
  let live = 0; for (const s of sims) if (s.horde && s.alive) live++;
  const want = Math.min(hordeCap(), Math.round(5 + min * 5));
  const gap = Math.max(140, 800 - min * 110);
  if (live < want && now - horde.spawnT > gap) { horde.spawnT = now; hordeSpawn(); if (live < want - 4) hordeSpawn(); }
  /* 시체 정리 */
  if (sims.length > 8) sims = sims.filter(s => !s.horde || s.alive || now - (s.deadT || 0) < 700);
  /* 각인 선택 */
  if (horde.waveLeft <= 0) { horde.waveLeft = HORDE_WAVE_MS; horde.wave++; hordePick(); }
  if (horde.left <= 0) { hordeEnd('clear'); return; }
  hordeHudUpdate();
}

/* 아레나 경계: 원 밖으로 나가지 못하게 */
function hordeConfine() {
  const dx = me.x - HORDE_C.x, dy = me.y - HORDE_C.y, d = Math.hypot(dx, dy);
  if (d > HORDE_R) { me.x = HORDE_C.x + dx / d * HORDE_R; me.y = HORDE_C.y + dy / d * HORDE_R; }
}

function drawHordeArena(now) {
  const p = .5 + Math.sin(now / 700) * .5;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgba(70,20,30,.55)'; /* 붉은 결계 안쪽 */
  ctx.beginPath(); ctx.rect(0, 0, WORLD.w, WORLD.h); ctx.arc(HORDE_C.x, HORDE_C.y, HORDE_R, 0, 7, true); ctx.fill('evenodd');
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = `rgba(255,${90 + p * 60},70,${.55 + p * .3})`;
  ctx.lineWidth = 4; ctx.setLineDash([26, 16]); ctx.lineDashOffset = -now / 26;
  ctx.beginPath(); ctx.arc(HORDE_C.x, HORDE_C.y, HORDE_R, 0, 7); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = `rgba(255,60,40,${.12 + p * .1})`; ctx.lineWidth = 26;
  ctx.beginPath(); ctx.arc(HORDE_C.x, HORDE_C.y, HORDE_R + 14, 0, 7); ctx.stroke();
  ctx.restore();
}

/* ---- 쇄도 UI ---- */
function hordeEl(id, cls, parent) {
  let el = document.getElementById(id);
  if (!el) { el = document.createElement('div'); el.id = id; if (cls) el.className = cls; (parent || document.body).appendChild(el); }
  return el;
}
function hordeHudShow(on) {
  const el = hordeEl('hordeHud');
  el.style.display = on ? 'block' : 'none';
  if (on) hordeHudUpdate();
}
function hordeHudUpdate() {
  if (!hordeOn()) return;
  const el = document.getElementById('hordeHud'); if (!el) return;
  const marks = Object.entries(horde.lv).map(([id, l]) => { const B = HORDE_BUFFS.find(b => b.id === id); return `<em title="${B.n} ${l} — ${esc(B.d(l))}">${B.ic}<b>${l}</b></em>`; }).join('');
  const sig = `${Math.round(horde.left / 1000)}|${horde.kills}|${marks.length}|${Math.round(horde.waveLeft / 500)}`;
  if (el._sig === sig) return; /* 매 프레임 DOM 쓰기 방지 */
  el._sig = sig;
  el.innerHTML = `<div class="hhTop"><b class="hhT">${hordeFmt(horde.left)}</b><span>웨이브 ${horde.wave}</span><span>처치 ${horde.kills}</span><span>💰${horde.gold}</span></div>`
    + `<div class="hhBar"><i style="width:${Math.max(0, Math.min(100, 100 - horde.waveLeft / HORDE_WAVE_MS * 100)).toFixed(1)}%"></i></div>`
    + `<div class="hhBuffs">${marks || '<span class="hhNone">각인 없음</span>'}</div>`;
}
function hordePick() {
  const pool = HORDE_BUFFS.filter(b => (horde.lv[b.id] || 0) < b.max);
  if (!pool.length) return;
  const pick = [];
  while (pick.length < Math.min(3, pool.length)) { const c = pool[Math.floor(Math.random() * pool.length)]; if (!pick.includes(c)) pick.push(c); }
  const el = hordeEl('hordePick');
  el.innerHTML = `<div class="hpBox"><h3>각인 선택 <small>웨이브 ${horde.wave}</small></h3><div class="hpCards">`
    + pick.map(b => { const nl = (horde.lv[b.id] || 0) + 1; return `<button class="hpCard" data-b="${b.id}"><i>${b.ic}</i><b>${b.n} ${nl}</b><span>${esc(b.d(nl))}</span></button>`; }).join('')
    + `</div></div>`;
  el.classList.add('open');
  sfx('levelup');
  el.querySelectorAll('.hpCard').forEach(btn => btn.onclick = () => {
    const B = HORDE_BUFFS.find(b => b.id === btn.dataset.b);
    if (B && horde) { horde.lv[B.id] = (horde.lv[B.id] || 0) + 1; horde.b[B.k] = (horde.b[B.k] || 0) + B.v; }
    el.classList.remove('open');
    sfx('buy');
    float(me.x, me.y - 44, `${B.ic} ${B.n} ${horde.lv[B.id]}`, '#ffd700', true);
    hordeHudUpdate();
  });
}
function hordeResult(r) {
  const el = hordeEl('hordeEnd');
  el.innerHTML = `<div class="heBox"><h3>${r.reason === 'clear' ? '🏆 쇄도 완주!' : '💀 쇄도 종료'}</h3>`
    + `<div class="heTime">${hordeFmt(r.survived)}${r.isBest ? ' <b>최고 기록!</b>' : ''}</div>`
    + `<ul><li>웨이브 <b>${r.wave}</b></li><li>처치 <b>${r.kills}</b></li><li>골드 <b>+${r.gold}</b></li><li>경험치 <b>+${r.exp}</b></li>`
    + (r.gems ? `<li>보석 <b>+${r.gems}</b> <small>(2분 단위 기록 갱신 보상)</small></li>` : '')
    + `</ul><button id="heClose">확인</button></div>`;
  el.classList.add('open');
  sfx(r.reason === 'clear' ? 'levelup' : 'die');
  el.querySelector('#heClose').onclick = () => { el.classList.remove('open'); sfx('click'); };
}
function renderHorde() {
  const body = document.getElementById('hordeBody'); if (!body) return;
  const rec = me.horde || {};
  const lv5 = (me.lv || 1) >= 5;
  body.innerHTML = `<div class="hdIntro">사방에서 몰려오는 적을 <b>10분</b> 동안 버팁니다. 30초마다 <b>각인</b> 3장 중 1장을 골라 그 판에서만 강해집니다.<br>평타는 <b>자동</b>으로 나갑니다 — 이동과 스킬에 집중하세요.</div>`
    + `<div class="hdRec"><div><span>최고 기록</span><b>${hordeFmt(rec.best || 0)}</b></div><div><span>최다 처치</span><b>${rec.kills || 0}</b></div><div><span>도전</span><b>${rec.runs || 0}회</b></div><div><span>완주</span><b>${rec.clears || 0}회</b></div></div>`
    + `<div class="hdRules"><li>몬스터·전리품은 서버에 기록하지 않아 저장 한도를 쓰지 않습니다</li><li>골드·경험치는 종료 시 합산 지급</li><li>2분마다 최고 기록을 갱신하면 보석 1개</li><li>쓰러져도 사망 패널티 없이 종료됩니다</li></div>`
    + `<button id="hdGo" class="hdGo" ${lv5 ? '' : 'disabled'}>${lv5 ? '🌀 입장' : 'Lv5부터 입장 가능'}</button>`;
  const go = document.getElementById('hdGo');
  if (go && lv5) go.onclick = () => { sfx('click'); hordeStart(); };
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

function drawHeldWeapon(cls, wid, c = ctx) {
  const it = wid ? getItem(wid) : null;
  const enh = (it && it._lv) || 0;
  if (enh >= 3) { /* 강화 무기 오라: +3 파랑 → +5 금색 → +7 붉은색 */
    c.shadowColor = enh >= 7 ? '#ff6b6b' : enh >= 5 ? '#ffd700' : '#7fc7ff';
    c.shadowBlur = 5 + enh * 1.2;
  }
  if (cls === 'warrior' || cls === 'rogue') {
    const bl = it ? it.color : (cls === 'rogue' ? '#aab4bd' : '#cdd5dd');
    const L = cls === 'warrior' ? 31 : 18;
    const W = cls === 'warrior' ? 2.7 : 2;
    c.fillStyle = '#4a3524';
    roundRect(c, -2.1, -1, 4.2, 8.5, 1.9); c.fill();
    c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
    c.fillStyle = '#d9b23c';
    c.beginPath(); c.arc(0, 8.6, 2.3, 0, 7); c.fill();
    c.strokeStyle = OL; c.stroke();
    c.fillStyle = '#d9b23c';
    roundRect(c, -6.2, -5.6, 12.4, 3.6, 1.7); c.fill();
    c.strokeStyle = OL; c.lineWidth = 1.1; c.stroke();
    c.fillStyle = '#e74c3c';
    c.beginPath(); c.arc(0, -3.8, 1.35, 0, 7); c.fill();
    if (wid === 'sword_flame') { c.shadowColor = '#ff7f27'; c.shadowBlur = 13; }
    const bg = c.createLinearGradient(-W, 0, W, 0);
    bg.addColorStop(0, shade(bl, .72)); bg.addColorStop(.45, shade(bl, 1.28)); bg.addColorStop(1, shade(bl, .85));
    c.fillStyle = bg;
    c.beginPath();
    c.moveTo(-W, -5);
    c.lineTo(-W, -L + 5.5);
    c.quadraticCurveTo(-W * .4, -L - .5, 0, -L - 2.2);
    c.quadraticCurveTo(W * .4, -L - .5, W, -L + 5.5);
    c.lineTo(W, -5);
    c.closePath(); c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = OL; c.lineWidth = 1.2; c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = .9;
    c.beginPath(); c.moveTo(0, -7.5); c.lineTo(0, -L + 6); c.stroke();
    if ((Date.now() % 2300) < 150) {
      c.fillStyle = '#fff';
      const sx = W * .6, sy = -L * .55;
      c.beginPath();
      c.moveTo(sx, sy - 4.2); c.lineTo(sx + 1.1, sy - 1.1); c.lineTo(sx + 4.2, sy);
      c.lineTo(sx + 1.1, sy + 1.1); c.lineTo(sx, sy + 4.2); c.lineTo(sx - 1.1, sy + 1.1);
      c.lineTo(sx - 4.2, sy); c.lineTo(sx - 1.1, sy - 1.1);
      c.closePath(); c.fill();
    }
  } else if (cls === 'archer') {
    c.strokeStyle = it ? it.color : '#7a5230';
    c.lineWidth = 3.6; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(-2, -15);
    c.quadraticCurveTo(9, -8, 10, 0);
    c.quadraticCurveTo(9, 8, -2, 15);
    c.stroke();
    c.strokeStyle = shade(it ? it.color : '#7a5230', .7);
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(-2, -15); c.quadraticCurveTo(5, -8, 6, 0);
    c.quadraticCurveTo(5, 8, -2, 15);
    c.stroke();
    c.lineCap = 'butt';
    c.strokeStyle = '#eee'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(-1.2, -14.4); c.lineTo(-1.2, 14.4); c.stroke();
    c.strokeStyle = '#d9b23c'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-3, -14); c.lineTo(-1, -15.5); c.stroke();
    c.beginPath(); c.moveTo(-3, 14); c.lineTo(-1, 15.5); c.stroke();
  } else if (cls === 'mage') {
    c.fillStyle = '#6b4a2f';
    roundRect(c, -2, -27, 4, 34, 2); c.fill();
    c.strokeStyle = OL; c.lineWidth = 1.2; c.stroke();
    c.strokeStyle = '#57391f'; c.lineWidth = 1;
    for (const yy of [-16, -6, 3]) {
      c.beginPath(); c.moveTo(-1.6, yy); c.lineTo(1.6, yy + 2); c.stroke();
    }
    const oc = it ? it.color : '#b388ff';
    c.shadowColor = oc; c.shadowBlur = 14 + (drawHeldWeapon.glow || 0) * 22;
    c.fillStyle = oc;
    c.beginPath(); c.arc(0, -30, 5, 0, 7); c.fill();
    c.fillStyle = shade(oc, 1.35);
    c.beginPath(); c.arc(-3.5, -33, 3, 0, 7); c.fill();
    c.beginPath(); c.arc(3.8, -33.5, 2.4, 0, 7); c.fill();
    c.fillStyle = 'rgba(255,255,255,.85)';
    c.beginPath(); c.arc(-1.2, -31.6, 1.5, 0, 7); c.fill();
    c.shadowBlur = 0;
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
      rows[11] = '....OTAAAAAAAATO....';
    }
    if (p) { pal.L = shade(p.color, 1.05); pal.l = shade(p.color, .45); }
    if (h) {
      pal.M = h.color; pal.m = shade(h.color, .55); pal.Q = shade(h.color, 1.55);
      rows[0] = '.......MMMMMM.......';
      rows[1] = '.....MMQQQQQQMM.....';
      rows[2] = '....OMMMMMMMMMMO....';
      rows[3] = '....OmmMMMMMMmmO....';
      rows[4] = '....OMMMMMMMMMMO....';
      rows[5] = '...OMMMMMMMMMMMMO...';
    }
    if (b) {
      pal.Z = b.color; pal.z = shade(b.color, .55);
      rows[22] = '...OOZZZZZZZZZZOO...';
      rows[23] = '...OOZZZZZZZZZZOO...';
      rows[24] = '..OOOZZZZ..ZZZZOOO..';
      rows[25] = '..OOOOOOO..OOOOOOO..';
    }
    SPRITE_DEFS[key] = { pal, rows };
  }
  return key;
}

/* ================= 히어로 20파츠 렌더러 (2D 정교화) =================
   기존 12x15 단일 스프라이트 1장을 20개 레이어 조합으로 교체:
   [01 그림자·본인링] [02 망토·화살통] [03 다리L] [04 다리R] [05 부츠L] [06 부츠R]
   [07 갑옷몸통] [08 어깨L] [09 어깨R] [10 자유팔L] [11 무기팔R(소매)]
   [12 장갑주먹] [13 얼굴] [14 눈·표식] [15 헤어·후드] [16 투구]
   [17 목걸이] [18 팔찌] [19 반지광택] [20 무기]
   ※ 01,12,18,19,20은 drawChar 본문에서 그림 (스윙 각도 wa·이펙트와 연결되므로) */
const HERO_SKIN = { warrior: '#f2c79a', archer: '#f0c49c', rogue: '#e8bd93', mage: '#f6cfa5' };
const HERO_CLOTH = { warrior: '#8a4b3c', archer: '#3f7a52', rogue: '#4d5a68', mage: '#6c3483' };
const HERO_HAIR = { warrior: '#5a3a26', archer: '#2e7d52', rogue: '#22303f', mage: '#4a235a' };
const heroEq = (eq, slot) => (eq && eq[slot] ? getItem(eq[slot]) : null);

function drawHero20(o, now, moving, fx, fy, bobY, c = ctx) {
  const cls = o.cls || 'warrior';
  const eq = o.equipped || {};
  const skin = HERO_SKIN[cls] || '#f2c79a';
  const skinD = shade(skin, .8);
  const hairC = HERO_HAIR[cls] || '#333';
  const armorIt = heroEq(eq, 'armor');
  const helmIt = heroEq(eq, 'helmet');
  const pantsIt = heroEq(eq, 'pants');
  const bootsIt = heroEq(eq, 'boots');
  const neckIt = heroEq(eq, 'necklace');
  const armorC = armorIt ? armorIt.color : HERO_CLOTH[cls];
  const armorD = shade(armorC, .58);
  const armorL = shade(armorC, 1.3);
  const trimC = armorIt ? (RARITY_COLOR[armorIt.rarity] || '#d9b23c') : '#c9b48a';
  const pantsC = pantsIt ? pantsIt.color : shade(HERO_CLOTH[cls], .75);
  const pantsD = shade(pantsC, .6);
  const bootsC = bootsIt ? bootsIt.color : '#4a3524';
  const bootsD = shade(bootsC, .55);
  const ph = (o.stepPh ?? now / 85);   /* 자캐: 이동거리 기반 위상(이동과 다리 동기) */
  const stepL = moving ? Math.sin(ph) * 4 : 0;
  const stepR = moving ? -Math.sin(ph) * 4 : 0;
  const armSw = moving ? -Math.sin(ph) * 3.5 : Math.sin(now / 600) * 1;
  const flutter = Math.sin(now / 300) * (moving ? 3 : 1.5);
  const isMage = cls === 'mage';
  const ex = (fx || 0) * 2.2;            /* 시선 방향으로 눈 이동 */
  const upFace = (fy || 0) < -.45;       /* 위를 볼 때 얼굴 살짝 위로 */
  const blink = (now % 3400) < 130;      /* ~3.4초마다 눈 깜빡임 */
  const helmName = helmIt ? (helmIt.name || '') : '';
  const helmId = eq.helmet || '';
  const isCrown = helmIt && (/왕관|크라운|crown/i.test(helmName) || String(helmId).includes('crown'));
  const helmC = helmIt ? helmIt.color : null;

  c.save();
  c.translate(0, -bobY);
  c.lineJoin = 'round'; c.lineCap = 'round';

  /* 02 망토 뒷면 (갑옷 어두운색, 걸으면 펄럭임) */
  c.fillStyle = armorD;
  c.beginPath();
  c.moveTo(-8, -32); c.lineTo(8, -32);
  c.lineTo(10 + flutter, 8); c.lineTo(-10 + flutter, 8);
  c.closePath(); c.fill();
  c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1; c.stroke();
  c.strokeStyle = shade(armorC, 1.1); c.lineWidth = 1.4;
  c.beginPath(); c.moveTo(0, -30); c.lineTo(flutter * .8, 6); c.stroke();

  /* 02-b 아처 화살통 (등 뒤) */
  if (cls === 'archer') {
    c.save();
    c.translate(9, -34); c.rotate(.35);
    c.fillStyle = '#6b4a2f';
    roundRect(c, -3.5, -4, 7, 18, 3); c.fill();
    c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
    for (let i = -1; i <= 1; i++) {
      c.strokeStyle = '#d9c8a9'; c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(i * 2, -4); c.lineTo(i * 2, -10); c.stroke();
      c.fillStyle = '#e74c3c';
      c.beginPath(); c.moveTo(i * 2 - 2, -10); c.lineTo(i * 2 + 2, -10); c.lineTo(i * 2, -13); c.closePath(); c.fill();
    }
    c.restore();
  }

  /* 03·04 다리 (마법사는 로브로 대체) */
  if (!isMage) {
    c.strokeStyle = pantsC; c.lineWidth = 7;
    c.beginPath(); c.moveTo(-5, -14); c.lineTo(-5 + stepL, 5); c.stroke();
    c.beginPath(); c.moveTo(5, -14); c.lineTo(5 + stepR, 5); c.stroke();
    c.strokeStyle = pantsD; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-5 - 2, -12); c.lineTo(-5 + stepL - 2, 4); c.stroke();
    c.beginPath(); c.moveTo(5 - 2, -12); c.lineTo(5 + stepR - 2, 4); c.stroke();
  } else {
    /* 마법사 로브 치마 (걸으면 흔들림) */
    c.fillStyle = armorC;
    c.beginPath();
    c.moveTo(-9, -14); c.lineTo(9, -14);
    c.lineTo(15 + flutter, 8); c.lineTo(-15 + flutter, 8);
    c.closePath(); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1; c.stroke();
    c.strokeStyle = trimC; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(-12 + flutter * .8, 5); c.lineTo(12 + flutter * .8, 5); c.stroke();
    c.strokeStyle = armorL; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -12); c.lineTo(flutter * .6, 4); c.stroke();
  }

  /* 05·06 부츠 (장착 색 반영 + 밑창 + 하이라이트) */
  const bootAt = (bx, by) => {
    c.fillStyle = bootsC;
    roundRect(c, bx - 4.5, by - 3, 9, 6.5, 2.5); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 1; c.stroke();
    c.fillStyle = bootsD;
    c.fillRect(bx - 4.5, by + 1.5, 9, 2);
    c.fillStyle = 'rgba(255,255,255,.28)';
    c.fillRect(bx - 4.5, by - 3, 9, 1.4);
    c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = .9;   /* 끈 디테일 */
    c.beginPath(); c.moveTo(bx - 1, by - 2); c.lineTo(bx - 1, by + 1); c.stroke();
    c.beginPath(); c.moveTo(bx + 1.5, by - 2); c.lineTo(bx + 1.5, by + 1); c.stroke();
  };
  if (!isMage) { bootAt(-5 + stepL, 6); bootAt(5 + stepR, 6); }
  else { bootAt(-6 + stepL * .4, 7); bootAt(6 + stepR * .4, 7); }

  /* 07 갑옷 몸통 (가슴판·벨트·등급트림·엠블럼) */
  c.fillStyle = armorC;
  roundRect(c, -11, -36, 22, 23, 5); c.fill();
  c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 1.2; c.stroke();
  c.fillStyle = armorL; c.globalAlpha = .55;
  roundRect(c, -8, -33.5, 16, 11, 3); c.fill();
  c.globalAlpha = 1;
  c.strokeStyle = trimC; c.lineWidth = 1.3; c.globalAlpha = .85;
  c.beginPath(); c.moveTo(-8, -32); c.lineTo(-8, -16); c.stroke();
  c.beginPath(); c.moveTo(8, -32); c.lineTo(8, -16); c.stroke();
  c.globalAlpha = 1;
  c.fillStyle = armorD;
  roundRect(c, -11, -16.5, 22, 4.5, 2); c.fill();   /* 벨트 */
  c.fillStyle = '#d9b23c';                              /* 버클 */
  roundRect(c, -2.5, -16, 5, 3.5, 1); c.fill();
  c.strokeStyle = OL; c.lineWidth = .8; c.stroke();
  c.fillStyle = '#e74c3c';                                /* 버클 보석 */
  c.beginPath(); c.arc(0, -14.2, 1.1, 0, 7); c.fill();
  c.fillStyle = 'rgba(255,255,255,.8)';
  c.beginPath(); c.arc(-.4, -14.6, .4, 0, 7); c.fill();
  if (armorIt && (armorIt.rarity === 'legend' || armorIt.rarity === 'unique')) {
    c.shadowColor = trimC; c.shadowBlur = 8;          /* 전설·유니크 엠블럼 */
    c.fillStyle = trimC;
    c.beginPath(); c.moveTo(0, -29); c.lineTo(3, -25); c.lineTo(0, -21); c.lineTo(-3, -25); c.closePath(); c.fill();
    c.shadowBlur = 0;
  }

  /* 08·09 어깨갑주 (전사는 크게+스파이크) */
  const bulky = cls === 'warrior';
  for (const s of [-1, 1]) {
    const px = s * (bulky ? 13 : 12), pr = bulky ? 7.5 : 6;
    c.fillStyle = armorC;
    c.beginPath(); c.arc(px, -32, pr, 0, 7); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 1.2; c.stroke();
    c.strokeStyle = trimC; c.lineWidth = 1.4;
    c.beginPath(); c.arc(px, -32, pr - 1.5, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.3)';
    c.beginPath(); c.arc(px - 2, -34.5, 1.4, 0, 7); c.fill();
    if (bulky) {
      c.fillStyle = armorD;
      c.beginPath(); c.moveTo(px + s * 2, -38); c.lineTo(px + s * 7, -40); c.lineTo(px + s * 3, -34); c.closePath(); c.fill();
    }
  }

  /* 10 자유팔L (걷기와 반대 위상으로 흔들림) + 손 */
  c.strokeStyle = shade(armorC, .85); c.lineWidth = 6;
  c.beginPath(); c.moveTo(-12, -29); c.lineTo(-14.5, -13 + armSw); c.stroke();
  c.fillStyle = skin;
  c.beginPath(); c.arc(-14.5, -11 + armSw, 3.1, 0, 7); c.fill();
  c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 1; c.stroke();

  /* 11 무기팔R 소매 (손·무기는 drawChar 본문의 wa 각도로 그림) */
  c.strokeStyle = shade(armorC, .85); c.lineWidth = 6;
  c.beginPath(); c.moveTo(12, -29); c.lineTo(15.5, -21); c.stroke();

  /* 15 헤어·후드 (투구 없을 때 직업 정체성) */
  if (!helmIt) {
    if (cls === 'archer' || cls === 'rogue') {
      c.fillStyle = hairC;                               /* 후드 */
      c.beginPath(); c.arc(0, -44, 10.5, Math.PI * .95, Math.PI * 2.05); c.fill();
      c.beginPath(); c.moveTo(-10, -44); c.lineTo(-12, -32); c.lineTo(-5, -36); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(10, -44); c.lineTo(12, -32); c.lineTo(5, -36); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1; c.stroke();
    } else if (cls === 'mage') {
      c.fillStyle = hairC;                               /* 챙 넓은 모자 */
      c.beginPath(); c.ellipse(0, -50, 13, 3.6, 0, 0, 7); c.fill();
      c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
      c.beginPath(); c.moveTo(-8, -50); c.lineTo(-2, -62); c.lineTo(6, -50); c.closePath(); c.fill();
      c.fillStyle = '#ffd700';
      c.beginPath(); c.arc(-2, -62, 1.6, 0, 7); c.fill();
    } else {
      c.fillStyle = hairC;                               /* 전사 짧은 머리 */
      c.beginPath(); c.arc(0, -45, 8.6, Math.PI, 0); c.fill();
      c.fillRect(-8.6, -45, 3, 6); c.fillRect(5.6, -45, 3, 6);
    }
  }

  /* 13 얼굴 베이스 + 목 */
  c.fillStyle = skinD;
  c.fillRect(-3, -38, 6, 5);
  c.fillStyle = skin;
  c.beginPath(); c.ellipse(0, -44, 8, 9, 0, 0, 7); c.fill();
  c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1; c.stroke();
  c.fillStyle = skinD; c.globalAlpha = .5;
  c.beginPath(); c.ellipse(0, -38.5, 5.5, 3, 0, 0, Math.PI); c.fill();
  c.globalAlpha = 1;

  /* 14 눈·표식 (방향주시·깜빡임·직업 문신/상처/복면) */
  const eyY = -45 + (upFace ? -1.5 : 0);
  if (cls === 'rogue') {
    c.fillStyle = '#1a2530';                             /* 복면 */
    roundRect(c, -8, -48.5, 16, 6.5, 3); c.fill();
    c.fillStyle = '#e8e4d8';
    if (blink) { c.fillRect(-5 + ex, eyY - .5, 3.4, 1); c.fillRect(1.6 + ex, eyY - .5, 3.4, 1); }
    else { c.beginPath(); c.arc(-3.2 + ex, eyY, 1.7, 0, 7); c.fill(); c.beginPath(); c.arc(3.2 + ex, eyY, 1.7, 0, 7); c.fill(); }
  } else {
    if (cls === 'archer') {
      c.strokeStyle = '#1e5c3a'; c.lineWidth = 1.4;    /* 페이스 페인트 */
      c.beginPath(); c.moveTo(-6.5 + ex, eyY + 3); c.lineTo(-1.5 + ex, eyY + 3); c.stroke();
      c.beginPath(); c.moveTo(1.5 + ex, eyY + 3); c.lineTo(6.5 + ex, eyY + 3); c.stroke();
    }
    if (cls === 'warrior') {
      c.strokeStyle = 'rgba(160,60,50,.8)'; c.lineWidth = 1.2;  /* 뺨 상처 */
      c.beginPath(); c.moveTo(-6 + ex, -42); c.lineTo(-3.5 + ex, -38.5); c.stroke();
    }
    c.fillStyle = '#1a1d24';
    if (blink) { c.fillRect(-5.5 + ex, eyY, 4, 1.2); c.fillRect(1.5 + ex, eyY, 4, 1.2); }
    else {
      c.beginPath(); c.ellipse(-3.5 + ex, eyY, 1.9, 2.4, 0, 0, 7); c.fill();
      c.beginPath(); c.ellipse(3.5 + ex, eyY, 1.9, 2.4, 0, 0, 7); c.fill();
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(-3 + ex, eyY - .8, .7, 0, 7); c.fill();
      c.beginPath(); c.arc(4 + ex, eyY - .8, .7, 0, 7); c.fill();
    }
    c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = 1.2;  /* 입 */
    c.beginPath(); c.moveTo(-1.8 + ex * .5, -38.5); c.lineTo(1.8 + ex * .5, -38.5); c.stroke();
  }

  /* 16 투구 (장착 시: 왕관 / 풀헬름 / 캡 3종 실루엣) */
  if (helmIt && helmC) {
    const helmD = shade(helmC, .6), helmL = shade(helmC, 1.35);
    if (isCrown) {
      c.fillStyle = helmC;
      roundRect(c, -8, -55.5, 16, 5.5, 2); c.fill();
      c.strokeStyle = OL; c.lineWidth = 1; c.stroke();
      for (const sx of [-6, 0, 6]) {
        c.beginPath(); c.moveTo(sx - 2.4, -55.5); c.lineTo(sx, -60.5); c.lineTo(sx + 2.4, -55.5); c.closePath(); c.fill();
        c.stroke();
      }
      c.fillStyle = '#e74c3c'; c.beginPath(); c.arc(-4, -53, 1.5, 0, 7); c.fill();
      c.fillStyle = '#3498db'; c.beginPath(); c.arc(0, -53, 1.5, 0, 7); c.fill();
      c.fillStyle = '#2ecc71'; c.beginPath(); c.arc(4, -53, 1.5, 0, 7); c.fill();
      c.fillStyle = helmL; c.fillRect(-8, -55.5, 16, 1.4);
    } else if ((helmIt.def || 0) >= 3) {
      c.fillStyle = helmC;                               /* 돔 */
      c.beginPath(); c.arc(0, -45.5, 9.2, Math.PI * .98, Math.PI * 2.02); c.fill();
      c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 1.1; c.stroke();
      c.fillStyle = helmL;                               /* 정수리 하이라이트 */
      c.beginPath(); c.arc(-2.5, -52, 3.4, Math.PI, Math.PI * 1.7); c.fill();
      c.fillStyle = helmD;                               /* 볼 가드 */
      c.fillRect(-9.5, -47, 3, 8); c.fillRect(6.5, -47, 3, 8);
      c.fillStyle = helmD;                               /* 코 가드 */
      c.fillRect(-.8, -47, 1.6, 7);
    } else {
      c.fillStyle = helmC;                               /* 캡·두건 */
      c.beginPath(); c.arc(0, -46, 8.8, Math.PI * .95, Math.PI * 2.05); c.fill();
      c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 1.1; c.stroke();
      c.fillStyle = helmD;
      roundRect(c, -8.8, -49.5, 17.6, 3.4, 1.7); c.fill();
      c.fillStyle = helmL; c.fillRect(-8.8, -49.5, 17.6, 1.2);
    }
  }

  /* 17 목걸이 (체인+보석, 장착 시 색 반영) */
  c.strokeStyle = 'rgba(217,178,60,.8)'; c.lineWidth = 1.2;
  c.beginPath(); c.arc(0, -30, 7.5, Math.PI * .25, Math.PI * .75); c.stroke();
  if (neckIt) {
    const gemC = neckIt.color || '#e74c3c';
    if ((neckIt.rarity === 'epic' || neckIt.rarity === 'unique' || neckIt.rarity === 'legend')) { c.shadowColor = gemC; c.shadowBlur = 7; }
    c.fillStyle = gemC;
    c.beginPath(); c.moveTo(0, -25.5); c.lineTo(2.8, -22); c.lineTo(0, -18.5); c.lineTo(-2.8, -22); c.closePath(); c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = OL; c.lineWidth = .8; c.stroke();
    c.fillStyle = 'rgba(255,255,255,.85)';
    c.beginPath(); c.arc(-.8, -22.5, .8, 0, 7); c.fill();
  }

  c.restore();
}

/* 무기·장갑·팔찌·반지 (drawChar + 로그인 초상화 공용) */
function drawHeroGear(o, eq, now, face, c = ctx) {
  if (o.dead) return;
  const sw = o.swing ? (now - o.swing) / 220 : -1;
  const baseA = face + .55;
  /* 휴식 자세는 화면 위쪽으로(위협적이지 않게) — 이동 방향을 따라가면 검이 땅을 찌르고 지팡이가 거꾸로 됨 */
  const restA = -Math.PI / 2 + .32 + Math.sin(now / 320) * .07;
  /* 휘두르기 시작 25%는 휴식→타격호 진입 블렌드 (뚝 끊김 방지) */
  const isStaff = (o.cls === 'mage');
  /* 지팡이는 세워 쥔다: 로컬 -y(=위)가 화면 위를 향하도록 회전각 ≈ 0. 기존 restA(-90°)는 지팡이를 가로로 눕혔다 */
  const staffRest = .12 + Math.sin(now / 900) * .05;
  const castT = (o.castFx && now - o.castFx.t0 < o.castFx.dur) ? (now - o.castFx.t0) / o.castFx.dur : -1;
  let wa;
  if (isStaff) {
    if (castT >= 0) wa = staffRest - Math.sin(castT * Math.PI) * .55;      /* 시전: 지팡이를 앞으로 들어올림 */
    else if (sw >= 0 && sw < 1) wa = staffRest - Math.sin(sw * Math.PI) * .8; /* 평타: 짧게 내려침 */
    else wa = staffRest;
  } else {
    wa = sw >= 0 && sw < 1
      ? (sw < .25 ? restA + (baseA - 1.5 - restA) * (sw / .25) : baseA - 1.5 + sw * 2.6)
      : restA;
  }
  /* 지팡이 손 위치: 몸 옆 고정(회전 반경으로 손이 돌면 지팡이가 몸에서 떨어져 보임) */
  const hx = isStaff ? 11 : Math.cos(wa) * 17; /* 좌우 반전은 캔버스가 처리 — 여기서 부호를 바꾸면 반대편에 붙는다 */
  const hy = isStaff ? -18 : Math.sin(wa) * 17 + 2;
  /* 무기팔 연결: 어깨→손을 팔로 이어 무기(지팡이) 분리감 제거 */
  {
    const shx = Math.cos(face) < -.05 ? -12 : 12;
    const armorC = eq.armor ? getItem(eq.armor).color : ((typeof HERO_CLOTH !== 'undefined' && HERO_CLOTH[o.cls]) || '#6b7480');
    limb(c, shx, -29, hx, hy, 5.5, shade(armorC, .85));
  }
  if (eq.gloves) {
    c.fillStyle = getItem(eq.gloves).color;
    c.beginPath(); c.arc(hx, hy, 3.4, 0, 7); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 1; c.stroke();
  }
  c.save();
  c.translate(hx, hy);
  c.rotate(wa);
  drawHeldWeapon.glow = castT >= 0 ? Math.sin(castT * Math.PI) : 0;
  drawHeldWeapon(o.cls, eq.weapon, c);
  drawHeldWeapon.glow = 0;
  c.restore();
  if (sw >= 0 && sw < 1 && !isStaff) {
    c.strokeStyle = `rgba(255,255,255,${.55 * (1 - sw)})`;
    c.lineWidth = 3.5;
    const aa = baseA - 1.2 + sw * 2.6;
    c.beginPath(); c.arc(0, 0, 26, aa - .55, aa + .55); c.stroke();
  }
  if (eq.bracelet) {
    c.fillStyle = getItem(eq.bracelet).color;
    c.beginPath(); c.arc(Math.cos(baseA) * 13, Math.sin(baseA) * 13 + 6, 2, 0, 7); c.fill();
  }
  if (eq.ring) { /* 반지: 무기 손 근처 글린트 */
    const tw = .6 + Math.sin(now / 260) * .4;
    c.fillStyle = getItem(eq.ring).color;
    c.globalAlpha = .55 + tw * .45;
    c.beginPath(); c.arc(hx + 2.5, hy - 2.5, 1.6, 0, 7); c.fill();
    c.globalAlpha = 1;
  }
}

/* 로그인용 초상화: 실제 게임 렌더러(drawHero20+Gear)로 뽑은 dataURL — 게임 속 모습 그대로 */
const PORTRAIT_GEAR = {
  warrior: { weapon: 'sword_flame', armor: 'armor_plate', helmet: 'crown_gold', pants: 'pants_plate', gloves: 'gloves_steel', boots: 'boots_wind', bracelet: 'bracelet_jade', necklace: 'necklace_ruby', ring: 'ring_shadow' },
  archer:  { weapon: 'bow_storm', armor: 'armor_leather', helmet: 'cap_leather', pants: 'pants_leather', gloves: 'gloves_leather', boots: 'boots_wind', bracelet: 'bracelet_jade', necklace: 'necklace_ruby', ring: 'ring_leather' },
  rogue:   { weapon: 'dagger_shadow', armor: 'armor_leather', helmet: 'cap_leather', pants: 'pants_leather', gloves: 'gloves_leather', boots: 'boots_wind', bracelet: 'bracelet_wood', necklace: 'necklace_copper', ring: 'ring_shadow' },
  mage:    { weapon: 'staff_flame', armor: 'armor_plate', helmet: 'crown_slime', pants: 'pants_plate', gloves: 'gloves_steel', boots: 'boots_wind', bracelet: 'bracelet_jade', necklace: 'necklace_ruby', ring: 'orb_lich' },
};
/* 캐릭터별 20프레임: 걷기8 + 휴식4 + 공격6 + 피격1 + 쓰러짐1
   벡터로 미리 굽고 매 프레임 drawImage로 재생 — 부드럽고 빠름 */
/* ===== VARCO 베이크 시트 (tools/bake.html → assets/sprites/<key>.png/.json) =====
   8방향 × 1프레임 정적 시트. 걷기/공격/피격/사망 연출은 drawChar의 캔버스 변환(바운스·스웨이·런지·회전)으로 처리.
   시트가 없거나 아직 로드 전이면 null → 기존 벡터 20프레임으로 폴백 */
const HERO_SHEETS = {}, SHEET_VER = 6; /* v6: 배경 프롭 재베이크(넓은 모델 정규화 수정) */
const HERO_SHEET_H = 118; /* 시트 알파 박스(치켜든 무기 끝 포함)의 화면 높이(px). 몸통만 치면 ≈ 75~95px — 벡터 영웅(≈58px)보다 큼 */
/* 매니페스트(있는 시트 키 목록)를 먼저 읽어, 없는 키(스켈레톤·오크 등)는 요청하지 않는다 — 404 소음·모바일 요청 낭비 제거.
   매니페스트가 없으면(구버전 배포) 예전처럼 직접 시도 */
let sheetManifest = null; /* null=로딩 전, Set=목록, false=없음 */
const sheetManifestP = fetch(`assets/sprites/manifest.json?v=${SHEET_VER}`).then(r => r.ok ? r.json() : Promise.reject())
  .then(list => { sheetManifest = new Set(list); }).catch(() => { sheetManifest = false; })
  .finally(() => { try {
    if (sheetManifest) for (const k of PROP_KEYS) propSheet(k); /* 배경 프롭 프리로드(52개·총 0.4MB) */
    for (const k of ['warrior', 'archer', 'rogue', 'mage']) { if (sheetManifest && sheetManifest.has(k)) heroSheet(k); /* 시트 로드 → 로드 완료 시 초상화 교체 */
      else { const el = document.querySelector(`#loginScreen .lp[data-cls="${k}"] img`); if (el) el.src = heroPortrait(k); } }
  } catch (e) {} });
function loadSheet(key, e) {
  fetch(`assets/sprites/${key}.json?v=${SHEET_VER}`).then(r => r.ok ? r.json() : Promise.reject(r.status)).then(meta => {
    const img = new Image();
    img.onload = () => {
      if (innerWidth <= 640 && meta.fr > 256) { /* 모바일: 시트 절반 해상도 — 9장 72MB가 인앱 브라우저 메모리를 압박했다 */
        try {
          const k = .5, c = document.createElement('canvas');
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height);
          meta = { ...meta, fr: meta.fr * k, top: meta.top * k, feet: meta.feet * k };
          e.img = c; e.meta = meta;
        } catch (err) { e.img = img; e.meta = meta; }
      } else { e.img = img; e.meta = meta; }
      if (key.startsWith('mob_')) { try { evictSheets(); } catch (e2) {} if ($('dexPanel')?.classList.contains('open')) { try { renderDex(); } catch (err) {} } } /* 로드 후 상한 초과분 제거 + 열린 도감 갱신 */
      if (key.startsWith('prop_')) { try { onPropLoaded(); } catch (e3) {} } /* 배경 프롭 도착 → 현재 구역 지형 재구움 */
      if (!key.startsWith('mob_')) { /* 로그인 초상화가 벡터로 먼저 그려졌으면 시트로 교체 */
        delete portraitCache[key];
        const pel = document.querySelector(`#loginScreen .lp[data-cls="${key}"] img`);
        if (pel) { try { pel.src = heroPortrait(key); } catch (err) {} }
        for (const aid of ['lgArt', 'crArt']) { const a = document.getElementById(aid); if (a && a.dataset.cls === key) { try { setTitleArt(aid, key); } catch (err) {} } } /* 타이틀 대형 아트 */
      }
    };
    img.onerror = () => { e.failed = true; };
    img.src = `assets/sprites/${key}.png?v=${SHEET_VER}`;
  }).catch(() => { e.failed = true; });
}
const SHEET_MOBILE = innerWidth <= 640;
const SHEET_CAP = SHEET_MOBILE ? 12 : 999; /* 모바일: 로드된 몹 시트 상한 — 초과 시 최근 미사용분 제거(누적 메모리로 Safari 텍스처 스래싱 방지) */
function evictSheets() {
  if (!SHEET_MOBILE) return;
  const now = Date.now();
  let mob = Object.keys(HERO_SHEETS).filter(k => k.startsWith('mob_') && HERO_SHEETS[k] && HERO_SHEETS[k].img);
  if (mob.length <= SHEET_CAP) return;
  mob.sort((a, b) => (HERO_SHEETS[a].used || 0) - (HERO_SHEETS[b].used || 0)); /* 오래 안 쓴 순 */
  for (const k of mob) {
    if (Object.keys(HERO_SHEETS).filter(x => x.startsWith('mob_') && HERO_SHEETS[x] && HERO_SHEETS[x].img).length <= SHEET_CAP) break;
    if (now - (HERO_SHEETS[k].used || 0) < 4000) continue; /* 최근 4초 내 화면에 그려진 시트는 유지 */
    delete HERO_SHEETS[k]; /* 다음 조회 시 필요하면 재로드 */
  }
}
function heroSheet(key) {
  let e = HERO_SHEETS[key];
  if (e === undefined) {
    e = HERO_SHEETS[key] = { img: null, meta: null, failed: false };
    if (sheetManifest === null) sheetManifestP.then(() => { if (sheetManifest && !sheetManifest.has(key)) e.failed = true; else loadSheet(key, e); });
    else if (sheetManifest && !sheetManifest.has(key)) e.failed = true;
    else loadSheet(key, e);
  }
  if (e.img) e.used = Date.now(); /* LRU 타임스탬프 */
  return e.img ? e : null;
}
/* face 각도(0=오른쪽, π/2=아래) → 시트 방향 인덱스 0..7 */
const sheetDir = face => ((Math.round(face / (Math.PI / 4)) % 8) + 8) % 8;
window.__ZONES = () => { const out = []; for (let n = 1; n <= MAX_PAGE; n++) { const pd = pageDef(n); for (const k of [...pd.kinds, pd.boss]) out.push({ n, name: k.name, base: k.base, hue: k.hue, boss: k === pd.boss }); } return out; }; /* 진단: 300종 목록 */
window.__SHEETS = () => Object.fromEntries(Object.entries(HERO_SHEETS).map(([k, v]) => [k, v.img ? 'ok' : v.failed ? 'failed' : 'loading'])); /* 스테이지 모드에서도 쓰는 진단 훅 */
/* ===== VARCO 몬스터 시트 =====
   키 'mob_<base>'. 시트가 없으면 false → 호출부가 기존 픽셀 스프라이트로 폴백.
   팔레트 변종(레드 슬라임·서리늑대 등)은 베이스 kind 색과의 색조(hue) 차이만큼 hue-rotate 필터로 재현 */
const MOB_SHEET_H = { slime: 3.4, goblin: 4.4, wolf: 3.8, skeleton: 4.6, orc: 4.4, lich: 4.4 }; /* 반경 r 대비 화면 높이 배수 */
function hueOf(hex) {
  const [r, g, b] = hexToRgb3(hex).map(v => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 1e-4) return 0;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
}
const _mobHueCache = {};
function mobHueShift(s, base) {
  if (!s.kind) return 0;
  if (_mobHueCache[s.kind] !== undefined) return _mobHueCache[s.kind];
  const kk = mobKindByName(s.kind), bk = Object.values(KINDS).find(k => k.base === base);
  let dh = 0;
  if (kk && typeof kk.hue === 'number') dh = kk.hue; /* 구역 변형: 지정 색조 */
  else if (kk && bk && kk !== bk) { dh = hueOf(kk.main) - hueOf(bk.main); if (dh > 180) dh -= 360; if (dh < -180) dh += 360; if (Math.abs(dh) < 8) dh = 0; }
  return (_mobHueCache[s.kind] = Math.round(dh));
}
/* 애니메이션 시트 행 선택: meta.states = { idle:{row,n}, walk, attack, hurt, death } (없으면 단일 행 0) */
function sheetRow(m, s, now) {
  const st = m.states;
  if (!st) return 0;
  const pick = (name, fps, once) => {
    const info = st[name] || st.idle; if (!info) return 0;
    const t0 = once ? (s[once] || now) : 0;
    let i = Math.floor((now - t0) / (1000 / fps));
    i = once ? Math.min(info.n - 1, Math.max(0, i)) : ((i % info.n) + info.n) % info.n;
    return info.row + i;
  };
  if (!s.alive) return pick('death', 8, 'deadT');
  if (s.hitFlash && now - s.hitFlash < 260 && st.hurt) return pick('hurt', 8, 'hitFlash');
  if (s.atkAnimT && now - s.atkAnimT < 520 && st.attack) return pick('attack', 12, 'atkAnimT');
  if (s.movingF && st.walk) return pick('walk', 9);
  return pick('idle', 4);
}
/* 색조 변형 시트 캐시 (base|hue → 캔버스). 구역당 최대 3종이라 LRU 6장이면 충분. Safari(캔버스 filter 미지원)는 원본 반환 */
const hueSheetCache = new Map();
function hueSheet(base, sh, dh) {
  const key = base + '|' + dh;
  let c = hueSheetCache.get(key);
  if (c) { hueSheetCache.delete(key); hueSheetCache.set(key, c); return c; }
  try {
    c = document.createElement('canvas'); c.width = sh.img.width; c.height = sh.img.height;
    const g = c.getContext('2d');
    if (!('filter' in g)) return sh.img;
    g.filter = `hue-rotate(${dh}deg)`; g.drawImage(sh.img, 0, 0);
  } catch (e) { return sh.img; }
  hueSheetCache.set(key, c);
  while (hueSheetCache.size > 6) hueSheetCache.delete(hueSheetCache.keys().next().value);
  return c;
}
/* 외곽선 텍스트: shadowBlur 텍스트는 글자마다 블러 패스를 돌려 모바일에서 프레임을 깎았다 → 스트로크 1회로 대체 */
function outlinedText(txt, x, y, w = 3, col = 'rgba(0,0,0,.85)') {
  ctx.lineJoin = 'round'; ctx.lineWidth = w; ctx.strokeStyle = col; ctx.strokeText(txt, x, y); ctx.fillText(txt, x, y);
}
function drawMobSheet(s, base, x, y, opts = {}) {
  const sh = heroSheet('mob_' + base);
  if (!sh) return false;
  const m = sh.meta, F = m.fr, d = sheetDir(s.dirA ?? Math.PI / 2), row = sheetRow(m, s, Date.now());
  const H = r0(s) * (MOB_SHEET_H[base] || ROLE_SHEET_H[(MOB_MODELS[base] || {}).role] || 4.2), k = H / Math.max(1, m.feet - m.top);
  ctx.save();
  ctx.translate(x, y - (opts.bob || 0));
  if (opts.squashX || opts.squashY) ctx.scale(opts.squashX || 1, opts.squashY || 1);
  const dh = mobHueShift(s, base);
  const src = dh ? hueSheet(base, sh, dh) : sh.img; /* 색조 변형은 시트 단위로 1회 구워 캐시 — 매 프레임 ctx.filter는 모바일 GPU에 가장 비싼 연산이었다 */
  if (opts.flash) ctx.globalAlpha = 1 - opts.flash * .6;
  ctx.drawImage(src, d * F, row * F, F, F, -F * k / 2, -m.feet * k, F * k, F * k);
  ctx.restore();
  return true;
}
const FR_WALK = 8, FR_IDLE = 4, FR_ATK = 6;
const frameCache = new Map();
function heroFrames(cls, eq, faceBake = Math.PI / 2) {
  const key = cls + '|' + faceBake.toFixed(2) + '|' + JSON.stringify(eq || {});
  let set = frameCache.get(key);
  if (set) { frameCache.delete(key); frameCache.set(key, set); return set; } /* LRU */
  set = bakeHeroFrames(cls, eq || {}, faceBake);
  frameCache.set(key, set);
  while (frameCache.size > (innerWidth <= 640 ? 2 : 6)) frameCache.delete(frameCache.keys().next().value); /* 세트당 ≈12MB */
  return set;
}
/* 베이크 후처리: 실루엣 외곽선 + 상하 라이팅 + 좌상단 림라이트.
   프레임을 굽는 시점에 한 번만 도는 패스라 런타임 비용 없이 입체감을 올린다 */
const _silCv = document.createElement('canvas'), _outCv = document.createElement('canvas');
function heroPostFx(src) {
  const W = src.width, H = src.height, k = W / 192; /* 논리 192 기준 배율 */
  _silCv.width = W; _silCv.height = H;
  _outCv.width = W; _outCv.height = H;
  const sc = _silCv.getContext('2d'), oc = _outCv.getContext('2d');
  /* 1) 실루엣을 8방향으로 번져 외곽선 */
  sc.clearRect(0, 0, W, H);
  sc.drawImage(src, 0, 0);
  sc.globalCompositeOperation = 'source-in';
  sc.fillStyle = '#0b0e14';
  sc.fillRect(0, 0, W, H);
  sc.globalCompositeOperation = 'source-over';
  const t = Math.max(1, Math.round(1.6 * k));
  oc.clearRect(0, 0, W, H);
  oc.globalAlpha = .85;
  for (let i = 0; i < 8; i++) {
    const a2 = i * Math.PI / 4;
    oc.drawImage(_silCv, Math.round(Math.cos(a2) * t), Math.round(Math.sin(a2) * t));
  }
  oc.globalAlpha = 1;
  oc.drawImage(src, 0, 0);
  /* 2) 상하 라이팅 (머리쪽 밝게, 발쪽 어둡게) — 몸 픽셀에만 */
  oc.globalCompositeOperation = 'source-atop';
  const g = oc.createLinearGradient(0, 40 * k, 0, 132 * k);
  g.addColorStop(0, 'rgba(255,246,225,.26)');
  g.addColorStop(.45, 'rgba(255,255,255,.04)');
  g.addColorStop(1, 'rgba(0,0,0,.30)');
  oc.fillStyle = g;
  oc.fillRect(0, 0, W, H);
  /* 3) 좌상단 림라이트 */
  const rg = oc.createRadialGradient(66 * k, 52 * k, 4 * k, 66 * k, 52 * k, 62 * k);
  rg.addColorStop(0, 'rgba(190,220,255,.22)');
  rg.addColorStop(1, 'rgba(190,220,255,0)');
  oc.fillStyle = rg;
  oc.fillRect(0, 0, W, H);
  oc.globalCompositeOperation = 'source-over';
  /* 결과를 새 캔버스로 복사 (재사용 버퍼라 그대로 돌려주면 다음 프레임이 덮어쓴다) */
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  out.getContext('2d').drawImage(_outCv, 0, 0);
  return out;
}
function bakeFrame(cls, eq, face, oExtra, tBake, squash, rot) {
  const S = 192, OX = 96, OY = 129; /* 논리 192 박스 — 화면에는 200px로 블릿 */
  const BK = Math.min(3, Math.max(2, Math.round(dpr || 1))); /* 백버퍼 픽셀비만큼 슈퍼샘플 (최소 2배) */
  const cv2 = document.createElement('canvas');
  cv2.width = S * BK; cv2.height = S * BK;
  const c = cv2.getContext('2d');
  c.scale(BK, BK);
  c.translate(OX, OY);
  if (rot) c.rotate(rot);
  if (squash) c.scale(squash[0], squash[1]);
  const oBake = { cls, equipped: eq, face, moving: false, stepPh: 0, ...oExtra };
  const fx = Math.cos(face), fy = Math.sin(face);
  if (fx < -.05) c.scale(-1, 1);
  drawHero20(oBake, tBake, !!oBake.moving, fx, fy, 0, c);
  drawHeroGear(oBake, eq, tBake, face, c);
  return heroPostFx(cv2);
}
function bakeHeroFrames(cls, eq, face) {
  const walk = [], idle = [], atk = [];
  for (let i = 0; i < FR_WALK; i++)
    walk.push(bakeFrame(cls, eq, face, { moving: true, stepPh: (i + .5) / FR_WALK * Math.PI * 2 }, 1000));
  for (let i = 0; i < FR_IDLE; i++)
    idle.push(bakeFrame(cls, eq, face, {}, i * 300 + 150));
  for (let k = 0; k < FR_ATK; k++) {
    const t = 1000;
    atk.push(bakeFrame(cls, eq, face, { swing: t - (k + .5) / FR_ATK * 220 }, t));
  }
  const hurt = bakeFrame(cls, eq, face, {}, 1000, [1.18, .84]);
  const dead = bakeFrame(cls, eq, face, {}, 1000, null, Math.PI / 2);
  /* 머리 꼭대기(논리 px, 발=129 기준 위로 양수): 첫 불투명 행을 찾아 이름표를 스프라이트 바로 위에 붙인다 */
  let top = 100;
  try {
    const f0 = idle[0], k = f0.width / 192, d = f0.getContext('2d').getImageData(0, 0, f0.width, f0.height).data;
    outer: for (let y = 0; y < f0.height; y++) for (let x = 0; x < f0.width; x += 2) {
      if (d[(y * f0.width + x) * 4 + 3] > 40) { top = 129 - y / k; break outer; }
    }
  } catch (e) {}
  return { walk, idle, atk, hurt, dead, top };
}
const portraitCache = {};
function heroPortrait(cls) {
  if (portraitCache[cls]) return portraitCache[cls];
  const eq = PORTRAIT_GEAR[cls] || {};
  const sh0 = heroSheet(cls);
  /* 벡터 20프레임 베이크는 세트당 ≈12MB — 시트가 있거나(또는 매니페스트 확인 전이면) 굽지 않는다.
     매니페스트가 '시트 없음'으로 확정된 직업만 벡터로 그린다 */
  const needVector = !sh0 && sheetManifest !== null && !(sheetManifest && sheetManifest.has(cls));
  const set = needVector ? heroFrames(cls, eq, -1.1) : null;
  const W = 150, H = 150;
  const cv2 = document.createElement('canvas');
  cv2.width = W; cv2.height = H;
  const c = cv2.getContext('2d');
  const g = c.createRadialGradient(W / 2, 70, 6, W / 2, 70, 78);
  g.addColorStop(0, 'rgba(255,215,0,.30)');
  g.addColorStop(1, 'rgba(255,215,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(0,0,0,.4)';
  c.beginPath(); c.ellipse(W / 2, 104, 30, 9, 0, 0, 7); c.fill();
  const sh = heroSheet(cls); /* 아직 로드 전이면 벡터로 그리고, 로드되면 loadSheet가 초상화를 다시 만든다 */
  if (sh) {
    const m = sh.meta, F = m.fr, k = 118 / Math.max(1, m.feet - m.top); /* 발 y=108, 시트 박스 높이 118 */
    c.drawImage(sh.img, 2 * F, 0, F, F, W / 2 - F * k / 2, 108 - m.feet * k, F * k, F * k);
  } else if (set) {
    c.drawImage(set.walk[2], 11, 11, 128, 128);
  } else { /* 시트 로딩 중 플레이스홀더: 직업 아이콘 — loadSheet가 완료되면 초상화를 다시 만든다 */
    c.font = '54px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText((CLASSES[cls] && CLASSES[cls].icon) || '✦', W / 2, 74);
  }
  const url = cv2.toDataURL();
  if (sh || set) portraitCache[cls] = url; /* 플레이스홀더는 캐시하지 않음 */
  return url;
}

/* 타이틀 화면용 대형 영웅 아트 (640px): 시트의 정면 프레임을 크게 + 직업색 림라이트·후광·바닥 그림자 */
const heroArtCache = {};
function heroArt(cls) {
  if (heroArtCache[cls]) return heroArtCache[cls];
  const sh = heroSheet(cls);
  if (!sh) return null;
  const col = (CLASSES[cls] && CLASSES[cls].color) || '#ffd700';
  const S = 640, cv2 = document.createElement('canvas'); cv2.width = S; cv2.height = S;
  const c = cv2.getContext('2d');
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  const m = sh.meta, F = m.fr, k = 520 / Math.max(1, m.feet - m.top);
  const dx = S / 2 - F * k / 2, dy = 560 - m.feet * k;
  /* 후광 */
  const rgb = hexRgb(col);
  const g = c.createRadialGradient(S / 2, 330, 10, S / 2, 330, 318);
  g.addColorStop(0, `rgba(${rgb},.30)`); g.addColorStop(.4, `rgba(${rgb},.12)`); g.addColorStop(.75, `rgba(${rgb},.03)`); g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  /* 바닥 그림자 */
  c.fillStyle = 'rgba(0,0,0,.55)'; c.beginPath(); c.ellipse(S / 2, 566, 150, 26, 0, 0, 7); c.fill();
  /* 뒤쪽 실루엣 글로우 */
  c.save(); c.filter = 'blur(16px)'; c.globalAlpha = .35;
  const sil = document.createElement('canvas'); sil.width = S; sil.height = S;
  const sg = sil.getContext('2d'); sg.drawImage(sh.img, 2 * F, 0, F, F, dx, dy, F * k, F * k); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = col; sg.fillRect(0, 0, S, S);
  c.drawImage(sil, 0, 0); c.restore();
  /* 본체 */
  c.drawImage(sh.img, 2 * F, 0, F, F, dx, dy, F * k, F * k);
  /* 림라이트: 우상단에서 직업색 */
  const body = document.createElement('canvas'); body.width = S; body.height = S;
  const bg = body.getContext('2d'); bg.drawImage(sh.img, 2 * F, 0, F, F, dx, dy, F * k, F * k); bg.globalCompositeOperation = 'source-in';
  const rl = bg.createLinearGradient(S * .8, 40, S * .3, S * .7); rl.addColorStop(0, `rgba(${rgb},.65)`); rl.addColorStop(.45, `rgba(${rgb},.13)`); rl.addColorStop(1, `rgba(${rgb},0)`);
  bg.fillStyle = rl; bg.fillRect(0, 0, S, S);
  c.drawImage(body, 0, 0);
  const url = cv2.toDataURL();
  heroArtCache[cls] = url;
  return url;
}
function setTitleArt(id, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  let url = null;
  try { url = heroArt(cls); } catch (e) { window.__lastErr = { at: Date.now(), where: 'heroArt', msg: String(e && e.message || e) }; }
  const col = (CLASSES[cls] && CLASSES[cls].color) || '#ffd700';
  const scr = el.closest('#loginScreen, #create'); if (scr) scr.style.setProperty('--lgc', `rgba(${hexRgb(col)},.22)`);
  if (!url) { el.dataset.cls = cls; el.style.opacity = 0; return; } /* 시트 로드 후 loadSheet가 다시 호출 */
  el.dataset.cls = cls;
  el.classList.add('swap');
  setTimeout(() => { el.src = url; el.style.opacity = ''; el.classList.remove('swap'); }, 120);
}
/* ================= 3D 캐릭터 (Three.js 합성) =================
   2D 월드는 그대로, 캐릭터만 오프스크린 WebGL에 렌더 후 합성.
   CDN 실패/WebGL 없음 → 기존 2D 프레임으로 자동 폴백 */
let threeState = 'idle';
/* 3D는 ?3d=1 일 때만 (기본 2D 20프레임 — 박스형 3D가 허수아비 같다는 평) */
const WANT_3D = location.search.includes('3d=1');
let THREE_NS = null, threeRenderer = null, threeCanvas = null;
/* 스킬 시전·피격 모션 상태 */
let heroCast = null, heroHurtT = 0, heroPickT = 0;
/* 스킬 아이콘: game-icons.net(CC BY 3.0) SVG를 Iconify API로 색 입혀 배지 안에. 매핑 없거나 로드 실패 시 이모지 */
const SKILL_ICON = { power_strike: 'sword-brandish', whirlwind: 'whirlwind', warcry: 'muscle-up', iron_body: 'shield',
  multishot: 'arrow-cluster', piercing: 'high-shot', sharpshooter: 'eye-target', swift_feet: 'boots',
  shadow_strike: 'ninja-mask', phantom: 'daggers', assassination: 'crescent-blade', swift_feet2: 'sprint',
  fireball: 'fireball', frost_nova: 'ice-bolt', magic_power: 'magic-swirl', mana_shield: 'shield-reflect', heal: 'healing' };
const TREE_ARCH_ICON = { nuke: 'fireball', cleave: 'crossed-swords', storm: 'whirlwind', chain: 'lightning-branches', dash: 'sprint', volley: 'arrow-cluster', heal: 'heart-plus',
  atk: 'punch-blast', def: 'shield', crit: 'bullseye', spd: 'boots' };
/* 스킬 배지(128px): 발동=둥근 사각 / 패시브=원형 프레임, 등급색 테두리, 스킬색 배경, 글리프 베벨·광택.
   스킬샵·트리·핫바·스킬서 아이템에 같은 이미지를 쓴다 */
function skillIconCanvas(id, def) {
  def = def || skillDef(id) || {};
  const cls = def.cls && CLASSES[def.cls] ? def.cls : myCls;
  const col = SKILL_FX_COLOR[id] || (def.arch ? skillElemColor(def) : null) || (CLASSES[cls] && CLASSES[cls].color) || '#ffd700';
  const gi = SKILL_ICON[id] || TREE_ARCH_ICON[def.arch] || TREE_ARCH_ICON[def.stat] || (def.hp ? 'heart-plus' : def.mp != null && def.kind === 'stat' ? 'magic-swirl' : null);
  if (!gi) return null;
  const im = glyphImg(`assets/icons/${gi}.svg`);
  if (!im._ok) return null;
  const grade = skillGrade(id, def), passive = isPassiveSkill(def);
  const key = `${gi}|${col}|${grade}|${passive}`;
  if (skIconCache[key]) return skIconCache[key];
  const S = 128, M = 10; /* 여백(후광용) */
  const gc = RARITY_COLOR[grade] || '#aaa', rank = RARITY_RANK[grade] || 0;
  const out = document.createElement('canvas'); out.width = S; out.height = S;
  const c = out.getContext('2d');
  const frame = (inset) => { c.beginPath(); if (passive) c.arc(S / 2, S / 2, S / 2 - M - inset, 0, 7); else c.roundRect(M + inset, M + inset, S - 2 * (M + inset), S - 2 * (M + inset), 26 - inset); };
  /* 후광 */
  c.save(); c.filter = `blur(${5 + rank}px)`; c.globalAlpha = .55 + rank * .08; c.fillStyle = gc; frame(0); c.fill(); c.restore();
  /* 프레임 바탕: 어두운 스킬색 그라데이션 */
  const bgG = c.createLinearGradient(0, M, 0, S - M);
  bgG.addColorStop(0, shade(col, .62)); bgG.addColorStop(1, shade(col, .22));
  c.fillStyle = bgG; frame(0); c.fill();
  /* 안쪽 광원 */
  c.save(); frame(0); c.clip();
  const rg = c.createRadialGradient(S * .36, S * .3, 4, S * .36, S * .3, S * .62);
  rg.addColorStop(0, shade(col, 1.25)); rg.addColorStop(.55, col); rg.addColorStop(1, shade(col, .45));
  c.globalAlpha = .85; c.fillStyle = rg; c.fillRect(0, 0, S, S);
  /* 대각 광택 */
  c.globalAlpha = .13; c.fillStyle = '#fff'; c.beginPath(); c.moveTo(M, M); c.lineTo(S * .62, M); c.lineTo(M, S * .62); c.closePath(); c.fill();
  /* 패시브: 안쪽 링 무늬 / 발동: 하단 어두운 밴드 */
  if (passive) { c.globalAlpha = .35; c.strokeStyle = '#fff'; c.lineWidth = 2; c.setLineDash([5, 6]); c.beginPath(); c.arc(S / 2, S / 2, S / 2 - M - 11, 0, 7); c.stroke(); c.setLineDash([]); }
  else { c.globalAlpha = .28; c.fillStyle = '#000'; c.fillRect(M, S - M - 22, S - 2 * M, 22); }
  c.restore();
  /* 등급 테두리 (밝은 위 → 어두운 아래) + 안쪽 하이라이트 */
  const bG = c.createLinearGradient(0, M, 0, S - M);
  bG.addColorStop(0, shade(gc, 1.45)); bG.addColorStop(1, shade(gc, .6));
  c.strokeStyle = bG; c.lineWidth = 5; frame(2.5); c.stroke();
  c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1.5; frame(6); c.stroke();
  /* 글리프: 흰→밝은 스킬색, 베벨, 그림자 */
  const gs = 78, gp = (S - gs) / 2;
  const mask = document.createElement('canvas'); mask.width = S; mask.height = S;
  const mg = mask.getContext('2d'); mg.imageSmoothingQuality = 'high'; mg.drawImage(im, gp, gp + 1, gs, gs);
  const dark = document.createElement('canvas'); dark.width = S; dark.height = S;
  const dg = dark.getContext('2d'); dg.drawImage(mask, 0, 0); dg.globalCompositeOperation = 'source-in'; dg.fillStyle = 'rgba(0,0,0,.6)'; dg.fillRect(0, 0, S, S);
  c.save(); c.filter = 'blur(2px)'; c.drawImage(dark, 2, 4); c.restore();
  const body = document.createElement('canvas'); body.width = S; body.height = S;
  const bg = body.getContext('2d'); bg.drawImage(mask, 0, 0); bg.globalCompositeOperation = 'source-in';
  const lg = bg.createLinearGradient(0, gp, 0, gp + gs); lg.addColorStop(0, '#ffffff'); lg.addColorStop(.55, '#f4f6ff'); lg.addColorStop(1, shade(col, 1.6));
  bg.fillStyle = lg; bg.fillRect(0, 0, S, S);
  bg.globalCompositeOperation = 'source-atop';
  const rimD = iconRim(mask, -2, -2, S); const td = document.createElement('canvas'); td.width = S; td.height = S;
  const tg2 = td.getContext('2d'); tg2.drawImage(rimD, 0, 0); tg2.globalCompositeOperation = 'source-in'; tg2.fillStyle = shade(col, .5); tg2.fillRect(0, 0, S, S);
  bg.globalAlpha = .75; bg.drawImage(td, 0, 0); bg.globalAlpha = 1;
  c.drawImage(body, 0, 0);
  /* 전설·유니크 반짝이 */
  if (rank >= 4) { c.fillStyle = '#fff'; for (const [x, y, r] of [[S * .24, S * .22, 3.2], [S * .76, S * .28, 2.4], [S * .7, S * .76, 2.6]]) { c.globalAlpha = .95; c.beginPath(); c.moveTo(x, y - r * 2.2); c.lineTo(x + r * .5, y - r * .5); c.lineTo(x + r * 2.2, y); c.lineTo(x + r * .5, y + r * .5); c.lineTo(x, y + r * 2.2); c.lineTo(x - r * .5, y + r * .5); c.lineTo(x - r * 2.2, y); c.lineTo(x - r * .5, y - r * .5); c.closePath(); c.fill(); } c.globalAlpha = 1; }
  skIconCache[key] = out;
  return out;
}
const skIconUrl = {};
function skillIconHtml(id, def) {
  def = def || skillDef(id) || {};
  const cls = def.cls && CLASSES[def.cls] ? def.cls : myCls;
  const col = SKILL_FX_COLOR[id] || (def.arch ? skillElemColor(def) : null) || (CLASSES[cls] && CLASSES[cls].color) || '#ffd700'; /* 배지 캔버스와 같은 색 규칙 */
  const cvS = skillIconCanvas(id, def);
  if (cvS) {
    const k = `${SKILL_ICON[id] || TREE_ARCH_ICON[def.arch] || TREE_ARCH_ICON[def.stat] || 'x'}|${skillGrade(id, def)}|${isPassiveSkill(def)}|${SKILL_FX_COLOR[id] || (def.arch ? skillElemColor(def) : '')}|${cls}`;
    if (!skIconUrl[k]) skIconUrl[k] = cvS.toDataURL();
    return `<span class="skic hi ${isPassiveSkill(def) ? 'pas' : 'act'}" style="--c:${col}"><img src="${skIconUrl[k]}" alt=""></span>`;
  }
  const gi = SKILL_ICON[id] || TREE_ARCH_ICON[def.arch] || TREE_ARCH_ICON[def.stat] || null;
  const emoji = def.icon || '✦';
  const img = gi ? `<img src="assets/icons/${gi}.svg?v=1" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display=''">` : ''; /* 로컬 SVG(game-icons, 흰색) — 배지 캔버스 준비 전 폴백 */
  return `<span class="skic" style="--c:${col}">${img}<em style="${gi ? 'display:none' : ''}">${emoji}</em></span>`;
}
const SKILL_FX_COLOR = { power_strike: '#ffb347', whirlwind: '#ffd166', multishot: '#e8d9a0', piercing: '#f6e58d',
  shadow_strike: '#b388ff', phantom: '#9b59b6', fireball: '#ff7f27', frost_nova: '#7fd8ff', heal: '#7fe3a0', mana_shield: '#5dade2' };
const CAST_DUR = { power_strike: 450, whirlwind: 500, multishot: 500, piercing: 500, shadow_strike: 450, phantom: 550, fireball: 550, frost_nova: 550, heal: 600 };
let lastFace3D = 0, lastT3D = 0, bankSm3D = 0, leanSm3D = 0;
const threeModels = {};
/* 3D 전면 비활성: 렌더는 2D 경로 전용. three.js는 로드조차 하지 않는다.
   (아래 3D 리그/베이크 코드는 호출되지 않는 보존 코드) */
const ENABLE_3D = false;
async function initThree() {
  if (!ENABLE_3D) { threeState = 'off'; return; }
  if (threeState !== 'idle') return;
  threeState = 'loading';
  try {
    THREE_NS = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js');
    threeCanvas = document.createElement('canvas');
    threeCanvas.width = 128; threeCanvas.height = 128;
    threeRenderer = new THREE_NS.WebGLRenderer({ canvas: threeCanvas, alpha: true, antialias: true });
    threeRenderer.setSize(128, 128, false);
    threeRenderer.setClearColor(0x000000, 0);
    threeState = 'ready';
  } catch (e) { threeState = 'failed'; }
}
const HERO3D_SKIN = { warrior: 0xf2c79a, archer: 0xf0c49c, rogue: 0xe8bd93, mage: 0xf6cfa5 };
const HERO3D_HAIR = { warrior: 0x5a3a26, archer: 0x2e7d52, rogue: 0x22303f, mage: 0x4a235a };
const HERO3D_CLOTH = { warrior: '#8a4b3c', archer: '#3f7a52', rogue: '#4d5a68', mage: '#6c3483' };
function h3mat(color, emissive = 0x000000, ei = 0) {
  return new THREE_NS.MeshLambertMaterial({ color, emissive, emissiveIntensity: ei });
}
function h3box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE_NS.Mesh(new THREE_NS.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}
function heroModel3D(cls, key) {
  key = key || cls;
  if (threeModels[key]) return threeModels[key];
  const T = THREE_NS;
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(26, 1, .1, 50);
  camera.position.set(1.5, 1.6, 4.6);
  camera.lookAt(0, 1.0, 0);
  scene.add(new T.HemisphereLight(0xffffff, 0x334455, 1.0));
  const dl = new T.DirectionalLight(0xffffff, 1.2);
  dl.position.set(2, 4, 3);
  scene.add(dl);
  const skin = HERO3D_SKIN[cls] ?? 0xf2c79a;
  const M = { scene, camera, refs: {}, mats: {}, _sig: '', _wid: undefined, _skin: skin };
  const R = M.refs, mats = M.mats;
  const root = new T.Group();
  scene.add(root);
  R.root = root;
  mats.skin = h3mat(skin);
  mats.glove = h3mat(skin);
  mats.pants = h3mat(0x6b7480);
  mats.armor = h3mat(0x8a4b3c);
  mats.boots = h3mat(0x4a3524);
  mats.trim = h3mat(0xc9b48a);
  mats.hair = h3mat(HERO3D_HAIR[cls] ?? 0x333333);
  mats.dark = h3mat(0x232833);
  for (const s of [-1, 1]) {
    const leg = new T.Group();
    leg.position.set(s * .13, .85, 0);
    leg.add(h3box(.2, .8, .24, mats.pants, 0, -.4, 0));
    leg.add(h3box(.22, .16, .3, mats.boots, 0, -.72, .02));
    root.add(leg);
    R[s < 0 ? 'legL' : 'legR'] = leg;
  }
  R.torso = new T.Group();
  R.torso.position.set(0, 1.18, 0);
  R.torso.add(h3box(.56, .62, .34, mats.armor));
  R.torso.add(h3box(.58, .1, .36, mats.dark, 0, -.26, 0));
  R.torso.add(h3box(.12, .1, .03, mats.trim, 0, -.26, .19));
  R.torso.add(h3box(.06, .4, .02, mats.trim, -.2, .05, .18));
  R.torso.add(h3box(.06, .4, .02, mats.trim, .2, .05, .18));
  root.add(R.torso);
  for (const s of [-1, 1]) root.add(h3box(.17, .12, .24, mats.armor, s * .35, 1.5, 0));
  for (const s of [-1, 1]) {
    const arm = new T.Group();
    arm.position.set(s * .34, 1.45, 0);
    arm.add(h3box(.16, .56, .18, mats.armor, 0, -.28, 0));
    const hand = h3box(.15, .15, .16, mats.glove, 0, -.62, 0);
    arm.add(hand);
    root.add(arm);
    R[s < 0 ? 'armL' : 'armR'] = arm;
    if (s > 0) {
      R.mountR = new T.Group();
      R.mountR.position.set(0, -.68, 0);
      arm.add(R.mountR);
    }
  }
  R.head = new T.Group();
  R.head.position.set(0, 1.62, 0);
  R.head.add(h3box(.44, .42, .4, mats.skin, 0, .2, 0));
  const eyeW = h3mat(0xffffff), eyeB = h3mat(0x1a1d24);
  R.head.add(h3box(.11, .13, .02, eyeW, -.115, .22, .2));
  R.head.add(h3box(.11, .13, .02, eyeW, .115, .22, .2));
  R.head.add(h3box(.05, .07, .02, eyeB, -.115, .22, .215));
  R.head.add(h3box(.05, .07, .02, eyeB, .115, .22, .215));
  R.head.add(h3box(.1, .03, .02, eyeB, 0, .03, .2)); /* smile */
  R.helm = new T.Group();
  R.head.add(R.helm);
  root.add(R.head);
  mats.gem = h3mat(0xe74c3c, 0xe74c3c, .4);
  R.gem = new T.Mesh(new T.OctahedronGeometry(.06), mats.gem);
  R.gem.position.set(0, 1.3, .2);
  R.gem.visible = false;
  root.add(R.gem);
  if (cls === 'mage') {
    const robe = new T.Mesh(new T.CylinderGeometry(.3, .46, .85, 10), mats.armor);
    robe.position.set(0, .45, 0);
    root.add(robe);
  }
  if (cls === 'archer') {
    const q = h3box(.12, .4, .12, h3mat(0x6b4a2f), .3, 1.35, -.24);
    q.rotation.z = .3;
    root.add(q);
    for (let i = -1; i <= 1; i++) {
      const a = new T.Mesh(new T.CylinderGeometry(.015, .015, .3, 6), h3mat(0xd9c8a9));
      a.position.set(.3 + i * .045, 1.62, -.26);
      root.add(a);
    }
  }
  threeModels[key] = M;
  return M;
}
function buildHelm3D(M, cls, helmId) {
  const T = THREE_NS, R = M.refs;
  while (R.helm.children.length) R.helm.remove(R.helm.children[0]);
  const hairM = M.mats.hair;
  const add = m => R.helm.add(m);
  if (!helmId) {
    if (cls === 'mage') {
      const brim = new T.Mesh(new T.CylinderGeometry(.34, .36, .07, 12), hairM);
      brim.position.y = .34; add(brim);
      const cone = new T.Mesh(new T.ConeGeometry(.18, .36, 10), hairM);
      cone.position.y = .53; add(cone);
      const tip = new T.Mesh(new T.SphereGeometry(.045, 8, 8), M.mats.trim);
      tip.position.y = .73; add(tip);
    } else if (cls === 'archer' || cls === 'rogue') {
      add(h3box(.46, .32, .44, hairM, 0, .22, -.03));
      add(h3box(.44, .1, .42, hairM, 0, .42, -.02));
    } else {
      add(h3box(.44, .12, .42, hairM, 0, .4, 0));
      add(h3box(.05, .22, .4, hairM, -.21, .26, 0));
      add(h3box(.05, .22, .4, hairM, .21, .26, 0));
    }
    return;
  }
  const it = getItem(helmId);
  const hm = h3mat(new T.Color(it.color || '#9aa5b1').getHex());
  const nm = it.name || '', sid = String(helmId);
  const crown = /왕관|크라운|crown/i.test(nm) || sid.includes('crown');
  if (crown) {
    const band = new T.Mesh(new T.CylinderGeometry(.24, .25, .12, 12), hm);
    band.position.y = .36; add(band);
    for (const sx of [-.13, 0, .13]) {
      const sp = new T.Mesh(new T.ConeGeometry(.05, .15, 6), hm);
      sp.position.set(sx, .48, 0); add(sp);
    }
    const j = new T.Mesh(new T.SphereGeometry(.04, 8, 8), h3mat(0xe74c3c, 0xe74c3c, .6));
    j.position.set(0, .36, .24); add(j);
  } else if ((it.def || 0) >= 3) {
    const dome = new T.Mesh(new T.SphereGeometry(.26, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), hm);
    dome.position.y = .2; add(dome);
    add(h3box(.05, .24, .03, hm, 0, .1, .24));
    add(h3box(.04, .2, .24, hm, -.24, .08, .05));
    add(h3box(.04, .2, .24, hm, .24, .08, .05));
  } else {
    const cap = new T.Mesh(new T.CylinderGeometry(.24, .26, .14, 12), hm);
    cap.position.y = .36; add(cap);
  }
}
function buildWeapon3D(M, cls, wid) {
  const T = THREE_NS, R = M.refs;
  while (R.mountR.children.length) R.mountR.remove(R.mountR.children[0]);
  const it = wid ? getItem(wid) : null;
  const bm = h3mat(new T.Color(it && it.color ? it.color : '#cdd5dd').getHex());
  const enh = (it && it._lv) || 0;
  const glow = enh >= 7 ? 0xff6b6b : enh >= 5 ? 0xffd700 : enh >= 3 ? 0x7fc7ff : 0;
  if (glow) { bm.emissive = new T.Color(glow); bm.emissiveIntensity = .55; }
  M.mats.weapon = bm; M._weapBase = glow ? .55 : 0; /* 시전 발광 펄스용 */
  const gold = h3mat(0xd9b23c), wood = h3mat(0x6b4a2f);
  const add = m => R.mountR.add(m);
  const blade = (len, w) => {
    add(h3box(w, len, .035, bm, 0, .12 + len / 2, 0));
    const tip = new T.Mesh(new T.ConeGeometry(w * .55, .12, 4), bm);
    tip.position.y = .12 + len + .06; tip.rotation.y = Math.PI / 4; add(tip);
  };
  if (cls === 'rogue') {
    blade(.42, .07);
    add(h3box(.2, .05, .06, gold, 0, .1, 0));
    add(h3box(.05, .16, .05, wood, 0, 0, 0));
  } else if (cls === 'archer') {
    const arc = new T.Mesh(new T.TorusGeometry(.4, .032, 8, 20, Math.PI), bm);
    arc.position.y = .45; add(arc);
    add(h3box(.02, .8, .02, h3mat(0xeeeeee), 0, .45, 0));
    add(h3box(.06, .14, .06, wood, 0, .45, 0));
  } else if (cls === 'mage') {
    const staff = new T.Mesh(new T.CylinderGeometry(.045, .045, 1.15, 8), h3mat(0x8a5f3a));
    staff.position.y = .5; add(staff);
    const oc = new T.Color(it && it.color ? it.color : '#b388ff').getHex();
    const orb = new T.Mesh(new T.IcosahedronGeometry(.14, 0), h3mat(oc, oc, 1));
    orb.position.y = 1.12; add(orb);
    M.mats.orb = orb.material; /* 시전 발광 펄스용 */
  } else {
    blade(.8, .1);
    add(h3box(.3, .06, .08, gold, 0, .1, 0));
    const gem = new T.Mesh(new T.SphereGeometry(.035, 8, 8), h3mat(0xe74c3c, 0xe74c3c, .5));
    gem.position.set(0, .1, .05); add(gem);
    add(h3box(.055, .2, .055, wood, 0, -.02, 0));
  }
  M._wid = wid || '';
}
function applyHeroGear3D(M, cls, eq) {
  const T = THREE_NS;
  const armorIt = eq.armor ? getItem(eq.armor) : null;
  const pantsIt = eq.pants ? getItem(eq.pants) : null;
  const bootsIt = eq.boots ? getItem(eq.boots) : null;
  const gloveIt = eq.gloves ? getItem(eq.gloves) : null;
  const armorC = armorIt ? armorIt.color : (HERO3D_CLOTH[cls] || '#888888');
  M.mats.armor.color.set(armorC);
  M.mats.pants.color.set(pantsIt ? pantsIt.color : shade(HERO3D_CLOTH[cls] || '#888888', .75));
  M.mats.boots.color.set(bootsIt ? bootsIt.color : '#4a3524');
  M.mats.trim.color.set(armorIt ? (RARITY_COLOR[armorIt.rarity] || '#d9b23c') : '#c9b48a');
  M.mats.glove.color.set(gloveIt ? gloveIt.color : ('#' + M._skin.toString(16).padStart(6, '0')));
  const neckIt = eq.necklace ? getItem(eq.necklace) : null;
  M.refs.gem.visible = !!neckIt;
  if (neckIt) { M.mats.gem.color.set(neckIt.color || '#e74c3c'); M.mats.gem.emissive.set(neckIt.color || '#e74c3c'); }
  buildHelm3D(M, cls, eq.helmet || null);
  if (M._wid !== (eq.weapon || '')) buildWeapon3D(M, cls, eq.weapon);
}
function poseHero3D(M, cls, o, moving, stepPh, flip, sw, now, dead, cast, yaw = null) {
  const R = M.refs;
  const w = moving ? Math.sin(stepPh) : 0;
  const amp = moving ? .62 : 0;
  R.legL.rotation.x = w * amp;
  R.legR.rotation.x = -w * amp;
  R.armL.rotation.x = -w * amp * .75 + (moving ? 0 : Math.sin(now / 600) * .06);
  R.torso.rotation.x = 0;
  /* 이동 린 + 선회 뱅크 (본인만 정밀 계측, 타인은 고정값) */
  let leanT = moving ? .1 : 0, bankT = 0;
  if (o.isSelf && !dead) {
    if (!lastT3D) { lastT3D = now; lastFace3D = o.face ?? 0; }
    const dt = Math.min(100, Math.max(1, now - lastT3D));
    const spd = Math.hypot(me.vx || 0, me.vy || 0) / Math.max(1, moveSpd());
    leanT = Math.min(1, spd) * .2;
    let dy = (o.face ?? 0) - lastFace3D;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    bankT = Math.max(-1, Math.min(1, (dy / (dt / 1000)) * .12)) * .22;
    lastFace3D = o.face ?? 0; lastT3D = now;
  }
  leanSm3D += (leanT - leanSm3D) * .18;
  bankSm3D += (bankT - bankSm3D) * .18;
  /* 스킬 시전 모션 (평타 스윙보다 우선) */
  let spinYaw = 0, crouch = 0;
  const ck = cast ? (now - cast.t0) / cast.dur : -1;
  if (cast && ck >= 0 && ck < 1) {
    const e = ck < .5 ? 2 * ck * ck : 1 - Math.pow(-2 * ck + 2, 2) / 2;
    if (cast.id === 'power_strike') {
      R.armR.rotation.x = -2.6 + e * 3.4; crouch = Math.sin(e * Math.PI) * .1;
      R.torso.rotation.x = e * .35;
    } else if (cast.id === 'multishot') {
      R.armR.rotation.x = -1.3; R.armL.rotation.x = -1.1;
      R.torso.rotation.y = (flip ? -1 : 1) * Math.sin(ck * Math.PI * 3) * .4;
      crouch = .12;
    } else if (cast.id === 'shadow_strike') {
      spinYaw = e * Math.PI * 4; crouch = .14;
      R.armR.rotation.x = -1.8; R.armL.rotation.x = -1.8;
    } else if (cast.id === 'fireball') {
      /* rotation.x는 앞뒤축이라 -2 이하로 가면 지팡이가 뒤로 넘어가 몸에 가려짐 */
      R.armR.rotation.x = -1.05 + e * .55; crouch = .06;
      R.torso.rotation.x = -.15 + e * .3;
    } else if (cast.id === 'heal') {
      R.armR.rotation.x = -2.7; R.armL.rotation.x = -2.7; crouch = .2;
      R.torso.rotation.x = -.12;
    }
    const pulse = .7 + Math.sin(ck * Math.PI * 4) * .3;
    if (M.mats.weapon) M.mats.weapon.emissiveIntensity = (M._weapBase || 0) + pulse;
    if (M.mats.orb) M.mats.orb.emissiveIntensity = 1 + pulse;
  } else {
    if (M.mats.weapon) M.mats.weapon.emissiveIntensity = M._weapBase || 0;
    if (M.mats.orb) M.mats.orb.emissiveIntensity = 1;
    if (sw >= 0 && sw < 1) {
      R.armR.rotation.x = sw < .25 ? (-.15 + (-2.4 + .15) * (sw / .25)) : (-2.4 + sw * 3.0);
      R.torso.rotation.y = (flip ? -1 : 1) * Math.sin(Math.min(1, sw) * Math.PI) * .35;
    } else {
      R.armR.rotation.x = -w * amp * .75 - .15;
      R.torso.rotation.y = 0;
    }
  }
  /* 피격 플린치 (본인) */
  const hd = (now - heroHurtT) / 200;
  const flinch = o.isSelf && !dead && hd >= 0 && hd < 1 ? (1 - hd) : 0;
  R.torso.rotation.x += -flinch * .3;
  crouch += flinch * .05;
  /* 휴식 중 고개 두리번 */
  R.head.rotation.y = (!moving && !cast && !dead) ? Math.sin(now / 2400 + cls.length) * .35 : 0;
  if (dead) {
    R.root.rotation.set(-Math.PI / 2, 0, 0);
    R.root.position.y = .35;
    R.armR.rotation.x = -.3; R.armL.rotation.x = -.3;
    R.legL.rotation.x = 0; R.legR.rotation.x = 0;
    R.torso.rotation.y = 0; R.torso.rotation.x = 0;
  } else {
    R.root.rotation.set(leanSm3D, yaw !== null ? yaw : ((flip ? Math.PI : 0) + spinYaw), -bankSm3D);
    R.root.position.y = (moving ? Math.abs(Math.sin(stepPh)) * .05 : Math.sin(now / 900) * .012) - crouch;
  }
}
function drawHero3D(o, eq, now, moving, stepPh, flip, sw) {
  try {
    const cls = o.cls || 'warrior';
    const M = heroModel3D(cls);
    const sig = JSON.stringify(eq);
    if (M._sig !== sig) { applyHeroGear3D(M, cls, eq); M._sig = sig; }
    const cast = (!o.dead && o.castFx && now - o.castFx.t0 < o.castFx.dur) ? o.castFx
      : ((!o.dead && o.isSelf && heroCast && now - heroCast.t0 < heroCast.dur) ? heroCast : null);
    poseHero3D(M, cls, o, moving, stepPh, flip, sw, now, !!o.dead, cast);
    threeRenderer.render(M.scene, M.camera);
    ctx.drawImage(threeCanvas, -64, -114, 128, 128);
    return true;
  } catch (e) {
    threeState = 'failed'; /* 다음 프레임부터 2D 폴백 */
    return false;
  }
}

function drawChar(o) {
  const now = Date.now();
  const moving = o.moving && !o.dead;
  const face = o.face ?? Math.PI / 2;
  const flip = Math.cos(face) < -.05;
  /* 발구름 위상과 통통 튐 동기화 — 시간 기준이면 미끄러져 보여서 거리 기반으로 */
  const stepPh = (moving && Number.isFinite(o.stepPh)) ? o.stepPh : now / 85;
  const bobY = moving ? Math.abs(Math.sin(stepPh)) * 2.4 : Math.sin(now / 600) * .8;

  ctx.fillStyle = 'rgba(0,0,0,.32)';
  ctx.beginPath(); ctx.ellipse(o.x, o.y + 12, 24, 8, 0, 0, 7); ctx.fill();
  {
    /* 시전 서클: 진행도에 따라 조여드는 이중 링 + 회전 룬 */
    const cf = (!o.dead && o.castFx && now - o.castFx.t0 < o.castFx.dur) ? o.castFx
      : ((!o.dead && o.isSelf && heroCast && now - heroCast.t0 < heroCast.dur) ? heroCast : null);
    if (cf) {
      const pr = clampN((now - cf.t0) / cf.dur, 0, 1);
      const col = SKILL_FX_COLOR[cf.id] || '#ffd700';
      if (Math.random() < .6) poofs.push({ x: o.x + rand(-16, 16), y: o.y + 6, vx: rand(-12, 12), vy: rand(-90, -40), r: rand(1.3, 2.6), t: 0, color: col, g: -30 }); /* 상승 마나 입자 */
      ctx.save();
      ctx.globalAlpha = .85 * (1 - pr * .35);
      ctx.strokeStyle = col; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(o.x, o.y + 12, 46 - pr * 18, (46 - pr * 18) * .38, 0, 0, 7); ctx.stroke();
      ctx.globalAlpha = .5;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([9, 7]); ctx.lineDashOffset = -now / 24;
      ctx.beginPath(); ctx.ellipse(o.x, o.y + 12, 62 - pr * 26, (62 - pr * 26) * .38, 0, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
      for (let ri = 0; ri < 3; ri++) {
        const ra = now / 320 + ri * 2.094;
        ctx.globalAlpha = .8;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(o.x + Math.cos(ra) * (52 - pr * 20), o.y + 12 + Math.sin(ra) * (52 - pr * 20) * .38, 2.6, 0, 7); ctx.fill();
      }
      ctx.restore();
    }
  }
  if (o.isSelf && !o.dead) {
    ctx.strokeStyle = 'rgba(255,215,0,.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(o.x, o.y + 12, 28, 10, 0, 0, 7); ctx.stroke();
  }

  /* 벡터 20프레임 (해상도 무관 초정밀 — 픽셀 없음) */
  const eq = o.equipped || {};
  const sw = (!o.dead && o.swing) ? (now - o.swing) / 220 : -1;
  /* 시전 중(자캐는 heroCast, 타인은 o.castFx)에는 베이크 프레임 대신 라이브로 그려 시전 포즈를 살린다 */
  const castNow = (!o.dead && o.castFx && now - o.castFx.t0 < o.castFx.dur) ? o.castFx
    : ((!o.dead && o.isSelf && heroCast && now - heroCast.t0 < heroCast.dur) ? heroCast : null);
  let fr = null;
  let frTop = 0;
  const sheet = heroSheet(o.cls || 'warrior');
  try {
    if (sheet) {
      fr = 'sheet';
      frTop = HERO_SHEET_H / (128 * 1.56 / 192); /* headY 계산식이 논리 192 기준이라 역산 */
    } else {
    const fs = heroFrames(o.cls || 'warrior', eq);
    frTop = fs.top;
    if (castNow) fr = 'live';
    if (fr === 'live') { /* 아래 라이브 렌더 */ }
    else if (o.dead) fr = fs.dead;
    else if (sw >= 0 && sw < 1) fr = fs.atk[Math.min(FR_ATK - 1, Math.floor(sw * FR_ATK))];
    else if (!o.dead && o.isSelf && now < hurtUntil) fr = fs.hurt;
    else if (moving) fr = fs.walk[((Math.floor(stepPh / (2 * Math.PI) * FR_WALK) % FR_WALK) + FR_WALK) % FR_WALK];
    else fr = fs.idle[Math.floor(now / 300) % FR_IDLE];
    }
  } catch (e) { fr = null; }
  ctx.save();
  ctx.translate(o.x, o.y - bobY);
  if (!o.dead && o.swing) {
    const lunge = Math.sin(Math.min(1, (now - o.swing) / 150) * Math.PI);
    if (lunge > 0) ctx.translate(Math.cos(face) * 10 * lunge, Math.sin(face) * 10 * lunge);
  }
  if (o.dead) ctx.globalAlpha = .45;
  else if (moving) ctx.rotate(Math.sin(stepPh) * .055); /* 걸음 스웨이 */
  if (!o.dead && flip && fr !== 'sheet') ctx.scale(-1, 1);
  if (fr === 'sheet') {
    const m = sheet.meta, F = m.fr, d = sheetDir(face);
    const k = HERO_SHEET_H / Math.max(1, m.feet - m.top); /* 시트 px → 화면 px */
    if (o.dead) ctx.rotate(Math.PI / 2);
    /* 발끝(m.feet)이 캐릭터 원점에 오도록 */
    ctx.drawImage(sheet.img, d * F, 0, F, F, -F * k / 2, -m.feet * k, F * k, F * k);
  } else if (fr === 'live') {
    const HB = 1.56 * 128 / 192; /* 베이크(192 논리박스 → 128*1.56 블릿)와 같은 화면 크기 */
    ctx.save();
    ctx.scale(HB, HB);
    const oLive = { ...o, castFx: castNow, moving, stepPh };
    const lfx = Math.cos(face), lfy = Math.sin(face);
    /* 좌우 반전은 바깥에서 이미 적용됨 — 여기서 또 뒤집으면 되돌아간다 */
    drawHero20(oLive, now, moving, lfx, lfy, 0, ctx);
    drawHeroGear(oLive, eq, now, face, ctx);
    ctx.restore();
  } else if (fr) { const HB = 1.56; ctx.drawImage(fr, -64 * HB, -86 * HB, 128 * HB, 128 * HB); } /* 캐릭터 20% 확대 */
  else { ctx.fillStyle = '#e74c3c'; ctx.beginPath(); ctx.arc(0, -24, 17, 0, 7); ctx.fill(); }
  ctx.restore();

  /* 머리 꼭대기 화면 y: 논리 top(발 기준) × (200/192 블릿 배율) */
  const headY = o.y - bobY - (frTop || 100) * (128 * 1.56 / 192);
  if (!o.dead && o.hp < o.maxHp) {
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    roundRect(ctx, o.x - 18, headY - 12, 36, 6.5, 3); ctx.fill();
    ctx.fillStyle = '#2ecc71';
    ctx.fillRect(o.x - 17, headY - 11, 34 * clampN(o.hp / o.maxHp, 0, 1), 4.5);
  }
  ctx.font = (o.isSelf ? 'bold ' : '') + '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = o.isSelf ? '#fff' : (CLASSES[o.cls]?.color || '#eee');
  const tt = o.title && TITLES[o.title];
  if (tt) { ctx.font = '10px sans-serif'; ctx.fillStyle = tt.color; outlinedText(`[${tt.name}]`, o.x, headY - (!o.dead && o.hp < o.maxHp ? 30 : 20), 2.5); ctx.font = (o.isSelf ? 'bold ' : '') + '12px sans-serif'; ctx.fillStyle = o.isSelf ? '#fff' : (CLASSES[o.cls]?.color || '#eee'); }
  outlinedText(o.name, o.x, headY - (!o.dead && o.hp < o.maxHp ? 18 : 8));
}

/* 몬스터 머리 꼭대기 y — VARCO 시트가 그려지는 중이면 시트 높이(r×MOB_SHEET_H), 아니면 예전 픽셀 기준 r×2.1 */
function mobTopY(s) {
  const base = s.type, r = sdef(s).r;
  const hm = MOB_SHEET_H[base] || ROLE_SHEET_H[(MOB_MODELS[base] || {}).role];
  return (hm && heroSheet('mob_' + base)) ? s.y - r * hm - ((MOB_MODELS[base] || {}).fly ? 14 : 0) : s.y - r * 2.1;
}
/* 신규 베이스(Quaternius/KayKit) 공용 렌더: 그림자 + 시트(비행형은 떠서 흔들림), 시트 없으면 고블린 픽셀 폴백 */
function drawGenericMob(s, now) {
  const M = MOB_MODELS[s.type] || {}, r = r0(s);
  const hover = M.fly ? 14 + Math.sin(now / 320 + (s.blink || 0)) * 5 : 0;
  ctx.fillStyle = M.fly ? 'rgba(0,0,0,.22)' : 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(s.x, s.y + 10, r * (M.fly ? .7 : .95), r * (M.fly ? .26 : .36), 0, 0, 7); ctx.fill();
  if (s.uniq) uniqAura(s, now);
  const flash = s.hitFlash ? clampN(1 - (now - s.hitFlash) / 150, 0, 1) * .85 : 0;
  if (!drawMobSheet(s, s.type, s.x, s.y + 11 - hover, { flash, bob: (s.movingF && !M.fly) ? Math.abs(Math.sin(now / 120 + (s.blink || 0))) * 3 : 0 })) {
    if (SPRITE_DEFS[s.type]) drawSprite(s.sprId || 'goblin', s.x, s.y + 11, s.uniq ? 5.6 : 4.5, { flash });
    else drawMobFallback(s, s.x, s.y + 11 - hover, r * (s.uniq ? 1.15 : 1)); /* 시트 도착 전: 종별 실루엣(엉뚱한 고블린 금지) */
  }
  drawKindExtras(s, now);
}
function mobUI(s, wide) {
  const d2 = sdef(s);
  const r = d2.r;
  if (s.id === hoverSimId || s.id === attackTargetSimId) { /* 조준 표시 */
    const on = s.id === attackTargetSimId;
    ctx.save();
    ctx.strokeStyle = on ? 'rgba(255,80,80,.9)' : 'rgba(255,255,255,.5)';
    ctx.lineWidth = on ? 2.2 : 1.6;
    ctx.setLineDash([7, 6]); ctx.lineDashOffset = -Date.now() / (on ? 40 : 90);
    ctx.beginPath(); ctx.ellipse(s.x, s.y + r * .55, r * 1.35, r * .55, 0, 0, 7); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  const isU = !!s.uniq;
  const isBoss = s.type === 'boss' || s.type === 'lich';
  /* 어그로 느낌표: 플레이어를 노리기 시작한 순간 0.7초 */
  if (s.alertT && Date.now() - s.alertT < 700) {
    const p = 1 - (Date.now() - s.alertT) / 700;
    const ay = mobTopY(s) - 14 - (1 - p) * 6;
    ctx.globalAlpha = Math.min(1, p * 2);
    ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd700';
    outlinedText('!', s.x, ay, 4);
    ctx.globalAlpha = 1;
  }
  if (s.hp < d2.hp || isBoss || isU) {
    const w = wide ? r * 2.7 : r * 2;
    const y = Math.min(s.y - r - (wide ? 38 : 18), mobTopY(s) - (wide ? 30 : 12)); /* 시트가 더 크면 그 위로 */
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    roundRect(ctx, s.x - w / 2 - 1.5, y - 1.5, w + 3, (wide ? 9 : 7) + 3, 3.5); ctx.fill();
    ctx.fillStyle = isU ? '#ff4d4d' : isBoss ? '#ff4040' : '#e74c3c';
    ctx.fillRect(s.x - w / 2, y, w * clampN(s.hp / d2.hp, 0, 1), wide ? 7 : 5);
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1;
    ctx.strokeRect(s.x - w / 2, y, w, wide ? 7 : 5);
  }
  /* 유니크 등급 배지 (이름 위) */
  if (isU) {
    const by = (s.hp < d2.hp || isBoss) ? Math.min(s.y - r - (wide ? 38 : 18), mobTopY(s) - (wide ? 30 : 12)) - 9 : mobTopY(s) - 6;
    const rgb = uniqColor(s), t = Date.now();
    ctx.save();
    ctx.font = 'bold 9.5px sans-serif'; ctx.textAlign = 'center';
    const label = '★ 유니크';
    const bw = ctx.measureText(label).width + 12;
    const grd = ctx.createLinearGradient(s.x - bw / 2, 0, s.x + bw / 2, 0);
    grd.addColorStop(0, `rgba(${rgb},.15)`); grd.addColorStop(.5, `rgba(${rgb},.55)`); grd.addColorStop(1, `rgba(${rgb},.15)`);
    ctx.fillStyle = grd;
    roundRect(ctx, s.x - bw / 2, by - 10, bw, 13, 6); ctx.fill();
    ctx.strokeStyle = `rgba(255,214,102,${.55 + Math.sin(t / 300) * .35})`; ctx.lineWidth = 1;
    roundRect(ctx, s.x - bw / 2, by - 10, bw, 13, 6); ctx.stroke();
    ctx.fillStyle = '#fff5d6'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, s.x, by);
    ctx.restore();
  }
  ctx.font = (wide || isU) ? 'bold 13px sans-serif' : '11px sans-serif';
  ctx.textAlign = 'center';
  if (isU) { const rgb = uniqColor(s); ctx.fillStyle = `rgb(${rgb})`; outlinedText(`Lv${simLevel(s)} ${d2.name}`, s.x, s.y + r + (wide ? 24 : 15), 3.2, 'rgba(0,0,0,.9)'); }
  else { ctx.fillStyle = isBoss ? '#ffb8b8' : 'rgba(255,255,255,.88)'; outlinedText(`Lv${simLevel(s)} ${d2.name}`, s.x, s.y + r + (wide ? 24 : 15)); }
}

/* 유니크 시그니처 색: 몬스터 색조를 반영한 보라~금 계열(구역마다 살짝 다르게) */
const _uniqColCache = {};
function uniqColor(s) {
  const key = s.kind || s.type || 'u';
  if (_uniqColCache[key]) return _uniqColCache[key];
  const dh = (typeof mobHueShift === 'function' && s.type) ? mobHueShift(s, s.type) : 0;
  /* 기본 마젠타-보라(280°)에서 몬스터 색조만큼 회전 → 종마다 오라 색이 다름 */
  const hue = (280 + dh + 360) % 360;
  const rgb = hslToRgb(hue / 360, .78, .62);
  return (_uniqColCache[key] = rgb.join(','));
}
function hslToRgb(h, sa, l) {
  const a = sa * Math.min(l, 1 - l);
  const f = n => { const k = (n + h * 12) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}
/* 상용 수준 유니크 연출: 회전 마법진 + 상승 오라 기둥 + 잔불 파티클 (스프라이트 아래 지면 레이어) */
function uniqAura(s, now) {
  const rad = r0(s) * 1.45;
  const gx = s.x, gy = s.y + 8;            /* 발밑 지면 중심 */
  const rgb = uniqColor(s);
  const gold = '255,214,102';
  const pulse = .5 + Math.sin(now / 380 + (s.blink || 0)) * .5;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  /* 1) 지면 소프트 글로우(원근 타원) */
  const gg = ctx.createRadialGradient(gx, gy, 2, gx, gy, rad * 1.5);
  gg.addColorStop(0, `rgba(${rgb},${.22 + pulse * .12})`);
  gg.addColorStop(.6, `rgba(${rgb},${.10 + pulse * .06})`);
  gg.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = gg;
  ctx.beginPath(); ctx.ellipse(gx, gy, rad * 1.5, rad * 1.5 * .42, 0, 0, 7); ctx.fill();
  /* 2) 회전 마법진: 두 개의 역방향 링 + 룬 틱 (타원 투영) */
  const flat = .42;
  const drawRing = (rr, rot, ticks, tickLen, alpha, w) => {
    ctx.strokeStyle = `rgba(${gold},${alpha})`;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.ellipse(gx, gy, rr, rr * flat, 0, 0, 7); ctx.stroke();
    ctx.lineWidth = Math.max(1, w * .8);
    for (let i = 0; i < ticks; i++) {
      const a = rot + i / ticks * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a) * flat;
      ctx.beginPath();
      ctx.moveTo(gx + c * rr, gy + sn * rr);
      ctx.lineTo(gx + c * (rr + tickLen), gy + sn * (rr + tickLen));
      ctx.stroke();
    }
  };
  drawRing(rad, now / 1400, 12, 5, .5 + pulse * .3, 2);
  drawRing(rad * .66, -now / 1000, 6, 4, .4 + pulse * .25, 1.6);
  /* 스프라이트 뒤 바디 글로우 — 몬스터가 배경에서 확 떠 보이게 (스프라이트보다 먼저 그려져 뒤에 깔림) */
  const by = s.y - r0(s) * .5;
  const bg = ctx.createRadialGradient(gx, by, 2, gx, by, rad * 1.35);
  bg.addColorStop(0, `rgba(${rgb},${.30 + pulse * .14})`);
  bg.addColorStop(.55, `rgba(${rgb},${.12 + pulse * .06})`);
  bg.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.arc(gx, by, rad * 1.35, 0, 7); ctx.fill();
  /* 룬 마젠타 내원 */
  ctx.strokeStyle = `rgba(${rgb},${.45 + pulse * .3})`;
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.ellipse(gx, gy, rad * .4, rad * .4 * flat, 0, 0, 7); ctx.stroke();
  /* 3) 상승 오라 기둥 */
  const colH = rad * 2.2;
  const cg = ctx.createLinearGradient(0, gy, 0, gy - colH);
  cg.addColorStop(0, `rgba(${rgb},${.20 + pulse * .1})`);
  cg.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.moveTo(gx - rad * .8, gy);
  ctx.lineTo(gx + rad * .8, gy);
  ctx.lineTo(gx + rad * .3, gy - colH);
  ctx.lineTo(gx - rad * .3, gy - colH);
  ctx.closePath(); ctx.fill();
  /* 4) 잔불 파티클(상태 없이 시간 시드로) */
  const N = 7, seed = (s.blink || 0) + gx * .13;
  for (let i = 0; i < N; i++) {
    const t = ((now / 1600) + i / N + seed) % 1;      /* 0(바닥)→1(꼭대기) */
    const ex = gx + Math.sin(seed + i * 2.3 + t * 3) * rad * .7 * (1 - t * .4);
    const ey = gy - t * colH * .95;
    const a = Math.sin(t * Math.PI) * (.7 + pulse * .3);  /* 시작·끝 페이드 */
    const er = 2.4 * (1 - t * .6);
    ctx.fillStyle = i % 3 === 0 ? `rgba(${gold},${a})` : `rgba(${rgb},${a})`;
    ctx.beginPath(); ctx.arc(ex, ey, er, 0, 7); ctx.fill();
  }
  ctx.restore();
}

/* ================= 몬스터 종별 외형 파츠 =================
   같은 베이스 실루엣도 구역별 kind마다 뿔·왕관·불꽃·결정 등으로 차별화 */
function drawKindExtras(s, now) {
  const nm = (s.def && s.def.name) || '';
  const T = { slime: [11, 4.5, 9], goblin: [15, 4.5, 11], wolf: [13, 4.5, 12], skeleton: [15, 5, 11], orc: [17, 5.5, 16], lich: [17, 5.5, 16] }[s.type] || [13, 4.5, 11];
  const sc = T[1] * (s.uniq ? 1.22 : 1);
  const h = T[0] * sc;
  const bob = s.movingF ? Math.abs(Math.sin(now / 120 + (s.blink || 0))) * 2.5 : 0;
  const topY = s.y + T[2] - h - bob;
  const faceY = topY + h * .34;
  const cx = s.x;
  const OL2 = 'rgba(0,0,0,.45)';
  const tri = (x, y, w2, len, col) => {
    ctx.fillStyle = col; ctx.strokeStyle = OL2; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x - w2, y); ctx.lineTo(x, y - len); ctx.lineTo(x + w2, y); ctx.closePath(); ctx.fill(); ctx.stroke();
  };
  const horns = (col, len) => { tri(cx - h * .2, topY + 4, 4.5, len, col); tri(cx + h * .2, topY + 4, 4.5, len, col); };
  const crownMini = (col) => {
    ctx.fillStyle = col; ctx.strokeStyle = OL2; ctx.lineWidth = 1.2;
    const w = h * .3;
    roundRect(ctx, cx - w, topY - 8, w * 2, 8, 2); ctx.fill(); ctx.stroke();
    for (const ox of [-w * .55, 0, w * .55]) tri(cx + ox, topY - 8, 3, 8, col);
    ctx.fillStyle = '#e74c3c'; ctx.beginPath(); ctx.arc(cx, topY - 4, 1.8, 0, 7); ctx.fill();
  };
  const flames = (col) => {
    for (let i = -1; i <= 1; i++) {
      const fl = h * .16 + Math.sin(now / 90 + i * 2.1 + cx) * h * .05;
      ctx.globalAlpha = .9;
      tri(cx + i * h * .14, topY + 2, 4, fl, col);
      ctx.globalAlpha = 1;
    }
  };
  const crystals = (col) => {
    ctx.fillStyle = col; ctx.strokeStyle = OL2; ctx.lineWidth = 1;
    for (const [ox, oy, sz, a] of [[-h * .22, topY + h * .1, 5, .4], [h * .22, topY + h * .14, 4, -.3], [0, topY - 2, 3.4, .1]]) {
      ctx.save(); ctx.translate(cx + ox, oy); ctx.rotate(a);
      ctx.fillRect(-sz / 2, -sz / 2, sz, sz); ctx.strokeRect(-sz / 2, -sz / 2, sz, sz);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.fillRect(-1, topY - 3, 2, 2);
  };
  const snowcap = () => {
    ctx.fillStyle = 'rgba(240,248,255,.92)';
    ctx.beginPath(); ctx.ellipse(cx, topY + 3, h * .24, h * .09, 0, Math.PI, 0); ctx.fill();
  };
  const bubbles = (col) => {
    for (let i = 0; i < 3; i++) {
      const ph = (now / 900 + i * .33 + cx * .01) % 1;
      ctx.globalAlpha = .75 * (1 - ph);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(cx + Math.sin(i * 2.4 + now / 500) * h * .18, topY + h * .5 - ph * h * .55, 2.5 + i, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
  };
  const aura = (col) => {
    const p = .5 + Math.sin(now / 260 + cx) * .25, rad = h * .62;
    ctx.fillStyle = col; ctx.globalAlpha = .1 + p * .06;
    ctx.beginPath(); ctx.arc(cx, topY + h * .45, rad, 0, 7); ctx.fill();
    ctx.globalAlpha = .5 + p * .3; ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(cx, topY + h * .45, rad, 0, 7); ctx.stroke();
    ctx.globalAlpha = 1;
  };
  const rageEyes = (col = '#ff4030') => {
    ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(cx - h * .1, faceY, 2.4, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + h * .1, faceY, 2.4, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
  };
  const bigEye = () => {
    ctx.fillStyle = '#fff'; ctx.strokeStyle = OL2; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(cx, faceY, h * .13, h * .15, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c0392b';
    ctx.beginPath(); ctx.arc(cx, faceY, h * .06, 0, 7); ctx.fill();
    ctx.fillStyle = '#1a1d24';
    ctx.beginPath(); ctx.arc(cx, faceY, h * .028, 0, 7); ctx.fill();
  };
  const helm = () => {
    ctx.fillStyle = '#7a5230'; ctx.strokeStyle = OL2; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx, topY + 4, h * .22, Math.PI, 0); ctx.fill(); ctx.stroke();
    ctx.fillRect(cx - h * .26, topY + 2, h * .52, 3);
  };
  const pads = () => {
    ctx.fillStyle = '#3f5c33'; ctx.strokeStyle = OL2; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx - h * .3, faceY + h * .28, h * .11, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + h * .3, faceY + h * .28, h * .11, 0, 7); ctx.fill(); ctx.stroke();
  };
  const bowMini = () => {
    ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx + h * .34, faceY + h * .2, h * .2, -1.2, 1.2); ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#eee'; ctx.lineWidth = 1;
    const ax = cx + h * .34;
    ctx.beginPath(); ctx.moveTo(ax + Math.cos(-1.2) * h * .2, faceY + h * .2 + Math.sin(-1.2) * h * .2);
    ctx.lineTo(ax + Math.cos(1.2) * h * .2, faceY + h * .2 + Math.sin(1.2) * h * .2); ctx.stroke();
  };
  const swordMini = () => {
    ctx.save(); ctx.translate(cx + h * .32, faceY + h * .3); ctx.rotate(-.5);
    ctx.fillStyle = '#aab7c4'; ctx.strokeStyle = OL2; ctx.lineWidth = 1;
    ctx.fillRect(-2, -h * .3, 4, h * .3); ctx.strokeRect(-2, -h * .3, 4, h * .3);
    ctx.fillStyle = '#d9b23c'; ctx.fillRect(-5, -2, 10, 3);
    ctx.restore();
  };
  const trail = (col) => {
    for (let i = 1; i <= 2; i++) {
      ctx.globalAlpha = .22 / i;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(cx - i * h * .22, topY + h * .5, h * .2 / i, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
  };
  const moss = () => {
    ctx.fillStyle = 'rgba(90,160,90,.75)';
    ctx.beginPath(); ctx.arc(cx - h * .14, faceY + h * .3, h * .08, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + h * .12, topY + h * .12, h * .06, 0, 7); ctx.fill();
  };
  const cracks = () => {
    ctx.strokeStyle = 'rgba(60,10,10,.7)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(cx - h * .1, faceY); ctx.lineTo(cx, faceY + h * .12); ctx.lineTo(cx - h * .05, faceY + h * .24); ctx.stroke();
    ctx.fillStyle = '#ff9a3c'; ctx.shadowColor = '#ff7f27'; ctx.shadowBlur = 7;
    ctx.beginPath(); ctx.arc(cx + h * .12, faceY + h * .1, 2, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
  };
  switch (nm) {
    case '레드 슬라임': cracks(); break;
    case '서리 슬라임': snowcap(); crystals('#bfe6ff'); break;
    case '독 슬라임': bubbles('#c07fe8'); break;
    case '암흑 슬라임': aura('#5a3fa8'); break;
    case '홉고블린': helm(); break;
    case '오크 전사': pads(); rageEyes(); break;
    case '광포한 오크': flames('#ff7f27'); rageEyes(); break;
    case '지옥견': flames('#ff5020'); rageEyes(); break;
    case '서리늑대': snowcap(); crystals('#bfe6ff'); break;
    case '몽마': aura('#7d5fff'); trail('#4a2fa8'); break;
    case '해골 궁수': bowMini(); break;
    case '죽음의 기사': swordMini(); crownMini('#565c68'); break;
    case '사령': trail('#a8d8d8'); break;
    case '오크 족장': crownMini('#ffd700'); break;
    case '오크 대족장': crownMini('#ffd700'); pads(); break;
    case '트롤': horns('#7a5c40', h * .18); moss(); break;
    case '오거': horns('#d9c8a9', h * .15); rageEyes(); break;
    case '사이클롭스': bigEye(); break;
    case '마귀': horns('#3a0f1c', h * .2); flames('#ff3040'); rageEyes(); break;
    case '리치 로드': crownMini('#c05fff'); flames('#c05fff'); break;
    case '죽음 군주': flames('#40c090'); break;
    case '대마령': aura('#ff6b9a'); crownMini('#ff6b9a'); break;
  }
}

/* ================= 몬스터 3D 베이크 =================
   6종 베이스 리그를 오프스크린에 굽고 2D 스프라이트처럼 블릿.
   실패 시 기존 픽셀 스프라이트로 폴백 */
let bakeR3D = null, bakeS3D = null, bakeC3D = null;
const mobFrameCache = new Map();
function m3mat(c, e, ei) { return new THREE_NS.MeshLambertMaterial({ color: c, emissive: e || 0x000000, emissiveIntensity: ei || 0 }); }
function m3box(parent, w, h, d, m, x, y, z) { const q = new THREE_NS.Mesh(new THREE_NS.BoxGeometry(w, h, d), m); q.position.set(x || 0, y || 0, z || 0); parent.add(q); return q; }
function m3ball(parent, r, m, x, y, z, sy) { const q = new THREE_NS.Mesh(new THREE_NS.SphereGeometry(r, 12, 10), m); q.position.set(x || 0, y || 0, z || 0); if (sy) q.scale.y = sy; parent.add(q); return q; }
function m3cone(parent, r, h, m, x, y, z, rx, rz) { const q = new THREE_NS.Mesh(new THREE_NS.ConeGeometry(r, h, 8), m); q.position.set(x || 0, y || 0, z || 0); if (rx) q.rotation.x = rx; if (rz) q.rotation.z = rz; parent.add(q); return q; }
function m3limb(parent, x, y, w, len, m) {
  const g = new THREE_NS.Group();
  g.position.set(x, y, 0);
  m3box(g, w, len, w, m, 0, -len / 2, 0);
  parent.add(g);
  return g;
}
function mobFx3D(g, refs, M, fx) {
  for (const t of fx) {
    const [tag, col] = Array.isArray(t) ? t : [t];
    const C = col || '#888888';
    if (tag === 'horns') { m3cone(g, .09, .34, m3mat(C), -refs.top.spread, refs.top.y, 0); m3cone(g, .09, .34, m3mat(C), refs.top.spread, refs.top.y, 0); }
    else if (tag === 'crown') {
      const band = new THREE_NS.Mesh(new THREE_NS.CylinderGeometry(.2, .22, .12, 10), m3mat(C));
      band.position.set(0, refs.top.y, 0); g.add(band);
      for (const sx of [-.12, 0, .12]) m3cone(g, .045, .14, m3mat(C), sx, refs.top.y + .12, 0);
    }
    else if (tag === 'flames') {
      for (const sx of [-.14, 0, .14]) m3cone(g, .08, .34, m3mat(C, C, .8), sx, refs.top.y + .1, 0);
    }
    else if (tag === 'crystals') {
      for (const [sx, sy2, sz2] of [[-.24, .3, 0], [.24, .34, 0], [0, .5, -.1]]) {
        const q = new THREE_NS.Mesh(new THREE_NS.OctahedronGeometry(.09), m3mat(C, C, .4));
        q.position.set(sx, refs.top.y - .2 + sy2, sz2); g.add(q);
      }
    }
    else if (tag === 'snowcap') { m3ball(g, .3, m3mat(0xf0f8ff), 0, refs.top.y - .05, 0, .45); }
    else if (tag === 'bubbles') {
      const bm = new THREE_NS.MeshLambertMaterial({ color: C, transparent: true, opacity: .65 });
      m3ball(g, .09, bm, -.3, .7, .2); m3ball(g, .07, bm, .32, .85, .1); m3ball(g, .06, bm, .05, 1.0, .25);
    }
    else if (tag === 'aura') {
      const q = new THREE_NS.Mesh(new THREE_NS.SphereGeometry(.85, 12, 10),
        new THREE_NS.MeshLambertMaterial({ color: C, transparent: true, opacity: .16 }));
      q.position.set(0, .8, 0); g.add(q);
    }
    else if (tag === 'rage' && refs.eyes) {
      for (const e of refs.eyes) { e.material.emissive = new THREE_NS.Color(col || '#ff4030'); e.material.emissiveIntensity = 1; }
    }
    else if (tag === 'bigeye') {
      m3ball(g, .16, M.white, refs.face.x, refs.face.y, refs.face.z + .02);
      m3ball(g, .07, M.dark, refs.face.x, refs.face.y, refs.face.z + .14);
    }
    else if (tag === 'helm') {
      const q = new THREE_NS.Mesh(new THREE_NS.SphereGeometry(.24, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m3mat(0x7a5230));
      q.position.set(0, refs.top.y - .2, 0); g.add(q);
    }
    else if (tag === 'pads') {
      m3box(g, .2, .14, .24, m3mat(0x3f5c33), -refs.sh.spread, refs.sh.y, 0);
      m3box(g, .2, .14, .24, m3mat(0x3f5c33), refs.sh.spread, refs.sh.y, 0);
    }
    else if (tag === 'bow') {
      const arc = new THREE_NS.Mesh(new THREE_NS.TorusGeometry(.34, .03, 8, 18, Math.PI), m3mat(C));
      arc.position.set(refs.sh.spread + .12, refs.sh.y - .1, 0); g.add(arc);
    }
    else if (tag === 'sword') { m3box(g, .09, .6, .04, m3mat(C), refs.sh.spread + .14, refs.sh.y - .2, .1); }
    else if (tag === 'moss') { m3ball(g, .12, m3mat(0x5aa05a), -.2, .7, .3); m3ball(g, .09, m3mat(0x5aa05a), .22, 1.1, -.1); }
  }
}
function rigSlime3D(M) {
  const g = new THREE_NS.Group();
  const body = m3ball(g, .55, M.main, 0, .5, 0); body.scale.y = .82;
  m3ball(g, .15, M.white, -.2, .72, .36);
  const eL = m3ball(g, .09, M.dark, -.18, .6, .44);
  const eR = m3ball(g, .09, M.dark, .18, .6, .44);
  return { root: g, eyes: [eL, eR], top: { y: 1.0, spread: .2 }, face: { x: 0, y: .6, z: .5 },
    anim(ph, t, moving) {
      const k = moving ? Math.sin(ph) * .07 : Math.sin(t / 500) * .025;
      body.scale.set(1 + k, .82 * (1 - k), 1 + k);
      g.position.y = moving ? Math.abs(Math.sin(ph)) * .1 : 0;
    } };
}
function rigGoblin3D(M) {
  const g = new THREE_NS.Group();
  const legL = m3limb(g, -.13, .8, .16, .75, M.shade);
  const legR = m3limb(g, .13, .8, .16, .75, M.shade);
  m3box(g, .42, .5, .3, M.main, 0, 1.05, 0);
  const armL = m3limb(g, -.3, 1.22, .13, .5, M.main);
  const armR = m3limb(g, .3, 1.22, .13, .5, M.main);
  m3ball(g, .3, M.main, 0, 1.5, 0);
  m3cone(g, .09, .34, M.main, -.4, 1.55, 0, 0, 1.25);
  m3cone(g, .09, .34, M.main, .4, 1.55, 0, 0, -1.25);
  const eL = m3ball(g, .07, M.dark, -.12, 1.52, .26);
  const eR = m3ball(g, .07, M.dark, .12, 1.52, .26);
  return { root: g, eyes: [eL, eR], top: { y: 1.82, spread: .15 }, face: { x: 0, y: 1.5, z: .32 }, sh: { y: 1.2, spread: .35 },
    anim(ph, t, moving) {
      const w = moving ? Math.sin(ph) : 0, a = moving ? .6 : 0;
      legL.rotation.x = w * a; legR.rotation.x = -w * a;
      armL.rotation.x = -w * a * .7; armR.rotation.x = w * a * .7;
      g.position.y = moving ? Math.abs(w) * .06 : Math.sin(t / 700) * .015;
    } };
}
function rigWolf3D(M) {
  const g = new THREE_NS.Group();
  m3box(g, .5, .45, .95, M.main, 0, .62, -.05);
  m3box(g, .34, .34, .34, M.main, 0, .82, .5);
  m3box(g, .16, .14, .2, M.shade, 0, .72, .72);
  m3cone(g, .08, .2, M.main, -.14, 1.05, .45);
  m3cone(g, .08, .2, M.main, .14, 1.05, .45);
  const eL = m3ball(g, .055, M.dark, -.1, .86, .66);
  const eR = m3ball(g, .055, M.dark, .1, .86, .66);
  const legs = [];
  for (const [sx, sz] of [[-.18, .3], [.18, .3], [-.18, -.38], [.18, -.38]]) {
    const l = m3limb(g, sx, .42, .13, .42, M.shade);
    legs.push(l);
  }
  const tail = m3box(g, .1, .1, .4, M.shade, 0, .75, -.62);
  tail.rotation.x = -.5;
  return { root: g, eyes: [eL, eR], top: { y: 1.15, spread: .2 }, face: { x: 0, y: .84, z: .72 },
    anim(ph, t, moving) {
      const w = moving ? Math.sin(ph) : 0, a = moving ? .7 : 0;
      legs[0].rotation.x = w * a; legs[3].rotation.x = w * a;
      legs[1].rotation.x = -w * a; legs[2].rotation.x = -w * a;
      tail.rotation.z = Math.sin(t / 300) * .3;
      g.position.y = moving ? Math.abs(w) * .05 : 0;
    } };
}
function rigSkeleton3D(M) {
  const g = new THREE_NS.Group();
  const legL = m3limb(g, -.13, .85, .13, .8, M.main);
  const legR = m3limb(g, .13, .85, .13, .8, M.main);
  m3box(g, .4, .5, .26, M.main, 0, 1.1, 0);
  for (let i = 0; i < 3; i++) m3box(g, .46, .05, .3, M.shade, 0, .95 + i * .12, 0);
  const armL = m3limb(g, -.28, 1.28, .11, .55, M.main);
  const armR = m3limb(g, .28, 1.28, .11, .55, M.main);
  m3ball(g, .28, M.main, 0, 1.62, 0);
  m3box(g, .1, .12, .05, M.dark, -.1, 1.64, .24);
  m3box(g, .1, .12, .05, M.dark, .1, 1.64, .24);
  return { root: g, eyes: [], top: { y: 1.92, spread: .15 }, face: { x: 0, y: 1.62, z: .3 }, sh: { y: 1.28, spread: .33 },
    anim(ph, t, moving) {
      const w = moving ? Math.sin(ph) : 0, a = moving ? .55 : 0;
      legL.rotation.x = w * a; legR.rotation.x = -w * a;
      armL.rotation.x = -w * a * .7; armR.rotation.x = w * a * .7;
      g.position.y = moving ? Math.abs(w) * .05 : 0;
      g.rotation.z = moving ? Math.sin(ph) * .03 : 0;
    } };
}
function rigOrc3D(M) {
  const g = new THREE_NS.Group();
  const legL = m3limb(g, -.2, .7, .24, .65, M.shade);
  const legR = m3limb(g, .2, .7, .24, .65, M.shade);
  m3box(g, .75, .7, .5, M.main, 0, 1.05, 0);
  const armL = m3limb(g, -.5, 1.3, .22, .7, M.main);
  const armR = m3limb(g, .5, 1.3, .22, .7, M.main);
  m3box(g, .4, .34, .36, M.main, 0, 1.6, .05);
  m3box(g, .44, .16, .38, M.shade, 0, 1.44, .06);
  m3cone(g, .05, .16, M.white, -.12, 1.56, .24);
  m3cone(g, .05, .16, M.white, .12, 1.56, .24);
  const eL = m3ball(g, .07, M.dark, -.13, 1.72, .22);
  const eR = m3ball(g, .07, M.dark, .13, 1.72, .22);
  return { root: g, eyes: [eL, eR], top: { y: 1.95, spread: .25 }, face: { x: 0, y: 1.66, z: .3 }, sh: { y: 1.3, spread: .55 },
    anim(ph, t, moving) {
      const w = moving ? Math.sin(ph) : 0, a = moving ? .5 : 0;
      legL.rotation.x = w * a; legR.rotation.x = -w * a;
      armL.rotation.x = -w * a * .6; armR.rotation.x = w * a * .6;
      g.position.y = moving ? Math.abs(w) * .07 : Math.sin(t / 800) * .02;
      g.rotation.z = moving ? Math.sin(ph) * .05 : 0;
    } };
}
function rigLich3D(M) {
  const g = new THREE_NS.Group();
  const robe = new THREE_NS.Mesh(new THREE_NS.CylinderGeometry(.3, .52, 1.0, 10), M.main);
  robe.position.set(0, .5, 0); g.add(robe);
  m3box(g, .5, .3, .3, M.main, 0, 1.1, 0);
  const armL = m3limb(g, -.32, 1.2, .12, .5, M.main);
  const armR = m3limb(g, .32, 1.2, .12, .5, M.main);
  m3ball(g, .26, M.main, 0, 1.5, 0);
  const eL = m3ball(g, .06, M.dark, -.1, 1.54, .22);
  const eR = m3ball(g, .06, M.dark, .1, 1.54, .22);
  eL.material.emissive = new THREE_NS.Color(0x7fe3ff); eL.material.emissiveIntensity = .9;
  eR.material.emissive = new THREE_NS.Color(0x7fe3ff); eR.material.emissiveIntensity = .9;
  const staff = new THREE_NS.Mesh(new THREE_NS.CylinderGeometry(.035, .035, 1.2, 8), m3mat(0x4a3524));
  staff.position.set(.42, .8, .1); g.add(staff);
  const orb = new THREE_NS.Mesh(new THREE_NS.IcosahedronGeometry(.11, 0), m3mat(M.orbC || 0x8b6bff, M.orbC || 0x8b6bff, .9));
  orb.position.set(.42, 1.5, .1); g.add(orb);
  return { root: g, eyes: [eL, eR], top: { y: 1.8, spread: .15 }, face: { x: 0, y: 1.5, z: .28 }, sh: { y: 1.2, spread: .37 },
    anim(ph, t, moving) {
      g.position.y = .12 + Math.sin(t / 450) * .07;
      g.rotation.z = Math.sin(t / 600) * .04;
      armL.rotation.x = Math.sin(t / 500) * .12 - .2;
      armR.rotation.x = -Math.sin(t / 500) * .12 - .2;
    } };
}
const MOB_BUILDERS3D = { slime: rigSlime3D, goblin: rigGoblin3D, wolf: rigWolf3D, skeleton: rigSkeleton3D, orc: rigOrc3D, lich: rigLich3D };
function mobRig3D(base, main, shadeC, fx) {
  const M = { main: m3mat(main), shade: m3mat(shadeC), dark: m3mat(0x1a1d24), white: m3mat(0xffffff), orbC: main };
  const b = (MOB_BUILDERS3D[base] || rigSlime3D)(M);
  mobFx3D(b.root, b, M, fx || []);
  return b;
}
function mobFrames3D(base, main, shadeC, fxkey, fx) {
  const key = base + '|' + main + '|' + shadeC + '|' + fxkey;
  let set = mobFrameCache.get(key);
  if (set) { mobFrameCache.delete(key); mobFrameCache.set(key, set); return set; }
  set = bakeMobFrames(base, main, shadeC, fx);
  mobFrameCache.set(key, set);
  while (mobFrameCache.size > 24) mobFrameCache.delete(mobFrameCache.keys().next().value);
  return set;
}
function bakeMobFrames(base, main, shadeC, fx) {
  if (!bakeR3D) {
    const T = THREE_NS;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 112;
    bakeR3D = new T.WebGLRenderer({ canvas: cv, alpha: true, antialias: true });
    bakeR3D.setSize(112, 112, false);
    bakeR3D.setClearColor(0x000000, 0);
    bakeS3D = new T.Scene();
    bakeS3D.add(new T.HemisphereLight(0xffffff, 0x334455, .95));
    const dl = new T.DirectionalLight(0xfff2d8, 1.25);
    dl.position.set(2, 4, 3);
    bakeS3D.add(dl);
    bakeC3D = new T.PerspectiveCamera(28, 1, .1, 50);
    bakeC3D.position.set(1.1, 1.5, 4.6);
    bakeC3D.lookAt(0, .95, 0);
  }
  const rig = mobRig3D(base, main, shadeC, fx);
  rig.root.scale.setScalar({ slime: 1.15, goblin: 1.1, wolf: 1.6, skeleton: 1.1, orc: 1.6, lich: 1.5 }[base] || 1);
  bakeS3D.add(rig.root);
  const shot = () => {
    bakeR3D.render(bakeS3D, bakeC3D);
    const c = document.createElement('canvas');
    c.width = c.height = 112;
    c.getContext('2d').drawImage(bakeR3D.domElement, 0, 0);
    return c;
  };
  const idle = [], walk = [];
  for (let i = 0; i < 2; i++) { rig.anim(0, 1000 + i * 500, false); idle.push(shot()); }
  for (let i = 0; i < 4; i++) { rig.anim((i + .5) / 4 * Math.PI * 2, 1000, true); walk.push(shot()); }
  bakeS3D.remove(rig.root);
  return { idle, walk };
}
const mobKindCache = new Map();
function mobKindByName(nm) {
  let k = mobKindCache.get(nm);
  if (!k) { k = kindByName(nm); mobKindCache.set(nm, k); }
  return k;
}
function drawMob3D(s, now, name, x, y, scale, opts, extra) {
  opts = opts || {};
  try {
    if (threeState === 'idle') initThree();
    if (threeState !== 'ready' || !THREE_NS) throw 0;
    const def = s.def || {};
    const kk = s.kind ? mobKindByName(s.kind) : null; /* 스탯 폴백과 무관하게 kind 정본 팔레트 */
    const main = (kk && kk.main) || def.main || def.color || '#888888';
    const sh = (kk && kk.shade) || def.shade || '#555555';
    const fx = (kk && kk.fx) || def.fx || [];
    const set = mobFrames3D(extra.base, main, sh, JSON.stringify(fx), fx);
    const fr = s.movingF ? set.walk[Math.floor(now / 140 + (s.blink || 0) / 500) % 4] : set.idle[Math.floor(now / 500) % 2];
    const sc = extra.rowsPx * scale / 96 * (s.uniq ? 1.23 : 1);
    const yy = y + (opts.bob || 0);
    ctx.save();
    ctx.translate(x, yy);
    if (opts.flip) ctx.scale(-1, 1);
    ctx.scale(opts.squashX || 1, opts.squashY || 1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(fr, -56 * sc, -100 * sc, 112 * sc, 112 * sc);
    ctx.restore();
    hitFlashOverlay(ctx, s, now, (sdef(s).r || 16) * 1.4);
  } catch (e) {
    drawSprite(name, x, y, scale, opts);
  }
}
function drawSlime(s, now) {
  const wob = Math.sin(now / 140 + s.blink);
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(s.x, s.y + 10, r0(s) * .95, r0(s) * .36, 0, 0, 7); ctx.fill();
  if (s.uniq) uniqAura(s, now);
  const flash = s.hitFlash ? clampN(1 - (now - s.hitFlash) / 150, 0, 1) * .85 : 0;
  if (!drawMobSheet(s, 'slime', s.x, s.y + 9, { squashX: 1 + wob * .07, squashY: 1 - wob * .07, flash, bob: s.movingF ? Math.abs(Math.sin(now / 140 + s.blink)) * 3 : 0 }))
    drawSprite(s.sprId || 'slime', s.x, s.y + 9, s.uniq ? 5.6 : 4.5, { squashX: 1 + wob * .07, squashY: 1 - wob * .07, flash, bob: s.movingF ? Math.abs(Math.sin(now / 140 + s.blink)) * 3 : 0 });
  drawKindExtras(s, now);
  mobUI(s, false);
}
function r0(s) { return sdef(s).r; }

function drawGoblin(s, now) {
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(s.x, s.y + 12, r0(s) * .95, r0(s) * .36, 0, 0, 7); ctx.fill();
  if (s.uniq) uniqAura(s, now);
  const flash = s.hitFlash ? clampN(1 - (now - s.hitFlash) / 150, 0, 1) * .85 : 0;
  if (!drawMobSheet(s, 'goblin', s.x, s.y + 11, { flash, bob: s.movingF ? Math.abs(Math.sin(now / 110)) * 3 : 0 }))
    drawSprite(s.sprId || 'goblin', s.x, s.y + 11, s.uniq ? 5.6 : 4.5, { flash, bob: s.movingF ? Math.abs(Math.sin(now / 110)) * 3 : 0 });
  drawKindExtras(s, now);
  mobUI(s, false);
}

function drawWolf(s, now) {
  const flip = Math.cos(s.dirA ?? 0) < 0 ? -1 : 1;
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(s.x, s.y + 13, r0(s) * 1.2, r0(s) * .32, 0, 0, 7); ctx.fill();
  if (s.uniq) uniqAura(s, now);
  const flash = s.hitFlash ? clampN(1 - (now - s.hitFlash) / 150, 0, 1) * .85 : 0;
  if (!drawMobSheet(s, 'wolf', s.x, s.y + 12, { flash, bob: s.movingF ? Math.abs(Math.sin(now / 75)) * 2 : 0 }))
    drawSprite(s.sprId || 'wolf', s.x, s.y + 12, s.uniq ? 5.6 : 4.5, { flip: flip < 0, flash, bob: s.movingF ? Math.abs(Math.sin(now / 75)) * 2 : 0 });
  drawKindExtras(s, now);
  mobUI(s, false);
}

function drawSkeleton(s, now) {
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(s.x, s.y + 12, r0(s) * .9, r0(s) * .34, 0, 0, 7); ctx.fill();
  if (s.uniq) uniqAura(s, now);
  const flash = s.hitFlash ? clampN(1 - (now - s.hitFlash) / 150, 0, 1) * .85 : 0;
  if (!drawMobSheet(s, 'skeleton', s.x, s.y + 11, { flash, bob: s.movingF ? Math.abs(Math.sin(now / 120)) * 3 : 0 }))
    drawSprite(s.sprId || 'skeleton', s.x, s.y + 11, s.uniq ? 6.2 : 5, { flash, bob: s.movingF ? Math.abs(Math.sin(now / 120)) * 3 : 0 });
  drawKindExtras(s, now);
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
  if (!drawMobSheet(s, 'lich', s.x, s.y + 16 - fl, { flash }))
    drawSprite(s.sprId || 'lich', s.x, s.y + 16 - fl, s.uniq ? 6.6 : 5.5, { flash });
  drawKindExtras(s, now);
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
  if (!drawMobSheet(s, 'orc', s.x, s.y + 16, { flash, bob: Math.sin(now / 300) * 2 }))
    drawSprite(s.sprId || 'orc', s.x, s.y + 16, s.uniq ? 6.6 : 5.5, { flash, bob: Math.sin(now / 300) * 2 });
  drawKindExtras(s, now);

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
      /* 하단 고정 UI(핫바·좌측독 가로줄·모바일바) 중 가장 위쪽을 기준으로 캐릭터가 가려지지 않게 */
      let top = Infinity;
      for (const id of ['mobileBar', 'hotbar', 'dockL']) {
        const r = $(id)?.getBoundingClientRect();
        if (r && r.height && r.top < top) top = r.top;
      }
      if (top < Infinity) B = innerHeight - top + 8;
    }
    uiInsetCache.T = T; uiInsetCache.B = B; uiInsetCache.t = now;
  }
  return uiInsetCache;
}
addEventListener('resize', () => { uiInsetCache.t = 0; }); /* 회전/리사이즈 시 인셋 즉시 재계산 */
/* 줍기 자석 비행 렌더 */
function drawPickFlights(now) {
  for (let i = pickFx.length - 1; i >= 0; i--) {
    const f = pickFx[i];
    const k = (now - f.t0) / PICK_MS;
    if (k >= 1) { pickFx.splice(i, 1); continue; }
    const e = k * k; /* 가속 흡입 */
    const x = f.x0 + (me.x - f.x0) * e, y = f.y0 + ((me.y - 22) - f.y0) * e;
    const it = getItem(f.itemId);
    const col = it.color || '#ffd700';
    ctx.fillStyle = col; ctx.globalAlpha = .35 * (1 - k * .5);
    ctx.beginPath(); ctx.arc(x, y, 10 * (1 - k * .5), 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    drawItemIcon(f.itemId, x, y + 12, 30 * (1 - k * .55), {});
    if ((k * 7 | 0) !== ((k - .04) * 7 | 0)) poofs.push({ x, y, vx: rand(-20, 20), vy: rand(-20, 20), r: 1.6, t: 0, color: col, g: 0 });
  }
}
/* 필드 드랍 렌더 (등급별 네온) — draw() + 스테이지 공용 */
function drawLootItems(now) {
  for (const [lid2, l] of Object.entries(lootItems)) {
    if ((l.map || 'm1') !== myMap()) continue;
    if (pickHide.has(lid2)) continue; /* 날아가는 중: 본체는 숨기고 비행 연출만 */
    const it = getItem(l.itemId);
    if (!it) continue;
    const bob = Math.sin(now / 300 + l.x) * 3;
    const R = it.rarity || 'common';
    const rank = RARITY_RANK[R] ?? 0;
    const ncol = RARITY_COLOR[R] || '#aaa';
    const hx = ncol.replace('#', '');
    const hx6 = hx.length === 3 ? hx.split('').map(ch => ch + ch).join('') : hx; /* #aaa 같은 3자리 대응 */
    const nr = parseInt(hx6.slice(0, 2), 16) || 0, ng = parseInt(hx6.slice(2, 4), 16) || 0, nb = parseInt(hx6.slice(4, 6), 16) || 0;
    const ncol3 = `${nr},${ng},${nb}`;
    const pulse = .5 + Math.sin(now / 260 + l.x * 1.7) * .28;
    const age = now - (l.ts || 0);
    const landing = (age >= 0 && age < 450) ? 1 - age / 450 : 0; /* 착지 팝 */
    /* 네온 후광 */
    const haloR = 13 + rank * 2.5;
    const hg = ctx.createRadialGradient(l.x, l.y - 4, 2, l.x, l.y - 4, haloR * 1.9);
    hg.addColorStop(0, `rgba(${ncol3},${.34 * pulse + .12})`);
    hg.addColorStop(1, `rgba(${ncol3},0)`);
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(l.x, l.y - 4, haloR * 1.9, 0, 7); ctx.fill();
    /* 네온 광기둥 (고급 이상, 등급별 높이·너비) */
    if (rank >= 1) {
      const beamH = 120 + rank * 70 + Math.sin(now / 300 + l.y) * 12;
      const bw = 5 + rank * 2.6;
      const flick = .75 + Math.sin(now / 110 + l.x) * .15 + Math.sin(now / 263 + l.y) * .1;
      const g = ctx.createLinearGradient(0, l.y, 0, l.y - beamH);
      g.addColorStop(0, `rgba(${ncol3},${.5 * flick})`);
      g.addColorStop(1, `rgba(${ncol3},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(l.x - bw, l.y);
      ctx.lineTo(l.x + bw, l.y);
      ctx.lineTo(l.x + bw * .25, l.y - beamH);
      ctx.lineTo(l.x - bw * .25, l.y - beamH);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${.45 * flick * Math.min(1, rank / 3)})`;
      ctx.fillRect(l.x - 1, l.y - beamH, 2, beamH);
      if (rank >= 4) {
        for (let i = 0; i < 10; i++) {
          const sd = l.x * 13.7 + i * 97.3;
          const py = l.y - ((now * (.05 + (i % 4) * .018) + sd * 57) % beamH);
          const px = l.x + Math.sin(sd + now / 700) * (bw + 8) * (.3 + (i % 5) / 5);
          const tw = Math.max(0, Math.sin(now / 130 + i * 2.4 + sd));
          if (tw < .15) continue;
          const sz2 = 1.6 + (i % 3) * .9;
          ctx.fillStyle = `rgba(${ncol3},${tw * .95})`;
          ctx.fillRect(px - sz2 / 2, py - sz2 / 2, sz2, sz2);
          ctx.fillStyle = `rgba(255,255,255,${tw * .9})`;
          ctx.fillRect(px - sz2 * .18, py - sz2 * 1.7, sz2 * .36, sz2 * 3.4);
          ctx.fillRect(px - sz2 * 1.7, py - sz2 * .18, sz2 * 3.4, sz2 * .36);
        }
      }
    }
    /* 파동 링 (희귀 이상, 등급별 개수) */
    const ringN = rank >= 4 ? 2 : rank >= 2 ? 1 : 0;
    for (let i = 0; i < ringN; i++) {
      const rr = 9 + ((now / 2.6 + l.x + i * 15) % 30);
      ctx.strokeStyle = `rgba(${ncol3},${clampN(1 - rr / 42, 0, 1) * .8})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.ellipse(l.x, l.y + 1, rr, rr * .42, 0, 0, 7); ctx.stroke();
    }
    /* 착지 플래시 */
    if (landing > 0) {
      const lr = 10 + (1 - landing) * 34;
      ctx.strokeStyle = `rgba(${ncol3},${landing * .9})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(l.x, l.y + 1, lr, lr * .42, 0, 0, 7); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,.30)';
    ctx.beginPath(); ctx.ellipse(l.x, l.y + 2, 8, 3.2, 0, 0, 7); ctx.fill();
    drawItemIcon(l.itemId, l.x, l.y + 8 + bob, 30 * (1 + landing * .55), { rot: Math.sin(now / 500 + l.y) * .07, squashX: 1 + landing * .25, squashY: 1 - landing * .2 });
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(${ncol3},.95)`;
    outlinedText(it.name, l.x, l.y + 26, 2.5);
  }
}
/* 미니맵 — draw() + 3D씬 공용 */
function updateMinimap(now) {
  mctx.clearRect(0, 0, 160, 120);
  mctx.globalAlpha = .85;
  { const t = getTex(myMap()); mctx.drawImage(t, 0, 0, t.width, t.height, 0, 0, 160, 120); }
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
    mctx.strokeRect(view.x * k, view.y * k, Math.min(160, cvW / (view.z || 1) * k), Math.min(120, cvH / (view.z || 1) * k)); /* 실제 화면 영역 */
  }
}
/* ================= 3D 풀씬 (?3d=1) =================
   로직은 2D 그대로, 렌더만 Three.js로. 실패하면 2D로 폴백 */
const SCENE3D = false; /* ?3d=1 진입 차단 — 항상 2D 렌더 */
let sceneLive = false, sceneFailed = false;
let renderer3D = null, scene3D = null, cam3D = null, ground3D = null, groundTex3D = null, groundMap3D = '';
let glFxEl = null, camT3D = { x: 800, y: 600 }, lastW3D = 0, lastH3D = 0;
const texCache3D = new Map(), beamTexCache3D = new Map();
let blobTex3D = null, glowTex3D = null;
const charNodes3D = new Map(), mobNodes3D = new Map(), lootNodes3D = new Map();
let ringPool3D = [], shotPool3D = [], floatPool3D = [], sparkPts3D = null, sparkPos3D = null, sparkCol3D = null;
const floatUse3D = new Map();
let gateGroup3D = null, gateKey3D = '';
const _v3a = { v: null };
function cssToRgb3D(s) {
  if (!s) return [1, 1, 1];
  s = String(s).trim();
  let m = s.match(/^rgba?\(([^)]+)\)/);
  if (m) { const p = m[1].split(',').map(Number); return [p[0] / 255, p[1] / 255, p[2] / 255]; }
  if (s[0] === '#') {
    let h = s.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16) || 0;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  return [1, 1, 1];
}
function radialTex3D(inner, outer) {
  const cv2 = document.createElement('canvas');
  cv2.width = cv2.height = 128;
  const c = cv2.getContext('2d');
  const g = c.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
  const t = new THREE_NS.CanvasTexture(cv2);
  t.colorSpace = THREE_NS.SRGBColorSpace;
  return t;
}
function spriteTex3D(key) {
  let t = texCache3D.get(key);
  if (!t) {
    t = new THREE_NS.CanvasTexture(buildSprite(key).cv);
    t.colorSpace = THREE_NS.SRGBColorSpace;
    t.magFilter = THREE_NS.LinearFilter;
    t.minFilter = THREE_NS.LinearMipmapLinearFilter;
    t.anisotropy = 8;
    texCache3D.set(key, t);
  }
  return t;
}
function hexToRgb3(hex) {
  let h = String(hex || '#aaa').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16) || 0;
  return [((n >> 16) & 255), ((n >> 8) & 255), (n & 255)];
}
function beamTex3D(rgb) {
  let t = beamTexCache3D.get(rgb);
  if (!t) {
    const cv2 = document.createElement('canvas');
    cv2.width = 32; cv2.height = 256;
    const c = cv2.getContext('2d');
    const g = c.createLinearGradient(0, 256, 0, 0);
    g.addColorStop(0, `rgba(${rgb},.85)`);
    g.addColorStop(.3, `rgba(${rgb},.35)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 256);
    c.fillStyle = 'rgba(255,255,255,.8)';
    c.fillRect(13, 0, 6, 256);
    t = new THREE_NS.CanvasTexture(cv2);
    t.colorSpace = THREE_NS.SRGBColorSpace;
    beamTexCache3D.set(rgb, t);
  }
  return t;
}
function plate3D(w = 256, h = 64) {
  const cv2 = document.createElement('canvas');
  cv2.width = w; cv2.height = h;
  const tex = new THREE_NS.CanvasTexture(cv2);
  tex.colorSpace = THREE_NS.SRGBColorSpace;
  const sp = new THREE_NS.Sprite(new THREE_NS.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.renderOrder = 10;
  return { sp, cv: cv2, cx: cv2.getContext('2d'), tex, key: '' };
}
function drawPlate3D(p, name, nameColor, frac, showBar) {
  const key = name + '|' + (showBar ? Math.ceil(frac * 20) : 'x') + '|' + nameColor;
  if (key === p.key) return;
  p.key = key;
  const c = p.cx, W = p.cv.width, H = p.cv.height;
  c.clearRect(0, 0, W, H);
  c.font = 'bold 26px sans-serif'; c.textAlign = 'center';
  c.shadowColor = 'rgba(0,0,0,.9)'; c.shadowBlur = 6;
  c.fillStyle = nameColor; c.fillText(name, W / 2, showBar ? 26 : 42);
  if (showBar) {
    c.shadowBlur = 0;
    c.fillStyle = 'rgba(0,0,0,.62)';
    c.fillRect(W / 2 - 70, 34, 140, 14);
    c.fillStyle = frac > .3 ? '#2ecc71' : '#e74c3c';
    c.fillRect(W / 2 - 68, 36, 136 * Math.max(0, Math.min(1, frac)), 10);
  }
  p.tex.needsUpdate = true;
}
function disposeGroup3D(g) {
  g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) { if (m.map && m.map.__shared3D) continue; if (m.map) m.map.dispose(); m.dispose(); }
    }
  });
}
function markShared3D(tex) { tex.__shared3D = true; return tex; }
function initScene3D() {
  if (sceneLive || sceneFailed) return sceneLive;
  if (threeState === 'idle') initThree();
  if (threeState !== 'ready' || !THREE_NS) return false;
  try {
    const T = THREE_NS;
    const mob = innerWidth <= 640;
    renderer3D = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer3D.setPixelRatio(Math.min(devicePixelRatio || 1, mob ? 2 : 2.5));
    renderer3D.setSize(innerWidth, innerHeight);
    renderer3D.domElement.id = 'gl';
    renderer3D.domElement.style.cssText = 'position:fixed;inset:0;z-index:0;';
    document.body.appendChild(renderer3D.domElement);
    cv.style.display = 'none';
    glFxEl = document.createElement('div');
    glFxEl.style.cssText = 'position:fixed;inset:0;z-index:5;pointer-events:none;';
    document.body.appendChild(glFxEl);
    scene3D = new T.Scene();
    scene3D.background = new T.Color(0x0b1220);
    scene3D.fog = new T.Fog(0x0b1220, 900, 2400);
    cam3D = new T.PerspectiveCamera(50, innerWidth / innerHeight, 10, 6000);
    cam3D.position.set(800, 950, 1240);
    cam3D.lookAt(800, 0, 600);
    scene3D.add(new T.HemisphereLight(0xbfd4ff, 0x2a3a2a, .8));
    const dl = new T.DirectionalLight(0xffe8c0, 1.35);
    dl.position.set(1100, 500, 850);
    dl.target.position.set(800, 0, 600);
    scene3D.add(dl); scene3D.add(dl.target);
    window.__dirLight3D = dl;
    if (!mob) {
      renderer3D.shadowMap.enabled = true;
      renderer3D.shadowMap.type = T.PCFSoftShadowMap;
      dl.castShadow = true;
      dl.shadow.mapSize.set(2048, 2048);
      dl.shadow.camera.left = -380; dl.shadow.camera.right = 380;
      dl.shadow.camera.top = 380; dl.shadow.camera.bottom = -380;
      dl.shadow.camera.near = 50; dl.shadow.camera.far = 1600;
    }
    const gg = new T.PlaneGeometry(WORLD.w, WORLD.h);
    ground3D = new T.Mesh(gg, new T.MeshLambertMaterial({ color: 0xffffff }));
    ground3D.rotation.x = -Math.PI / 2;
    ground3D.position.set(WORLD.w / 2, 0, WORLD.h / 2);
    ground3D.receiveShadow = !mob;
    scene3D.add(ground3D);
    blobTex3D = markShared3D(radialTex3D('rgba(0,0,0,.5)', 'rgba(0,0,0,0)'));
    glowTex3D = markShared3D(radialTex3D('rgba(255,255,255,.9)', 'rgba(255,255,255,0)'));
    const blobGeo = new T.CircleGeometry(1, 20);
    window.__blobGeo3D = blobGeo;
    for (let i = 0; i < 18; i++) {
      const m = new T.Mesh(new T.RingGeometry(.86, 1, 40),
        new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = 3; m.visible = false;
      scene3D.add(m); ringPool3D.push(m);
    }
    const shotGeo = new T.SphereGeometry(1, 10, 8);
    for (let i = 0; i < 24; i++) {
      const m = new T.Mesh(shotGeo, new T.MeshBasicMaterial({ color: 0xffffff }));
      m.visible = false; m.userData.col = '';
      scene3D.add(m); shotPool3D.push(m);
    }
    for (let i = 0; i < 12; i++) {
      const p = plate3D(256, 80);
      p.sp.visible = false;
      p.sp.scale.set(120, 37, 1);
      scene3D.add(p.sp);
      floatPool3D.push({ ...p, ref: null, born: 0 });
    }
    const N = 140;
    sparkPos3D = new Float32Array(N * 3);
    sparkCol3D = new Float32Array(N * 3);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(sparkPos3D, 3));
    g.setAttribute('color', new T.BufferAttribute(sparkCol3D, 3));
    sparkPts3D = new T.Points(g, new T.PointsMaterial({ size: 7, vertexColors: true, transparent: true, opacity: .95, depthWrite: false }));
    sparkPts3D.frustumCulled = false;
    scene3D.add(sparkPts3D);
    _v3a.v = new T.Vector3();
    sceneLive = true;
  } catch (e) { sceneFailed = true; }
  return sceneLive;
}
function syncGround3D() {
  const mp = myMap();
  if (mp === groundMap3D && groundTex3D) return;
  const tex = new THREE_NS.CanvasTexture(getTex(mp));
  tex.colorSpace = THREE_NS.SRGBColorSpace;
  tex.anisotropy = renderer3D.capabilities.getMaxAnisotropy();
  if (groundTex3D) groundTex3D.dispose();
  groundTex3D = tex;
  ground3D.material.map = tex;
  ground3D.material.needsUpdate = true;
  groundMap3D = mp;
}
function followCam3D(now, dt) {
  const k = Math.min(1, dt * .008);
  camT3D.x += ((me.x + (me.vx || 0) * .22) - camT3D.x) * k;
  camT3D.y += ((me.y + (me.vy || 0) * .22) - camT3D.y) * k;
  camT3D.x = clampN(camT3D.x, 150, WORLD.w - 150);
  camT3D.y = clampN(camT3D.y, 100, WORLD.h - 100);
  cam3D.position.set(camT3D.x, 780, camT3D.y + 520);
  cam3D.lookAt(camT3D.x, 0, camT3D.y);
  const dl = window.__dirLight3D;
  if (dl) {
    dl.position.set(camT3D.x + 300, 500, camT3D.y + 250);
    dl.target.position.set(camT3D.x, 0, camT3D.y);
    dl.target.updateMatrixWorld();
  }
  if (lastW3D !== innerWidth || lastH3D !== innerHeight) {
    lastW3D = innerWidth; lastH3D = innerHeight;
    renderer3D.setSize(innerWidth, innerHeight);
    cam3D.aspect = innerWidth / innerHeight;
    cam3D.updateProjectionMatrix();
  }
}
function charRig3D(pid, cls) {
  let rec = charNodes3D.get(pid);
  if (!rec || rec.cls !== cls) {
    if (rec) { scene3D.remove(rec.rig.refs.root); }
  const M = heroModel3D(cls, 'sc:' + pid + ':' + cls);
  /* 월드 단위(픽셀 스케일)에 맞춤 — 원본 리그가 미터 단위라 2px로 보였음 */
  if (!M._scaled60) { M.refs.root.scale.setScalar(60); M._scaled60 = true; }
  scene3D.add(M.refs.root);
    M.refs.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    const plate = plate3D();
    plate.sp.scale.set(120, 30, 1);
    scene3D.add(plate.sp);
    const blob = new THREE_NS.Mesh(window.__blobGeo3D,
      new THREE_NS.MeshBasicMaterial({ map: blobTex3D, transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 2;
    scene3D.add(blob);
    rec = { M, plate, blob, sig: '', cls };
    charNodes3D.set(pid, rec);
  }
  return rec;
}
function poseChar3D(pid, o, eq, now, moving, stepPh, dead, dt) {
  const cls = o.cls || 'warrior';
  const rec = charRig3D(pid, cls);
  const M = rec.M;
  const sig = JSON.stringify(eq);
  if (rec.sig !== sig) { applyHeroGear3D(M, cls, eq); rec.sig = sig; }
  const sw = (!dead && o.swing) ? (now - o.swing) / 220 : -1;
  const cast = (!dead && o.castFx && now - o.castFx.t0 < o.castFx.dur) ? o.castFx
    : ((!dead && o.isSelf && heroCast && now - heroCast.t0 < heroCast.dur) ? heroCast : null);
  const face = o.face ?? Math.PI / 2;
  poseHero3D(M, cls, o, moving, stepPh, Math.cos(face) < -.05, sw, now, dead, cast, Math.PI / 2 - face);
  const bobY = moving ? Math.abs(Math.sin(stepPh)) * 2.4 : Math.sin(now / 600) * .8;
  M.refs.root.position.set(o.x, bobY, o.y);
  if (moving) M.refs.root.rotation.z += Math.sin(stepPh) * .04;
  const showBar = !dead && o.hp < o.maxHp;
  rec.plate.sp.visible = true;
  rec.plate.sp.position.set(o.x, 148, o.y);
  drawPlate3D(rec.plate, o.name || '?', o.isSelf ? '#ffffff' : (CLASSES[cls]?.color || '#eee'), showBar ? (o.hp / o.maxHp) : 1, showBar);
  rec.blob.visible = true;
  rec.blob.position.set(o.x, 2, o.y);
  const bs = dead ? 20 : 17;
  rec.blob.scale.set(bs, bs, 1);
  return rec;
}
function syncChars3D(now, dt) {
  const seen = new Set(['me']);
  const myMoving = meMovingNow && !me.dead;
  const myStep = myMoving ? (Number.isFinite(me.stepPh) ? me.stepPh : now / 85) : 0;
  poseChar3D('me', { cls: myCls, equipped: me.equipped || {}, x: me.x, y: me.y, face: me.face ?? Math.PI / 2, moving: myMoving,
    stepPh: myStep, swing: me.swing, hp: me.hp, maxHp: maxHpOf(), name: myName, isSelf: true, dead: !!me.dead },
    me.equipped || {}, now, myMoving, myStep, !!me.dead, dt);
  for (const [id, p] of Object.entries(others)) {
    if (Date.now() - (p.lastSeen || 0) >= OFFLINE_MS || (p.map || 'm1') !== myMap()) continue;
    seen.add(id);
    const rec0 = charNodes3D.get(id);
    const px = rec0 ? rec0.lx ?? p.x : p.x, pz = rec0 ? rec0.lz ?? p.y : p.y;
    const dist = Math.hypot(p.x - px, p.y - pz);
    const mv = dist > 4 && !p.dead;
    const ph = ((rec0 ? rec0.ph ?? 0 : 0) + dist * .11) % (Math.PI * 2);
    let face = rec0 ? rec0.fc ?? Math.PI / 2 : Math.PI / 2;
    if (dist > 4) {
      let d = Math.atan2(p.y - pz, p.x - px) - face;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      face += d * Math.min(1, dt * .01);
    }
    poseChar3D(id, { cls: p.cls || 'warrior', equipped: p.equipped || {}, x: p.x, y: p.y, face, moving: mv, stepPh: ph,
      swing: 0, hp: p.hp ?? 100, maxHp: p.maxHp ?? 100, name: p.name, isSelf: false, dead: !!p.dead, castFx: null },
      p.equipped || {}, now, mv, ph, !!p.dead, dt);
    const rec = charNodes3D.get(id);
    rec.lx = p.x; rec.lz = p.y; rec.ph = ph; rec.fc = face;
  }
  for (const [pid, rec] of charNodes3D) {
    if (!seen.has(pid)) {
      scene3D.remove(rec.M.refs.root); scene3D.remove(rec.plate.sp); scene3D.remove(rec.blob);
      charNodes3D.delete(pid);
    }
  }
}
function spriteScale3D(key, r) {
  const sp = buildSprite(key);
  const w = r * 3.4;
  return [w, w * sp.h / sp.w];
}
function syncMobs3D(now) {
  const seen = new Set();
  for (const s of sims) {
    if (!s.alive || (s.map || 'm1') !== myMap()) continue;
    seen.add(s.id);
    const d = sdef(s);
    let nd = mobNodes3D.get(s.id);
    if (!nd) {
      const grp = new THREE_NS.Group();
      const spr = new THREE_NS.Sprite(new THREE_NS.SpriteMaterial({ map: spriteTex3D(s.sprId || s.type), transparent: true, depthWrite: false }));
      grp.add(spr);
      const blob = new THREE_NS.Mesh(window.__blobGeo3D,
        new THREE_NS.MeshBasicMaterial({ map: blobTex3D, transparent: true, depthWrite: false }));
      blob.rotation.x = -Math.PI / 2; blob.position.y = 1;
      grp.add(blob);
      const plate = plate3D(220, 56);
      plate.sp.scale.set(100, 25, 1);
      grp.add(plate.sp);
      const glow = new THREE_NS.Sprite(new THREE_NS.SpriteMaterial({ map: glowTex3D, transparent: true, depthWrite: false, blending: THREE_NS.AdditiveBlending, opacity: 0 }));
      grp.add(glow);
      scene3D.add(grp);
      nd = { grp, spr, blob, plate, glow };
      mobNodes3D.set(s.id, nd);
    }
    const key = s.sprId || s.type;
    if (nd._key !== key) { nd.spr.material.map = spriteTex3D(key); nd._key = key; }
    const [w, h] = spriteScale3D(key, d.r);
    nd.spr.scale.set(w, h, 1);
    const bob = s.movingF ? Math.abs(Math.sin(now / 120 + (s.blink || 0))) * 3 : 0;
    nd.grp.position.set(s.x, bob, s.y);
    nd.spr.position.y = h / 2 - 6;
    nd.blob.scale.set(d.r * 1.15, d.r * 1.15, 1);
    const fl = s.hitFlash ? clampN(1 - (now - s.hitFlash) / 150, 0, 1) : 0;
    nd.spr.material.color.setRGB(1, 1 - fl * .75, 1 - fl * .75);
    const isBoss = s.type === 'boss' || s.type === 'lich';
    const showBar = s.hp < d.hp || isBoss || !!s.uniq;
    nd.plate.sp.visible = true;
    nd.plate.sp.position.y = h + 16;
    drawPlate3D(nd.plate, `Lv${simLevel(s)} ${d.name}`, s.uniq ? '#ff8a5c' : isBoss ? '#ffb8b8' : '#ffffff', showBar ? (s.hp / d.hp) : 1, showBar);
    const ga = s.uniq ? .5 + Math.sin(now / 250) * .2 : (isBoss ? .3 + Math.sin(now / 300) * .1 : 0);
    nd.glow.material.opacity = ga;
    if (ga > 0) {
      nd.glow.material.color.set(s.uniq ? '#ff4d4d' : '#ff5040');
      const gs = d.r * 3.4;
      nd.glow.scale.set(gs, gs, 1);
      nd.glow.position.y = h / 2;
    }
  }
  for (const [id, nd] of mobNodes3D) {
    if (!seen.has(id)) {
      scene3D.remove(nd.grp);
      nd.spr.material.dispose(); nd.blob.material.dispose(); nd.plate.tex.dispose(); nd.plate.sp.material.dispose(); nd.glow.material.dispose();
      mobNodes3D.delete(id);
    }
  }
}
function syncLoot3D(now) {
  const seen = new Set();
  for (const [lid, l] of Object.entries(lootItems)) {
    if ((l.map || 'm1') !== myMap()) continue;
    seen.add(lid);
    const it = getItem(l.itemId);
    if (!it) continue;
    const R = it.rarity || 'common';
    const rank = RARITY_RANK[R] ?? 0;
    const ncol = RARITY_COLOR[R] || '#aaa';
    let nd = lootNodes3D.get(lid);
    if (!nd) {
      const grp = new THREE_NS.Group();
      const spr = new THREE_NS.Sprite(new THREE_NS.SpriteMaterial({ map: spriteTex3D(itemSprite(l.itemId)), transparent: true, depthWrite: false }));
      spr.scale.set(36, 36, 1);
      grp.add(spr);
      const glow = new THREE_NS.Sprite(new THREE_NS.SpriteMaterial({ map: glowTex3D, transparent: true, depthWrite: false, blending: THREE_NS.AdditiveBlending, opacity: .7 }));
      const gs = 46 + rank * 12;
      glow.scale.set(gs, gs, 1);
      glow.position.y = 6;
      grp.add(glow);
      const beam = new THREE_NS.Sprite(new THREE_NS.SpriteMaterial({ map: beamTex3D(hexToRgb3(ncol).join(',')), transparent: true, depthWrite: false, blending: THREE_NS.AdditiveBlending, opacity: .8 }));
      const bh = rank >= 1 ? 130 + rank * 60 : 0;
      beam.scale.set(10 + rank * 5, Math.max(1, bh), 1);
      beam.position.y = bh / 2;
      beam.visible = rank >= 1;
      grp.add(beam);
      const plate = plate3D(220, 48);
      plate.sp.scale.set(96, 21, 1);
      grp.add(plate.sp);
      scene3D.add(grp);
      nd = { grp, spr, glow, beam, plate, key: '' };
      lootNodes3D.set(lid, nd);
    }
    const bob = Math.sin(now / 300 + l.x) * 3;
    nd.grp.position.set(l.x, 0, l.y);
    nd.spr.position.y = 22 + bob;
    const pulse = .55 + Math.sin(now / 260 + l.x * 1.7) * .25;
    nd.glow.material.opacity = .35 + pulse * .4;
    nd.beam.material.opacity = .5 + Math.sin(now / 200 + l.y) * .2;
    drawPlate3D(nd.plate, it.name, ncol, 1, false);
    nd.plate.sp.position.y = 52;
  }
  for (const [lid, nd] of lootNodes3D) {
    if (!seen.has(lid)) {
      scene3D.remove(nd.grp);
      nd.spr.material.dispose(); nd.glow.material.dispose(); nd.beam.material.dispose(); nd.plate.tex.dispose(); nd.plate.sp.material.dispose();
      lootNodes3D.delete(lid);
    }
  }
}
function syncFx3D(now) {
  let ri = 0;
  const useRing = (x, z, rad, op, rgb) => {
    if (ri >= ringPool3D.length) return;
    const m = ringPool3D[ri++];
    m.visible = true;
    m.position.set(x, 3, z);
    m.scale.set(rad, rad, 1);
    m.material.opacity = op;
    m.material.color.set(`rgb(${rgb})`);
  };
  for (const r of rings) {
    const p = r.t / r.max;
    useRing(r.x, r.y, Math.max(1, r.r * (.25 + p * .75)), (1 - p) * .85, r.color);
  }
  for (const s of slashes) {
    const p = s.t / 180;
    useRing(s.x, s.y, Math.max(1, (s.len || 38) * (0.8 + p * .5)), (1 - p) * .7, '255,255,255');
  }
  for (; ri < ringPool3D.length; ri++) ringPool3D[ri].visible = false;
  let si = 0;
  for (const s of shots) {
    if (si >= shotPool3D.length) break;
    const m = shotPool3D[si++];
    const col = '#' + cssToRgb3D(s.color).map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
    if (m.userData.col !== col) { m.material.color.set(col); m.userData.col = col; }
    m.visible = true;
    m.position.set(s.x, 20, s.y);
    const sc = Math.max(1.5, (s.size || 5) * .9);
    m.scale.set(sc, sc, sc);
  }
  for (; si < shotPool3D.length; si++) shotPool3D[si].visible = false;
  let pi = 0;
  const N = sparkPos3D.length / 3;
  for (const p of poofs) {
    if (pi >= N) break;
    const [r, g, b] = cssToRgb3D(p.color);
    sparkPos3D[pi * 3] = p.x;
    sparkPos3D[pi * 3 + 1] = Math.max(2, 16 - (p.t / 600) * 8 + Math.sin(p.t / 80 + p.x) * 2);
    sparkPos3D[pi * 3 + 2] = p.y;
    sparkCol3D[pi * 3] = r; sparkCol3D[pi * 3 + 1] = g; sparkCol3D[pi * 3 + 2] = b;
    pi++;
  }
  for (; pi < N; pi++) { sparkPos3D[pi * 3 + 1] = -999; }
  sparkPts3D.geometry.attributes.position.needsUpdate = true;
  sparkPts3D.geometry.attributes.color.needsUpdate = true;
  for (const slot of floatPool3D) {
    if (slot.ref && (!floats.includes(slot.ref) || now - slot.born > 1000)) { slot.ref = null; slot.sp.visible = false; }
  }
  for (const f of floats) {
    if (floatUse3D.get(f)) continue;
    const slot = floatPool3D.find(s2 => !s2.ref);
    if (!slot) break;
    const c = slot.cx, W = slot.cv.width;
    c.clearRect(0, 0, W, slot.cv.height);
    c.font = (f.big ? 'bold 44px ' : 'bold 36px ') + 'sans-serif';
    c.textAlign = 'center';
    c.shadowColor = 'rgba(0,0,0,.9)'; c.shadowBlur = 8;
    c.fillStyle = f.color || '#fff';
    c.fillText(f.text, W / 2, 52);
    slot.tex.needsUpdate = true;
    slot.ref = f; slot.born = now;
    floatUse3D.set(f, true);
  }
  if (floatUse3D.size > 60) floatUse3D.clear();
  for (const slot of floatPool3D) {
    if (!slot.ref) continue;
    const age = now - slot.born;
    const f = slot.ref;
    slot.sp.visible = true;
    slot.sp.position.set(f.x, 70 - age * .06, f.y);
    slot.sp.material.opacity = Math.max(0, 1 - age / 1000);
  }
}
function syncGates3D(now) {
  const pn = pageNum();
  const key = myMap() + '|' + ((me.conq || {})[pn] ? 1 : 0) + '|' + pn;
  if (key !== gateKey3D) {
    gateKey3D = key;
    if (gateGroup3D) { disposeGroup3D(gateGroup3D); scene3D.remove(gateGroup3D); gateGroup3D = null; }
    const T = THREE_NS;
    gateGroup3D = new T.Group();
    const mkGate = (px, label, locked, flip) => {
      const col = locked ? 0x787880 : 0xa060ff;
      const mat = new T.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: locked ? .25 : .8 });
      for (const dz of [-26, 26]) {
        const pil = new T.Mesh(new T.BoxGeometry(10, 110, 10), mat);
        pil.position.set(px + (flip ? -14 : 14), 55, 600 + dz);
        gateGroup3D.add(pil);
      }
      const p = plate3D(300, 56);
      drawPlate3D(p, label, locked ? '#9a9aa8' : '#ffd700', 1, false);
      p.sp.scale.set(150, 28, 1);
      p.sp.position.set(px + (flip ? -70 : 70), 150, 600);
      gateGroup3D.add(p.sp);
      const gl = new T.Sprite(new T.SpriteMaterial({ map: glowTex3D, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: locked ? .25 : .6 }));
      gl.material.color.set(locked ? '#787880' : '#a060ff');
      gl.scale.set(120, 160, 1);
      gl.position.set(px, 60, 600);
      gateGroup3D.add(gl);
    };
    if (pn < MAX_PAGE) mkGate(1490, pageDef(pn + 1).name, !(me.conq || {})[pn], true);
    if (pn > 1) mkGate(100, pageDef(pn - 1).name, false, false);
    scene3D.add(gateGroup3D);
  }
}
function groundRay3D(mx, my) {
  const v = _v3a.v;
  v.set((mx / innerWidth) * 2 - 1, -(my / innerHeight) * 2 + 1, .5).unproject(cam3D);
  const d = v.sub(cam3D.position).normalize();
  if (d.y > -1e-5) return null;
  const t = -cam3D.position.y / d.y;
  return { x: cam3D.position.x + d.x * t, y: cam3D.position.z + d.z * t };
}
function pickWorld(mx, my) {
  if (SCENE3D && sceneLive && cam3D && _v3a.v) {
    const p = groundRay3D(mx, my);
    if (p) return { x: clampN(p.x, 40, WORLD.w - 40), y: clampN(p.y, 40, WORLD.h - 40) };
  }
  return screenToWorld(mx, my);
}
function updateViewRect3D() {
  const a = groundRay3D(0, 0), b = groundRay3D(innerWidth, innerHeight);
  if (a && b) { view.x = Math.min(a.x, b.x); view.y = Math.min(a.y, b.y); view.z = 1; }
}
function updateGlFx(now) {
  if (!glFxEl) return;
  const hpR = (me.hp || 0) / maxHpOf();
  let bg = '';
  if (now < hurtUntil) bg += `radial-gradient(ellipse at center, transparent 55%, rgba(231,76,60,${(hurtUntil - now) / 300 * .5}) 100%),`;
  if (!me.dead && hpR < .35) {
    const vp = (.3 + Math.sin(now / 260) * .18) * clampN((.35 - hpR) / .35, 0, 1);
    bg += `radial-gradient(ellipse at center, transparent 40%, rgba(180,0,0,${vp}) 100%),`;
  }
  bg += 'transparent';
  if (glFxEl._bg !== bg) { glFxEl._bg = bg; glFxEl.style.background = bg; }
}
function updateScene3D(now, dt) {
  if (!sceneLive && !initScene3D()) { draw(now); return; }
  if (lastW3D !== innerWidth || lastH3D !== innerHeight) { lastW3D = innerWidth; lastH3D = innerHeight; }
  renderer3D.setSize(innerWidth, innerHeight);
  cam3D.aspect = innerWidth / innerHeight;
  cam3D.updateProjectionMatrix();
  syncGround3D();
  followCam3D(now, dt);
  syncChars3D(now, dt);
  syncMobs3D(now);
  syncLoot3D(now);
  syncFx3D(now);
  syncGates3D(now);
  updateViewRect3D();
  updateMinimap(now);
  updateGlFx(now);
  renderer3D.render(scene3D, cam3D);
}
function tickStageGL(now, t, dt) {
  me.x = 800 + Math.sin(t * .25) * 300;
  me.y = 600 + Math.cos(t * .18) * 200;
  me.face = Math.atan2(Math.cos(t * .18) * -.18 * 200, Math.cos(t * .25) * .25 * 300);
  const spd = moveSpd();
  me.stepPh = ((me.stepPh || 0) + spd * dt / 1000 * .11) % (Math.PI * 2);
  meMovingNow = true;
  me.equipped = PORTRAIT_GEAR.warrior;
  if (!myName) myName = '테스터';
  me.hp = 78;
  const skills = ['power_strike', 'multishot', 'shadow_strike', 'fireball', 'heal'];
  const cc = t % 8;
  heroCast = cc < .6 ? { id: skills[Math.floor(t / 8) % skills.length], t0: now - cc * 1000, dur: 600 } : null;
  if ((tickStageGL.n = (tickStageGL.n || 0) + 1) % 60 === 0) {
    try {
      const r0 = charNodes3D.get('me');
      document.title = `me=${Math.round(me.x)},${Math.round(me.y)} chars=${charNodes3D.size} cam=${Math.round(camT3D.x)},${Math.round(camT3D.y)} root=${r0 ? r0.M.refs.root.position.toArray().map(v => Math.round(v)).join(',') : 'NONE'} kids=${r0 ? r0.M.refs.root.children.length : -1}`;
    } catch (e) { document.title = 'dbg-err ' + (e.message || e); }
  }
  updateScene3D(now, dt);
}
function draw(now) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const vw = cvW, vh = cvH;
  let shx = 0, shy = 0;
  if (shakeT && now - shakeT < 180) {
    const p = (1 - (now - shakeT) / 180) * shakePow;
    shx = rand(-p, p); shy = rand(-p, p);
  } else shakePow = 0;
  /* 가로: 항상 정중앙(부족하면 스크롤). 세로: 모바일 상하 UI를 제외한 밴드 기준 */
  const { T, B } = uiInsets(now);
  /* 창을 늘려 월드(1600x1200)보다 넓어지면 가로/세로 같은 배율로 확대해 화면을 100% 채운다.
     균등 배율이라 찌그러지지 않고, 좌우 검은 여백도 생기지 않는다. */
  /* 화면을 최소한 꽉 채우는 배율(zFill) 아래로는 못 줄인다 — 줄이면 월드 밖 검은 여백이 생기므로 */
  const zFill = Math.max(vw / WORLD.w, (vh - T - B) / WORLD.h);
  /* 모바일: 인앱 뷰포트 고정 배율 — 가로로 월드 약 820px가 보이도록 축소(1:1은 캐릭터가 화면을 압도했다). 렌더는 DPR 최대라 선명 */
  const z = vw <= 640 ? clampN(vw / MOBILE_VIEW_W, zFill, 1) : clampN(Math.max(1, zFill) * userZoom, zFill, USER_ZOOM_MAX);
  const vwW = vw / z, vhW = vh / z, TW = T / z, BW = B / z;
  const availH = vhW - TW - BW;
  const cx = WORLD.w >= vwW ? clampN(cam.x - vwW / 2, 0, WORLD.w - vwW) : (WORLD.w - vwW) / 2;
  let cy;
  if (WORLD.h >= availH) cy = clampN(cam.y - TW - availH / 2, -TW, WORLD.h - vhW + BW);
  else cy = -(TW + (availH - WORLD.h) / 2);
  view.x = cx; view.y = cy; view.z = z;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, vw, vh);
  ctx.save();
  ctx.scale(z, z);
  ctx.translate(-cx + shx / z, -cy + shy / z);
  ctx.drawImage(getTex(myMap()), 0, 0, WORLD.w, WORLD.h);
  drawWaterFx(now); /* 물/용암 반짝임 */
  if (hordeOn()) drawHordeArena(now); /* 쇄도 결계 */

  drawLootItems(now);
  drawPickFlights(now);

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
    outlinedText((locked ? '🔒 ' : (dirRight ? '▶ ' : '◀ ')) + label, px, 546, 3.5);
  };
  if (!hordeOn()) { /* 쇄도 중에는 구역 관문을 감춘다(입장 불가 상태라 혼동만 준다) */
    if (pn < MAX_PAGE) drawPortal(1490, pageDef(pn + 1).name, !(me.conq || {})[pn], true);
    if (pn > 1) drawPortal(100, pageDef(pn - 1).name, false, false);
  }

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
    else if (s.type === 'orc' || s.type === 'boss') drawBoss(s, now);
    else if (MOB_MODELS[s.type]) drawGenericMob(s, now);
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
    drawChar({ x: pv.x, y: pv.y, color: o.color || colorOf(id), name: o.name, title: o.title, hp: o.hp, maxHp: o.maxHp, dead: o.dead, equipped: o.equipped, cls: o.cls || 'warrior', isSelf: false, face: pv.f, moving: mv });
  }
  if (ready) drawChar({ x: me.x, y: me.y, color: '#fff', name: myName, title: me.title, hp: me.hp, maxHp: me.maxHp, dead: me.dead, equipped: me.equipped, cls: myCls, isSelf: true, face: me.face ?? Math.PI / 2, moving: meMovingNow, swing: lastAttackAt });

  /* ===== 스킬/투사체 FX — 가산 블렌딩으로 발광 ===== */
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const sh of shots) {
    const p = sh.t / sh.max, r = Math.max(2.2, sh.size || 5);
    for (let i = 1; i <= 6; i++) { /* 잔상 꼬리 */
      const q = i / 6;
      ctx.globalAlpha = (1 - p * .4) * (1 - q) * .5;
      ctx.fillStyle = sh.color;
      ctx.beginPath(); ctx.arc(sh.x - sh.vx * .016 * i, sh.y - sh.vy * .016 * i, r * (1.1 - q * .7), 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1 - p * .3;
    const gg = ctx.createRadialGradient(sh.x, sh.y, 0, sh.x, sh.y, r * 3.4);
    gg.addColorStop(0, '#ffffff'); gg.addColorStop(.22, sh.color); gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(sh.x, sh.y, r * 3.4, 0, 7); ctx.fill();
  }
  for (const rg of rings) {
    const p = rg.t / rg.max, R = Math.max(2, rg.r * (.2 + p * .8));
    const g2 = ctx.createRadialGradient(rg.x, rg.y, R * .5, rg.x, rg.y, R); /* 충격파: 안쪽 투명 → 색 → 흰 테두리 */
    g2.addColorStop(0, `rgba(${rg.color},0)`); g2.addColorStop(.72, `rgba(${rg.color},${(1 - p) * .5})`); g2.addColorStop(1, `rgba(255,255,255,${(1 - p) * .85})`);
    ctx.globalAlpha = 1; ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(rg.x, rg.y, R, 0, 7); ctx.fill();
    ctx.strokeStyle = `rgba(${rg.color},${1 - p})`; ctx.lineWidth = 4 * (1 - p) + 1;
    ctx.beginPath(); ctx.arc(rg.x, rg.y, R, 0, 7); ctx.stroke();
    ctx.setLineDash([6, 10]); ctx.lineDashOffset = -rg.t / 5; ctx.lineWidth = 1.4; ctx.strokeStyle = `rgba(255,255,255,${(1 - p) * .7})`;
    ctx.beginPath(); ctx.arc(rg.x, rg.y, R * 1.2, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  }
  for (const sl of slashes) {
    const p = sl.t / 180, L = (sl.len || 38) * (0.8 + p * .5);
    ctx.globalAlpha = 1 - p;
    ctx.strokeStyle = sl.color || '#ffffff'; ctx.lineWidth = (sl.w || 3.6) * (1 - p) + 1.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(sl.x, sl.y, L, sl.a - .85, sl.a + .85); ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${.8 * (1 - p)})`; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(sl.x, sl.y, L - 6, sl.a - .7, sl.a + .7); ctx.stroke();
    const tipA = sl.a + .85, tx = sl.x + Math.cos(tipA) * L, ty = sl.y + Math.sin(tipA) * L; /* 검끝 섬광 */
    const tg = ctx.createRadialGradient(tx, ty, 0, tx, ty, 14); tg.addColorStop(0, `rgba(255,255,255,${(1 - p)})`); tg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = tg; ctx.beginPath(); ctx.arc(tx, ty, 14, 0, 7); ctx.fill();
  }
  for (const b of bolts) {
    const p = b.t / b.max, a = 1 - p;
    const flick = .7 + Math.sin(b.t / 18) * .3;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [w, c] of [[b.w * 3.2, `rgba(${hexRgb(b.color)},${a * .25 * flick})`], [b.w * 1.4, `rgba(${hexRgb(b.color)},${a * .9})`], [b.w * .55, `rgba(255,255,255,${a})`]]) {
      ctx.strokeStyle = c; ctx.lineWidth = w;
      ctx.beginPath(); b.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    }
  }
  for (const m of meteors) {
    const p = Math.min(1, m.t / (m.max * .8));
    const e = p * p;
    const x = m.sx + (m.x - m.sx) * e, y = (m.y - 300) + 300 * e;
    ctx.globalAlpha = 1;
    for (let i = 1; i <= 6; i++) { const q = i / 6; const bx = m.sx + (m.x - m.sx) * Math.max(0, e - q * .12), by = (m.y - 300) + 300 * Math.max(0, e - q * .12); ctx.globalAlpha = (1 - q) * .45; ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(bx, by, m.size * (1.1 - q * .6), 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
    const gg = ctx.createRadialGradient(x, y, 0, x, y, m.size * 2.6);
    gg.addColorStop(0, '#ffffff'); gg.addColorStop(.3, m.color); gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, m.size * 2.6, 0, 7); ctx.fill();
    /* 착탄 지점 표식 */
    ctx.strokeStyle = `rgba(${hexRgb(m.color)},${.5 + p * .5})`; ctx.lineWidth = 1.5; ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.ellipse(m.x, m.y, 26 * (1 - p * .5), 10 * (1 - p * .5), 0, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  drawAmbient(now); /* 바이옴 입자(낙엽·눈·불씨…) */
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const p of poofs) {
    ctx.globalAlpha = clampN(1 - p.t / 600, 0, 1);
    ctx.fillStyle = p.color;
    const rr = Math.max(.5, p.r * (1 - p.t / 900));
    ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, 7); ctx.fill();
    if (Math.abs(p.vx) + Math.abs(p.vy) > 40) { /* 빠른 입자는 스트릭 */
      ctx.strokeStyle = p.color; ctx.lineWidth = rr * 1.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * .03, p.y - p.vy * .03); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();

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

  updateMinimap(now);

  const hpR = (me.hp || 0) / maxHpOf();
  if (!me.dead && hpR < .35) {
    const vp = (.3 + Math.sin(now / 260) * .18) * clampN((.35 - hpR) / .35, 0, 1);
    const vg = ctx.createRadialGradient(cvW / 2, cvH / 2, cvH * .28, cvW / 2, cvH / 2, cvH * .72);
    vg.addColorStop(0, 'rgba(180,0,0,0)');
    vg.addColorStop(1, `rgba(180,0,0,${vp})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, cvW, cvH);
  }
  if (flashes.length) { /* 스킬 섬광: 시전 위치 중심, 가산 */
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const f of flashes) {
      const p = f.t / f.max, z = view.z || 1, fx = (f.x - view.x) * z, fy = (f.y - view.y) * z;
      const R = Math.max(cvW, cvH) * (.35 + p * .5);
      const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, R);
      g.addColorStop(0, `rgba(${f.rgb},${(1 - p) * f.str})`); g.addColorStop(.5, `rgba(${f.rgb},${(1 - p) * f.str * .35})`); g.addColorStop(1, `rgba(${f.rgb},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, cvW, cvH);
    }
    ctx.restore();
  }
}

/* ================= HUD ================= */
/* 매 프레임 호출되므로 값이 바뀐 경우에만 DOM에 씀 — 동일 값 재대입도 레이아웃을 오염시켜 모바일 스터터 유발 */
const domCache = {};
function setTxt(id, v) { if (domCache['t' + id] !== v) { domCache['t' + id] = v; $(id).textContent = v; } }
function setBarW(id, pct) { const v = pct.toFixed(1) + '%'; if (domCache['w' + id] !== v) { domCache['w' + id] = v; $(id).style.width = v; } }
let shopGoldCache = -1;
function updateHUD() {
  if (shopGoldCache !== (me.gold || 0)) { shopGoldCache = me.gold || 0; const sg = $('shopGold'); if (sg) sg.textContent = `💰 ${shopGoldCache.toLocaleString()} G`; }
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
  { const gh = $('gemHud'); if (gh && domCache.gem !== me.gem) { domCache.gem = me.gem; gh.textContent = '💎 ' + (me.gem || 0).toLocaleString(); } }
  { const bd = $('achvBadge'); if (bd) { const n = achvClaimableCount(); if (domCache.achvN !== n) { domCache.achvN = n; if (n > 0) { bd.textContent = n; bd.hidden = false; } else bd.hidden = true; } } }
  const pts = me.statPts || 0;
  const disp = pts > 0 ? 'flex' : 'none';
  if (domCache.ptsDisp !== disp) { domCache.ptsDisp = disp; $('statPtsRow').style.display = disp; uiInsetCache.t = 0; /* HUD 높이 변동 즉시 반영 */ }
  if (pts > 0) setTxt('uiPts', String(pts));
}

function setPot(el, n, kind) {
  const box = $(el);
  if (!box) return;
  const pref = kind ? ((me.potPref || {})[kind] || '') : '';
  const k = 'pot' + el;
  const sig = 'n' + n + '|' + pref + '|' + itemIconGen;
  if (domCache[k] === sig) return;
  domCache[k] = sig;
  box.querySelector('.cnt').textContent = n;
  box.classList.toggle('locked', n <= 0);
  if (kind) {
    const ic = box.querySelector('.ic2');
    const shown = pref || (kind === 'hp' ? 'potion' : 'potion_mp');
    if (ic) ic.innerHTML = itemIconHtml(shown, 34, 'potic');
  }
}
function updateHotbar(now) {
  const ids = [1, 2, 3, 4, 5].map(boundId);
  [['hb1', 0], ['hb2', 1], ['hb3', 2], ['hb4', 3], ['hb5', 4]].forEach(([el, i]) => {
    const box = $(el);
    if (!box) return;
    const id = ids[i];
    const refs = box._hbRefs || (box._hbRefs = { nm: box.querySelector('.nm'), ic: box.querySelector('.ic2'), cdEl: box.querySelector('.cd') }); /* 자식 ref 1회만 조회 — 매 프레임 15회 querySelector 제거 */
    const nm = refs.nm, ic = refs.ic, cdEl = refs.cdEl;
    const k = 'hb' + el;
    if (!id) { if (domCache[k] !== 'empty') { domCache[k] = 'empty'; nm.textContent = '-'; ic.textContent = '✦'; box.classList.remove('locked'); cdEl.style.display = 'none'; } return; }
    const def = skillDef(id);
    if (!def) { if (domCache[k] !== 'empty') { domCache[k] = 'empty'; nm.textContent = '-'; ic.textContent = '✦'; box.classList.remove('locked'); cdEl.style.display = 'none'; } return; } /* 사라진 스킬 id가 바인딩돼 있으면 빈 칸(매 프레임 예외 방지) */
    const locked = !hasSkill(id);
    const remain = (skillCdUntil[id] || 0) - now;
    const cdSec = remain > 0 && !locked ? Math.ceil(remain / 1000) : 0;
    const sig = `${id}|${locked}|${cdSec}`;
    if (domCache[k] === sig) return; /* 변화 없으면 DOM 접근 생략 (매 프레임 호출) */
    domCache[k] = sig;
    ic.innerHTML = skillIconHtml(id, def);
    nm.textContent = def.name;
    box.classList.toggle('locked', locked);
    if (cdSec > 0) {
      cdEl.style.display = 'flex';
      cdEl.textContent = cdSec;
    } else cdEl.style.display = 'none';
  });
  setPot('hbHp', potCount('hp'), 'hp');
  setPot('hbMp', potCount('mp'), 'mp');
}

/* ================= 스킬 드래그 → 퀵슬롯 =================
   스킬샵/스킬트리의 [1]~[5] 버튼이 있는 행(= 등록 가능한 액티브 스킬)을 끌어 핫바 1~5칸에 놓으면 등록.
   마우스는 즉시, 터치는 220ms 길게 누르면 시작(짧게 밀면 리스트 스크롤) */
let sdrag = null, sdragTimer = 0;
function skillDragIdFrom(target) {
  const row = target.closest && target.closest('.srow, .tnode');
  if (!row) return null;
  const bb = row.querySelector('[data-bind]');
  if (!bb) return null;
  return { id: bb.dataset.bind.split(':')[1], row };
}
function sdragStart(e, id) {
  sdrag = { id, x: e.clientX, y: e.clientY, over: null };
  document.body.classList.add('skilldrag');
  let g = $('dragGhost');
  if (!g) { g = document.createElement('div'); g.id = 'dragGhost'; document.body.appendChild(g); }
  g.textContent = skillDef(id).icon || '✦';
  g.style.display = 'flex';
  sdragMove(e);
}
function sdragSlotAt(x, y) {
  for (let sIdx = 1; sIdx <= 5; sIdx++) {
    const el = $('hb' + sIdx); if (!el) continue;
    const r = el.getBoundingClientRect();
    if (x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6) return sIdx;
  }
  return 0;
}
function sdragMove(e) {
  if (!sdrag) return;
  const g = $('dragGhost');
  if (g) { g.style.left = e.clientX + 'px'; g.style.top = e.clientY + 'px'; }
  const slot = sdragSlotAt(e.clientX, e.clientY);
  if (slot !== sdrag.over) {
    sdrag.over = slot;
    for (let sIdx = 1; sIdx <= 5; sIdx++) $('hb' + sIdx)?.classList.toggle('dropok', sIdx === slot);
  }
}
function sdragEnd(e, cancel) {
  clearTimeout(sdragTimer); sdragTimer = 0;
  if (!sdrag) return;
  const { id, over } = sdrag;
  sdrag = null;
  document.body.classList.remove('skilldrag');
  const g = $('dragGhost'); if (g) g.style.display = 'none';
  for (let sIdx = 1; sIdx <= 5; sIdx++) $('hb' + sIdx)?.classList.remove('dropok');
  if (cancel) return;
  const slot = over || sdragSlotAt(e.clientX, e.clientY);
  if (slot) {
    bindSet(slot, id); sfx('click');
    if ($('shopPanel')?.classList.contains('open')) renderShop();
    if ($('treePanel')?.classList.contains('open')) renderTree();
  }
}
document.addEventListener('pointerdown', e => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  if (e.target.closest('button, input, a')) return; /* [1]~[5] 버튼·구매 버튼 클릭은 그대로 */
  const hit = skillDragIdFrom(e.target);
  if (!hit) return;
  if (e.pointerType === 'touch') {
    const sx = e.clientX, sy = e.clientY;
    const cancelHold = ev => { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) { clearTimeout(sdragTimer); sdragTimer = 0; document.removeEventListener('pointermove', cancelHold); } };
    document.addEventListener('pointermove', cancelHold);
    sdragTimer = setTimeout(() => { document.removeEventListener('pointermove', cancelHold); sdragStart(e, hit.id); try { navigator.vibrate && navigator.vibrate(10); } catch (err) {} }, 220);
    document.addEventListener('pointerup', () => { clearTimeout(sdragTimer); sdragTimer = 0; document.removeEventListener('pointermove', cancelHold); }, { once: true });
  } else {
    e.preventDefault();
    sdragStart(e, hit.id);
  }
}, { passive: false });
document.addEventListener('pointermove', e => { if (sdrag) { e.preventDefault(); sdragMove(e); } }, { passive: false });
document.addEventListener('pointerup', e => sdragEnd(e, false));
document.addEventListener('pointercancel', e => sdragEnd(e, true));

/* ================= 입력 ================= */
const chatInput = $('chatInput');
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const text = chatInput.value.trim();
    chatInput.value = '';
    chatInput.blur();
    if (text) { if (offline) toast('☁️ 로컬 모드 — 채팅은 서버 복구 후 가능합니다'); else addDoc(collection(db, 'chat'), { from: myName, text, ts: Date.now() }).catch(e => { if (isQuotaErr(e)) enterOffline(e); }); }
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
  const dex = me.dex || {};
  const card = (k, n, tag) => {
    const seen = !!dex[k.name];
    /* 발견한 몬스터만 실제 스프라이트 시트를 로드(도감 열 때 전 몬스터 64MB 일괄 다운로드 방지) — 미발견은 회색 벡터 폴백 */
    return `<div class="dexmon ${seen ? 'seen' : 'unseen'}" title="${esc(k.name)}${seen ? '' : ' — 미발견'}">
      <img class="dexic ${seen && heroSheet('mob_' + k.base) ? 'smooth' : ''}" src="${mobThumb(k, seen)}" alt="">
      <div class="dexnm">${seen ? esc(k.name) : '???'}</div>
      <div class="dexlv">${tag ? tag + ' ' : ''}Lv${n}</div>
    </div>`;
  };
  let html = '';
  for (let n = 1; n <= MAX_PAGE; n++) {
    const pd = pageDef(n);
    const conq = (me.conq || {})[n];
    const cur = n === pageNum();
    html += `<div class="dexrow ${conq ? 'dexconq' : ''} ${cur ? 'dexcur' : ''}">
      <div class="dexpage">${conq ? '✅' : cur ? '📍' : '🔒'} ${pd.name} ${conq ? '<span class="dexok">정복 완료</span>' : ''}</div>
      <div class="dexmons">
        ${card(pd.kinds[0], n, '')}
        ${card(pd.kinds[1], n, '')}
        ${card(pd.boss, n, 'BOSS')}
      </div>
    </div>`;
  }
  const total = MAX_PAGE * 3, got = Object.keys(dex).length;
  body.innerHTML = `<div class="dexsum">도감 ${got} 종 발견 · 발견한 종에게 주는 피해 <b style="color:#7fe3a0">+${Math.round(DEX_DMG_BONUS * 100)}%</b> · ★유니크는 각 종류 10% 확률로 등장</div>` + html;
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
    { const t = getTex(n0 === pageNum() ? myMap() : 'm1'); wctx.drawImage(t, 0, 0, t.width, t.height, 0, 0, wc.width, wc.height); }
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
    if (id === 'treePanel') renderTree();
    if (id === 'dexPanel') renderDex();
    if (id === 'achvPanel') renderAchv();
    if (id === 'hordePanel') renderHorde();
  }
}
const rb2 = $('reviveBtn');
if (rb2) rb2.onclick = reviveNow;
const rtl = $('rankTabLv'), rta = $('rankTabAtk');
if (rtl) rtl.onclick = () => { rankMode = 'lv'; renderRank(); };
if (rta) rta.onclick = () => { rankMode = 'atk'; renderRank(); };
/* 직업별 스탯 버튼 8종 생성 (로그인 후 호출 — myCls 확정 필요) */
function renderStatButtons() {
  const box = $('stBtns');
  if (!box) return;
  box.innerHTML = '';
  for (const k of (cdef().stats || [])) {
    const d = STAT_DEFS[k];
    if (!d) continue;
    const b = document.createElement('button');
    b.className = 'stbtn' + (k === cdef().rec ? ' rec' : '');
    b.dataset.st = k;
    b.textContent = d.s || d.n; /* HUD 한 줄 유지용 짧은 표기 */
    b.title = d.n + ' — ' + d.d; /* 효과 설명 툴팁 */
    b.onclick = () => addStat(k);
    box.appendChild(b);
  }
}
$('hudTop').onclick = () => {
  sfx('click');
  const mini = $('hud').classList.toggle('mini');
  uiInsetCache.t = 0; /* --hudB(장비패널/모바일 배치·카메라 밴드) 즉시 갱신 */
  try { localStorage.setItem('hudMini', mini ? '1' : ''); } catch (e) {}
};
try { if (localStorage.getItem('hudMini')) $('hud').classList.add('mini'); } catch (e) {}
function toggleInv() { sfx('click'); $('invPanel').classList.toggle('open'); }
document.querySelector('#rankPanel h3').addEventListener('click', e => {
  if (e.target.tagName === 'BUTTON') return;
  sfx('click');
  $('rankPanel').classList.toggle('folded');
});
async function doLogout() {
  try { if (pendKeys.size) await trySync(true); } catch (e) {} /* 보류 진행분 먼저 저장 */
  try { await signOut(auth); } catch (e) {}
  location.reload();
}
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
/* 퀵슬롯: 클릭 = 시전(배운 스킬) / 아직 못 배운·빈 슬롯 클릭, 우클릭, 길게 누르기 = 배운 스킬 중 선택해 등록 */
function learnedActives() {
  const ids = new Set();
  for (const [id, d] of Object.entries(SKILLS)) if (d.type === 'active' && (d.cls === myCls || d.cls === 'all') && hasSkill(id)) ids.add(id);
  try { for (const id of classActiveIds()) if (hasSkill(id)) ids.add(id); } catch (e) {}
  if (hasSkill('heal')) ids.add('heal');
  return [...ids];
}
function openSlotPick(slot) {
  let el = $('slotPick');
  if (!el) { el = document.createElement('div'); el.id = 'slotPick'; document.body.appendChild(el); }
  const cur = boundId(slot);
  const list = learnedActives();
  el.innerHTML = `<div class="spt">[${slot}]번 슬롯에 등록</div>` +
    (list.length ? list.map(id => { const d = skillDef(id); return `<button data-pick="${id}" class="${id === cur ? 'cur' : ''}"><span class="spi">${skillIconHtml(id, d)}</span>${esc(d.name)}</button>`; }).join('')
                 : `<div class="spn">배운 액티브 스킬이 없습니다 — 스킬샵[B]에서 습득</div>`);
  el.querySelectorAll('[data-pick]').forEach(b => b.onclick = ev => { ev.stopPropagation(); bindSet(slot, b.dataset.pick); sfx('click'); closeSlotPick(); });
  el.classList.add('open');
  const r = $('hb' + slot).getBoundingClientRect(), w = el.offsetWidth || 200, h = el.offsetHeight || 120;
  el.style.left = clampN(r.left + r.width / 2 - w / 2, 6, innerWidth - w - 6) + 'px';
  el.style.top = Math.max(6, r.top - h - 10) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', slotPickAway), 0);
}
function closeSlotPick() { $('slotPick')?.classList.remove('open'); document.removeEventListener('pointerdown', slotPickAway); }
function slotPickAway(e) { if (!e.target.closest('#slotPick')) closeSlotPick(); }
for (let sIdx = 1; sIdx <= 5; sIdx++) {
  const box = $('hb' + sIdx);
  let holdT = 0, held = false;
  box.onclick = () => { if (held) { held = false; return; } const id = boundId(sIdx); if (!id || !hasSkill(id)) openSlotPick(sIdx); else useSkill(sIdx); };
  box.oncontextmenu = e => { e.preventDefault(); openSlotPick(sIdx); };
  box.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') return; holdT = setTimeout(() => { held = true; openSlotPick(sIdx); }, 380); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) box.addEventListener(ev, () => clearTimeout(holdT));
}
$('hbHp').onclick = () => usePotion('hp');
$('hbMp').onclick = () => usePotion('mp');
for (const [hbId, kind] of [['hbHp', 'hp'], ['hbMp', 'mp']]) {
  const box = $(hbId);
  box.ondragover = e => e.preventDefault();
  box.ondrop = e => {
    e.preventDefault();
    const src = e.dataTransfer.getData('text/plain');
    if (!src || !meRef) return;
    const [bid] = splitStack(src);
    const it = getItem(bid);
    if ((kind === 'hp' && !it.heal) || (kind === 'mp' && !it.mana) || it.scroll) { toast('🧪 여기에 둘 수 없는 아이템입니다'); return; }
    updX(meRef, { [`potPref.${kind}`]: bid }).catch(() => {});
    me.potPref = { ...(me.potPref || {}), [kind]: bid };
    toast(`${kind === 'hp' ? '🧪' : '💧'} 퀵슬롯 지정: ${it.name}`);
    sfx('click');
  };
}
$('bulkSellBtn').onclick = e => { e.stopPropagation(); sfx('click'); toggleBulkMenu(); };
{ const ab = $('autoBtn'); if (ab) ab.onclick = toggleAuto; updateAutoBtn(); }
function openSettings() {
  const m = $('settingsModal'); if (!m) return;
  $('setSound').checked = !muted;
  $('setAuto').checked = autoHunt;
  $('setDmg').checked = settings.dmgText;
  $('setShake').checked = settings.screenShake;
  $('setHp').value = settings.autoPotHp; $('setHpVal').textContent = settings.autoPotHp;
  $('setMp').value = settings.autoPotMp; $('setMpVal').textContent = settings.autoPotMp;
  document.querySelectorAll('#setAutoSell [data-rar]').forEach(b => b.classList.toggle('on', !!(settings.autoSell || {})[b.dataset.rar]));
  m.hidden = false;
}
{ const hs = $('hudSettings'); if (hs) hs.onclick = e => { e.stopPropagation(); openSettings(); }; }
{ const sc = $('setClose'); if (sc) sc.onclick = () => { $('settingsModal').hidden = true; }; }
{ const sm = $('settingsModal'); if (sm) sm.onclick = e => { if (e.target === sm) sm.hidden = true; }; }
{ const el = $('setSound'); if (el) el.onchange = () => { if (el.checked === muted) toggleMute(); }; }
{ const el = $('setAuto'); if (el) el.onchange = () => { if (el.checked !== autoHunt) toggleAuto(); }; }
{ const el = $('setDmg'); if (el) el.onchange = () => { settings.dmgText = el.checked; saveSettings(); }; }
{ const el = $('setShake'); if (el) el.onchange = () => { settings.screenShake = el.checked; saveSettings(); }; }
{ const el = $('setHp'); if (el) el.oninput = () => { settings.autoPotHp = +el.value; $('setHpVal').textContent = el.value; saveSettings(); }; }
{ const el = $('setMp'); if (el) el.oninput = () => { settings.autoPotMp = +el.value; $('setMpVal').textContent = el.value; saveSettings(); }; }
document.querySelectorAll('#setAutoSell [data-rar]').forEach(b => b.onclick = () => { settings.autoSell = settings.autoSell || {}; settings.autoSell[b.dataset.rar] = !settings.autoSell[b.dataset.rar]; b.classList.toggle('on', settings.autoSell[b.dataset.rar]); saveSettings(); sfx('click'); });
{ const sb = $('salvageBtn'); if (sb) sb.onclick = e => { e.stopPropagation(); sfx('click'); toggleSalvageMenu(); }; }
{ const st = $('sortBtn'); if (st) st.onclick = e => { e.stopPropagation(); sortBag(); }; }
{ const sb2 = $('statsBtn'); if (sb2) sb2.onclick = e => { e.stopPropagation(); openStats(); }; }
document.querySelectorAll('#dockL [data-p]').forEach(b => b.onclick = () => {
  sfx('click');
  const k = b.dataset.p;
  if (k === 'invPanel') toggleInv();
  else if (k === 'worldMap') toggleWorldMap();
  else if (k === 'chat') toggleChat();
  else togglePanel(k);
});
$('modalDim').onclick = () => {
  document.querySelectorAll('.sidepanel').forEach(p => p.classList.remove('open'));
  $('invPanel').classList.remove('open');
  $('worldMap').classList.remove('open');
  closeEnhMenu(); closeEnhModal();
};
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
  if (e.code === 'Digit3') useSkill(3);
  if (e.code === 'Digit4') useSkill(4);
  if (e.code === 'Digit5') useSkill(5);
  if (e.code === 'Digit6') usePotion('hp');
  if (e.code === 'Digit7') usePotion('mp');
  if (e.code === 'KeyT') { sfx('click'); toggleTree(); }
  if (e.code === 'KeyL') toggleChat();
  if (e.code === 'KeyI') toggleInv();
  if (e.code === 'KeyB') { sfx('click'); togglePanel('shopPanel'); }
  if (e.code === 'KeyQ') { sfx('click'); togglePanel('questPanel'); }
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyV') { sfx('click'); toggleWorldMap(); }
  if (e.code === 'KeyG') { sfx('click'); togglePanel('achvPanel'); }
  if (e.code === 'KeyP') toggleAuto();
  if (e.code === 'KeyC') { sfx('click'); toggleDex(); }
  if (e.code === 'KeyK') { sfx('click'); togglePanel('hordePanel'); }
});
addEventListener('keyup', e => keys[e.code] = false);
/* 포커스 이탈/탭 전환 시 keyup 유실로 캐릭터가 계속 걷는 것 방지 */
addEventListener('blur', () => { keys = {}; mouseDown = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden) { keys = {}; mouseDown = false; if (pendKeys.size) trySync(true); } });
addEventListener('pagehide', () => { if (pendKeys.size) trySync(true); }); /* 탭 닫기/이동 전 저장(최선 노력, 실패해도 localStorage 보류분이 다음 접속에 복원) */

function screenToWorld(mx, my) { const z = view.z || 1; return { x: mx / z + view.x, y: my / z + view.y }; }
cv.addEventListener('contextmenu', e => e.preventDefault());
/* 클릭=발사 없이 이동만, 더블클릭=자동 공격 (260ms 안에 두 번 눌렀는지 판정) */
let clickTimer = null, downX = 0, downY = 0, lastMX = 0, lastMY = 0, hoverSimId = null;
/* 몬스터 히트박스: 예전엔 발밑 반경 원(r+16)뿐이라 머리·몸통을 눌러도 빗나갔다.
   스프라이트가 발 기준 위로 r*2.6 만큼 솟아 있으므로 세로로 긴 박스로 판정하고, 가까운 것을 우선 고른다 */
const simHit = (v, wx, wy) => {
  const d = sdef(v), r = (d.r || 16) * (v.uniq ? 1.15 : 1);
  const halfW = r * 1.5 + 10;
  const top = v.y - r * 2.9 - 8, bot = v.y + r * .7 + 8;
  return Math.abs(wx - v.x) <= halfW && wy >= top && wy <= bot;
};
const simAt = (x, y) => {
  const w = pickWorld(x, y);
  const cands = sims.filter(v => v.alive && v.map === myMap() && simHit(v, w.x, w.y));
  cands.sort((a, b) => Math.hypot(a.x - w.x, a.y - w.y) - Math.hypot(b.x - w.x, b.y - w.y));
  return { w, s: cands[0] };
};
cv.addEventListener('mousedown', e => {
  if (e.button !== 0 || !ready || me.dead || document.activeElement === chatInput) return;
  chatInput.blur();
  const { w, s } = simAt(e.clientX, e.clientY);
  downX = lastMX = e.clientX; downY = lastMY = e.clientY;
  mouseDown = true;
  if (s) {
    /* 몬스터 클릭 = 즉시 타깃 지정 (사거리 밖이면 자동 접근). 더블클릭도 같은 동작이라 대기 없음 */
    clearTimeout(clickTimer);
    dest = null;
    attackTargetSimId = s.id;
    if (Math.hypot(s.x - me.x, s.y - me.y) <= atkRange() * 1.05) tryAttack(Date.now(), s);
  } else {
    clearTimeout(clickTimer);
    attackTargetSimId = null;
    dest = w;
  }
});
cv.addEventListener('dblclick', e => {
  if (!ready || me.dead || document.activeElement === chatInput) return;
  e.preventDefault();
  clearTimeout(clickTimer);
  const { w, s } = simAt(e.clientX, e.clientY);
  downX = lastMX = e.clientX; downY = lastMY = e.clientY;
  mouseDown = true;
  if (s) {
    dest = null;
    attackTargetSimId = s.id;
    if (Math.hypot(s.x - me.x, s.y - me.y) <= atkRange() * 1.05) tryAttack(Date.now(), s);
  } else {
    attackTargetSimId = null;
    dest = w;
  }
});
addEventListener('mousemove', e => {
  lastMX = e.clientX; lastMY = e.clientY;
  try { hoverSimId = (ready && !me.dead) ? (simAt(e.clientX, e.clientY).s?.id || null) : null; } catch (err) { hoverSimId = null; }
  if (mouseDown && !(e.buttons & 1)) { mouseDown = false; return; } /* 창 밖에서 버튼을 뗀 경우 */
  if (!mouseDown || attackTargetSimId) return;
  dest = pickWorld(e.clientX, e.clientY);
});
addEventListener('mouseup', () => mouseDown = false);

/* ================= 터치 (모바일) ================= */
let touchDownId = null;
function tapWorld(x, y) {
  if (!ready || me.dead) return;
  /* 채팅 입력 중 월드 탭 = 키보드 내리기 (preventDefault 때문에 네이티브 블러가 안 됨) */
  if (document.activeElement === chatInput) { chatInput.blur(); return; }
  const { w, s } = simAt(x, y);
  if (s) {
    dest = null;
    attackTargetSimId = s.id;
    if (Math.hypot(s.x - me.x, s.y - me.y) <= atkRange() * 1.05) tryAttack(Date.now(), s);
  } else {
    attackTargetSimId = null;
    dest = w;
  }
}
/* 두 손가락 핀치로 화면 확대/축소 (모바일). userZoom은 draw()에서 기본 배율에 곱해진다. */
const pinchDist = ts => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
cv.addEventListener('touchstart', e => {
  e.preventDefault();
  if (e.touches.length >= 2) { /* 두 손가락: 모바일은 배율 고정이라 아무것도 안 함(이동 입력만 취소) */
    touchDownId = null; dest = null;
    if (innerWidth <= 640) return;
    pinchD0 = pinchDist([...e.touches]); pinchZ0 = userZoom;
    return;
  }
  if (pinchD0) return; /* 핀치 중 손가락 추가 */
  const t = e.changedTouches[0];
  touchDownId = t.identifier;
  tapWorld(t.clientX, t.clientY);
}, { passive: false });
cv.addEventListener('touchmove', e => {
  e.preventDefault();
  if (e.touches.length >= 2 && pinchD0) {
    const d = pinchDist([...e.touches]);
    if (d > 8) setUserZoom(pinchZ0 * (d / pinchD0));
    return;
  }
  if (pinchD0) return;
  if (attackTargetSimId != null) return;
  const t = [...e.changedTouches].find(c => c.identifier === touchDownId);
  if (t) dest = pickWorld(t.clientX, t.clientY);
}, { passive: false });
for (const ev of ['touchend', 'touchcancel']) cv.addEventListener(ev, e => {
  e.preventDefault();
  if (e.touches.length < 2) pinchD0 = 0; /* 핀치 종료 */
  if ([...e.changedTouches].some(c => c.identifier === touchDownId)) touchDownId = null;
}, { passive: false });
/* 데스크톱: Ctrl/⌘ + 휠(= 트랙패드 핀치)로 확대/축소.
   맨 휠은 무시 — 트랙패드 스크롤이 수십 개의 wheel 이벤트를 쏘아 배율이 최소/최대로 튀던 버그 */
cv.addEventListener('wheel', e => {
  e.preventDefault();
  if (!e.ctrlKey && !e.metaKey) return;
  setUserZoom(userZoom * Math.exp(-e.deltaY * .01));
}, { passive: false });
addEventListener('pointerdown', function unlockAudio() {
  try { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) {}
}, { once: true });

/* ================= 메인 루프 ================= */
let lastT = 0;
let lastLoopErr = '', loopErrMsg = '';
/* 스테이지 배치: 고정 좌표 대신 매 프레임 뷰포트 기준(가로 100%)으로 재계산.
   폭이 좁으면 줄바꿈해서 화면 밖으로 밀려나지 않고, 넓으면 균등하게 벌어진다. */
function stageLayout() {
  const W = cvW, H = cvH;
  const pad = clampN(W * .045, 14, 96);
  const inner = Math.max(120, W - pad * 2);
  const head = clampN(H * .16, 78, 130);
  const heroY = H - clampN(H * .16, 76, 150);
  const band = (n, minW, top, hgt) => {
    const cols = Math.max(1, Math.min(n, Math.floor(inner / minW) || 1));
    const rows = Math.ceil(n / cols);
    return { cols, rows, top, rowH: hgt / rows };
  };
  const body = Math.max(140, heroY - head - 30);
  const mobRowsN = Math.ceil(6 / Math.max(1, Math.min(6, Math.floor(inner / 170) || 1)));
  const lootRowsN = Math.ceil(6 / Math.max(1, Math.min(6, Math.floor(inner / 110) || 1)));
  const unit = mobRowsN * 1.5 + lootRowsN;
  const mobsH = body * (mobRowsN * 1.5 / unit);
  const mobs = band(6, 170, head + 26, mobsH);
  const loot = band(6, 110, head + 26 + mobsH + 16, body - mobsH - 16);
  const heroes = band(4, 150, heroY, 0);
  const place = (arr, b) => {
    arr.forEach((o, i) => {
      const r = Math.floor(i / b.cols), c = i % b.cols;
      const inRow = Math.min(b.cols, arr.length - r * b.cols);
      o.x = pad + (inner / inRow) * (c + .5);
      o.y = b.top + b.rowH * (r + (b.rowH ? .5 : 0));
    });
  };
  return { pad, head, mobs, loot, heroes, place,
    f1: Math.round(clampN(W * .016, 14, 20)), f2: Math.round(clampN(W * .011, 10, 14)) };
}
/* 시각 검증용 스테이지 (?stage=1): Firebase 없이 실렌더러로 영웅·몬스터 전시 */
let stageSims = null;
function stageMode() {
  window.__stage = true;
  document.body.classList.add('staging');
  $('loading').style.display = 'none';
  try { document.querySelectorAll('.sidepanel').forEach(p => p.classList.remove('open')); } catch (e) {}
  stageSims = [
    makeSim('st_slime', { page: 'p4', kind: '독 슬라임', alive: true, hp: 60, homeX: 200, homeY: 250 }),
    makeSim('st_gob', { page: 'p12', kind: '홉고블린', alive: true, hp: 90, homeX: 450, homeY: 250 }),
    makeSim('st_wolf', { page: 'p85', kind: '몽마', alive: true, hp: 200, homeX: 700, homeY: 250 }),
    makeSim('st_skel', { page: 'p78', kind: '죽음의 기사', alive: true, hp: 300, homeX: 950, homeY: 250 }),
    makeSim('st_boss', { page: 'p1', kind: '오크 족장', boss: true, alive: true, hp: 2400, homeX: 1150, homeY: 250 }),
    makeSim('st_lich', { page: 'p95', kind: '대마령', alive: true, hp: 2000, homeX: 640, homeY: 120 }),
  ];
  for (const s of stageSims) { s.x = s.homeX; s.y = s.homeY; s.movingF = true; s.dirA = Math.PI / 2; }
  for (const s of stageSims) s.map = myMap(); /* 클릭 판정(simAt)용 맵 통일 */
  if (new URLSearchParams(location.search).get('bag')) {
    me.inv = { 0: 'sword_wood', 1: 'sword_iron+2~112', 2: 'armor_plate', 3: 'potion*5', 4: 'scroll_normal*2', 5: 'ring_shadow', 6: 'crown_gold', 7: 'boots_wind~93', 8: 'potion_hi*3' };
    me.equipped = { weapon: 'sword_flame', armor: 'armor_leather', helmet: 'cap_leather' };
    renderInvUI();
    $('invPanel').classList.add('open');
  }
  if (new URLSearchParams(location.search).get('panel') === 'tree') {
    me.gold = 5000; me.lv = 10;
    me.tree = { warrior_t1_01: true, warrior_t1_02: true, warrior_t1_03: true };
    me.binds = { 1: 'power_strike', 2: 'whirlwind', 3: 'heal' };
    renderTree();
    $('treePanel').classList.add('open');
  }
  sims = stageSims; /* 클릭 판정(simAt)이 스테이지 몬스터를 볼 수 있게 */
  ready = true; /* 입력 핸들러 테스트용 (메인 루프는 __stage 가드로 정지 유지) */
  window.__stageApi = { get dest() { return dest; }, get attackTarget() { return attackTargetSimId; } };
  /* 등급별 드랍 네온 전시 (일반→유니크) */
  lootItems = {
    st_c: { itemId: 'sword_wood', x: 150, y: 470, map: myMap(), ts: Date.now() - 10000 },
    st_u: { itemId: 'gloves_leather', x: 320, y: 470, map: myMap(), ts: Date.now() - 10000 },
    st_r: { itemId: 'sword_iron', x: 500, y: 470, map: myMap(), ts: Date.now() - 10000 },
    st_e: { itemId: 'sword_flame', x: 690, y: 470, map: myMap(), ts: Date.now() - 10000 },
    st_l: { itemId: 'crown_gold', x: 880, y: 470, map: myMap(), ts: Date.now() - 10000 },
    st_q: { itemId: 'orb_lich', x: 1080, y: 470, map: myMap(), ts: Date.now() - 150 },
  };
  const t0 = Date.now();
  let slLast = 0;
  const freezeCast = new URLSearchParams(location.search).get('cast');
  const heroes = ['warrior', 'archer', 'rogue', 'mage'].map((cls, i) => ({ cls, x: 190 + i * 300, stepPh: i * 1.7, eq: PORTRAIT_GEAR[cls] || {} }));
  const drawMob = (s, now) => {
    if (s.type === 'slime') drawSlime(s, now);
    else if (s.type === 'goblin') drawGoblin(s, now);
    else if (s.type === 'wolf') drawWolf(s, now);
    else if (s.type === 'skeleton') drawSkeleton(s, now);
    else if (s.type === 'lich') drawLich(s, now);
    else if (s.type === 'orc' || s.type === 'boss') drawBoss(s, now);
    else if (MOB_MODELS[s.type]) drawGenericMob(s, now);
    else drawBoss(s, now);
  };
  const sl = () => {
    if (!window.__stage) return;
    requestAnimationFrame(sl);
    try {
      const now = Date.now(), t = (now - t0) / 1000;
      const sdt = Math.min(50, now - (slLast || now));
      slLast = now;
      if (SCENE3D) { tickStageGL(now, t, sdt); return; }
      const LY = stageLayout();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0d1420'; ctx.fillRect(0, 0, cvW, cvH);
      /* 배경: 늘리지 않고 커버 크롭 — 창을 가로로 늘려도 지형이 찌그러지지 않는다 */
      { const bs = Math.max(cvW / WORLD.w, cvH / WORLD.h);
        const sw = Math.min(WORLD.w, cvW / bs), sh = Math.min(WORLD.h, cvH / bs);
        const t = getTex('p' + (new URLSearchParams(location.search).get('page') || 1)), k = t.width / WORLD.w; /* ?page=N: 바이옴 텍스처 확인 */
        ctx.drawImage(t, (WORLD.w - sw) / 2 * k, (WORLD.h - sh) / 2 * k, sw * k, sh * k, 0, 0, cvW, cvH); }
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, 0, cvW, LY.head);
      ctx.fillStyle = '#ffd700'; ctx.font = 'bold ' + LY.f1 + 'px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('STAGE — 실렌더러 검증 (?stage=1)', LY.pad, LY.head * .3);
      ctx.fillStyle = '#8899aa'; ctx.font = LY.f2 + 'px sans-serif';
      ctx.fillText('걷기·공격·대기 20프레임 / kind 파츠 / 지팡이 연결 확인용', LY.pad, LY.head * .52);
      ctx.fillText('t=' + t.toFixed(1) + 's · 3D:' + threeState + (freezeCast ? ' · cast=' + freezeCast : '') + ' · loot=' + Object.keys(lootItems || {}).length + '/' + myMap() + ' · me=' + Math.round(me.x) + ',' + Math.round(me.y) + ' chars=' + charNodes3D.size + ' cam=' + Math.round(camT3D.x) + ',' + Math.round(camT3D.y), LY.pad, LY.head * .76);
      LY.place(Object.values(lootItems), LY.loot);
      drawLootItems(now);
      LY.place(stageSims, LY.mobs);
      for (const s of stageSims) {
        s.dirA = Math.PI / 2 + Math.sin(t * .7 + s.homeX) * .5;
        drawMob(s, now);
      }
      LY.place(heroes, LY.heroes);
      heroes.forEach((h, i) => {
        h.stepPh += .075;
        const face = Math.PI / 2 + Math.sin(t * .55 + i * 1.6) * 1.1;
        const cyc = (t + i * 1.13) % 4;
        /* 직업별 스킬 시전 전시 (?cast=스킬ID면 해당 자세로 고정) */
        const baseSkill = { warrior: 'power_strike', archer: 'multishot', rogue: 'shadow_strike', mage: 'fireball' }[h.cls];
        let castFx = null;
        if (freezeCast && CAST_DUR[freezeCast]) {
          castFx = { id: freezeCast, t0: now - CAST_DUR[freezeCast] * .5, dur: CAST_DUR[freezeCast] };
        } else {
          const sid = (Math.floor(t / 7) % 2 && h.cls === 'mage') ? 'heal' : baseSkill;
          const cc = (t + i * 1.75) % 7;
          if (cc < .55) castFx = { id: sid, t0: now - cc * 1000, dur: CAST_DUR[sid] };
        }
        drawChar({ cls: h.cls, equipped: h.eq, face, moving: true, stepPh: h.stepPh,
          swing: cyc < .3 ? now - cyc * 1000 : 0, castFx, x: h.x, y: h.y, hp: 100, maxHp: 100,
          name: CLASSES[h.cls].name, isSelf: i === 0 });
      });
    } catch (err) { console.error('[stage]', err); window.__stage = false; }
  };
  sl();
}
function loop(t) {
requestAnimationFrame(loop);
  if (window.__stage) return;
  try {
    loopBody(t);
    if (loopErrMsg) loopErrMsg = '';
  } catch (err) {
    loopErrMsg = String(err && err.message || err);
    if (loopErrMsg !== lastLoopErr) { lastLoopErr = loopErrMsg; console.error('[loop]', err); toast('⚠️ 렌더 오류: ' + esc(loopErrMsg)); }
  }
}
/* 중앙 모달 + 일시정지 (독/ESC 등 모든 토글은 MutationObserver가 자동 감지) */
let paused = false, pauseStart = 0, chatVisible = true;
function syncModal() {
  const open = !!document.querySelector('#invPanel.open,.sidepanel.open,#worldMap.open,#enhModal,#enhMenu,#hordePick.open,#hordeEnd.open');
  const dim = $('modalDim');
  if (dim) dim.classList.toggle('on', open);
  document.querySelectorAll('#dockL [data-p]').forEach(b => {
    const id = b.dataset.p;
    if (id === 'chat') { b.classList.toggle('on', chatVisible); return; }
    const el = document.getElementById(id);
    b.classList.toggle('on', !!(el && el.classList.contains('open')));
  });
  if (open && !paused) { paused = true; pauseStart = Date.now(); }
  else if (!open && paused) {
    paused = false;
    const d = Date.now() - pauseStart;
    for (const k in skillCdUntil) skillCdUntil[k] = (skillCdUntil[k] || 0) + d;
    if (me.deadUntil) me.deadUntil += d;
  }
}
if (typeof MutationObserver !== 'undefined') new MutationObserver(() => { try { syncModal(); } catch (e) {} }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
function toggleChat() { chatVisible = !chatVisible; $('chatBox').style.display = chatVisible ? '' : 'none'; syncModal(); }
function toggleTree() { togglePanel('treePanel'); if ($('treePanel').classList.contains('open')) renderTree(); }
function loopBody(t) {
  const now = Date.now();
  const dt = Math.min(50, t - lastT);
  lastT = t;
  if (!ready) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d1420';
    ctx.fillRect(0, 0, cvW, cvH);
    ctx.fillStyle = '#8899aa';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⚔ 바이브 아레나 ⚔', cvW / 2, cvH / 2 - 12);
    ctx.fillStyle = '#556';
    ctx.font = '12px sans-serif';
    ctx.fillText('연결 중...', cvW / 2, cvH / 2 + 12);
    return;
  }

  if (!Number.isFinite(me.vx)) me.vx = 0;
  if (!Number.isFinite(me.vy)) me.vy = 0;
  if (!Number.isFinite(me.stepPh)) me.stepPh = 0;
  if (!Number.isFinite(dustT)) dustT = 0;
  if (paused) { updateHUD(); updateHotbar(now); draw(now); return; } /* 모달 열림: 렌더만, 로직 정지 */
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
    const maxSpd = moveSpd() * (Date.now() < (me.atkSlowUntil || 0) ? .45 : 1); /* 타격 직후 감속 */
    if (dx || dy) {
      dest = null; attackTargetSimId = null;
      if (autoHunt) { autoHunt = false; updateAutoBtn(); } /* 수동 이동 시 자동 사냥 해제 */
      const len = Math.hypot(dx, dy);
      glideToward(me.x + dx / len * 120, me.y + dy / len * 120, maxSpd, dt, 0);
    } else {
      if (autoHunt && !attackTargetSimId && !dest) { /* 자동 사냥: 주변 루팅 먼저 → 없으면 가장 가까운 몬스터 */
        const loot = now < bagFullUntil ? null : nearestLoot(280); /* 가방 가득이면 루팅 경로 생략 → 사냥 계속 */
        if (loot) dest = { x: loot.x, y: loot.y, loot: loot.lid, t0: now };
        else { const t = nearestSim(9999, simSkip); if (t) { attackTargetSimId = t.id; targetT0 = now; } }
      }
      if (autoHunt) autoCombat(now);
    }
    if (dx || dy) { /* (위 분기에서 처리됨) */ }
    else if (attackTargetSimId) {
      const s = sims.find(v => v.id === attackTargetSimId && v.map === myMap());
      if (!s || !s.alive) { attackTargetSimId = null; brake(dt); }
      else if (Math.hypot(s.x - me.x, s.y - me.y) > atkRange()) {
        if (autoHunt) { if (!targetT0) targetT0 = now; else if (now - targetT0 > 8000) { simSkip[s.id] = now + 20000; attackTargetSimId = null; targetT0 = 0; } } /* 바위·연못 뒤 몬스터에 영원히 밀착하는 것 방지 */
        glideToward(s.x, s.y, maxSpd, dt, 1);
      }
      else { targetT0 = now; brake(dt); tryAttack(now, s); }
    } else if (dest) {
      const dd = Math.hypot(dest.x - me.x, dest.y - me.y);
      if (dest.loot && (dd < 34 || !lootItems[dest.loot] || (lootSkip[dest.loot] || 0) > now || now - (dest.t0 || now) > 6000)) { /* 루팅 목적지: 줍기 반경 안 / 사라짐 / 건너뜀 / 6초 내 못 닿음(바위 속 등) */
        if (now - (dest.t0 || now) > 6000) lootSkip[dest.loot] = now + 20000;
        dest = null; brake(dt);
      }
      else if (dd < 10 && !mouseDown) { dest = null; brake(dt); }
      else glideToward(dest.x, dest.y, maxSpd, dt, 1);
    } else brake(dt);
    /* 실제 속도로 걷기 판정 — 다리 모션·먼지가 속도와 동기화돼 밀림 현상 없음 */
    const spd = Math.hypot(me.vx, me.vy);
    moved = spd > 30;
    if (moved) {
      meMovingNow = true;
      me.stepPh = (me.stepPh + spd * dt / 1000 * .11) % (Math.PI * 2); /* 발구름 위상: 이동 거리 기반 */
      dustT += spd * dt / 1000;
      while (dustT > 30) {                  /* 30px마다 발먼지 */
        dustT -= 30;
        poofs.push({ x: me.x + rand(-5, 5), y: me.y + 12, vx: rand(-8, 8) - me.vx * .08, vy: rand(-14, -6), r: rand(1.5, 3), t: 0, color: 'rgba(150,140,110,.5)', g: -14 });
      }
    } else meMovingNow = false;
  } else meMovingNow = false;
  /* 감속 스키드 중에도 충돌 해결 — 아니면 장애물 속으로 미끄러져 들어감 */
  if (moved || Math.hypot(me.vx || 0, me.vy || 0) > 1) resolveCollide();

  if (!Number.isFinite(me.x) || !Number.isFinite(me.y)) { me.x = SPAWN.x; me.y = SPAWN.y; cam.x = me.x; cam.y = me.y; }
  if (!Number.isFinite(me.hp)) me.hp = maxHpOf(); /* 비정상 HP가 Firestore로 퍼지는 것 차단 */
  if (me.mp != null && !Number.isFinite(me.mp)) me.mp = maxMpOf();
  const movedFar = Math.abs(me.x - sentX) + Math.abs(me.y - sentY) > 16; /* 2px→16px: 미세 이동은 보내지 않음 */
  const mpChanged = me.mp != null && (Math.abs(Math.round(me.mp) - (sentMp ?? 0)) >= 5 || (Math.round(me.mp) !== sentMp && me.mp >= maxMpOf()));
  const quotaBackoff = offline || ecoOn() || now - quotaHitAt < 60000; /* 로컬 모드/한도 초과 직후엔 위치 심박 중단 (동기화 때 한 번에 실림) */
  if (offline || pendKeys.size) trySync(false);
  if (!quotaBackoff && ((now - lastPosWrite > 1500 && (movedFar || hpDirty || mpChanged)) || now - lastPosWrite > 20000)) { /* 600ms→1.5s, 심박 8s→20s: 쓰기 1/3 */
    lastPosWrite = now;
    hpDirty = false;
    sentX = me.x; sentY = me.y; sentHp = Math.round(me.hp || 0); sentMp = me.mp != null ? Math.round(me.mp) : null;
if (meRef) updX(meRef, { x: me.x, y: me.y, hp: me.hp, ...(me.mp != null ? { mp: Math.round(me.mp) } : {}), ...(me.lastHurtAt ? { lastHurtAt: Math.round(me.lastHurtAt) } : {}), power: Math.round(totalAtk() * (1 + totalCrit()) * skillPow()), lastSeen: now }).catch(() => {});
  }

  if (!me.dead && (me.mp ?? 0) < maxMpOf()) {
    me.mp = Math.min(maxMpOf(), (me.mp ?? 0) + maxMpOf() * .03 * dt / 1000);
    /* 재생 중엔 5 이상 변했거나 만충 시에만 쓰기 — 매 600ms 쓰기로 쿼터 낭비 방지 */
    if (Math.abs(me.mp - (sentMp ?? 0)) >= 5 || me.mp >= maxMpOf()) hpDirty = true;
  }

  /* 접속 직후 피가 쭉 차는 것 방지: 로그인 후 30초간 자동 재생 억제 */
  if (!me.dead && now - loginAt > 30000 && now - (me.lastHurtAt || 0) > 4000 && me.hp < maxHpOf()) {
    me.hp = Math.min(maxHpOf(), me.hp + maxHpOf() * .02 * (1 + (me.stRegen || 0) * .15) * dt / 1000); /* 재생 스탯 */
    if (Math.abs(me.hp - sentHp) >= 5 || me.hp >= maxHpOf()) hpDirty = true;
  }

  if (me.dead && me.deadUntil && now > me.deadUntil) {
    me.dead = false; me.hp = maxHpOf();
    const sp0 = (pageDef(pageNum()) || {}).spawn || SPAWN; me.x = sp0.x; me.y = sp0.y; /* 현재 구역의 스폰 지점(2구역부터 좌측) */
    updX(meRef, { dead: false, hp: me.hp, x: me.x, y: me.y, lastSeen: now }).catch(() => {});
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

  /* 카메라: 이동 방향으로 살짝 앞서 봄(lookahead) + 부드러운 추적 */
  const lk = .22, ck = Math.min(1, dt * .01);
  cam.x += ((me.x + (me.vx || 0) * lk) - cam.x) * ck;
  cam.y += ((me.y + (me.vy || 0) * lk) - cam.y) * ck;

  if (hordeOn()) hordeConfine(); /* 쇄도: 결계 밖으로 못 나감 */
  if (!me.dead && !mapFading && !hordeOn()) {
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
  if (ready) { try { updateAmbient(now, dt); } catch (e) {} }
  try { hordeTick(now, dt); } catch (e) { window.__lastErr = { at: Date.now(), where: 'hordeTick', msg: String(e && e.message || e) }; }
  slashes = slashes.filter(s => (s.t += dt) < 180);
  bolts = bolts.filter(b => (b.t += dt) < b.max);
  meteors = meteors.filter(m => { m.t += dt; if (m.t >= m.max * .8 && !m.landed) { m.landed = true; try { m.onLand && m.onLand(); } catch (e) {} } return m.t < m.max * .8; });
  shots = shots.filter(s => { s.t += dt; s.x += s.vx * dt / 1000; s.y += s.vy * dt / 1000; return s.t < s.max; });
  rings = rings.filter(r => (r.t += dt) < r.max);
  flashes = flashes.filter(f => (f.t += dt) < f.max);
  poofs = poofs.filter(p => { p.t += dt; p.x += (p.vx || 0) * dt / 1000; p.y += (p.vy || 0) * dt / 1000; p.vy = (p.vy || 0) + (p.g ?? 240) * dt / 1000; return p.t < 600; });

  updateHUD();
  updateHotbar(now);
  if ($('shopPanel').classList.contains('open')) renderShopThrottled();
  if ($('questPanel').classList.contains('open')) renderQuestsThrottled();
  if ($('treePanel') && $('treePanel').classList.contains('open')) renderTreeThrottled();
  if (SCENE3D && !sceneFailed) updateScene3D(now, dt);
  else draw(now);
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
  runTx(db, async tx => {
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
    /* 골드 차감은 트랜잭션(로컬 적용)에서 이미 반영됨 — 여기서 다시 빼면 이중 과금 */
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
  runTx(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return false;
    const p = snap.data();
    if ((p.statPts || 0) <= 0) return false;
    tx.update(meRef, { statPts: p.statPts - 1, [k]: (p[k] || 0) + 1 });
    return true;
  }).then(ok => {
    if (!ok) return;
    sfx('buy'); /* 스탯 증가는 트랜잭션(로컬 적용)에서 이미 반영됨 — 재적용하면 +2 */
    if (k === 'stHp') {
      me.hp = Math.min(maxHpOf(), (me.hp || 0) + 15);
      updX(meRef, { hp: me.hp }).catch(() => {});
    }
    float(me.x, me.y - 30, `${STAT_DEFS[k]?.n || k} +1`, '#7fe3a0');
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
      <div class="cicon">${heroSheet(k) ? `<img src="${heroPortrait(k)}" alt="">` : c.icon}</div>
      <div class="cname">${c.name}</div>
      <div class="cweap">「${c.weaponName}」</div>
      <div class="cstat">HP <b>${c.hp}</b> · MP <b>${c.mp || 100}</b> · 공격 <b>${c.atk}</b><br>치명타 <b>${Math.round(c.crit * 100)}%</b> · 속도 <b>${c.speed}</b><br>${info[k]}</div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.ccard').forEach(card => card.onclick = () => {
    selectedCls = card.dataset.cls;
    grid.querySelectorAll('.ccard').forEach(c => c.classList.toggle('sel', c.dataset.cls === selectedCls));
    setTitleArt('crArt', selectedCls);
  });
  setTitleArt('crArt', selectedCls);
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
      scr.innerHTML = '<div class="lgBg"><div class="lgStars"></div><div class="lgFog"></div><img class="lgArt" id="lgArt" alt=""><div class="lgVig"></div></div>'
      + '<div class="lgTop"><div class="lgEyebrow">VIBE ARENA</div><h1>바이브 아레나</h1><div class="sub">영웅들의 무대 · 100개 구역을 정복하라</div></div>'
      + '<div class="lgBottom"><div class="party">'
      + ['warrior', 'archer', 'rogue', 'mage'].map(k => `<div class="lp" data-cls="${k}"><img alt=""><span></span></div>`).join('')
      + '</div><div class="lphint">영웅을 고르면 캐릭터 생성에 반영됩니다</div><button id="googleLoginBtn">🅶 Google로 계속하기</button></div>';
      scr.querySelectorAll('.lp').forEach(el => {
        try {
          const k = el.dataset.cls;
          el.querySelector('img').src = heroPortrait(k);
          el.querySelector('span').textContent = (CLASSES[k] && CLASSES[k].name) || k;
          el.classList.toggle('sel', k === selectedCls);
          el.onclick = () => { selectedCls = k; scr.querySelectorAll('.lp').forEach(x => x.classList.toggle('sel', x === el)); setTitleArt('lgArt', k); };
        } catch (e) { /* 초상화 실패해도 로그인은 진행 */
          el.querySelector('span').textContent = (CLASSES[el.dataset.cls] && CLASSES[el.dataset.cls].name) || el.dataset.cls;
        }
      });
      document.body.appendChild(scr);
    }
    scr.style.display = 'flex';
    setTitleArt('lgArt', selectedCls);
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
/* (제거) 15초 lastSeen 별도 쓰기 — 위치 심박(20s)에 lastSeen이 포함돼 중복이었다 */
let _dailyCheckT = 0;
setInterval(() => {
  let n = 1;
  for (const [, o] of Object.entries(others)) if (Date.now() - (o.lastSeen || 0) < OFFLINE_MS) n++;
  const el = $('ocN');
  if (el) el.textContent = n;
  /* 만료된 루팅 건너뛰기 기록 정리 (lid 키 누적 방지) */
  { const nowT = Date.now(); for (const k in lootSkip) if (lootSkip[k] <= nowT) delete lootSkip[k]; }
  /* 자정 넘김 감지: 장시간 접속 중에도 날짜가 바뀌면 일일 초기화 (이전엔 재접속/퀘스트창 열 때만) */
  if (ready && Date.now() - _dailyCheckT > 30000) { _dailyCheckT = Date.now(); try { if ((me.daily || {}).date && (me.daily || {}).date !== todayStr()) { checkDaily(); if ($('questPanel')?.classList.contains('open')) renderQuests(); } } catch (e) {} }
}, 1000);

window.addEventListener('unhandledrejection', ev => { try { const r = ev.reason; window.__lastErr = { at: Date.now(), where: 'unhandledrejection', code: r && r.code, msg: String(r && (r.stack || r.message) || r).slice(0, 400) }; } catch (e) {} });
window.addEventListener('error', ev => {
  const el = $('loading');
  if (el && el.style.display !== 'none' && !String(ev.message).includes('favicon')) {
    el.style.display = 'flex';
    el.innerHTML = '오류 발생: ' + esc(ev.message || String(ev)) +
      '<br><br><a href="javascript:location.reload()" style="color:#7fc7ff">새로고침</a>';
  }
});

async function init() {
  if (location.search.includes('stage=1')) { stageMode(); return; } /* 검증 스테이지: 로그인 건너뜀 */
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
      dead: false, color: colorOf(uid), map: 'p1', conq: {}, dex: {}, statPts: 0, lastSeen: Date.now(), mp: maxMpOf(), gem: 0, achv: {}, title: '', daily: {},
    });
    me = { ...me, cls: choice.cls, map: 'p1', gold: 100, hp: c.hp, maxHp: c.hp, atk: c.atk }; /* 스냅샷 도착 전 로컬 동기화 */
    await sysMsg(`${myName}(${c.name})님이 월드에 입장했습니다.`);
  } else {
    const d = snap.data();
    myName = d.name;
    myCls = d.cls || 'warrior';
    muted = !!d.muted;
    if (!d.cls) await updX(meRef, { cls: 'warrior' }).catch(() => {});
    /* 문서 전체를 지금 병합해야 아래 ensurePage/watchMonsters가 올바른 구역(me.map)을 본다
       — onSnapshot 병합만 믿으면 p2+에서 재접속 시 p1 몬스터를 구독해 현재 구역이 텅 빔 */
    const { x: _x, y: _y, hp: _hp, ...rest } = d;
    me = { ...me, ...rest };
    me.dead = false; /* DB에도 아래에서 dead:false로 기록 */
    me.x = Number.isFinite(d.x) ? d.x : SPAWN.x;
    me.y = Number.isFinite(d.y) ? d.y : SPAWN.y;
    me.hp = Number.isFinite(d.hp) ? clampN(d.hp, 1, maxHpOf()) : maxHpOf(); /* 저장된 HP 복원(이전엔 항상 기본값 100) */
    cam.x = me.x; cam.y = me.y;
    restorePend(d); /* 이전 세션에서 서버에 못 올린 진행분(서버 lastSeen보다 새로울 때만) */
    await updX(meRef, { lastSeen: Date.now(), dead: false, ...(d.mp == null ? { mp: maxMpOf() } : {}) }).catch(() => {}); /* 한도 초과여도 로그인은 계속 */
    /* 로그인 1회 실제 서버 기록: 접속 시각·레벨·전투력 — 절약 모드에서는 보류 변경이 없으면 서버에 아무것도 안 실려 랭킹 ⚔이 옛값/0으로 남았다 */
    withTimeout(updateDoc(meRef, { lastSeen: Date.now(), dead: false, lv: me.lv || 1, power: curPower() }), UPD_TIMEOUT).catch(() => {});
    if (pendKeys.size) trySync(true);
  }

  try { await ensureWorld(); await ensureWorldM2(); await ensurePage(pageNum()); } catch (e) { noteErr && noteErr(e); }

  onSnapshot(meRef, s => {
    if (!s.exists()) return;
    if (offline || pendKeys.size) return; /* 로컬 모드: 로컬 상태가 권위 — 서버 에코가 진행분을 되돌리지 않게 */
    const d = s.data();
    /* x/y/hp/mp/lastHurtAt는 로컬이 권위 — 자기 쓰기 에코가 이동/재생을 되돌리는 것 방지
       (이전의 '장착템=가방템 중복 제거' 클리너는 정당한 동일 아이템 사본까지 파괴해 제거함) */
    const { x, y, hp, mp, lastHurtAt, dead, deadUntil, ...rest } = d; /* 생사·부활시각도 로컬 권위(옛 서버값이 즉시 부활시키는 것 방지) */
    me = { ...me, ...rest };
    renderInvUI();
    try { /* 열려 있는 패널은 서버 상태로 다시 그림 — 수령/구매 직후 단계·잔액이 바로 맞게 */
      if ($('achvPanel')?.classList.contains('open')) renderAchv();
      if ($('questPanel')?.classList.contains('open')) renderQuests();
      if ($('shopPanel')?.classList.contains('open')) renderShop();
    } catch (e) {}
  });

  watchPlayers();
  watchMonsters();
  watchLoot();
  watchChat();
  watchRank();

  try { checkDaily(); } catch (e) {} /* 일일 초기화(출석/일일퀘) */
  ready = true;
  loginAt = Date.now();
  window.__HIT = (sx, sy) => { const r = simAt(sx, sy); return { world: r.w, hit: r.s ? { id: r.s.id, kind: r.s.kind, x: Math.round(r.s.x), y: Math.round(r.s.y) } : null }; };
  window.__SIMS = () => sims.filter(v => v.alive && v.map === myMap()).slice(0, 8).map(v => ({ id: v.id, kind: v.kind, hp: v.hp, maxHp: v.maxHp, x: Math.round(v.x), y: Math.round(v.y), r: (sdef(v).r || 16), sx: Math.round((v.x - view.x) * (view.z || 1)), sy: Math.round((v.y - view.y) * (view.z || 1)) }));
  window.__itemThumb = itemThumb; window.__itemIconCanvas = itemIconCanvas; /* 진단: 아이콘 미리보기 */
  window.__TX = () => Promise.race([runTransaction(db, async tx => { const g = await tx.get(meRef); tx.update(meRef, { lastSeen: Date.now() }); return 'tx-ok:' + g.exists(); }), new Promise(r => setTimeout(() => r('tx-timeout'), 8000))]).catch(e => 'tx-error:' + (e.code || e.message)); /* 진단: 트랜잭션 경로 */
  window.__DD = async id => { const sm = sims.find(v => v.id === id); if (!sm) return 'no-sim'; const t0 = performance.now(); const r = await Promise.race([dealDamage(sm, 1), new Promise(rs => setTimeout(() => rs('dd-timeout'), 8000))]); return { r, ms: Math.round(performance.now() - t0) }; };
  window.__PING = () => Promise.race([updateDoc(meRef, { lastSeen: Date.now() }).then(() => 'write-ok'), new Promise(r => setTimeout(() => r('write-timeout'), 8000))]).catch(e => 'write-error:' + (e.code || e.message)); /* 진단: 쓰기 채널 상태 */
  window.__MOB = async id => { const g = await getDoc(doc(db, 'monsters', id)); return g.exists() ? g.data() : null; };
  window.__give = async (id, slot = 17) => { await updX(meRef, { ['inv.' + slot]: id }); return 'ok'; }; /* 진단: 가방 슬롯에 아이템 넣기 */
  window.__useBook = useSkillBook; window.__me = () => me; window.__OFF = () => ({ offline, since: offlineSince, pend: [...pendKeys], loot: Object.keys(lootItems).length }); window.__SYNC = () => trySync(true); window.__forceOff = () => enterOffline({ code: 'resource-exhausted' }); window.__LOOT = () => lootItems; window.__uniqGrid = ns => ns.map(n => { const pd = pageDef(n); return { n, name: pd.kinds[0].name, base: pd.kinds[0].base, hue: pd.kinds[0].hue, thumb: mobThumb(pd.kinds[0]), boss: pd.boss.base, bossThumb: mobThumb(pd.boss) }; });
window.__tex = n => getTex(pageId(n)); window.__rank = () => rankCache; window.__horde = () => horde; window.__hordeStart = hordeStart; window.__hordeEnd = () => hordeEnd('clear'); window.__hordeSkip = ms => { if (horde) horde.left -= (ms || 60000); }; window.__waters = () => zoneWaters; window.__pageDef = pageDef; window.__view = () => ({ x: view.x, y: view.y, z: view.z, dpr }); window.__mkUniqAt = () => { const s0 = sims.find(v=>v.alive && v.id!=='p1_boss'); if(!s0) return 'no'; s0.uniq=true; s0._ud=null; cam.x=s0.x; cam.y=s0.y; return {id:s0.id, kind:s0.kind, x:s0.x, y:s0.y}; }; window.__mkUniq = () => { const s0 = sims.find(v=>v.alive && v.id!=='p1_boss'); if(!s0) return 'no'; s0.uniq=true; s0._ud=null; const me2=window.__me?me:me; me.x=s0.x; me.y=s0.y-80; cam.x=s0.x; cam.y=s0.y-40; return {id:s0.id, kind:s0.kind}; }; window.__useSkill = useSkill; window.__sheets2 = () => ({ total: Object.keys(HERO_SHEETS).length, mob: Object.keys(HERO_SHEETS).filter(k=>k.startsWith('mob_')&&HERO_SHEETS[k].img).length, wss: WSS, bioTex: bioTexCache.size }); window.__loadMob = base => heroSheet('mob_'+base); window.__openStats = openStats; window.__sortBag = sortBag; window.__toggleAuto = toggleAuto; window.__autoState = () => ({ auto: autoHunt, target: attackTargetSimId, dest, map: me.map, myMap: myMap(), nearLoot: (l => l ? { x: Math.round(l.x), y: Math.round(l.y), d: Math.round(Math.hypot(l.x - me.x, l.y - me.y)) } : null)(nearestLoot(280)) }); window.__clearTarget = () => { attackTargetSimId = null; dest = null; }; window.__auto = () => autoHunt; window.__settings = () => settings; window.__salvage = salvageBulk; window.__invRar = () => Object.entries(me.inv||{}).map(([k,v])=>({k, id:String(v).split(/[*~+]/)[0], rar:getItem(v).rarity, rank:RARITY_RANK[getItem(v).rarity]??0, slot:getItem(v).slot||'-'})); window.__claimAchv = claimAchv; window.__ownedTitles = ownedTitles; window.__paused = () => ({ paused, ready, dead: me.dead, wm: worldMapOpen() }); window.__unpause = () => { paused = false; }; window.__cdUntil = id => skillCdUntil[id]||0; window.__bound = boundId; window.__skillDef = skillDef; window.__mpc = id => { const d=skillDef(id); return d&&d.mp?mpCostOf(skillMp(id,d)):0; }; window.__castTree = castTreeSkill; window.__drawOnce = () => { const t0 = performance.now(); try { loopBody(performance.now()); } catch (e) { return 'ERR:' + (e.stack || e.message); } return Math.round((performance.now() - t0) * 100) / 100; }; window.__showCreate = () => showCreateUI(); window.__showLogin = () => { const p = waitForLoginClick(); return p; }; window.__pick = lid => pickup(lid, lootItems[lid]); window.__atk = (id, dmg) => { const sm = sims.find(v => v.id === id); if (!sm) return 'no-sim'; attackResult(sm, dmg, false); return { hp: sm.hp, alive: sm.alive }; }; window.__books = () => Object.keys(ITEMS).filter(k => k.startsWith('sb_')).length;
  window.__ITEMS = () => ({ items: Object.keys(ITEMS).length, sets: Object.keys(SETS).length, sample: Object.entries(ITEMS).filter(([k]) => /_b[0-9]$/.test(k)).slice(0, 3).map(([k, v]) => k + ':' + v.name) });
  window.__ZONETEX = n => { try { const t = getTex('p' + n); return { w: t.width, h: t.height, cols: (worldColliders['p' + n] || []).length }; } catch (e) { return { err: String(e && e.stack || e).slice(0, 300) }; } };
  window.__DBG = () => ({ page: myPage(), colliders: (worldColliders[myMap()] || []).length, frozenMs: hitStopUntil - Date.now(), activeIsChat: document.activeElement === chatInput, activeTag: document.activeElement && document.activeElement.tagName + '#' + document.activeElement.id, wmUp: worldMapOpen(), mouseDown, moveSpd: moveSpd(), atkRange: atkRange(), atkCdMs: atkCdOf(), sinceAtk: Date.now() - lastAttackAt, mapFading, snapN: window.__snapN || 0, snapAgoMs: window.__snapT ? Date.now() - window.__snapT : null, lastDmg: window.__lastDmg || null, lastErr: window.__lastErr || null, dead: !!me.dead, paused, ready, sheets: Object.fromEntries(Object.entries(HERO_SHEETS).map(([k, v]) => [k, v.img ? 'ok' : v.failed ? 'failed' : 'loading'])), target: attackTargetSimId, hover: hoverSimId, dest: dest && { x: Math.round(dest.x), y: Math.round(dest.y) }, zoom: userZoom, viewZ: view.z, dpr, fx: { rings: rings.length, slashes: slashes.length, shots: shots.length, poofs: poofs.length, floats: floats.length }, cast: heroCast && heroCast.id, binds: JSON.stringify(me.binds || {}), skills: JSON.stringify(me.skills || {}), gold: me.gold, heroTop: (() => { try { return heroFrames(me.cls || 'warrior', me.equipped || {}).top; } catch (e) { return null; } })(),
    me: { x: Math.round(me.x), y: Math.round(me.y), lv: me.lv, map: me.map, bag: me.bagSize, conq: JSON.stringify(me.conq || {}) },
    sims: sims.filter(s => s.alive).slice(0, 20).map(s => ({ id: s.id, x: Math.round(s.x), y: Math.round(s.y), d: Math.round(Math.hypot(s.x - me.x, s.y - me.y)), boss: s.boss, lv: simLevel(s) })) });
  $('loading').style.display = 'none';
  renderStatButtons();
  if (isMobileUI()) toast('💡 아이템은 가까이 가면 자동으로 줍습니다');
  const mn = $('mapName');
  if (mn) mn.textContent = pageDef(pageNum()).name;
  renderInvUI();
}

buildWorld();

document.querySelectorAll('#invPanel h3.tog').forEach(h => {
  const g = $(h.dataset.tog);
  /* 예전엔 모바일에서 장비/가방을 접은 채로 열어 팝업이 빈 화면처럼 보였다 — 팝업이 커진 지금은 펼쳐서 시작 */
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
