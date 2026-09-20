# SEXTA 2.0 — arquitetura alvo

> Princípio: primeiro confiabilidade; depois aparência JARVIS.

## Visão

A SEXTA é uma única assistente distribuída. Celular, navegador e computadores são corpos com capacidades diferentes. O Cloud Core mantém identidade, estado compartilhado e missões. Um PC pode atuar como **Home Hub**, oferecendo filesystem, automação Windows, browser, Codex/coding e sincronização com Obsidian.

```text
Phone / Browser / Other device
           |
           v
      SEXTA Cloud Core
       |   |       |
 WorldState Missions Memory
       |   |       |
       +---+-------+
           |
       Device Bus
           |
       Home Hub PC
      /    |      \
  Coding Files   Browser
      \    |      /
       Obsidian Vault
```

## Regras arquiteturais

1. A SEXTA não depende do Home Hub para existir.
2. Se o PC estiver offline, tarefas que exigem suas capacidades ficam em `waiting_for_device`.
3. O Obsidian é Knowledge Vault de longo prazo, não memória quente.
4. Toda ação relevante segue **OBSERVE → ACT → VERIFY**.
5. Comandos determinísticos devem usar Fast Path; LLM não é obrigatório para abrir app, volume, mídia etc.
6. Voz e execução pesada são caminhos separados: conversar não deve bloquear enquanto uma missão trabalha.
7. UI principal é HUD contextual. Diagnóstico, integrações e configurações ficam no Control Center.
8. Sem novos arquivos `*-v5`: uma implementação canônica por subsistema.
9. Migração incremental. Nenhuma etapa deve regressar capacidade existente.

## Camadas

### Cloud Core

- Orchestrator
- World State
- Mission Engine
- Event Bus
- Capability Router
- Memory services
- Device registry

### Home Hub

- Windows Agent
- filesystem
- Coding/Codex agent
- browser automation
- screen/context
- Obsidian Vault Sync

### Memória

- Working memory: sessão/World State
- Episodic memory: acontecimentos/missões
- Semantic memory: fatos e preferências
- Procedural memory: maneiras recorrentes de executar tarefas
- Obsidian Vault: conhecimento duradouro e editável

O celular registra memória no cloud imediatamente. Quando o Home Hub estiver online, o Vault Sync materializa conhecimento útil em Markdown e lê alterações do usuário de volta.

## Estado desta branch

Implementado como fundação não destrutiva:

- `lib/v2/event-bus.mjs`
- `lib/v2/world-state.mjs`
- `lib/v2/device-capabilities.mjs`
- `lib/v2/missions.mjs`
- `lib/v2/orchestrator.mjs`
- `lib/v2/home-hub.mjs`
- `/api/v2/state`
- `/api/v2/missions`
- `/api/v2/home-hub`
- heartbeat espelhado no World State
- eventos de Vault Sync após alteração manual de memória
- testes unitários básicos

## Próximas migrações

### P0 — Reliability

- persistir missions no Supabase usando `supabase/sexta_2_schema.sql`
- conectar command/result IDs às missions
- reconciliar dispositivos offline por timeout
- testes de integração do PC Agent
- health detalhado
- logs estruturados e métricas de latência

### P1 — Voice Runtime

Consolidar `live-voice*.js` em uma única implementação modular:

```text
voice/
  session
  input
  output
  interruption
  tools
  metrics
```

Preservar a voz/persona atual.

### P2 — Fast Path

Classificar localmente intenções determinísticas e executar sem esperar o LLM.

### P3 — Home Hub

O PC registra capabilities, recebe missions cloud, executa Coding/Codex/Windows/Browser e sincroniza Obsidian.

### P4 — HUD

Só após a base passar nos testes:

- modo ambient
- modo conversation
- modo mission/workspace
- Control Center separado
- estética inspirada em HUD/JARVIS sem poluição de dashboard
