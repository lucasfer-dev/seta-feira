# SEXTA 1.3 — Test report

Data: 30/08/2026

## Passou

- `node --check` em `server.mjs`, `lib/core.mjs`, `api/vault.js`, frontend e shell Electron.
- Todos os IDs usados pela UI existem no HTML (checagem estática: nenhum seletor `#id` ausente).
- Core inicia com versão `1.3.0-obsidian-memory`.
- Em modo local de teste:
  - login por PIN: OK;
  - criação de memória: OK;
  - memória gera nota Markdown automaticamente: OK;
  - seed do Vault gera índices/pastas: OK;
  - `GET /api/vault`: OK;
  - edição simulada vinda do Obsidian: OK;
  - nova leitura recupera o Markdown editado: OK.
- Electron 1.3:
  - bridge IPC de Vault implementado;
  - seleção de pasta, leitura recursiva, escrita segura e abertura via Obsidian URI implementadas;
  - path traversal bloqueado.
- Android 1.3:
  - scaffold Kotlin `VaultBridgePlugin.kt` incluído;
  - desenho usa `ACTION_OPEN_DOCUMENT_TREE` + permissão persistente;
  - leitura/escrita Markdown recursiva implementada no scaffold.
- Supabase `sexta-core`:
  - migration `add_vault_and_secure_data_api`: aplicada;
  - migration `allow_sexta_server_via_custom_key`: aplicada;
  - `public.sexta_vault_notes`: RLS ativo;
  - advisor de segurança após as migrations: **0 lints**.

## Limitação do ambiente de teste

O runtime local desta sessão não conseguiu resolver o DNS de `*.supabase.co` (`EAI_AGAIN`), então a chamada HTTP Core → Supabase não pôde ser validada daqui. O schema/migrations foram aplicados e verificados diretamente pelo conector Supabase; a lógica completa foi validada no modo local do Core.

## Ainda depende de toolchain externa

- O `.exe` final exige instalação/empacotamento Electron no ambiente de build Windows.
- O `.apk` final exige Android Studio/Android SDK e o registro do plugin descrito em `apps/android-capacitor/VAULT_SYNC_SETUP.md`.
- Google Workspace só executa ações reais após OAuth Client ID/Secret e autorização do usuário.
- Evolution API precisa estar hospedada/conectada para WhatsApp real.
