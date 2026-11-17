/* ================= CONFIG ================= */
// Dapat tumugma sa style.css (--board-h, --platform-h, --rod-top)
const BOARD_H = 340, PLATFORM_H = 24, ROD_TOP = 66, DISK_H = 24;
const BASE_TOP = BOARD_H - PLATFORM_H;
const LIFT_Y = ROD_TOP - DISK_H - 8;
const SPEEDS = {
  slow:     { ms: 600, label: "Slow" },
  normal:   { ms: 350, label: "Normal" },
  fast:     { ms: 180, label: "Fast" },
  veryfast: { ms: 80,  label: "Very Fast" }
};
const HUES = [350, 28, 48, 160, 205, 262, 320, 95];

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ================= SOUND (Web Audio) ================= */
const Sound = (() => {
  let ctx = null, enabled = true, last = 0;

  function init() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === "suspended") ctx.resume();
  }
  function tone({ freq, end, type = "sine", dur = 0.1, gain = 0.2, at = 0 }) {
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (end) o.frequency.exponentialRampToValueAtTime(end, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function play(fn, force) {
    if (!enabled || !ctx) return;
    const now = performance.now();
    if (!force && now - last < 50) return; // iwas sabay-sabay na tunog
    last = now;
    fn();
  }
  return {
    init,
    setEnabled(v) { enabled = v; },
    isEnabled: () => enabled,
    pickup() { play(() => tone({ freq: 900, end: 500, type: "triangle", dur: 0.06, gain: 0.15 })); },
    drop() {
      play(() => {
        tone({ freq: 220, end: 90, dur: 0.14, gain: 0.35 });
        tone({ freq: 1200, end: 600, type: "square", dur: 0.03, gain: 0.05 });
      });
    },
    win() {
      play(() => [523, 659, 784, 1047].forEach((f, i) =>
        tone({ freq: f, type: "triangle", dur: 0.25, gain: 0.2, at: i * 0.15 })), true);
    }
  };
})();

/* ================= SOLVER ================= */
// Recursive Tower of Hanoi (JS, ginagamit bilang fallback at pang-test)
function hanoiMoves(k, from = 0, to = 2, via = 1, out = []) {
  if (k === 0) return out;
  hanoiMoves(k - 1, from, via, to, out);
  out.push([from, to]);
  hanoiMoves(k - 1, via, to, from, out);
  return out;
}

function listToArray(term) {
  const out = [];
  while (term && term.args && term.args.length === 2) {
    out.push(term.args[0]);
    term = term.args[1];
  }
  return out;
}

let prologProgram = null;
async function solveWithProlog(k) {
  if (!prologProgram) {
    const r = await fetch("hanoi.pl");
    if (!r.ok) throw new Error("Hindi mabasa ang hanoi.pl");
    prologProgram = await r.text();
  }
  const session = pl.create(1000000);
  await new Promise((res, rej) => session.consult(prologProgram, { success: res, error: rej }));
  await new Promise((res, rej) => session.query(`hanoi(${k}, a, c, b, Moves).`, { success: res, error: rej }));
  return new Promise((res, rej) => session.answer({
    success: a => res(listToArray(a.links["Moves"]).map(m =>
      [m.args[0].id.charCodeAt(0) - 97, m.args[1].id.charCodeAt(0) - 97])),
    fail: () => rej(new Error("Walang solusyon")),
    error: rej
  }));
}

/* ================= GAME STATE ================= */
const board = $("board");
const towers = document.querySelectorAll(".tower");
let n = 3;
let pegs = [[], [], []];
let moves = 0;
let selected = null;
let busy = false;        // may gumagalaw na disk
let autoRunning = false;
let paused = false;
let won = false;
let runId = 0;           // tumataas tuwing reset: pinipigilan ang lumang animation
let speedKey = "normal";
let diskEls = {};
let pauseResolvers = [];

const minMoves = () => Math.pow(2, n) - 1;

/* ================= TIMER ================= */
let elapsedBase = 0, timerStart = null, timerInterval = null;
const elapsed = () => elapsedBase + (timerStart ? performance.now() - timerStart : 0);
const fmt = ms => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
function renderTime() { $("time").textContent = fmt(elapsed()); }
function startTimer() { if (timerStart) return; timerStart = performance.now(); timerInterval = setInterval(renderTime, 250); }
function stopTimer() {
  if (timerStart) { elapsedBase += performance.now() - timerStart; timerStart = null; }
  clearInterval(timerInterval); timerInterval = null; renderTime();
}
function resetTimer() { stopTimer(); elapsedBase = 0; renderTime(); }

/* ================= RENDER / LAYOUT ================= */
const towerX = i => (board.clientWidth / 3) * (i + 0.5);
function diskWidth(size) {
  const maxW = (board.clientWidth / 3) * 0.9;
  const minW = Math.max(28, maxW * 0.35);
  return minW + (maxW - minW) * (size - 1) / Math.max(1, n - 1);
}
const setPos = (el, x, y) => { el.style.transform = `translate(${x}px, ${y}px)`; };

function buildDisks() {
  board.querySelectorAll(".disk").forEach(d => d.remove());
  diskEls = {};
  for (let s = 1; s <= n; s++) {
    const el = document.createElement("div");
    el.className = "disk";
    const h = HUES[(s - 1) % HUES.length];
    el.style.background = `linear-gradient(180deg, hsl(${h} 85% 64%), hsl(${h} 80% 44%))`;
    board.appendChild(el);
    diskEls[s] = el;
  }
}

function layoutAll() {
  for (let i = 0; i < 3; i++) {
    pegs[i].forEach((size, k) => {
      const el = diskEls[size];
      const w = diskWidth(size);
      el.style.transition = "none";
      el.style.zIndex = "";
      el.style.width = w + "px";
      el.style.height = (DISK_H - 2) + "px";
      setPos(el, towerX(i) - w / 2, BASE_TOP - (k + 1) * DISK_H + 1);
    });
  }
}

function highlight() {
  towers.forEach((t, i) => t.classList.toggle("selected", selected === i));
}

function setMessage(text, type) {
  const m = $("message");
  m.textContent = text || "";
  m.className = type || "";
}

function updateUI() {
  const c = pegs[2].length;
  $("moves").textContent = moves;
  $("best").textContent = minMoves();
  $("progressText").textContent = `${c} / ${n}`;
  $("progressBar").style.width = (c / n * 100) + "%";
  $("speedLabel").textContent = SPEEDS[speedKey].label;
  $("state").textContent = won ? "Completed" : paused ? "Paused" : (autoRunning || moves > 0 || busy) ? "Playing" : "Ready";
  $("autoBtn").disabled = autoRunning;
  $("pauseBtn").disabled = !autoRunning || paused;
  $("resumeBtn").disabled = !paused;
}

/* ================= CONTROLS ================= */
function reset() {
  runId++;                       // patayin ang lahat ng lumang async na galaw
  autoRunning = false; paused = false; busy = false; won = false;
  selected = null; moves = 0;
  pauseResolvers.splice(0).forEach(r => r());
  resetTimer();
  n = parseInt($("disks").value, 10);
  pegs = [[], [], []];
  for (let s = n; s >= 1; s--) pegs[0].push(s);
  buildDisks();
  layoutAll();
  highlight();
  $("overlay").classList.add("hidden");
  setMessage("I-click ang tower para maglaro, o pindutin ang AUTO SOLVE.");
  updateUI();
}

function pause() {
  if (!autoRunning || paused) return;
  paused = true;
  stopTimer();
  updateUI();
  setMessage("Naka-pause. Tatapusin muna ang kasalukuyang galaw.");
}

function resume() {
  if (!paused) return;
  paused = false;
  startTimer();
  pauseResolvers.splice(0).forEach(r => r());
  setMessage("");
  updateUI();
}

const waitWhilePaused = token => new Promise(res => {
  if (!paused || token !== runId) return res();
  pauseResolvers.push(res);
});

function complete() {
  won = true; autoRunning = false; paused = false; selected = null;
  stopTimer(); highlight(); updateUI();
  $("finalMoves").textContent = moves;
  $("finalMin").textContent = minMoves();
  $("finalTime").textContent = (elapsed() / 1000).toFixed(1) + " seconds";
  setMessage(moves === minMoves() ? "Perpekto! Pinakamaikling solusyon." : "Tapos na!");
  $("overlay").classList.remove("hidden");
  const t = runId;
  setTimeout(() => { if (t === runId) Sound.win(); }, 180);
}

/* ================= ANIMATED MOVE ================= */
async function moveDisk(from, to, token) {
  if (busy || token !== runId) return false;
  const size = pegs[from][pegs[from].length - 1];
  const topTo = pegs[to][pegs[to].length - 1];
  // Tiyakin ang official rules
  if (size === undefined || from === to || (topTo !== undefined && topTo < size)) return false;

  busy = true;
  try {
    startTimer();
    updateUI();
    const el = diskEls[size];
    const w = diskWidth(size);
    const x1 = towerX(from) - w / 2, x2 = towerX(to) - w / 2;
    const yEnd = BASE_TOP - (pegs[to].length + 1) * DISK_H + 1;
    el.style.zIndex = 5;

    const stage = async (x, y) => {
      const ms = SPEEDS[speedKey].ms; // binabasa tuwing yugto, kaya pwedeng palitan habang tumatakbo
      el.style.transition = `transform ${ms}ms ease-in-out`;
      setPos(el, x, y);
      await sleep(ms + 20);
      return token === runId;
    };

    Sound.pickup();
    if (!await stage(x1, LIFT_Y)) return false;  // 1. pataas
    if (!await stage(x2, LIFT_Y)) return false;  // 2. pahalang
    if (!await stage(x2, yEnd)) return false;    // 3. pababa
    Sound.drop();

    pegs[to].push(pegs[from].pop());
    moves++;
    layoutAll();
    if (pegs[2].length === n) complete(); else updateUI();
    return true;
  } finally {
    if (token === runId) busy = false;
  }
}

/* ================= AUTO SOLVE ================= */
async function autoSolve() {
  if (autoRunning) return;
  Sound.init();
  reset();
  const token = runId;
  autoRunning = true;
  updateUI();
  setMessage("Nag-iisip ang Prolog...");

  let list;
  try {
    list = await solveWithProlog(n);
    setMessage(`Prolog ang nag-solve: ${list.length} na galaw.`);
  } catch (e) {
    console.warn(e);
    list = hanoiMoves(n);
    setMessage("Hindi na-load ang Prolog (gamitin ang Live Server). JS ang ginamit na solver.", "error");
  }
  if (token !== runId) return;

  for (const [f, t] of list) {
    await waitWhilePaused(token);
    if (token !== runId) return;
    const ok = await moveDisk(f, t, token);
    if (!ok) {
      if (token === runId) { autoRunning = false; updateUI(); setMessage("May error sa galaw.", "error"); }
      return;
    }
  }
}

/* ================= MANUAL PLAY ================= */
async function onTowerClick(i) {
  Sound.init();
  if (autoRunning || busy || won) return;

  if (selected === null) {
    if (!pegs[i].length) { setMessage("Walang disk sa tower na iyan.", "error"); return; }
    selected = i; highlight();
    setMessage("Piliin ang tower na paglalagyan.");
    return;
  }
  const from = selected;
  selected = null; highlight();
  if (from === i) { setMessage("Na-cancel ang pagpili."); return; }

  const disk = pegs[from][pegs[from].length - 1];
  const target = pegs[i][pegs[i].length - 1];
  if (target !== undefined && target < disk) {
    setMessage("Hindi pwede! Bawal ipatong ang malaking disk sa mas maliit.", "error");
    return;
  }
  setMessage("");
  await moveDisk(from, i, runId);
}

/* ================= SELF TEST (F12 > Console > runSelfTest()) ================= */
window.runSelfTest = async function () {
  for (let k = 3; k <= 8; k++) {
    let mv, src = "Prolog";
    try { mv = await solveWithProlog(k); } catch (e) { mv = hanoiMoves(k); src = "JS"; }
    const p = [Array.from({ length: k }, (_, i) => k - i), [], []];
    let ok = true;
    for (const [f, t] of mv) {
      const d = p[f].pop();
      if (d === undefined || (p[t].length && p[t][p[t].length - 1] < d)) { ok = false; break; }
      p[t].push(d);
    }
    ok = ok && mv.length === Math.pow(2, k) - 1 && p[2].length === k;
    console.log(`${k} disks (${src}): ${mv.length} moves ->`, ok ? "OK" : "FAILED");
  }
};

/* ================= EVENTS ================= */
towers.forEach((t, i) => t.addEventListener("click", () => onTowerClick(i)));
$("autoBtn").addEventListener("click", autoSolve);
$("pauseBtn").addEventListener("click", pause);
$("resumeBtn").addEventListener("click", resume);
$("resetBtn").addEventListener("click", reset);
$("againBtn").addEventListener("click", reset);
$("disks").addEventListener("change", reset);
$("speed").addEventListener("change", e => { speedKey = e.target.value; updateUI(); });
$("soundBtn").addEventListener("click", () => {
  Sound.init();
  Sound.setEnabled(!Sound.isEnabled());
  $("soundBtn").textContent = "SOUND: " + (Sound.isEnabled() ? "ON" : "OFF");
});
document.addEventListener("pointerdown", () => Sound.init(), { once: true });
new ResizeObserver(() => { if (!busy) layoutAll(); }).observe(board);

reset();