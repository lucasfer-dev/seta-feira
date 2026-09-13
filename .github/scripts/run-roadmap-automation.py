from pathlib import Path

source_path = Path('.github/scripts/roadmap-automation.py')
source = source_path.read_text(encoding='utf-8')
lines = source.splitlines()
filtered = [
    line for line in lines
    if not line.startswith("wf = '.github/workflows/web-smoke.yml'")
    and not line.startswith('rep(wf,')
]
compiled = '\n'.join(filtered) + '\n'
exec(compile(compiled, str(source_path), 'exec'), {'__name__': '__main__', '__file__': str(source_path)})
