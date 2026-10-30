import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [jsx, css, redesign, extras, home, homeCss, profile, debrief] = await Promise.all([
  readFile(new URL('./main.jsx', import.meta.url), 'utf8'),
  readFile(new URL('./style.css', import.meta.url), 'utf8'),
  readFile(new URL('./redesign.css', import.meta.url), 'utf8'),
  readFile(new URL('./MissionExtras.jsx', import.meta.url), 'utf8'),
  readFile(new URL('./Home.jsx', import.meta.url), 'utf8'),
  readFile(new URL('./home.css', import.meta.url), 'utf8'),
  readFile(new URL('./PlayerProfile.jsx', import.meta.url), 'utf8'),
  readFile(new URL('./LocalDebrief.jsx', import.meta.url), 'utf8')
]);

test('Mission 6 controls are not inside the full-screen launch countdown overlay', () => {
  assert.equal((jsx.match(/className="launch-countdown-overlay"/g) || []).length, 1);
  assert.equal((jsx.match(/className="launch-sequence"/g) || []).length, 1, 'mission authorization panel keeps its own class');
  const missionRules = [...css.matchAll(/\.launch-sequence\{([^}]*)\}/g)].map(match => match[1]);
  assert.ok(missionRules.some(rule => rule.includes('pointer-events:auto')));
  assert.ok(missionRules.every(rule => !rule.includes('position:fixed') && !rule.includes('pointer-events:none')));
  assert.match(css, /\.launch-countdown-overlay\{[^}]*pointer-events:none/);
  assert.match(jsx, /aria-label=\{`Enter \$\{glyphNames\[v-1\]\} glyph`\}/);
  assert.match(jsx, /disabled=\{busy\|\|m\.entered\.length!==m\.sequence\.length\} onClick=\{\(\)=>action\(\{type:'engines'\}\)\}/);
});

test('crew status badges occupy a dedicated responsive grid area and long labels truncate', () => {
  assert.match(jsx, /className="crew-badges"/);
  assert.match(css, /\.crew-row\{display:grid;grid-template-columns/);
  assert.match(css, /grid-template-areas:"index icon name ready badges"/);
  assert.match(css, /grid-template-areas:"index icon name ready" "index icon badges badges"/);
  assert.match(css, /\.crew-badges \.captain,\.crew-badges \.offline-tag,\.crew-badges \.online-tag,\.crew-badges \.you-tag\{position:static;inset:auto\}/);
  assert.match(css, /\.crew-name\{[^}]*min-width:0;overflow:hidden;text-overflow:ellipsis/);
  assert.match(css, /\.crew-name small\{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis/);
});

test('live mission clock is present only during play and stays pinned while content scrolls', () => {
  assert.match(jsx, /phase==='playing'&&<div className=\{`mission-status-bar/);
  assert.match(jsx, /role="timer" aria-label=\{`Mission time remaining/);
  assert.match(redesign, /\.mission-status-bar\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s);
  assert.match(redesign, /\.mission-status-bar\s*\{[^}]*z-index:\s*30;/s);
  assert.match(redesign, /\.status-clock b\s*\{[^}]*font-variant-numeric:\s*tabular-nums;/s);
});

test('mobile mission layout keeps the puzzle, chat, and touch controls in the page flow', () => {
  assert.match(redesign, /body\s*\{\s*min-width:\s*0;/);
  assert.match(redesign, /\.app\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s);
  assert.match(redesign, /@media\s*\(max-width:\s*760px\)/);
  assert.match(redesign, /\.chat-dock\s*\{\s*position:\s*relative;/);
  assert.match(redesign, /\.chat-dock\.is-open\s*\{\s*position:\s*relative;/);
  assert.match(redesign, /\.nav-grid\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(redesign, /\.glyph-buttons button\s*\{[^}]*min-height:\s*48px;/s);
  assert.match(redesign, /\.hull-grid\s*\{\s*display:\s*grid;/);
});

test('coolant mission exposes its generated target flow before players commit a port', () => {
  assert.match(extras, /className="coolant-key" aria-label="Target coolant flow"/);
  assert.match(extras, /TARGET FLOW/);
  assert.match(extras, /i===m\.steps\.length\?'CHOOSE PORT':'UP NEXT'/);
  assert.match(redesign, /\.coolant-key/);
});

test('home launcher exposes create, join, live room actions, daily challenge, guide, and rules', () => {
  assert.match(jsx, /<Home name=\{name\}[^>]*rooms=\{liveRooms\}/);
  assert.match(jsx, /socket\.emit\('list-rooms'/);
  assert.match(home, /className="home-action-panel create-panel"/);
  assert.match(home, /className="home-action-panel join-panel"/);
  assert.match(home, /rooms\.map\(room/);
  assert.match(home, /room\.phase==='playing'\?onWatch\(room\.code\):onJoin\(room\.code\)/);
  assert.match(home, /CREATE TODAY’S RUN/);
  assert.match(home, /id="how-to-play"/);
  assert.match(home, /id="game-rules"/);
  assert.match(homeCss, /@media\(max-width:700px\)/);
  assert.match(homeCss, /\.home-room-row\s*\{\s*grid-template-columns:minmax\(0,1fr\) auto auto/);
});

test('landing navigation uses aligned SVG icon-label items and profile controls', () => {
  assert.equal((jsx.match(/className=\{navActive===/g) || []).length, 4);
  assert.equal((jsx.match(/<svg viewBox="0 0 24 24" aria-hidden="true">/g) || []).length, 4);
  assert.match(jsx, /<ProfileButton name=\{name\} onClick=\{\(\)=>setProfileOpen\(true\)\}/);
  assert.match(jsx, /<PlayerProfile open=\{profileOpen\} onClose=/);
  assert.match(homeCss, /\.home-nav a\s*\{[^}]*display:flex;[^}]*align-items:center/);
  assert.match(homeCss, /@media\(max-width:700px\)[\s\S]*\.home-nav a/);
  assert.doesNotMatch(homeCss, /\.home-nav a:nth-child\(\d\):before/);
});

test('profile edits persist the callsign and show actual local match records', () => {
  assert.match(profile, /localStorage\.setItem\('mz-name', value\)/);
  assert.match(profile, /aria-modal="true"/);
  assert.match(profile, /event\.key === 'Escape'/);
  assert.match(profile, /event\.target === event\.currentTarget/);
  assert.match(profile, /Number\(records\.totalRuns\)/);
  assert.match(profile, /records\.recentResults/);
  assert.match(profile, /records\.achievements/);
  assert.match(debrief, /totalMissionsCompleted/);
  assert.match(debrief, /recentResults/);
  assert.match(debrief, /achievements:\[\.\.\.new Set/);
});
