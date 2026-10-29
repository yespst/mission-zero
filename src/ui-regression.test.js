import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [jsx, css] = await Promise.all([
  readFile(new URL('./main.jsx', import.meta.url), 'utf8'),
  readFile(new URL('./style.css', import.meta.url), 'utf8')
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
