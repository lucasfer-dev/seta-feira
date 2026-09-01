# SEXTA 1.5 — Knowledge Vault

Assistente pessoal cloud-first, voice-first e multiplataforma. O mesmo Core atende navegador, programa Windows e app Android.

## O que a 1.5 adiciona

- **Knowledge Vault compatível com Obsidian** para memória de longo prazo.
- Cada memória permanente pode virar uma nota `.md` com frontmatter e links `[[...]]`.
- Busca de memórias relevantes do Vault antes de consultas ao cérebro.
- Sync bidirecional do Vault: edições feitas no Obsidian podem voltar para a SEXTA.
- **Windows/Electron**: escolhe uma pasta local, sincroniza e abre diretamente no Obsidian.
- **Android/Capacitor**: bridge Kotlin preparado para selecionar uma pasta pelo Storage Access Framework e espelhar o mesmo Vault.
- Supabase protegido por RLS + chave interna adicional da SEXTA no Data API.
- Confirmação idempotente antes de enviar mensagens/e-mails, criar itens no Google ou permitir edição pelo Codex.
- Voz Android full-duplex com interrupção durante a fala, ferramentas nativas e token protegido pelo Android Keystore.
- Cache de sincronização invalidado após escrita, limitação de tentativas de login, cron autenticado e CI com testes.

## Arquitetura

```text
                         SEXTA CORE
                 Gemini + ferramentas + router
                           │
              ┌────────────┴────────────┐
              │                         │
       Supabase / memória quente   Knowledge Vault
       mensagens / realtime        Markdown / links
              │                         │
       ┌──────┴───────┐          ┌──────┴───────┐
       │              │          │              │
  SEXTA Desktop   SEXTA Android  Obsidian PC   Obsidian Mobile
     Electron        Capacitor      mesma pasta / espelho local
```

## Rodar o Core localmente

Requer Node.js 22+.

```bash
npm run dev
```

Abra `http://localhost:3000`.

## Memória Obsidian

Leia [`OBSIDIAN_MEMORY.md`](./OBSIDIAN_MEMORY.md).

No Windows, rode também:

```bash
npm run desktop:install
npm run desktop:dev
```

Na tela **Memória**, use **Escolher pasta do Vault** e depois **Sincronizar agora**.

## Android

```bash
npm run android:install
cd apps/android-capacitor
npx cap add android
npx cap sync android
npx cap open android
```

Depois siga `apps/android-capacitor/VAULT_SYNC_SETUP.md` para adicionar o bridge Kotlin do Vault. O APK final exige Android Studio/SDK para compilação.

## Voz

- Perguntas feitas pelo microfone respondem por voz.
- Wake word web: `Sexta-feira` quando o navegador suporta reconhecimento contínuo.
- A versão Android definitiva usa wake word local/nativo para não gastar tokens enquanto espera ativação.

## Integrações existentes

- Google Workspace: Calendar, Gmail, Drive, Contacts, Docs, Sheets e Tasks (OAuth necessário).
- WhatsApp: Evolution API/webhook (configuração externa necessária).
- ChatGPT handoff: prepara a pergunta, abre ChatGPT e pode importar uma resposta copiada de volta para o contexto.
- PC Agent: ações allowlistadas no Windows.
- Smart Inbox: triagem de notificações Gmail/WhatsApp.

## Supabase

Projeto utilizado nesta build: `sexta-core`, separado de outros projetos.

Variáveis principais:

```env
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SEXTA_DATA_API_KEY=
```

A Data API exige a chave publishable **e** a chave interna `x-sexta-api-key` enviada somente pelo backend. As tabelas públicas continuam com RLS.

O schema canônico está em `supabase/migrations/20260901193718_harden_sexta_core.sql`. Aplique a migration antes de publicar a versão 1.5, pois o fluxo de confirmação usa `sexta_pending_actions`.

Na Vercel, defina também `CRON_SECRET` com um valor aleatório forte. O cron diário chama `/api/monitor/run` às 11:00 UTC (08:00 em São Paulo fora de mudanças históricas de fuso).

Depois do deploy, reconecte o Google Workspace para substituir os escopos antigos e amplos pelos escopos mínimos da versão 1.5.

## Segurança

- O browser não recebe `SEXTA_DATA_API_KEY`, Gemini key, tokens Google ou credenciais Evolution.
- Não coloque credenciais na memória/Obsidian.
- Ações que enviam conteúdo ou criam dados externos exigem confirmação única.
- Este ZIP de teste inclui `.env.local` com credenciais temporárias por solicitação explícita do proprietário. Rotacione-as antes de compartilhar/publicar.

## Estrutura

```text
api/                       endpoints do Core
agent/                     PC Agent
apps/desktop-electron/     programa Windows
apps/android-capacitor/    app Android + bridge nativo
lib/                       IA, memória e integrações
public/                    interface compartilhada
supabase/                  schema de referência
OBSIDIAN_MEMORY.md         funcionamento do Knowledge Vault
```


## Correção 1.3.2 — SUPABASE_401 / schema private

A função usada em `pgrst.db_pre_request` deve ficar em `public` com `SECURITY DEFINER` e execução limitada ao papel `authenticator`. A tabela de chaves permanece em `private`. Isso evita `permission denied for schema private` sem expor o schema privado aos clientes.


## Correção 1.3.2
- Corrige `permission denied for function check_sexta_request` no Supabase.
- Remove o `db_pre_request` e valida a chave interna diretamente nas políticas RLS.
- A função de validação é `SECURITY INVOKER`; não há função privilegiada exposta por RPC.
- O schema `private` e a tabela de chaves continuam sem acesso direto pelo cliente.
- Valide novamente o Security Advisor depois de aplicar qualquer migração.
