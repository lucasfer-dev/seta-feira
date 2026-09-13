import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const metrics = fs.readFileSync(new URL('../api/live-metrics.js', import.meta.url), 'utf8');
const voice = fs.readFileSync(new URL('../public/voice-core-v10.js', import.meta.url), 'utf8');
test('voice observability correlates startup and endpoint-to-audio latency', () => {
  assert.match(voice, /voiceTraceId/); assert.match(metrics, /activityEndToSpeakingMs/); assert.match(metrics, /startupMs/); assert.match(metrics, /prewarmMs/);
  assert.match(metrics, /startupSlow/); assert.match(metrics, /endpointSlow/);
});
