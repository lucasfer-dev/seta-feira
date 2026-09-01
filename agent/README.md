# SEXTA PC Agent

O PC Agent mantém a SEXTA conectada ao Windows mesmo quando a tela está bloqueada. Ele recebe comandos da SEXTA Cloud e pode delegar tarefas de programação ao Codex CLI autenticado localmente.

## Fluxo

```text
SEXTA Android / Desktop
        ↓
SEXTA Cloud (Vercel + Supabase)
        ↓
PC Agent em segundo plano
        ↓
Codex CLI
        ↓
Projeto permitido
```

## Instalação única no Windows

Pré-requisitos:

- Node.js 22+
- Codex CLI instalado e autenticado com a conta ChatGPT
- `.env.local` contendo `SEXTA_AGENT_TOKEN`
- `agent/config.json` com os projetos permitidos

Depois rode na raiz do projeto:

```powershell
npm run agent:install
```

O instalador cria uma tarefa oculta no Agendador de Tarefas do Windows, inicia o agente imediatamente, reinicia o processo em caso de falha e inicia novamente quando o usuário fizer logon. Também desativa a suspensão automática enquanto o PC estiver conectado à tomada para que a tela bloqueada não derrube o executor.

A tela pode ser bloqueada normalmente com `Win + L`. Enquanto a sessão do Windows permanecer logada, o agente continua funcionando.

Depois de reiniciar o computador, é necessário entrar no Windows ao menos uma vez; depois disso ele pode ficar bloqueado normalmente.

## Estado

```powershell
npm run agent:status
```

## Remover início automático

```powershell
npm run agent:uninstall
```

## Segurança

O Codex só trabalha em projetos cadastrados em `agent/config.json`. Análises usam sandbox `read-only`; alterações usam `workspace-write`. Não é usado `OPENAI_API_KEY` nessa ponte.
