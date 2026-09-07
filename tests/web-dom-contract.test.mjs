import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

function referencedIds(source) {
  const ids = new Set();
  const patterns = [
    /\$\(\s*['"]#([A-Za-z][\w-]*)['"]\s*\)/g,
    /document\.querySelector\(\s*['"]#([A-Za-z][\w-]*)['"]\s*\)/g,
    /document\.getElementById\(\s*['"]([A-Za-z][\w-]*)['"]\s*\)/g
  ];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) ids.add(match[1]);
  return [...ids];
}

test('index preserva todos os IDs estáticos usados pelo app principal', () => {
  const missing = referencedIds(app).filter(id => !new RegExp(`id=["']${id}["']`).test(html));
  assert.deepEqual(missing, [], `IDs ausentes no index: ${missing.join(', ')}`);
});

test('v4 web carrega depois do app sem substituir o Voice Core', () => {
  assert.match(html, /src=["']\/app\.js["']/);
  assert.match(html, /src=["']\/proactivity-engine\.js["']/);
  assert.match(html, /src=["']\/sexta-v4-intelligence\.js["']/);
  const voiceLoader = fs.readFileSync(new URL('../public/voice-loader.js', import.meta.url), 'utf8');
  assert.match(voiceLoader, /voice-core-v10\.js/);
  assert.doesNotMatch(voiceLoader, /voice-core-v(?:5|6|7|8|9)\.js/);
});
