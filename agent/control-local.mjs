import { readRuntimeState, writeRuntimeState } from './runtime-state.mjs';

const [command = 'status', value = ''] = process.argv.slice(2);
let state = readRuntimeState();

if (command === 'pause') state = writeRuntimeState({ paused: true });
else if (command === 'resume') state = writeRuntimeState({ paused: false });
else if (command === 'autonomy') state = writeRuntimeState({ autonomy: value });
else if (command === 'privacy') {
  const [key, raw] = String(value).split('=');
  if (!['screen', 'clipboard', 'uiAutomation', 'browser', 'hardware'].includes(key)) throw new Error('Use privacy screen=true|false, clipboard=true|false, uiAutomation=true|false, browser=true|false ou hardware=true|false');
  state = writeRuntimeState({ privacy: { [key]: raw !== 'false' } });
} else if (command === 'cancel') state = writeRuntimeState({ cancelEpoch: state.cancelEpoch + 1 });
else if (command !== 'status') throw new Error('Comando: status | pause | resume | autonomy <observer|assistant|autonomous> | privacy <capability=true|false> | cancel');

console.log(JSON.stringify(state, null, 2));
