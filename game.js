import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInWithPopup, GoogleAuthProvider, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, setDoc, updateDoc, onSnapshot, collection,
  query, orderBy, limit, addDoc, runTransaction, getDoc, writeBatch, increment
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const app = initializeApp(window.firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

/* ================= 상수 ================= */
const WORLD = { w: 1600, h: 1200 };
const SPAWN = { x: 800, y: 600 };
const OFFLINE_MS = 12000;
const INV_SIZE = 18;
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

const SLOTS = [
  ['weapon', '무기'], ['armor', '갑옷'], ['helmet', '모자'],
  ['pants', '바지'], ['gloves', '장갑'], ['boots', '부츠'],
  ['bracelet', '팔찌'], ['necklace', '목걸이'], ['ring', '반지'],
];

const ITEMS = {
  sword_wood:    { name: '나무 검',   slot: 'weapon', atk: 3,  color: '#a0714f' },
  sword_iron:    { name: '철 검',     slot: 'weapon', atk: 8,  color: '#bdc3c7' },
  sword_flame:   { name: '화염검',    slot: 'weapon', atk: 15, color: '#ff7f27' },
  armor_cloth:   { name: '천 갑옷',   slot: 'armor',  def: 2,  color: '#d9c8a9' },
  armor_leather: { name: '가죽 갑옷', slot: 'armor',  def: 5,  color: '#8b5a2b' },
  armor_plate:   { name: '강철 갑옷', slot: 'armor',  def: 10, color: '#7f8c8d' },
  cap_cloth:     { name: '천 모자',   slot: 'helmet', def: 1,  color: '#d9c8a9' },
  cap_leather:   { name: '가죽 투구', slot: 'helmet', def: 3,  color: '#8b5a2b' },
  crown_gold:    { name: '대족장의 왕관', slot: 'helmet', def: 6, atk: 3, color: '#ffd700' },
  pants_cloth:   { name: '천 바지',   slot: 'pants',  def: 1,  color: '#cbbfa3' },
  pants_leather: { name: '가죽 바지', slot: 'pants',  def: 3,  color: '#7a5230' },
  pants_plate:   { name: '강철 다리보호대', slot: 'pants', def: 6, color: '#95a5a6' },
  gloves_cloth:  { name: '천 장갑',   slot: 'gloves', def: 1,  color: '#d9c8a9' },
  gloves_leather:{ name: '가죽 장갑', slot: 'gloves', def: 2,  atk: 2, color: '#8b5a2b' },
  gloves_steel:  { name: '강철 건틀릿', slot: 'gloves', def: 4, atk: 4, color: '#aab7c4' },
  boots_cloth:   { name: '천 신발',   slot: 'boots',  def: 1,  color: '#cbbfa3' },
  boots_leather: { name: '가죽 부츠', slot: 'boots',  def: 2,  color: '#7a5230' },
  boots_wind:    { name: '질풍 부츠', slot: 'boots',  def: 3,  spd: 25, color: '#5dade2' },
  bracelet_wood: { name: '나무 팔찌', slot: 'bracelet', def: 1, color: '#a0714f' },
  bracelet_jade: { name: '옥 팔찌',   slot: 'bracelet', def: 3, atk: 2, color: '#48c9b0' },
  necklace_copper:{ name: '구리 목걸이', slot: 'necklace', atk: 2, color: '#b87333' },
  necklace_ruby: { name: '루비 목걸이', slot: 'necklace', atk: 5, color: '#e74c3c' },
  ring_leather:  { name: '가죽 반지', slot: 'ring', crit: .03, color: '#8b5a2b' },
  ring_shadow:   { name: '그림자 반지', slot: 'ring', crit: .08, atk: 3, color: '#6c3483' },
  potion:        { name: 'HP 물약',   heal: 50, color: '#e74c3c' },
};
const DROP_TABLE = {
  slime:  [['potion', .30], ['sword_wood', .15], ['pants_cloth', .10], ['cap_cloth', .10], ['boots_cloth', .08], ['gloves_cloth', .08], ['bracelet_wood', .06]],
  goblin: [['potion', .25], ['sword_iron', .12], ['armor_cloth', .12], ['gloves_leather', .10], ['cap_leather', .10], ['pants_leather', .10], ['necklace_copper', .08]],
  wolf:   [['potion', .30], ['armor_leather', .12], ['boots_leather', .12], ['gloves_leather', .10], ['ring_leather', .08]],
  boss:   [['sword_flame', 1], ['armor_plate', 1], ['pants_plate', .8], ['crown_gold', .8], ['gloves_steel', .8], ['boots_wind', .8], ['bracelet_jade', .8], ['necklace_ruby', .8], ['ring_shadow', .8]],
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
const expNeed = lv => lv * lv * 30;
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (a, b) => a + Math.random() * (b - a);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => document.getElementById(id);

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
const skillCdUntil = {};

const PALETTE = ['#e74c3c', '#3498db', '#9b59b6', '#1abc9c', '#f39c12', '#e91e63', '#00bcd4'];
const colorOf = id => PALETTE[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];

const skillLv = id => (me.skills || {})[id] || 0;
const passSum = f => Object.keys(SKILLS).reduce((a, id) => a + (SKILLS[id][f] || 0) * skillLv(id), 0);
const cdef = () => CLASSES[myCls] || CLASSES.warrior;
const eqStats = f => Object.values(me.equipped || {}).reduce((a, id) => a + ((ITEMS[id] || {})[f] || 0), 0);
const totalAtk = () => (me.atk || 10) + eqStats('atk') + passSum('atk');
const totalDef = () => eqStats('def') + passSum('def');
const totalCrit = () => cdef().crit + passSum('crit') + eqStats('crit');
const moveSpd = () => cdef().speed + passSum('spd') + eqStats('spd');
const classActiveId = () => Object.keys(SKILLS).find(k => SKILLS[k].cls === myCls && SKILLS[k].type === 'active');

function float(x, y, text, color = '#fff') { floats.push({ x, y, text, color, t: 0 }); }
async function sysMsg(text, k = '') { await addDoc(collection(db, 'chat'), { from: '', text, ts: Date.now(), k }); }

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
        homeX: clampN(z.cx + rand(-z.spread, z.spread), 40, WORLD.w - 40),
        homeY: clampN(z.cy + rand(-z.spread, z.spread), 40, WORLD.h - 40),
      });
    }
  }
  batch.set(doc(db, 'monsters', 'boss'), { type: 'boss', hp: BOSS_DEF.hp, maxHp: BOSS_DEF.hp, alive: true, homeX: 800, homeY: 1050 });
  batch.set(flag, { ts: Date.now() });
  try { await batch.commit(); } catch (e) {}
}

function makeSim(id, d) {
  const type = d.type;
  const def = type === 'boss' ? BOSS_DEF : MONSTER_TYPES[type];
  return { id, type, def, x: d.homeX, y: d.homeY, wa: rand(0, Math.PI * 2), nextWander: 0, atkCdUntil: 0, alive: !!d.alive, hp: typeof d.hp === 'number' ? d.hp : def.hp, respawnAt: d.respawnAt || 0 };
}

function bossAlert(on) {
  const el = $('bossAlert');
  if (on) {
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => el.style.display = 'none', 5000);
  } else el.style.display = 'none';
}

/* ================= 실시간 구독 ================= */
function watchMonsters() {
  onSnapshot(collection(db, 'monsters'), snap => {
    snap.forEach(dc => {
      const d = dc.data();
      let s = sims.find(x => x.id === dc.id);
      if (!s) { s = makeSim(dc.id, d); sims.push(s); }
      if (d.alive && !s.alive) {
        s.x = d.homeX; s.y = d.homeY;
        if (dc.id === 'boss' && !bossWasAlive) bossAlert(true);
      }
      if (typeof d.hp === 'number' && typeof s.hp === 'number' && d.hp < s.hp && s.alive) s.hitFlash = Date.now();
      if (!d.alive && s.alive) spawnPoof(s);
      if (!d.alive && s.alive && dc.id === 'boss') bossAlert(false);
      s.alive = !!d.alive;
      s.hp = typeof d.hp === 'number' ? d.hp : s.def.hp;
      s.respawnAt = d.respawnAt || 0;
    });
    bossWasAlive = (sims.find(s => s.id === 'boss') || { alive: true }).alive;
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
  });
}

/* ================= 성장/보상 ================= */
function levelCalc(p, expGain) {
  let lv = p.lv || 1, exp = (p.exp || 0) + expGain, maxHp = p.maxHp || 100, atk = p.atk || 10, leveled = 0;
  while (exp >= expNeed(lv)) { exp -= expNeed(lv); lv++; maxHp += 20; atk += 2; leveled++; }
  const upd = { exp, lv, maxHp, atk };
  if (leveled) upd.hp = maxHp;
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
      float(me.x, me.y - 44, `레벨 업! Lv ${nlv}`, '#ffd700');
      sysMsg(`${myName}님이 Lv ${nlv} 달성!`);
    }, 0);
  }).catch(() => {});
}

function rollDrops(type) {
  return (DROP_TABLE[type] || []).filter(([, p]) => Math.random() < p).map(([id]) => id);
}

async function dropLoot(type, x, y) {
  for (const itemId of rollDrops(type)) {
    await addDoc(collection(db, 'loot'), { itemId, x: x + rand(-24, 24), y: y + rand(-24, 24), ts: Date.now() });
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
      tx.update(ref, { hp: 0, alive: false, killedBy: uid, respawnAt: Date.now() + sim.def.respawn });
      return true;
    }
    tx.update(ref, { hp: nhp });
    return false;
  }).catch(() => null);
}

async function handleKill(sim) {
  const gold = Math.round((sim.def.gold || 0) * rand(.8, 1.25));
  float(sim.x, sim.y - sim.def.r - 30, `+${sim.def.exp} EXP`, '#3498db');
  float(sim.x, sim.y - sim.def.r - 50, `+${gold} G`, '#ffd700');
  await gainExp(sim.def.exp, { type: sim.type, gold });
  dropLoot(sim.type, sim.x, sim.y);
  sysMsg(`${myName}님이 ${sim.def.name}을(를) 처치했습니다!${sim.type === 'boss' ? ' 👑👑👑' : ''}`);
}

async function attackResult(sim, dmg, crit) {
  const r = await dealDamage(sim, dmg);
  if (r === null || r === undefined) return;
  float(sim.x, sim.y - sim.def.r - 10, String(dmg) + (crit ? '!' : ''), crit ? '#ffd700' : '#fff');
  if (r) await handleKill(sim);
}

function nearestSim(maxD) {
  let best = null, bestD = maxD;
  for (const s of sims) {
    if (!s.alive) continue;
    const d = Math.hypot(s.x - me.x, s.y - me.y);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

function stepToward(pt, sp) {
  me.face = Math.atan2(pt.y - me.y, pt.x - me.x);
  const d = Math.hypot(pt.x - me.x, pt.y - me.y) || 1;
  me.x = clampN(me.x + (pt.x - me.x) / d * sp, 20, WORLD.w - 20);
  me.y = clampN(me.y + (pt.y - me.y) / d * sp, 20, WORLD.h - 20);
}

function shade(hex, f) {
  const n = parseInt((hex || '#888888').slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}
function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function shadow(x, y, rx) {
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath(); ctx.ellipse(x, y + 13, rx, rx * .36, 0, 0, 7); ctx.fill();
}
function spawnPoof(s) {
  for (let i = 0; i < 12; i++) {
    const a = rand(0, Math.PI * 2), v = rand(40, 130);
    poofs.push({ x: s.x, y: s.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, r: rand(2, 5), t: 0, color: s.def.color });
  }
}
function hitFlashOverlay(s, now, d) {
  if (!s.hitFlash) return;
  const p = (now - s.hitFlash) / 150;
  if (p >= 1) { s.hitFlash = 0; return; }
  ctx.globalAlpha = (1 - p) * .7;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(s.x, s.y, d * .55, 0, 7); ctx.fill();
  ctx.globalAlpha = 1;
}

function fireShot(tx, ty, color, dur, size = 5) {
  const d = Math.hypot(tx - me.x, ty - me.y) || 1;
  shots.push({ x: me.x, y: me.y, vx: (tx - me.x) / d * 480, vy: (ty - me.y) / d * 480, t: 0, max: dur, color, size });
}

function tryAttack(now, forced = null) {
  if (!ready || me.dead) return;
  const cd = cdef().atkCd;
  if (now < lastAttackAt + cd) return;
  lastAttackAt = now;
  const target = forced && forced.alive ? forced : nearestSim(cdef().range);
  if (target) me.face = Math.atan2(target.y - me.y, target.x - me.x);
  if (cdef().melee) {
    slashes.push({ x: me.x, y: me.y, a: target ? Math.atan2(target.y - me.y, target.x - me.x) : -Math.PI / 2, t: 0, w: myCls === 'rogue' ? 2 : 3 });
  } else if (target) {
    fireShot(target.x, target.y, myCls === 'archer' ? '#d9c8a9' : '#b388ff', myCls === 'archer' ? 130 : 190, myCls === 'archer' ? 4 : 7);
  }
  if (!target) return;
  const crit = Math.random() < totalCrit();
  const dmg = Math.max(1, Math.round(totalAtk() * rand(.85, 1.15) * (crit ? 1.6 : 1)));
  attackResult(target, dmg, crit);
}

/* ================= 스킬 ================= */
function useSkill(slot) {
  if (!ready || me.dead) return;
  const now = Date.now();
  const id = slot === 2 ? 'heal' : classActiveId();
  if (!id) return;
  const def = SKILLS[id];
  if (skillLv(id) < 1) { float(me.x, me.y - 34, '미습득 스킬 (B: 샵)', '#888'); return; }
  if (now < (skillCdUntil[id] || 0)) return;

  if (id === 'heal') {
    const amt = Math.round(me.maxHp * .4);
    const nhp = Math.min(me.maxHp, (me.hp || 0) + amt);
    updateDoc(meRef, { hp: nhp }).catch(() => {});
    me.hp = nhp;
    float(me.x, me.y - 34, `+${amt} HP`, '#2ecc71');
    rings.push({ x: me.x, y: me.y, r: 60, t: 0, max: 400, color: '46,204,113' });
  } else if (id === 'power_strike') {
    const t = nearestSim(cdef().range * 1.3);
    if (!t) { float(me.x, me.y - 34, '대상 없음', '#888'); return; }
    slashes.push({ x: me.x, y: me.y, a: Math.atan2(t.y - me.y, t.x - me.x), t: 0, w: 7 });
    const dmg = Math.max(1, Math.round(totalAtk() * 4 * rand(.9, 1.1)));
    rings.push({ x: t.x, y: t.y, r: 40, t: 0, max: 300, color: '255,140,0' });
    attackResult(t, dmg, true);
  } else if (id === 'multishot') {
    const targets = sims.filter(s => s.alive && Math.hypot(s.x - me.x, s.y - me.y) < 240);
    if (!targets.length) { float(me.x, me.y - 34, '대상 없음', '#888'); return; }
    for (const t of targets) {
      fireShot(t.x, t.y, '#d9c8a9', Math.hypot(t.x - me.x, t.y - me.y) / 480 * 1000 + 60, 4);
      const dmg = Math.max(1, Math.round(totalAtk() * 1.5 * rand(.9, 1.1)));
      setTimeout(() => attackResult(t, dmg, false), 150);
    }
  } else if (id === 'shadow_strike') {
    const t = nearestSim(180);
    if (!t) { float(me.x, me.y - 34, '대상 없음', '#888'); return; }
    me.x = clampN(t.x + rand(-40, 40), 20, WORLD.w - 20);
    me.y = clampN(t.y + rand(-40, 40), 20, WORLD.h - 20);
    cam.x = me.x; cam.y = me.y;
    slashes.push({ x: me.x, y: me.y, a: Math.atan2(t.y - me.y, t.x - me.x), t: 0, w: 6 });
    const dmg = Math.max(1, Math.round(totalAtk() * 6));
    attackResult(t, dmg, true);
  } else if (id === 'fireball') {
    const t = nearestSim(340);
    if (!t) { float(me.x, me.y - 34, '대상 없음', '#888'); return; }
    fireShot(t.x, t.y, '#ff7f27', Math.hypot(t.x - me.x, t.y - me.y) / 480 * 1000, 9);
    rings.push({ x: t.x, y: t.y, r: 140, t: 0, max: 500, color: '255,90,0' });
    const victims = sims.filter(s => s.alive && Math.hypot(s.x - t.x, s.y - t.y) < 145);
    for (const v of victims) {
      const dmg = Math.max(1, Math.round(totalAtk() * 2.2 * rand(.9, 1.1)));
      setTimeout(() => attackResult(v, dmg, false), 260);
    }
  }
  skillCdUntil[id] = now + def.cd;
}

/* ================= 스킬 샵 ================= */
function renderShop() {
  const body = $('shopBody');
  const list = Object.entries(SKILLS).filter(([, d]) => d.cls === myCls || d.cls === 'all');
  body.innerHTML = list.map(([id, d]) => {
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
  body.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => buySkill(b.dataset.buy));
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
    if (r === 'ok') { float(me.x, me.y - 34, `${SKILLS[id].name} 습득!`, '#7fe3a0'); renderShop(); }
    else if (r === 'poor') float(me.x, me.y - 34, '골드가 부족합니다', '#ff6b6b');
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
      float(me.x, me.y - 40, `퀘스트 완료! +${qdef.reward.gold || 0}G`, '#7fe3a0');
      sysMsg(`[퀘스트] ${myName}님이 「${qdef.name}」 완료!`, 'q');
      renderQuests();
    }
  }).catch(() => {});
}

/* ================= 인벤토리/루팅 ================= */
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
    const idx = await addToInv(item.itemId);
    if (idx === null) { float(me.x, me.y - 30, '가방이 가득 참', '#e74c3c'); return; }
    float(me.x, me.y - 30, `+ ${ITEMS[item.itemId].name}`, ITEMS[item.itemId].color);
  } finally { picking = false; }
}

function addToInv(itemId) {
  return runTransaction(db, async tx => {
    const snap = await tx.get(meRef);
    if (!snap.exists()) return null;
    const p = snap.data();
    const inv = { ...(p.inv || {}) };
    for (let i = 0; i < INV_SIZE; i++) {
      if (inv[String(i)] == null) {
        inv[String(i)] = itemId;
        const q = { ...(p.q || {}) };
        q.items = (q.items || 0) + 1;
        tx.update(meRef, { inv, q });
        return i;
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
    const it = ITEMS[itemId];
    if (it.heal) {
      const hp = Math.min(p.maxHp, (p.hp || 0) + it.heal);
      delete inv[String(idx)];
      tx.update(meRef, { inv, hp });
      setTimeout(() => float(me.x, me.y - 30, `+${it.heal} HP`, '#2ecc71'), 0);
    } else {
      const old = eq[it.slot];
      eq[it.slot] = itemId;
      if (old) inv[String(idx)] = old; else delete inv[String(idx)];
      tx.update(meRef, { inv, equipped: eq, 'q.eqflag': 1 });
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
    const inv = { ...(p.inv || {}) };
    for (let i = 0; i < INV_SIZE; i++) {
      if (inv[String(i)] == null) { inv[String(i)] = itemId; break; }
    }
    delete eq[slot];
    tx.update(meRef, { inv, equipped: eq });
  }).catch(() => {});
}

function renderInvUI() {
  const grid = $('invGrid');
  grid.innerHTML = '';
  for (let i = 0; i < INV_SIZE; i++) {
    const div = document.createElement('div');
    div.className = 'islot';
    const itemId = (me.inv || {})[String(i)];
    if (itemId) {
      const it = ITEMS[itemId];
      div.innerHTML = `<span class="ic" style="color:${it.color}">${it.name[0]}</span>`;
      const stat = it.atk ? `공격 +${it.atk}` : it.def ? `방어 +${it.def}` : `HP +${it.heal} 회복`;
      div.title = `${it.name}\n${stat}`;
      div.onclick = () => slotClick(String(i));
    }
    grid.appendChild(div);
  }
  const eg = $('equipGrid');
  eg.innerHTML = '';
  for (const [slot, label] of SLOTS) {
    const div = document.createElement('div');
    div.className = 'eslot';
    const itemId = (me.equipped || {})[slot];
    if (itemId) {
      const it = ITEMS[itemId];
      div.innerHTML = `<span class="slbl">${label}</span><span style="color:${it.color}">${esc(it.name)}</span>`;
      const extra = [it.atk ? `공격+${it.atk}` : '', it.def ? `방어+${it.def}` : '',
        it.crit ? `치명타+${Math.round(it.crit * 100)}%p` : '', it.spd ? `속도+${it.spd}` : ''].filter(Boolean).join(' · ');
      div.title = `${it.name}\n${extra}`;
      div.onclick = () => unequip(slot);
    } else {
      div.innerHTML = `<span class="slbl">${label}</span><span style="color:#556">-</span>`;
    }
    eg.appendChild(div);
  }
}

/* ================= 몬스터 시뮬레이션 ================= */
function updateSims(now, dt) {
  const targets = [];
  for (const [, o] of Object.entries(others)) {
    if (Date.now() - (o.lastSeen || 0) < OFFLINE_MS && !o.dead) targets.push({ x: o.x, y: o.y, mine: false });
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
          tx.update(ref, { alive: true, hp: g.data().maxHp || s.def.hp, killedBy: null });
        }).catch(() => {});
      }
      continue;
    }
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
        s.x += (tgt.x - s.x) / best * sp;
        s.y += (tgt.y - s.y) / best * sp;
      } else if (now >= s.atkCdUntil) {
        s.atkCdUntil = now + (s.type === 'boss' ? 1800 : 1300);
        if (tgt.mine) monsterHitMe(s, now);
      }
    } else {
      if (now >= s.nextWander) { s.nextWander = now + rand(1200, 3000); s.wa = rand(0, Math.PI * 2); }
      const sp = s.def.speed * .45 * dt / 1000;
      s.dirA = s.wa;
      s.movingF = true;
      s.aggroF = false;
      s.x = clampN(s.x + Math.cos(s.wa) * sp, 20, WORLD.w - 20);
      s.y = clampN(s.y + Math.sin(s.wa) * sp, 20, WORLD.h - 20);
    }
  }
}

function monsterHitMe(s, now) {
  const dmg = Math.max(1, Math.round(s.def.atk * rand(.85, 1.15)) - totalDef());
  hurtUntil = now + 300;
  float(me.x, me.y - 30, String(dmg), '#ff6b6b');
  const nhp = (me.hp || 0) - dmg;
  if (nhp <= 0 && !me.dead) {
    me.dead = true; me.hp = 0; me.deadUntil = now + 3000;
    updateDoc(meRef, { dead: true, deadUntil: me.deadUntil, hp: 0, 'q.deaths': increment(1) }).catch(() => {});
    sysMsg(`${myName}님이 ${s.def.name}에게 쓰러졌습니다...`);
  } else {
    me.hp = nhp;
    updateDoc(meRef, { hp: nhp }).catch(() => {});
  }
}

/* ================= 렌더링 ================= */
const cv = $('game'), ctx = cv.getContext('2d');
const mm = $('minimap'), mctx = mm.getContext('2d');

function resize() { cv.width = innerWidth; cv.height = innerHeight; }
addEventListener('resize', resize);
resize();

const grass = document.createElement('canvas');
grass.width = grass.height = 128;
{
  const g = grass.getContext('2d');
  g.fillStyle = '#204030'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#25493a';
  g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
}
const grassPattern = ctx.createPattern(grass, 'repeat');

function sr(n) { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); }

const SKIN = '#f2c79a';

function drawHat(cls, helmetId) {
  const it = ITEMS[helmetId];
  const hc = it ? it.color : null;
  if (hc || cls === 'warrior') {
    const col = hc || '#9aa5b1';
    ctx.fillStyle = shade(col, 1.05);
    ctx.beginPath(); ctx.arc(0, -22, 11, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.fillRect(-11, -24, 22, 4);
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.beginPath(); ctx.arc(-4, -26, 3, 0, 7); ctx.fill();
    return;
  }
  if (cls === 'archer') {
    ctx.fillStyle = '#2e7d52';
    roundRect(ctx, -10, -33, 20, 6, 2); ctx.fill();
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath(); ctx.moveTo(9, -31); ctx.lineTo(18, -40); ctx.lineTo(13, -28); ctx.closePath(); ctx.fill();
  } else if (cls === 'rogue') {
    ctx.fillStyle = '#34495e';
    ctx.beginPath(); ctx.arc(0, -21, 11.5, Math.PI * .92, Math.PI * 2.08); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.5; ctx.stroke();
  } else if (cls === 'mage') {
    ctx.fillStyle = '#6c3483';
    ctx.beginPath(); ctx.moveTo(-12, -23); ctx.lineTo(12, -23); ctx.lineTo(2, -47); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd700';
    ctx.beginPath(); ctx.arc(3, -35, 2, 0, 7); ctx.fill();
  }
}

function drawHeldWeapon(cls, wid) {
  const it = ITEMS[wid];
  if (cls === 'warrior') {
    const bl = it ? it.color : '#c8d0d8';
    ctx.fillStyle = '#6b4a2f'; roundRect(ctx, -2, -2, 4, 7, 1.5); ctx.fill();
    ctx.fillStyle = '#d9b23c'; roundRect(ctx, -5.5, -5, 11, 3, 1.5); ctx.fill();
    ctx.fillStyle = bl;
    ctx.beginPath();
    ctx.moveTo(-2.5, -5); ctx.lineTo(-2.5, -26); ctx.lineTo(0, -31); ctx.lineTo(2.5, -26); ctx.lineTo(2.5, -5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillRect(-1, -24, 1, 18);
  } else if (cls === 'rogue') {
    const bl = it ? it.color : '#aab4bd';
    ctx.fillStyle = '#4a3524'; roundRect(ctx, -1.5, -1, 3, 5, 1); ctx.fill();
    ctx.fillStyle = bl;
    ctx.beginPath();
    ctx.moveTo(-1.8, -1); ctx.lineTo(-1.8, -11); ctx.lineTo(0, -15); ctx.lineTo(1.8, -11); ctx.lineTo(1.8, -1);
    ctx.closePath(); ctx.fill();
  } else if (cls === 'archer') {
    ctx.strokeStyle = it ? it.color : '#7a5230';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 13, -Math.PI / 2 - .5, Math.PI / 2 + .5); ctx.stroke();
    ctx.strokeStyle = '#eee'; ctx.lineWidth = 1;
    const a0 = -Math.PI / 2 - .5, a1 = Math.PI / 2 + .5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a0) * 13, Math.sin(a0) * 13);
    ctx.lineTo(Math.cos(a1) * 13, Math.sin(a1) * 13);
    ctx.stroke();
  } else if (cls === 'mage') {
    ctx.fillStyle = '#7a5230';
    roundRect(ctx, -1.5, -26, 3, 32, 1.5); ctx.fill();
    ctx.fillStyle = it ? it.color : '#b388ff';
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 9;
    ctx.beginPath(); ctx.arc(0, -29, 4.5, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function drawChar(o) {
  const now = Date.now();
  const bob = o.moving && !o.dead ? Math.abs(Math.sin(now / 85)) * 2.6 : 0;
  shadow(o.x, o.y, 14);
  if (o.isSelf && !o.dead) {
    ctx.strokeStyle = 'rgba(255,215,0,.75)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(o.x, o.y + 13, 17, 6.5, 0, 0, 7); ctx.stroke();
  }
  ctx.save();
  ctx.translate(o.x, o.y - bob);
  if (o.dead) { ctx.globalAlpha = .45; ctx.rotate(Math.PI / 2); }
  if (!o.dead) {
    const st = o.moving ? Math.sin(now / 85) : 0;
    const pc = ITEMS[o.equipped?.pants];
    ctx.fillStyle = pc ? pc.color : '#3a3f4a';
    roundRect(ctx, -9, 4, 7, 11 - Math.abs(st) * 2, 3); ctx.fill();
    roundRect(ctx, 2, 4, 7, 11 - Math.abs(st) * 2, 3); ctx.fill();
  }
  const armorItem = ITEMS[o.equipped?.armor];
  const bc = o.isSelf ? '#8899bb' : (CLASSES[o.cls]?.color || '#888');
  const g = ctx.createLinearGradient(0, -12, 0, 12);
  g.addColorStop(0, shade(bc, 1.15)); g.addColorStop(1, shade(bc, .72));
  ctx.fillStyle = armorItem || g;
  roundRect(ctx, -12, -12, 24, 22, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2; ctx.stroke();
  if (armorItem) {
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
    roundRect(ctx, -8.5, -8.5, 17, 15, 4); ctx.stroke();
  }
  ctx.fillStyle = SKIN;
  ctx.beginPath(); ctx.arc(0, -20, 10, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 1.5; ctx.stroke();
  const fx = Math.cos(o.face ?? Math.PI / 2), fy = Math.sin(o.face ?? Math.PI / 2);
  ctx.fillStyle = '#22262e';
  ctx.beginPath(); ctx.arc(-3.5 + fx * 2.6, -21 + fy * 1.6, 1.7, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(3.5 + fx * 2.6, -21 + fy * 1.6, 1.7, 0, 7); ctx.fill();
  if (!o.dead) drawHat(o.cls, o.equipped?.helmet);
  if (!o.dead) {
    const sw = o.swing ? (now - o.swing) / 220 : -1;
    const baseA = (o.face ?? Math.PI / 2) + .55;
    const a = sw >= 0 && sw < 1 ? baseA - 1.5 + sw * 2.6 : baseA + Math.sin(now / 320) * .07;
    ctx.save();
    ctx.rotate(a);
    ctx.translate(12, 2);
    drawHeldWeapon(o.cls, o.equipped?.weapon);
    ctx.restore();
    if (sw >= 0 && sw < 1) {
      ctx.strokeStyle = `rgba(255,255,255,${.55 * (1 - sw)})`;
      ctx.lineWidth = 3;
      const aa = baseA - 1.2 + sw * 2.6;
      ctx.beginPath(); ctx.arc(0, 0, 24, aa - .5, aa + .5); ctx.stroke();
    }
  }
  ctx.restore();
  if (!o.dead && o.hp < o.maxHp) {
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(o.x - 16, o.y - 42, 32, 5);
    ctx.fillStyle = '#2ecc71';
    ctx.fillRect(o.x - 16, o.y - 42, 32 * clampN(o.hp / o.maxHp, 0, 1), 5);
  }
  ctx.font = (o.isSelf ? 'bold ' : '') + '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = o.isSelf ? '#fff' : (CLASSES[o.cls]?.color || '#eee');
  ctx.fillText(o.name, o.x, o.y - 46);
}

function mobUI(s, wide) {
  const r = s.def.r;
  if (s.hp < s.def.hp || s.type === 'boss') {
    const w = wide ? r * 2.6 : r * 2;
    const y = s.y - r - (wide ? 36 : 18);
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    roundRect(ctx, s.x - w / 2 - 1, y - 1, w + 2, (wide ? 8 : 6) + 2, 3); ctx.fill();
    ctx.fillStyle = s.type === 'boss' ? '#ff5050' : '#e74c3c';
    ctx.fillRect(s.x - w / 2, y, w * clampN(s.hp / s.def.hp, 0, 1), wide ? 7 : 5);
  }
  ctx.font = wide ? 'bold 13px sans-serif' : '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = wide ? '#ffb0b0' : 'rgba(255,255,255,.85)';
  ctx.fillText(s.def.name, s.x, s.y + r + (wide ? 22 : 15));
}

function drawSlime(s, now) {
  const r = s.def.r;
  const wob = Math.sin(now / 140 + s.x * .05) * .1;
  shadow(s.x, s.y + 8, r * .95);
  ctx.save();
  ctx.translate(s.x, s.y + 4);
  ctx.scale(1 + wob, 1 - wob);
  const g = ctx.createRadialGradient(-r * .3, -r * .6, 2, 0, 0, r * 1.25);
  g.addColorStop(0, shade(s.def.color, 1.55));
  g.addColorStop(1, shade(s.def.color, .65));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-r, 3);
  ctx.quadraticCurveTo(-r * 1.05, -r * 1.45, 0, -r * 1.35);
  ctx.quadraticCurveTo(r * 1.05, -r * 1.45, r, 3);
  ctx.quadraticCurveTo(0, 9, -r, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.beginPath(); ctx.ellipse(-r * .35, -r * .7, r * .24, r * .14, -.5, 0, 7); ctx.fill();
  const ed = Math.atan2(cam.y - s.y, cam.x - s.x);
  const exo = Math.cos(ed) * 2, eyo = Math.sin(ed) * 1.2;
  ctx.fillStyle = '#14351f';
  ctx.beginPath(); ctx.arc(-r * .32 + exo, -r * .38 + eyo, 2.3, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(r * .32 + exo, -r * .38 + eyo, 2.3, 0, 7); ctx.fill();
  ctx.strokeStyle = '#14351f'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(exo * 1.5, -r * .12 + eyo, r * .3, .35, Math.PI - .35); ctx.stroke();
  ctx.restore();
  hitFlashOverlay(s, now, r * 1.4);
  mobUI(s, false);
}

function drawGoblin(s, now) {
  const r = s.def.r;
  const walk = Math.sin(now / 110) * (s.movingF ? 1 : 0);
  shadow(s.x, s.y + 11, r * .95);
  ctx.save();
  ctx.translate(s.x, s.y + Math.abs(walk) * -.8);
  ctx.fillStyle = '#4a6e33';
  roundRect(ctx, -r * .55, r * .75, r * .45, 8 + walk * 2, 3); ctx.fill();
  roundRect(ctx, r * .1, r * .75, r * .45, 8 - walk * 2, 3); ctx.fill();
  ctx.fillStyle = '#5f8f3e';
  roundRect(ctx, -r * .78, -r * .25, r * 1.56, r * 1.1, 6); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#7a5230';
  roundRect(ctx, -r * .78, r * .3, r * 1.56, r * .52, 3); ctx.fill();
  ctx.save();
  ctx.translate(r * .82, r * .1);
  ctx.rotate(.5 + Math.sin(now / 170) * .3);
  ctx.fillStyle = '#5f8f3e';
  roundRect(ctx, -2.5, -3, 6, 11, 3); ctx.fill();
  ctx.fillStyle = '#8a6b45';
  roundRect(ctx, -3, -16, 6.5, 15, 3); ctx.fill();
  ctx.fillStyle = '#6e5436';
  ctx.beginPath(); ctx.arc(0, -16, 4.2, 0, 7); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#549038';
  roundRect(ctx, -r * .95, -r * .15, r * .35, r * .8, 3); ctx.fill();
  ctx.fillStyle = '#6da34d';
  ctx.beginPath(); ctx.arc(0, -r * .78, r * .74, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r * .68, -r * .92); ctx.lineTo(-r * 1.4, -r * 1.18); ctx.lineTo(-r * .58, -r * .55);
  ctx.moveTo(r * .68, -r * .92); ctx.lineTo(r * 1.4, -r * 1.18); ctx.lineTo(r * .58, -r * .55);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  const ed = Math.atan2(cam.y - s.y, cam.x - s.x);
  const exo = Math.cos(ed) * 1.6;
  ctx.fillStyle = '#ffd54a';
  ctx.beginPath(); ctx.arc(-r * .27 + exo, -r * .82, 2.1, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(r * .27 + exo, -r * .82, 2.1, 0, 7); ctx.fill();
  ctx.fillStyle = '#1c2b12';
  ctx.beginPath(); ctx.arc(-r * .27 + exo, -r * .82, .9, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(r * .27 + exo, -r * .82, .9, 0, 7); ctx.fill();
  ctx.strokeStyle = '#1c2b12'; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-r * .44, -r * 1.02); ctx.lineTo(-r * .1, -r * .9);
  ctx.moveTo(r * .44, -r * 1.02); ctx.lineTo(r * .1, -r * .9);
  ctx.stroke();
  ctx.fillStyle = '#2b1d10';
  roundRect(ctx, -r * .3, -r * .5, r * .6, r * .22, 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(-r * .18, -r * .5); ctx.lineTo(-r * .1, -r * .34); ctx.lineTo(-r * .02, -r * .5);
  ctx.moveTo(r * .18, -r * .5); ctx.lineTo(r * .1, -r * .34); ctx.lineTo(r * .02, -r * .5);
  ctx.fill();
  ctx.restore();
  hitFlashOverlay(s, now, r * 1.5);
  mobUI(s, false);
}

function drawWolf(s, now) {
  const r = s.def.r;
  shadow(s.x, s.y + 10, r * 1.05);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.dirA ?? Math.PI / 2);
  const run = s.movingF ? Math.sin(now / 70) : 0;
  ctx.strokeStyle = '#6f777c';
  ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.quadraticCurveTo(-r * 1.55, -r * .3 + run, -r * 1.45, -r * .85 + run * 1.5);
  ctx.stroke();
  ctx.fillStyle = '#767e83';
  roundRect(ctx, r * .55, r * .3, 4.5, 9 + run * 2, 2); ctx.fill();
  roundRect(ctx, r * .25, r * .3, 4.5, 9 - run * 2, 2); ctx.fill();
  roundRect(ctx, -r * .55, r * .3, 4.5, 9 - run * 2, 2); ctx.fill();
  roundRect(ctx, -r * .85, r * .3, 4.5, 9 + run * 2, 2); ctx.fill();
  const g = ctx.createLinearGradient(0, -r * .6, 0, r * .6);
  g.addColorStop(0, '#9aa2a8'); g.addColorStop(1, '#767e83');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(0, 0, r * 1.15, r * .6, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.strokeStyle = '#5d6569'; ctx.lineWidth = 2;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath(); ctx.moveTo(i * r * .38, -r * .52); ctx.lineTo(i * r * .38, -r * .78); ctx.stroke();
  }
  ctx.fillStyle = '#8a9296';
  ctx.beginPath(); ctx.ellipse(r * .98, -r * .12, r * .52, r * .4, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.stroke();
  ctx.fillStyle = '#767e83';
  ctx.beginPath();
  ctx.moveTo(r * .78, -r * .42); ctx.lineTo(r * .68, -r * .88); ctx.lineTo(r * 1.0, -r * .5);
  ctx.moveTo(r * 1.08, -r * .45); ctx.lineTo(r * 1.12, -r * .9); ctx.lineTo(r * 1.3, -r * .48);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#a7afb5';
  ctx.beginPath(); ctx.ellipse(r * 1.42, -r * .02, r * .3, r * .2, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#22262e';
  ctx.beginPath(); ctx.arc(r * 1.62, -r * .04, 2, 0, 7); ctx.fill();
  if (s.aggroF) {
    ctx.shadowColor = '#ff4040'; ctx.shadowBlur = 7;
    ctx.fillStyle = '#ff5050';
  } else ctx.fillStyle = '#22262e';
  ctx.beginPath(); ctx.arc(r * 1.05, -r * .22, 1.8, 0, 7); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineCap = 'butt';
  ctx.restore();
  hitFlashOverlay(s, now, r * 1.5);
  mobUI(s, false);
}

function drawBoss(s, now) {
  const r = s.def.r;
  const pulse = .35 + Math.sin(now / 200) * .15;
  ctx.strokeStyle = `rgba(255,60,60,${pulse})`;
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(s.x, s.y, r + 12, 0, 7); ctx.stroke();
  shadow(s.x, s.y + 16, r * 1.05);
  ctx.save();
  ctx.translate(s.x, s.y + Math.sin(now / 300) * 1.5);
  ctx.fillStyle = '#3f5c33';
  roundRect(ctx, -r * .5, r * .55, r * .38, r * .55, 5); ctx.fill();
  roundRect(ctx, r * .14, r * .55, r * .38, r * .55, 5); ctx.fill();
  const g = ctx.createLinearGradient(0, -r * .5, 0, r * .7);
  g.addColorStop(0, '#5d8a41'); g.addColorStop(1, '#3f5c33');
  ctx.fillStyle = g;
  roundRect(ctx, -r * .82, -r * .5, r * 1.64, r * 1.15, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = '#5c4327'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-r * .6, -r * .35); ctx.lineTo(r * .55, r * .5); ctx.stroke();
  ctx.fillStyle = '#7d8790';
  ctx.beginPath(); ctx.arc(-r * .78, -r * .42, r * .3, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(r * .78, -r * .42, r * .3, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(-r * .78, -r * .42, r * .3, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.arc(r * .78, -r * .42, r * .3, 0, 7); ctx.stroke();
  ctx.fillStyle = '#4a6e33';
  roundRect(ctx, -r * 1.0, -r * .2, r * .3, r * .8, 5); ctx.fill();
  ctx.save();
  ctx.translate(r * .95, -r * .1);
  ctx.rotate(.35 + Math.sin(now / 260) * .22);
  ctx.fillStyle = '#6b4a2f';
  roundRect(ctx, -2.5, -r * .95, 5, r * 1.15, 2); ctx.fill();
  ctx.fillStyle = '#aab4bd';
  ctx.beginPath();
  ctx.moveTo(-3, -r * .9); ctx.quadraticCurveTo(-r * .55, -r * .75, -3, -r * .45);
  ctx.moveTo(3, -r * .9); ctx.quadraticCurveTo(r * .55, -r * .75, 3, -r * .45);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#6da34d';
  ctx.beginPath(); ctx.arc(0, -r * .78, r * .52, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#f3ede0';
  ctx.beginPath();
  ctx.moveTo(-r * .3, -r * .62); ctx.lineTo(-r * .38, -r * .94); ctx.lineTo(-r * .16, -r * .66);
  ctx.moveTo(r * .3, -r * .62); ctx.lineTo(r * .38, -r * .94); ctx.lineTo(r * .16, -r * .66);
  ctx.fill();
  ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-r * .28, -r * 1.04); ctx.lineTo(r * .28, -r * 1.04); ctx.stroke();
  const ed = Math.atan2(cam.y - s.y, cam.x - s.x);
  const exo = Math.cos(ed) * 2;
  ctx.shadowColor = '#ff3030'; ctx.shadowBlur = 9;
  ctx.fillStyle = '#ff4040';
  ctx.beginPath(); ctx.arc(-r * .18 + exo, -r * .84, 2.7, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(r * .18 + exo, -r * .84, 2.7, 0, 7); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffd700';
  const cy2 = -r * 1.3;
  ctx.beginPath();
  ctx.moveTo(-r * .3, cy2 + 8);
  ctx.lineTo(-r * .3, cy2); ctx.lineTo(-r * .15, cy2 + 5);
  ctx.lineTo(0, cy2 - 3); ctx.lineTo(r * .15, cy2 + 5);
  ctx.lineTo(r * .3, cy2); ctx.lineTo(r * .3, cy2 + 8);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  hitFlashOverlay(s, now, r * 1.3);
  mobUI(s, true);
}

function draw(now) {
  const vw = cv.width, vh = cv.height;
  const cx = WORLD.w >= vw ? clampN(cam.x - vw / 2, 0, WORLD.w - vw) : (WORLD.w - vw) / 2;
  const cy = WORLD.h >= vh ? clampN(cam.y - vh / 2, 0, WORLD.h - vh) : (WORLD.h - vh) / 2;
  view.x = cx; view.y = cy;

  ctx.save();
  ctx.translate(-cx, -cy);
  ctx.fillStyle = grassPattern;
  ctx.fillRect(cx, cy, vw, vh);
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, WORLD.w, WORLD.h);

  for (let i = 0; i < 26; i++) {
    const dx = sr(i) * WORLD.w, dy = sr(i + 99) * WORLD.h;
    if (sr(i + 55) < .5) {
      ctx.fillStyle = '#3d2b1f';
      ctx.fillRect(dx - 4, dy - 6, 8, 14);
      ctx.fillStyle = '#1d5e3a';
      ctx.beginPath(); ctx.arc(dx, dy - 22, 20 + sr(i + 7) * 8, 0, 7); ctx.fill();
      ctx.fillStyle = '#257047';
      ctx.beginPath(); ctx.arc(dx - 8, dy - 28, 12, 0, 7); ctx.fill();
    } else {
      ctx.fillStyle = '#6b7280';
      ctx.beginPath(); ctx.ellipse(dx, dy, 14 + sr(i + 3) * 8, 10 + sr(i + 4) * 6, sr(i + 5), 0, 7); ctx.fill();
    }
  }

  for (let i = 26; i < 76; i++) {
    const fx = sr(i + 300) * WORLD.w, fy = sr(i + 400) * WORLD.h;
    if (sr(i + 500) < .45) {
      ctx.fillStyle = ['#e8da7a', '#d98cb3', '#8ecae6'][i % 3];
      ctx.beginPath(); ctx.arc(fx, fy, 2.2, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.beginPath(); ctx.arc(fx - .8, fy - .8, .9, 0, 7); ctx.fill();
    } else {
      ctx.strokeStyle = '#2f6b47'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(fx, fy); ctx.lineTo(fx + 2, fy - 5);
      ctx.moveTo(fx + 4, fy); ctx.lineTo(fx + 5, fy - 4);
      ctx.stroke();
    }
  }

  for (const [, l] of Object.entries(lootItems)) {
    const it = ITEMS[l.itemId];
    if (!it) continue;
    const bob = Math.sin(now / 300 + l.x) * 3;
    ctx.save();
    ctx.translate(l.x, l.y + bob);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = it.color;
    ctx.fillRect(-7, -7, 14, 14);
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.strokeRect(-7, -7, 14, 14);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(it.name, l.x, l.y + 22);
  }

  for (const s of sims) {
    if (!s.alive) continue;
    if (s.type === 'slime') drawSlime(s, now);
    else if (s.type === 'goblin') drawGoblin(s, now);
    else if (s.type === 'wolf') drawWolf(s, now);
    else drawBoss(s, now);
  }

  for (const [id, o] of Object.entries(others)) {
    if (Date.now() - (o.lastSeen || 0) >= OFFLINE_MS) continue;
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
    ctx.globalAlpha = 1 - p * .5;
    if (sh.size <= 4) {
      ctx.strokeStyle = sh.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y);
      ctx.lineTo(sh.x - sh.vx * .03, sh.y - sh.vy * .03);
      ctx.stroke();
    } else {
      ctx.fillStyle = sh.color;
      ctx.shadowColor = sh.color;
      ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(sh.x, sh.y, sh.size, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  for (const rg of rings) {
    const p = rg.t / rg.max;
    ctx.strokeStyle = `rgba(${rg.color},${1 - p})`;
    ctx.lineWidth = 4 * (1 - p) + 1;
    ctx.beginPath(); ctx.arc(rg.x, rg.y, rg.r * (0.3 + p * .7), 0, 7); ctx.stroke();
  }

  for (const sl of slashes) {
    const p = sl.t / 180;
    ctx.strokeStyle = `rgba(255,255,255,${1 - p})`;
    ctx.lineWidth = (sl.w || 3) * (1 - p) + 1;
    ctx.beginPath();
    ctx.arc(sl.x, sl.y, 34 + p * 22, sl.a - .9, sl.a + .9);
    ctx.stroke();
  }

  for (const f of floats) {
    ctx.globalAlpha = 1 - f.t / 1000;
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y - f.t * .03);
    ctx.globalAlpha = 1;
  }

  for (const p of poofs) {
    ctx.globalAlpha = 1 - p.t / 600;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - p.t / 900), 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  if (now < hurtUntil) {
    ctx.strokeStyle = `rgba(231,76,60,${(hurtUntil - now) / 300 * .8})`;
    ctx.lineWidth = 14;
    ctx.strokeRect(0, 0, vw, vh);
  }

  mctx.clearRect(0, 0, 160, 120);
  const k = .1;
  for (const s of sims) {
    if (!s.alive) continue;
    mctx.fillStyle = s.type === 'boss' ? (Math.sin(now / 150) > 0 ? '#ff2020' : '#800000') :
                     (s.type === 'wolf' ? '#bbb' : s.def.color);
    const rr = s.type === 'boss' ? 4 : 2;
    mctx.fillRect(s.x * k - rr / 2, s.y * k - rr / 2, rr, rr);
  }
  mctx.fillStyle = '#ffd700';
  for (const l of Object.values(lootItems)) mctx.fillRect(l.x * k - 1, l.y * k - 1, 2.5, 2.5);
  for (const [, o] of Object.entries(others)) {
    if (Date.now() - (o.lastSeen || 0) >= OFFLINE_MS) continue;
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
  $('hpbar').style.width = clampN((me.hp || 0) / me.maxHp * 100, 0, 100) + '%';
  $('hpText').textContent = `${Math.max(0, Math.ceil(me.hp || 0))} / ${me.maxHp}`;
  $('expbar').style.width = clampN((me.exp || 0) / expNeed(me.lv) * 100, 0, 100) + '%';
  $('expText').textContent = `EXP ${me.exp || 0} / ${expNeed(me.lv)}`;
  $('uiAtk').textContent = totalAtk();
  $('uiDef').textContent = totalDef();
  $('uiCrit').textContent = Math.round(totalCrit() * 100);
  $('uiSpd').textContent = Math.round(moveSpd());
  $('uiGold').textContent = (me.gold || 0).toLocaleString();
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
    if (text) addDoc(collection(db, 'chat'), { from: myName, text, ts: Date.now() });
    e.preventDefault();
  }
});

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
$('shopBtn').onclick = () => togglePanel('shopPanel');
$('questBtn').onclick = () => togglePanel('questPanel');
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
  if (e.code === 'KeyB') togglePanel('shopPanel');
  if (e.code === 'KeyQ') togglePanel('questPanel');
});
addEventListener('keyup', e => keys[e.code] = false);

function screenToWorld(mx, my) { return { x: mx + view.x, y: my + view.y }; }

cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('mousedown', e => {
  if (e.button !== 0 || !ready || me.dead || document.activeElement === chatInput) return;
  chatInput.blur();
  const w = screenToWorld(e.clientX, e.clientY);
  const s = sims.find(v => v.alive && Math.hypot(v.x - w.x, v.y - w.y) < v.def.r + 16);
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

/* ================= 메인 루프 ================= */
let lastT = 0;
function loop(t) {
  requestAnimationFrame(loop);
  const now = Date.now();
  const dt = Math.min(50, t - lastT);
  lastT = t;
  if (!ready) return;

  if (!me.dead && document.activeElement !== chatInput) {
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
      me.x = clampN(me.x + dx / len * sp, 20, WORLD.w - 20);
      me.y = clampN(me.y + dy / len * sp, 20, WORLD.h - 20);
    } else if (attackTargetSimId) {
      const s = sims.find(v => v.id === attackTargetSimId);
      if (!s || !s.alive) attackTargetSimId = null;
      else if (Math.hypot(s.x - me.x, s.y - me.y) > cdef().range) stepToward(s, moveSpd() * dt / 1000);
      else tryAttack(now, s);
    } else if (dest) {
      if (Math.hypot(dest.x - me.x, dest.y - me.y) < 10 && !mouseDown) dest = null;
      else stepToward(dest, moveSpd() * dt / 1000);
    }
  }
  if (now - lastPosWrite > 150) {
    lastPosWrite = now;
    updateDoc(meRef, { x: me.x, y: me.y, lastSeen: now }).catch(() => {});
  }

  if (me.dead && me.deadUntil && now > me.deadUntil) {
    me.dead = false; me.hp = me.maxHp;
    me.x = SPAWN.x; me.y = SPAWN.y;
    updateDoc(meRef, { dead: false, hp: me.hp, x: me.x, y: me.y, lastSeen: now }).catch(() => {});
    float(me.x, me.y - 40, '부활!', '#2ecc71');
  }

  updateSims(now, dt);

  if (!picking) {
    for (const [lid, l] of Object.entries(lootItems)) {
      if (Math.hypot(l.x - me.x, l.y - me.y) < 36) { pickup(lid, l); break; }
    }
  }

  cam.x += (me.x - cam.x) * Math.min(1, dt * .01);
  cam.y += (me.y - cam.y) * Math.min(1, dt * .01);

  floats = floats.filter(f => (f.t += dt) < 1000);
  slashes = slashes.filter(s => (s.t += dt) < 180);
  shots = shots.filter(s => { s.t += dt; s.x += s.vx * dt / 1000; s.y += s.vy * dt / 1000; return s.t < s.max; });
  rings = rings.filter(r => (r.t += dt) < r.max);
  poofs = poofs.filter(p => { p.t += dt; p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; p.vy += 260 * dt / 1000; return p.t < 600; });
  meMovingNow = Math.hypot(me.x - mePrev.x, me.y - mePrev.y) > .5;
  mePrev = { x: me.x, y: me.y };

  updateHUD();
  updateHotbar(now);
  if ($('shopPanel').classList.contains('open')) renderShopThrottled();
  if ($('questPanel').classList.contains('open')) renderQuestsThrottled();
  draw(now);
}

let shopT = 0, questT = 0;
function renderShopThrottled() { if (Date.now() - shopT > 700) { shopT = Date.now(); renderShop(); } }
function renderQuestsThrottled() { if (Date.now() - questT > 700) { questT = Date.now(); renderQuests(); } }

/* ================= 시작 ================= */
setInterval(() => { if (uid && meRef) updateDoc(meRef, { lastSeen: Date.now() }).catch(() => {}); }, 4000);

function waitForLoginClick() {
  return new Promise((resolve, reject) => {
    $('loading').style.display = 'none';
    const scr = $('loginScreen');
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
      dead: false, color: colorOf(uid), lastSeen: Date.now(),
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

  onSnapshot(meRef, s => {
    if (!s.exists()) return;
    const d = s.data();
    const { x, y, ...rest } = d;
    me = { ...me, ...rest };
    renderInvUI();
  });

  watchPlayers();
  watchMonsters();
  watchLoot();
  watchChat();

  ready = true;
  $('loading').style.display = 'none';
  renderInvUI();
}

init().catch(err => {
  $('loading').textContent = '초기화 실패: ' + err.message +
    '\n\nFirebase 콘솔에서 확인하세요:\n1. Authentication > Google 로그인 사용\n2. Cloud Firestore 생성\n3. 보안 규칙에서 로그인 사용자 읽기/쓰기 허용';
});

requestAnimationFrame(loop);
