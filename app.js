'use strict';

const MODES = [
  { id: 'miranda',   ko: '현장 미란다',  sub: '현행범 체포 시 권리 고지' },
  { id: 'voluntary', ko: '임의동행',     sub: '동행 요청 · 거부권 고지 · 동의 확인' },
  { id: 'consular',  ko: '영사기관 통보', sub: '영사 통보 요청권 고지 · 의사 확인' },
];
const REASONS = [
  { id: 'disadvantage', ko: '그 장소에서 질문하면 본인에게 불리' },
  { id: 'traffic',      ko: '그 장소에서 질문하면 교통에 방해' },
];
const PLACES = [
  { id: 'substation', ko: '지구대' },
  { id: 'box',        ko: '파출소' },
  { id: 'station',    ko: '경찰서' },
];
const OFFICER_FIELDS = ['unit', 'unitRoman', 'name', 'nameRoman'];
const AUDIO_CACHE = 'audio-v1';

const $ = (id) => document.getElementById(id);
const state = { mode: 'miranda', lang: null, crime: null, purpose: null, reason: null, place: null };
let languages = [], crimes = [], audioManifest = {};
const langData = {};
const blobUrls = {};

async function getJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function loadLang(code) {
  if (!langData[code]) langData[code] = await getJSON(`data/lang/${code}.json`);
  return langData[code];
}

/* 고지 구간: tools/generate_audio.py 의 segments() 와 같은 규칙 */
function buildSegments(L) {
  if (state.mode === 'miranda') {
    return [
      { audio: `arrest_${state.crime}`, lines: [L.arrest.replace('{crime}', L.crimes[state.crime])] },
      { audio: 'rights', lines: L.rights },
    ];
  }
  if (state.mode === 'voluntary') return voluntarySegments(L);
  if (isMandatory() && L.consularMandatory) return [{ audio: 'consular_mandatory', lines: L.consularMandatory }];
  return [{ audio: 'consular', lines: L.consular }];
}

// 소속·이름·장소명은 미리 만든 음성에 넣을 수 없으므로, 화면에만 표시하고 음성은 공통 문장(tts)으로 읽는다
function voluntarySegments(L) {
  const V = L.voluntary;
  const ko = L === langData.ko;
  const o = officer();
  const both = (k, r) => (ko || !r ? k : `${k} (${r})`);
  const placeName = $('placeName').value.trim();
  const placeType = V.places[state.place];
  const placeLine = (p) => V.place.replace('{place}', p);
  return [
    { audio: 'vol_identity', tts: V.identityAudio,
      lines: [V.identity.replace('{unit}', both(o.unit, o.unitRoman)).replace('{name}', both(o.name, o.nameRoman))] },
    { audio: 'vol_request', lines: [V.request] },
    { audio: `vol_purpose_${state.purpose}`, item: true, lines: [V.purposes[state.purpose]] },
    { audio: `vol_reason_${state.reason}`, item: true, lines: [V.reasons[state.reason]] },
    { audio: `vol_place_${state.place}`, item: true, tts: placeLine(placeType),
      lines: [placeLine(!placeName ? placeType : ko ? placeName : `${placeType} (${placeName})`)] },
    { audio: 'vol_notice', lines: V.notice },
  ];
}

/* 경찰관 정보: 이 기기에만 저장 */
function officer() {
  return Object.fromEntries(OFFICER_FIELDS.map((f) => [f, $(f).value.trim()]));
}

function loadOfficer() {
  try {
    const saved = JSON.parse(localStorage.getItem('officer') || '{}');
    for (const f of OFFICER_FIELDS) if (saved[f]) $(f).value = saved[f];
  } catch {}
}

function saveOfficer() {
  try { localStorage.setItem('officer', JSON.stringify(officer())); } catch {}
}

const isMandatory = () => state.mode === 'consular' && state.lang === 'zh' && $('mandatory').checked;
const needsAnswer = () => state.mode === 'voluntary' || (state.mode === 'consular' && !isMandatory());
const audioUrl = (code, name) => {
  const key = `${code}/${name}.mp3`;
  return `audio/${key}?v=${audioManifest[key] || '0'}`;
};

/* ---------- 설정 화면 ---------- */

function pressed(container, el) {
  container.querySelectorAll('[aria-pressed]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
}

function renderModes() {
  const box = $('modes');
  box.innerHTML = '';
  for (const m of MODES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mode';
    b.setAttribute('aria-pressed', String(m.id === state.mode));
    b.innerHTML = `<b>${m.ko}</b><small>${m.sub}</small>`;
    b.onclick = () => { state.mode = m.id; pressed(box, b); refresh(); };
    box.appendChild(b);
  }
}

function renderLangs(filter = '') {
  const box = $('langs');
  const q = filter.trim().toLowerCase();
  box.innerHTML = '';
  for (const l of languages) {
    if (q && ![l.name, l.nameKo, l.code].some((s) => s.toLowerCase().includes(q))) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lang';
    b.setAttribute('aria-pressed', String(l.code === state.lang));
    b.innerHTML = `<i class="flag" aria-hidden="true">${l.flag}</i><span><b lang="${l.bcp47}">${l.name}</b><small>${l.nameKo}</small></span>`;
    b.onclick = () => { state.lang = l.code; pressed(box, b); loadLang(l.code).catch(() => {}); refresh(); };
    box.appendChild(b);
  }
}

function renderChips(id, items, key) {
  const box = $(id);
  box.innerHTML = '';
  for (const c of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('aria-pressed', String(c.id === state[key]));
    b.textContent = c.ko;
    b.onclick = () => { state[key] = c.id; pressed(box, b); refresh(); };
    box.appendChild(b);
  }
}

function refresh() {
  const o = officer();
  const volReady = state.purpose && state.reason && state.place && o.unit && o.name;
  $('crimeSec').hidden = state.mode !== 'miranda';
  $('volSec').hidden = state.mode !== 'voluntary';
  $('mandSec').hidden = !(state.mode === 'consular' && state.lang === 'zh');
  $('startBtn').disabled = !state.lang || (state.mode === 'miranda' && !state.crime) || (state.mode === 'voluntary' && !volReady);
}

/* ---------- 고지 화면 ---------- */

let segments = [];

async function openNotice() {
  stop();
  const meta = languages.find((l) => l.code === state.lang);
  const [L, K] = await Promise.all([loadLang(state.lang), loadLang('ko')]);
  segments = buildSegments(L);
  const koSegs = buildSegments(K);
  // 미리 받아 두어야 재생 버튼을 누른 순간 바로 재생된다 (iOS 자동재생 제한 회피)
  segments.forEach((s) => audioSrc(s.audio).catch(() => {}));

  $('noticeLang').textContent = `${meta.nameKo} · ${meta.name}`;
  $('noticeTitle').textContent = L.titles[state.mode];
  $('noticeTitle').lang = meta.bcp47;
  $('noticeTitle').dir = meta.dir;
  $('draftWarn').hidden = !!L.reviewed;

  const box = $('lines');
  box.innerHTML = '';
  box.lang = meta.bcp47;
  box.dir = meta.dir;
  segments.forEach((s) => {
    const div = document.createElement('div');
    div.className = s.item ? 'seg item' : 'seg';
    for (const t of s.lines) {
      const p = document.createElement('p');
      p.textContent = t;
      div.appendChild(p);
    }
    s.el = div;
    box.appendChild(div);
  });

  $('koLines').innerHTML = '';
  koSegs.flatMap((s) => s.lines).forEach((t) => {
    const p = document.createElement('p');
    p.textContent = t;
    $('koLines').appendChild(p);
  });

  $('status').hidden = true;
  $('answer').hidden = !needsAnswer();
  $('answerResult').hidden = true;
  for (const [id, key] of [['yesBtn', 'yes'], ['noBtn', 'no']]) {
    const b = $(id);
    b.innerHTML = `<span lang="${meta.bcp47}">${L[key]}</span><br><small>${K[key]}</small>`;
    b.setAttribute('aria-pressed', 'false');
  }

  $('setup').hidden = true;
  $('notice').hidden = false;
  window.scrollTo(0, 0);
  history.pushState({ notice: true }, '');
}

function closeNotice() {
  stop();
  $('notice').hidden = true;
  $('setup').hidden = false;
}

function answer(yes) {
  const K = langData.ko;
  $('yesBtn').setAttribute('aria-pressed', String(yes));
  $('noBtn').setAttribute('aria-pressed', String(!yes));
  let what = state.mode === 'voluntary'
    ? (yes ? '임의동행에 동의함' : '임의동행을 거부함')
    : (yes ? '영사기관 통보를 요청함' : '영사기관 통보를 원하지 않음');
  if (state.mode === 'voluntary') {
    const place = $('placeName').value.trim() || PLACES.find((p) => p.id === state.place).ko;
    what += ` (목적: ${K.crimes[state.purpose]} 사건 / 이유: ${REASONS.find((r) => r.id === state.reason).ko} / 장소: ${place})`;
  }
  const now = new Date().toLocaleString('ko-KR', { hour12: false });
  const r = $('answerResult');
  r.textContent = `응답: ${yes ? K.yes : K.no} — ${what} (${now})`;
  r.hidden = false;
}

/* ---------- 재생 ---------- */

const player = new Audio();
let playToken = 0;

async function audioSrc(name) {
  const url = audioUrl(state.lang, name);
  if (blobUrls[url]) return blobUrls[url];
  // fetch → blob 으로 재생해야 서비스워커 캐시(오프라인)에서도 iOS/Android 모두 안정적으로 재생된다
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status);
  blobUrls[url] = URL.createObjectURL(await res.blob());
  return blobUrls[url];
}

function speakFallback(text, token) {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) return reject(new Error('no tts'));
    const meta = languages.find((l) => l.code === state.lang);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = meta.bcp47;
    u.rate = Number($('speed').value);
    u.onend = resolve;
    u.onerror = reject;
    if (token === playToken) speechSynthesis.speak(u);
  });
}

function playOne(src) {
  return new Promise((resolve, reject) => {
    player.src = src;
    player.playbackRate = Number($('speed').value);
    player.onended = resolve;
    player.onerror = () => reject(new Error('audio error'));
    player.play().catch(reject);
  });
}

async function play() {
  const token = ++playToken;
  $('playBtn').textContent = '■ 정지';
  try {
    for (const s of segments) {
      if (token !== playToken) return;
      segments.forEach((x) => x.el.classList.toggle('active', x === s));
      s.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      try {
        await playOne(await audioSrc(s.audio));
      } catch {
        if (token !== playToken) return;
        await speakFallback(s.tts || s.lines.join(' '), token); // 음성 파일이 없을 때 기기 내장 TTS
      }
    }
  } catch {
    alertBox('음성을 재생할 수 없습니다. 화면의 글을 보여 주세요.');
  } finally {
    if (token === playToken) stop();
  }
}

function stop() {
  playToken++;
  player.pause();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  segments.forEach((x) => x.el && x.el.classList.remove('active'));
  $('playBtn').textContent = '▶ 재생';
}

function alertBox(msg) {
  $('status').textContent = msg;
  $('status').hidden = false;
}

/* ---------- 오프라인 저장 ---------- */

async function saveOffline() {
  const btn = $('offlineBtn');
  if (!('caches' in window)) { btn.textContent = '지원 안 됨'; return; }
  const urls = Object.entries(audioManifest).map(([k, v]) => `audio/${k}?v=${v}`);
  const cache = await caches.open(AUDIO_CACHE);
  let done = 0, failed = 0;
  btn.disabled = true;
  const queue = [...urls];
  async function worker() {
    while (queue.length) {
      const url = queue.shift();
      try {
        if (!(await cache.match(url))) await cache.add(url);
      } catch { failed++; }
      done++;
      btn.textContent = `저장 중 ${Math.round((done / urls.length) * 100)}%`;
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  btn.disabled = false;
  btn.textContent = failed ? `일부 실패(${failed}) · 재시도` : '오프라인 저장 완료 ✓';
}

/* ---------- 시작 ---------- */

async function init() {
  [languages, crimes, audioManifest] = await Promise.all([
    getJSON('data/languages.json'),
    getJSON('data/crimes.json'),
    getJSON('audio/manifest.json').catch(() => ({})),
  ]);
  loadLang('ko').catch(() => {});
  renderModes();
  renderLangs();
  renderChips('crimes', crimes, 'crime');
  renderChips('purposes', crimes, 'purpose');
  renderChips('reasons', REASONS, 'reason');
  renderChips('places', PLACES, 'place');
  loadOfficer();
  refresh();

  $('langSearch').oninput = (e) => renderLangs(e.target.value);
  $('mandatory').onchange = refresh;
  for (const f of OFFICER_FIELDS) $(f).oninput = () => { saveOfficer(); refresh(); };
  $('startBtn').onclick = () => openNotice().catch(() => alert('고지문을 불러오지 못했습니다.'));
  $('backBtn').onclick = () => history.back();
  window.onpopstate = () => { if (!$('notice').hidden) closeNotice(); };
  $('playBtn').onclick = () => ($('playBtn').textContent.startsWith('■') ? stop() : play());
  $('speed').onchange = () => { player.playbackRate = Number($('speed').value); };
  $('yesBtn').onclick = () => answer(true);
  $('noBtn').onclick = () => answer(false);
  $('offlineBtn').onclick = saveOffline;

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
