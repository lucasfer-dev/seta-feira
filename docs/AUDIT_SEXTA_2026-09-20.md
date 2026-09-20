# Auditoria arquitetural — 20/09/2026

## Resumo executivo

A SEXTA atual já contém partes importantes de um assistente distribuído, mas ainda opera como várias gerações de implementação convivendo ao mesmo tempo. O problema principal não é ausência de funcionalidades; é ausência de uma fronteira canônica entre runtime residente, voz, estado, capabilities, missões e interface.

A reconstrução deve ser incremental. O código útil existente deve permanecer funcionando enquanto os subsistemas são consolidados.

## Arquitetura atual

### Core / cloud
- `server.mjs` funciona como roteador HTTP e servidor estático.
- APIs de memória, comandos, Google, WhatsApp, voz e devices já existem.
- Há uma fundação V2 com Event Bus, World State, Missions, Device Capabilities e Orchestrator.
- Missions já conseguem despachar comandos para devices e persistir resultado verificado.

### Windows
- Electron atua como shell residente, tray, updater e host do PC Agent.
- PC Agent possui automação Windows, browser, vault e execução de tarefas.
- O processo principal mantém watchdogs do agent e do wake.

### Voz
- O frontend contém múltiplas gerações de Live Voice e Voice Core.
- O wake Windows em `main` estava acoplado diretamente a PowerShell + System.Speech.
- Android possui runtime de voz próprio e mais avançado que o Desktop.

### Memória
- Supabase, memória de conversa e Knowledge Vault/Obsidian coexistem.
- O Vault já está corretamente posicionado como memória durável, não runtime.

## Dívida técnica crítica

1. Múltiplas implementações canônicas concorrentes:
   - `live-voice.js`, `live-voice-v2.js`, `live-voice-v3.js`, `live-voice-v4.js`
   - `voice-core-v5.js` até `voice-core-v10.js`
   - `sexta-shell-v2/v3/v4`
   - módulos `legacy` de controle Windows
   - `agent.mjs` e `agent-v3.mjs`

2. Wake word Windows acoplado ao mecanismo errado.
   - System.Speech depende do reconhecedor instalado no Windows.
   - A qualidade varia por idioma/configuração da máquina.
   - O Desktop não deve conhecer detalhes do mecanismo de keyword spotting.

3. Estado insuficiente para referência contextual.
   - Não havia browser state, audio state ou lastObject completos no World State.

4. Orchestrator ainda não era a entrada real do sistema.
   - Existia como fundação, mas não classificava Fast Path nem executava capabilities registradas.

5. Diagnóstico fragmentado.
   - Existiam logs e estados locais, mas sem envelope comum de trace/action/device/mission.

6. Versionamento desalinhado.
   - Core, Desktop e preload possuíam números diferentes sem fronteira explicitada.

## O que manter

- Node.js 22 e módulos atuais do Core.
- Electron como Home Hub Windows.
- PC Agent e Windows Hands nativo.
- Missions e command/result existentes.
- Device routing existente.
- Supabase e schema V2.
- Google/Evolution API.
- Knowledge Vault/Obsidian.
- Gemini Live/persona atual.
- Capacitor/Android.
- Estratégia incremental, sem reescrita total.

## O que substituir gradualmente

- System.Speech como mecanismo principal de wake.
- Versionamento `live-voice-vN` e `voice-core-vN`.
- Chamadas diretas que ignoram o Orchestrator.
- Estado espalhado por UI/runtime.
- Fallbacks silenciosos.
- Códigos de erro livres sem estrutura.

## Arquitetura alvo

Entrada
→ Orchestrator
→ Reflex / Realtime / Deep
→ Capability Registry
→ Agent / execution target
→ Observe → Act → Verify
→ World State
→ Memory
→ Response

O Desktop passa a ser um runtime residente. A UI é apenas uma projeção desse runtime.

## Mudanças iniciadas nesta branch

### Core
- Error Model padronizado.
- Event Bus com traceId, missionId, deviceId e actionId.
- World State expandido com browser, áudio, referência conversacional e ação anterior.
- Capability Registry com executor e verificação.
- Reflex Engine determinístico.
- Orchestrator agora classifica input e pode executar Fast Path sem LLM.
- Observability com health de componentes e ações observadas.
- Conversation Session com idle timeout e lastObject.

### Wake
- Electron deixa de iniciar PowerShell diretamente.
- Um único `wake-runtime.mjs` passa a ser a fronteira canônica.
- O runtime aceita um motor local nativo configurável.
- System.Speech permanece somente como fallback de compatibilidade e pode ser desligado por configuração.
- Erros do wake passam a ser explícitos.

## Escolha de engine local

O contrato foi preparado para um engine real local. A solução final deve usar um modelo que realmente reconheça português e a frase “sexta-feira”.

Não é seguro declarar Sherpa-ONNX como solução final apenas porque ele possui KWS: os modelos KWS oficiais disponíveis atualmente são principalmente inglês/chinês. O engine precisa ser validado com português real antes de substituir o fallback.

OpenWakeWord é uma opção adequada quando houver um modelo customizado `sexta-feira.onnx` treinado e testado. A camada atual permite trocar o engine sem modificar Electron.

## Plano de migração

### Fase 1 — fundação
- consolidar Event Bus, Error Model, World State, Registry, observability e Orchestrator;
- cobrir contratos com testes.

### Fase 2 — resident voice
- Audio Service canônico;
- engine local de wake validado;
- Conversation Session;
- diagnóstico de mic/level/VAD/wake/realtime.

### Fase 3 — inteligência
- Fast Path para comandos locais;
- Realtime Brain para conversa;
- Deep Brain para planejamento;
- todas as entradas atravessando Orchestrator.

### Fase 4 — execução
- capabilities canônicas para Computer/Browser;
- Observe → Act → Verify obrigatório;
- Mission Engine para tarefas persistentes.

### Fase 5 — memória
- separar working/session/episodic/semantic/procedural;
- Vault somente para conhecimento durável.

### Fase 6 — devices
- protocolo cloud ↔ Home Hub;
- Android registrando capabilities;
- reconexão e fila de missões.

### Fase 7 — integrações
- Google e WhatsApp somente através de capabilities/agentes.

### Fase 8 — limpeza
- migrar consumidores para implementações canônicas;
- remover arquivos `v2/v3/v4/v5...` somente quando sem referências;
- UI ambiental por último.

## Definition of Done para migrações

Uma feature só pode ser chamada de concluída quando:
1. input é interpretado;
2. capability correta é selecionada;
3. execution target é resolvido;
4. ação é executada;
5. resultado é verificado;
6. World State é atualizado;
7. memória é atualizada quando relevante;
8. usuário recebe feedback;
9. falha fica observável.

## Riscos restantes

- O engine de wake em português ainda precisa de modelo local real e teste em Windows físico.
- O repositório contém PRs antigos que podem conflitar com a consolidação.
- A camada Web Voice possui gerações paralelas e precisa de migração controlada.
- Packaging do engine nativo precisa validar DLL/modelo no instalador.
- Testes Linux não substituem teste E2E de microfone, janela e áudio no Windows.
