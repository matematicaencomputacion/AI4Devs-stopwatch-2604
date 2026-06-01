'use strict';

/* ============================================================
   Utilidades
   ============================================================ */
const $   = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');

function breakdown(ms){
  ms = Math.max(0, ms);
  const totalCs  = Math.floor(ms / 10);
  const cs       = totalCs % 100;
  const totalSec = Math.floor(ms / 1000);
  return {
    h:  Math.floor(totalSec / 3600) % 100,
    m:  Math.floor(totalSec / 60) % 60,
    s:  totalSec % 60,
    cs
  };
}
function fmtLap(ms){
  const { h, m, s, cs } = breakdown(ms);
  const mins = h * 60 + m;
  return `${pad(mins)}:${pad(s)}.${pad(cs)}`;
}

/* ============================================================
   Referencias DOM cacheadas (resueltas UNA sola vez)
   Solo nodos PERMANENTES. Los volátiles (.upper/.lower/.fold/.unfold)
   se reconstruyen en setDigit, por lo que NO se cachean.
   ============================================================ */
const flips      = [...document.querySelectorAll('.flip')];   // permanentes: solo cambian sus hijos

const clockEl    = $('#clock');
const csEl       = $('#cs');
const colon1El   = $('#colon-1');
const colon2El   = $('#colon-2');
const lapsEl     = $('#laps');
const finishEl   = $('#finish');
const sliderEl   = $('#slider');
const modeLabelEl= $('#mode-label');
const muteBtn    = $('#mute');
const setterEl   = $('#setter');
const panelSw    = $('#panel-stopwatch');
const panelCd    = $('#panel-countdown');

const swMain     = $('#sw-main');
const swMainT    = $('#sw-main-t');
const swIconPath = $('#sw-icon').querySelector('path');
const swLapBtn   = $('#sw-lap');
const swResetBtn = $('#sw-reset');

const cdMain     = $('#cd-main');
const cdMainT    = $('#cd-main-t');
const cdIconPath = $('#cd-icon').querySelector('path');
const cdResetBtn = $('#cd-reset');

const root = document.documentElement;

const PLAY  = 'M8 5v14l11-7z';
const PAUSE = 'M6 5h4v14H6zM14 5h4v14h-4z';

/* ============================================================
   Estado de aplicación
   ============================================================ */
let mode  = 'stopwatch';
let muted = false;
const sw = { elapsed: 0, running: false, last: 0, laps: [] };
const cd = { duration: 0, remaining: 0, running: false, last: 0, finished: false };
let setH = 0, setM = 0, setS = 0;

/* ---- Estado previo para change-detection (evita escrituras de DOM redundantes) ---- */
let lastClockStr = '';
let lastCs       = '.00';
let lastUrgent   = false;

/* ============================================================
   Flip clock
   ============================================================ */
flips.forEach(f => {                          // estado inicial sin animación
  f.dataset.cur = '0';
  f.innerHTML = `<div class="upper"><span>0</span></div><div class="lower"><span>0</span></div>`;
});

function setDigit(el, val){
  const cur = el.dataset.cur;
  if (cur === val) return;                    // guard por dígito (no re-anima sin cambio)
  el.dataset.cur = val;
  el.innerHTML =
    `<div class="upper"><span>${val}</span></div>` +
    `<div class="lower"><span>${cur}</span></div>` +
    `<div class="fold"><span>${cur}</span></div>` +
    `<div class="unfold"><span>${val}</span></div>`;
}

/* Recibe un objeto breakdown ya calculado (evita recomputarlo). */
function renderClock(b){
  const str = `${pad(b.h)}${pad(b.m)}${pad(b.s)}`;
  if (str === lastClockStr) return;           // change-detection a nivel reloj
  lastClockStr = str;
  for (let i = 0; i < 6; i++) setDigit(flips[i], str[i]);
}

function setCs(b){
  const t = '.' + pad(b.cs);
  if (t === lastCs) return;                    // change-detection del chip de centésimas
  lastCs = t;
  csEl.textContent = t;
}

function setUrgent(v){
  if (v === lastUrgent) return;                // change-detection de la clase urgente
  lastUrgent = v;
  clockEl.classList.toggle('urgent', v);
}

/* ============================================================
   Audio
   ============================================================ */
let audioCtx;
function beep(times = 3){
  if (muted) return;
  try{
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    let t = audioCtx.currentTime;
    for (let i = 0; i < times; i++){
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'triangle'; o.frequency.value = 920;
      o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.32, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.start(t); o.stop(t + 0.3); t += 0.4;
    }
  } catch (e) {}
}

/* ============================================================
   Bucle principal — siempre activo, sin querySelector ni breakdown duplicado
   ============================================================ */
function tick(now){
  if (mode === 'stopwatch' && sw.running){
    sw.elapsed += now - sw.last; sw.last = now;
    const b = breakdown(sw.elapsed);          // calculado UNA vez por frame
    renderClock(b);
    setCs(b);
  } else if (mode === 'countdown' && cd.running){
    cd.remaining -= now - cd.last; cd.last = now;
    if (cd.remaining <= 0){ cd.remaining = 0; finishCountdown(); }
    const b = breakdown(cd.remaining);        // calculado UNA vez por frame
    renderClock(b);
    setUrgent(cd.running && cd.remaining <= 10000);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/* ============================================================
   Cronómetro
   ============================================================ */
function swToggle(){
  if (sw.running){ sw.running = false; }
  else { sw.running = true; sw.last = performance.now(); }
  updateSwUI();
}
function swReset(){
  sw.running = false; sw.elapsed = 0; sw.laps = [];
  const b = breakdown(0);
  renderClock(b); setCs(b);
  lapsEl.innerHTML = '';
  updateSwUI();
}
function swLap(){
  if (sw.elapsed <= 0) return;
  sw.laps.push(sw.elapsed);
  renderLaps();
}
function renderLaps(){
  lapsEl.innerHTML = '';
  const deltas = sw.laps.map((t, i) => i ? t - sw.laps[i - 1] : t);
  const min = Math.min(...deltas), max = Math.max(...deltas);
  sw.laps.forEach((t, i) => {
    const delta = deltas[i];
    const row = document.createElement('div');
    row.className = 'lap'
      + (sw.laps.length > 1 && delta === min ? ' fast' : '')
      + (sw.laps.length > 1 && delta === max ? ' slow' : '');
    row.innerHTML =
      `<span class="n">Vuelta ${pad(i + 1)}</span>` +
      `<span class="delta">${fmtLap(delta)}</span>` +
      `<span class="total">${fmtLap(t)}</span>`;
    lapsEl.prepend(row);
  });
}
function updateSwUI(){
  swMainT.textContent = sw.running ? 'Pausar' : (sw.elapsed > 0 ? 'Reanudar' : 'Iniciar');
  swIconPath.setAttribute('d', sw.running ? PAUSE : PLAY);
  swLapBtn.disabled   = !sw.running;
  swResetBtn.disabled = sw.running || sw.elapsed === 0;
  colon1El.classList.toggle('blink', sw.running);
  colon2El.classList.toggle('blink', sw.running);
}

/* ============================================================
   Cuenta regresiva
   ============================================================ */
function applySet(){
  cd.duration  = ((setH * 60 + setM) * 60 + setS) * 1000;
  cd.remaining = cd.duration; cd.finished = false; cd.running = false;
  setUrgent(false);
  clockEl.classList.remove('finished');
  finishEl.classList.remove('show');
  if (mode === 'countdown') renderClock(breakdown(cd.remaining));
  updateCdUI();
}
function step(unit, d){
  if (cd.running) return;
  if (unit === 'h') setH = (setH + d + 24) % 24;
  if (unit === 'm') setM = (setM + d + 60) % 60;
  if (unit === 's') setS = (setS + d + 60) % 60;
  applySet();
}
function cdToggle(){
  if (cd.duration <= 0) return;
  if (cd.finished){ applySet(); }
  if (cd.running){ cd.running = false; }
  else { cd.running = true; cd.last = performance.now(); }
  updateCdUI();
}
function cdReset(){
  cd.running = false; cd.finished = false; cd.remaining = cd.duration;
  setUrgent(false);
  clockEl.classList.remove('finished');
  finishEl.classList.remove('show');
  renderClock(breakdown(cd.remaining));
  updateCdUI();
}
function finishCountdown(){
  cd.running = false; cd.finished = true;
  setUrgent(false);
  clockEl.classList.add('finished');
  finishEl.classList.add('show');
  beep(3);
  updateCdUI();
}
function updateCdUI(){
  cdMainT.textContent = cd.running
    ? 'Pausar'
    : (cd.finished
        ? 'Reiniciar'
        : (cd.remaining < cd.duration && cd.remaining > 0 ? 'Reanudar' : 'Iniciar'));
  cdIconPath.setAttribute('d', cd.running ? PAUSE : PLAY);
  cdMain.disabled     = cd.duration === 0 && !cd.finished;
  cdResetBtn.disabled = cd.running || (cd.remaining === cd.duration && !cd.finished);
  setterEl.classList.toggle('disabled', cd.running);
  const blink = cd.running && !cd.finished;
  colon1El.classList.toggle('blink', mode === 'countdown' ? blink : sw.running);
  colon2El.classList.toggle('blink', mode === 'countdown' ? blink : sw.running);
}

/* ============================================================
   Modos / tabs
   ============================================================ */
function setMode(m){
  mode = m;
  const isCd = (m === 'countdown');
  sliderEl.classList.toggle('right', isCd);
  document.querySelectorAll('.tabs button')
    .forEach(b => {
      const on = b.dataset.mode === m;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  panelSw.hidden = isCd;
  panelCd.hidden = !isCd;
  csEl.classList.toggle('hidden', isCd);
  root.style.setProperty('--accent', isCd ? 'var(--mint)' : 'var(--gold)');
  modeLabelEl.textContent = isCd ? 'Cuenta regresiva' : 'Cronómetro de precisión';
  if (isCd){
    renderClock(breakdown(cd.remaining || cd.duration));
    updateCdUI();
  } else {
    const b = breakdown(sw.elapsed);
    renderClock(b); setCs(b);
    updateSwUI();
  }
}

/* ============================================================
   Listeners (addEventListener en todos los casos)
   ============================================================ */
swMain.addEventListener('click', swToggle);
swResetBtn.addEventListener('click', swReset);
swLapBtn.addEventListener('click', swLap);

document.querySelectorAll('.chev').forEach(b =>
  b.addEventListener('click', () => step(b.dataset.step, +b.dataset.d)));

document.querySelectorAll('.chip').forEach(c =>
  c.addEventListener('click', () => {
    if (cd.running) return;
    const sec = +c.dataset.sec;
    setH = Math.floor(sec / 3600);
    setM = Math.floor(sec / 60) % 60;
    setS = sec % 60;
    applySet();
  }));

cdMain.addEventListener('click', cdToggle);
cdResetBtn.addEventListener('click', cdReset);

document.querySelectorAll('.tabs button').forEach(b =>
  b.addEventListener('click', () => setMode(b.dataset.mode)));

muteBtn.addEventListener('click', () => {
  muted = !muted;
  muteBtn.classList.toggle('muted', muted);
  const label = muted ? 'Activar sonido' : 'Silenciar sonido';
  muteBtn.setAttribute('aria-label', label);
  muteBtn.setAttribute('title', label);
  if (!muted) beep(1);
});

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (e.code === 'Space'){
    e.preventDefault();
    mode === 'stopwatch' ? swToggle() : cdToggle();
  } else if (k === 'r'){
    mode === 'stopwatch' ? swReset() : cdReset();
  } else if (k === 'l' && mode === 'stopwatch'){
    swLap();
  }
});

/* ============================================================
   Init
   ============================================================ */
renderClock(breakdown(0));
updateSwUI();
