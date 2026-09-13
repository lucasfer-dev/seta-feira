from pathlib import Path
import os
import subprocess

BRANCHES = [
    'roadmap/04-capability-router-mcp',
    'roadmap/05-mission-engine-controls',
    'roadmap/06-world-state-unified',
    'roadmap/07-browser-agent-reliability',
    'roadmap/08-memory-context-scopes',
    'roadmap/09-proactivity-guardrails',
    'roadmap/10-presence-orb-ux',
    'roadmap/11-observability-slo',
    'roadmap/12-desktop-hardening',
]


def sh(*args):
    print('+', ' '.join(args), flush=True)
    subprocess.run(args, check=True)


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old in text:
        text = text.replace(old, new, 1)
        p.write_text(text, encoding='utf-8')
        return True
    return False


def patch_live(branch):
    path = 'api/live-token.js'
    replace_once(path, "  'pc_screen_analyze',\n  'pc_ui_action',", "  'pc_screen_analyze',\n  'pc_ui_tree',\n  'pc_ui_action',")
    if branch != BRANCHES[0]:
        replace_once(path, "  'pc_agent_task'\n]);", "  'pc_agent_task',\n  'pc_mission_status',\n  'pc_mission_resume',\n  'pc_mission_cancel'\n]);")


def patch_mission_policy():
    policy = Path('lib/tool-policy.mjs')
    source = policy.read_text(encoding='utf-8')
    source = source.replace('|continua|continue|continuar|transfere', '|continua|continue|continuar|cancela|cancele|cancelar|retoma|retome|retomar|transfere', 1)
    anchor = "  if (name === 'pc_ui_action' && ['set_value', 'type'].includes(String(args?.action || ''))) {"
    mission_policy = """  if (name === 'pc_mission_status') {
    return { version: POLICY_VERSION, risk: 'low', sideEffect: 'mission-read', requiresExplicit: false, destructive: false, external: false };
  }
  if (name === 'pc_mission_resume') {
    return { version: POLICY_VERSION, risk: 'high', sideEffect: 'autonomous-local-action', requiresExplicit: true, destructive: false, external: false };
  }
  if (name === 'pc_mission_cancel') {
    return { version: POLICY_VERSION, risk: 'medium', sideEffect: 'mission-state-write', requiresExplicit: true, destructive: false, external: false };
  }

"""
    if "name === 'pc_mission_status'" not in source:
        if anchor not in source:
            raise RuntimeError('mission policy anchor missing')
        source = source.replace(anchor, mission_policy + anchor, 1)
    policy.write_text(source, encoding='utf-8')

    core = Path('lib/tool-core.mjs')
    source = core.read_text(encoding='utf-8')
    source = source.replace("  if (MISSION_TOOL_NAMES.has(name)) return executeMissionTool(name, args, options);\n  if (name === CAPABILITY_DISPATCH_DECLARATION.name) {", "  if (name === CAPABILITY_DISPATCH_DECLARATION.name) {", 1)
    source = source.replace("  let result;\n  if (name === 'pc_agent_task') result = await runPcAgentTask(args, options);", "  let result;\n  if (MISSION_TOOL_NAMES.has(name)) result = await executeMissionTool(name, args, options);\n  else if (name === 'pc_agent_task') result = await runPcAgentTask(args, options);", 1)
    core.write_text(source, encoding='utf-8')

    test = Path('tests/roadmap-05-missions.test.mjs')
    if test.exists():
        source = test.read_text(encoding='utf-8')
        if "const policy = fs.readFileSync" not in source:
            source = source.replace("const source = fs.readFileSync(new URL('../lib/tool-core.mjs', import.meta.url), 'utf8');", "const source = fs.readFileSync(new URL('../lib/tool-core.mjs', import.meta.url), 'utf8');\nconst policy = fs.readFileSync(new URL('../lib/tool-policy.mjs', import.meta.url), 'utf8');\nconst live = fs.readFileSync(new URL('../api/live-token.js', import.meta.url), 'utf8');")
            source = source.replace("  assert.match(source, /runPcAgentTask\\(\\{ goal:mission\\.goal/);", "  assert.match(source, /runPcAgentTask\\(\\{ goal:mission\\.goal/);\n  assert.match(policy, /pc_mission_resume/);\n  assert.match(policy, /requiresExplicit: true/);\n  assert.match(live, /'pc_mission_status'/);\n  assert.match(live, /'pc_mission_resume'/);\n  assert.match(live, /'pc_mission_cancel'/);")
            test.write_text(source, encoding='utf-8')


sh('git', 'config', 'user.name', 'sexta-roadmap-bot')
sh('git', 'config', 'user.email', 'actions@users.noreply.github.com')
sh('git', 'fetch', 'origin', '+refs/heads/roadmap/*:refs/remotes/origin/roadmap/*')

for branch in BRANCHES:
    sh('git', 'checkout', '-B', branch, f'origin/{branch}')
    patch_live(branch)
    if branch != BRANCHES[0]:
        patch_mission_policy()
    sh('node', '--check', 'api/live-token.js')
    if branch != BRANCHES[0]:
        sh('node', '--check', 'lib/tool-core.mjs')
        sh('node', '--check', 'lib/tool-policy.mjs')
        sh('node', '--test', 'tests/roadmap-05-missions.test.mjs')
    if subprocess.run(['git', 'diff', '--quiet']).returncode == 0:
        print(branch, 'already hardened')
        continue
    sh('git', 'add', '-A')
    sh('git', 'commit', '-m', 'fix(core): keep routed tools policy-safe and Live-visible')
    sh('git', 'push', 'origin', f'HEAD:refs/heads/{branch}')
