import { deleteSecret, listSecretAliases, secureVaultStatus, setSecret } from './secure-vault.mjs';

async function hiddenInput(prompt = 'Valor secreto: ') {
  if (process.env.SEXTA_SECRET_VALUE) return process.env.SEXTA_SECRET_VALUE;
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') throw new Error('Use SEXTA_SECRET_VALUE em terminal não interativo.');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = ch => {
      if (ch === '\u0003') { cleanup(); reject(new Error('cancelado')); return; }
      if (ch === '\r' || ch === '\n') { cleanup(); process.stdout.write('\n'); resolve(value); return; }
      if (ch === '\u007f' || ch === '\b') { value = value.slice(0, -1); return; }
      value += ch;
    };
    const cleanup = () => { process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); };
    process.stdin.on('data', onData);
  });
}

const [command = 'status', alias = ''] = process.argv.slice(2);
try {
  if (command === 'status') console.log(JSON.stringify(secureVaultStatus(), null, 2));
  else if (command === 'list') for (const item of listSecretAliases()) console.log(item);
  else if (command === 'set') { const value = await hiddenInput(`Segredo para ${alias}: `); console.log(JSON.stringify(await setSecret(alias, value))); }
  else if (command === 'delete') console.log(JSON.stringify({ alias, deleted: await deleteSecret(alias) }));
  else throw new Error('Uso: npm run sexta:vault -- status|list|set <alias>|delete <alias>');
} catch (error) { console.error(`SEXTA Secure Vault: ${error?.message || error}`); process.exitCode = 1; }
