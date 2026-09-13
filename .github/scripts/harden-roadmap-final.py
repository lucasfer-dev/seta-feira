from pathlib import Path
import subprocess


def sh(*args):
    print('+', ' '.join(args), flush=True)
    subprocess.run(args, check=True)


def patch(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        return False
    p.write_text(text.replace(old, new, 1), encoding='utf-8')
    return True


def commit(branch, message, checks=()):
    for item in checks:
        sh('node', '--check', item)
    if subprocess.run(['git','diff','--quiet']).returncode == 0:
        print(branch, 'already up to date')
        return
    sh('git','add','-A')
    sh('git','commit','-m',message)
    sh('git','push','origin',f'HEAD:refs/heads/{branch}')


sh('git','config','user.name','sexta-roadmap-bot')
sh('git','config','user.email','actions@users.noreply.github.com')
sh('git','fetch','origin','+refs/heads/roadmap/*:refs/remotes/origin/roadmap/*')

# PR 8 onward: device-aware scoped context cache.
for branch in [
    'roadmap/08-memory-context-scopes','roadmap/09-proactivity-guardrails','roadmap/10-presence-orb-ux',
    'roadmap/11-observability-slo','roadmap/12-desktop-hardening'
]:
    sh('git','checkout','-B',branch,f'origin/{branch}')
    sync = Path('api/sync.js')
    source = sync.read_text(encoding='utf-8')
    source = source.replace("  if (scope === 'device' && deviceId && String(item.deviceId || item.device_id || '') !== deviceId) return false;\n  return true;", "  if (scope === 'device') {\n    const ownerDevice = String(item.deviceId || item.device_id || '');\n    return Boolean(deviceId) && ownerDevice === deviceId;\n  }\n  return true;")
    source = source.replace("function refresh(scope, deviceId) {\n  if (inFlights.has(scope)) return inFlights.get(scope);\n  const promise = loadSnapshot(scope,deviceId).then(value => { caches.set(scope,{value,at:Date.now()}); return value; }).finally(() => inFlights.delete(scope));\n  inFlights.set(scope,promise); return promise;\n}", "function cacheKey(scope, deviceId) { return `${scope}:${deviceId || 'global'}`; }\nfunction refresh(key, scope, deviceId) {\n  if (inFlights.has(key)) return inFlights.get(key);\n  const promise = loadSnapshot(scope,deviceId).then(value => { caches.set(key,{value,at:Date.now()}); return value; }).finally(() => inFlights.delete(key));\n  inFlights.set(key,promise); return promise;\n}")
    source = source.replace("    const ttl = scope === 'voice' ? VOICE_CACHE_MS : CACHE_MS; const cached = caches.get(scope); const age = cached ? Date.now()-cached.at : Infinity;", "    const ttl = scope === 'voice' ? VOICE_CACHE_MS : CACHE_MS; const key = cacheKey(scope,deviceId); const cached = caches.get(key); const age = cached ? Date.now()-cached.at : Infinity;")
    source = source.replace("void refresh(scope,deviceId)", "void refresh(key,scope,deviceId)")
    source = source.replace("const snapshot = await refresh(scope,deviceId);", "const snapshot = await refresh(key,scope,deviceId);")
    source = source.replace("const stale = caches.get('full')?.value || caches.get('voice')?.value;", "const stale = [...caches.entries()].find(([key]) => key.startsWith('full:'))?.[1]?.value || [...caches.entries()].find(([key]) => key.startsWith('voice:'))?.[1]?.value;")
    sync.write_text(source, encoding='utf-8')

    voice = Path('public/voice-core-v10.js')
    source = voice.read_text(encoding='utf-8')
    source = source.replace("    const conversationId = localStorage.getItem('sexta_conversation') || 'main';\n    let sync = {};\n    const freshness = fresh ? '&fresh=1' : '';\n    try { sync = await api(`/api/sync?conversationId=${encodeURIComponent(conversationId)}&scope=voice${freshness}`); } catch {}", "    const conversationId = localStorage.getItem('sexta_conversation') || 'main';\n    const deviceId = localStorage.getItem('sexta_device_id') || (IS_ANDROID ? 'android-native' : IS_DESKTOP ? 'desktop-native' : 'browser');\n    let sync = {};\n    const freshness = fresh ? '&fresh=1' : '';\n    try { sync = await api(`/api/sync?conversationId=${encodeURIComponent(conversationId)}&scope=voice&deviceId=${encodeURIComponent(deviceId)}${freshness}`); } catch {}")
    voice.write_text(source, encoding='utf-8')

    test = Path('tests/roadmap-08-memory-context.test.mjs')
    if test.exists():
        source = test.read_text(encoding='utf-8')
        source = source.replace("assert.match(source, /memoryVisible/); assert.match(source, /expiresAt/); assert.match(source, /STALE-WHILE-REVALIDATE/);", "assert.match(source, /memoryVisible/); assert.match(source, /cacheKey/); assert.match(source, /deviceId/); assert.match(source, /expiresAt/); assert.match(source, /STALE-WHILE-REVALIDATE/);")
        test.write_text(source, encoding='utf-8')
    sh('node','--test','tests/roadmap-08-memory-context.test.mjs')
    commit(branch,'fix(memory): isolate context cache by device',['api/sync.js','public/voice-core-v10.js'])

# PR 10 onward: avoid unsupported arithmetic in CSS calc for orb scale.
for branch in ['roadmap/10-presence-orb-ux','roadmap/11-observability-slo','roadmap/12-desktop-hardening']:
    sh('git','checkout','-B',branch,f'origin/{branch}')
    p = Path('public/presence-orb-lite.js')
    source = p.read_text(encoding='utf-8')
    source = source.replace("      transform: scale(calc(.96 + var(--sexta-stage-energy) * .08));", "      transform: scale(.98);")
    source = source.replace("html[data-sexta-presence='listening'] .ambient-orb.sexta-presence-stage { --sexta-stage-energy: .58; }", "html[data-sexta-presence='listening'] .ambient-orb.sexta-presence-stage { transform:scale(1.01); }")
    source = source.replace("html[data-sexta-presence='thinking'] .ambient-orb.sexta-presence-stage { --sexta-stage-energy: .72; filter:", "html[data-sexta-presence='thinking'] .ambient-orb.sexta-presence-stage { transform:scale(1.02); filter:")
    source = source.replace("html[data-sexta-presence='speaking'] .ambient-orb.sexta-presence-stage { --sexta-stage-energy: .92; }", "html[data-sexta-presence='speaking'] .ambient-orb.sexta-presence-stage { transform:scale(1.04); }")
    source = source.replace("html[data-sexta-presence='acting'] .ambient-orb.sexta-presence-stage { --sexta-stage-energy: .82; filter:", "html[data-sexta-presence='acting'] .ambient-orb.sexta-presence-stage { transform:scale(1.025); filter:")
    p.write_text(source, encoding='utf-8')
    test = Path('tests/roadmap-10-presence.test.mjs')
    if test.exists():
        source = test.read_text(encoding='utf-8')
        if "doesNotMatch" not in source:
            source = source.replace("assert.match(presence, /recovering: 'reconnecting'/);", "assert.match(presence, /recovering: 'reconnecting'/);\n  assert.doesNotMatch(orb, /var\\(--sexta-stage-energy\\) \\* \\.08/);")
            test.write_text(source, encoding='utf-8')
    sh('node','--test','tests/roadmap-10-presence.test.mjs')
    commit(branch,'fix(ui): use Chromium-safe orb transforms',['public/presence-orb-lite.js'])

# PR 12: failure backoff should be capped at 15s total, not 15s + normal poll delay.
branch='roadmap/12-desktop-hardening'
sh('git','checkout','-B',branch,f'origin/{branch}')
patch('agent/agent-v3.mjs', "    await sleep(Math.min(15000, 750 * (2 ** Math.min(pollFailureStreak, 4))));\n  }\n  await sleep(3000);", "    await sleep(Math.min(15000, 750 * (2 ** Math.min(pollFailureStreak, 4))));\n    continue;\n  }\n  await sleep(3000);")
test=Path('tests/roadmap-12-hardening.test.mjs')
source=test.read_text(encoding='utf-8')
source=source.replace("assert.match(agent,/Math\\.min\\(15000/);", "assert.match(agent,/Math\\.min\\(15000/); assert.match(agent,/continue;/);")
test.write_text(source,encoding='utf-8')
sh('node','--test','tests/roadmap-12-hardening.test.mjs')
commit(branch,'fix(agent): cap failed-poll backoff without extra delay',['agent/agent-v3.mjs'])
