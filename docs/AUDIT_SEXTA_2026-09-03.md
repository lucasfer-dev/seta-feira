# Auditoria SEXTA — 03/09/2026

## Estado atual

- Produção Vercel no commit `15236ff` está READY.
- O núcleo Live usa Gemini 3.1 Flash Live com `thinkingLevel=minimal`, VAD automático, áudio PCM 16 kHz de entrada e 24 kHz de saída.
- O Android já possui wake word local, serviço foreground, AEC/NS/AGC, full duplex, interrupção, tool calling e persistência de turnos.

## P0 encontrados

1. **Primeiro comando após wake word usa transporte incompatível com Gemini 3.1.** O Android envia `pendingWakeCommand` por `clientContent` depois de `setupComplete`. No Gemini 3.1, client content deve ser usado apenas para histórico inicial; atualizações de texto da conversa devem ir por `realtimeInput`.
2. **Watchdog pode reconectar durante fala longa.** `awaitingResponseSinceMs` começa no primeiro fragmento de `inputTranscription`; uma fala contínua superior ao timeout pode ser interpretada como falta de resposta.
3. **Playback bloqueia processamento de eventos Live.** O callback de WebSocket chama `AudioTrack.write(..., WRITE_BLOCKING)` no mesmo fluxo que processa `interrupted`, transcrição e tool calls. Sob buffer cheio, isso aumenta latência de barge-in e pode dar sensação de travamento.
4. **Estado de `assistantSpeaking` termina cedo.** `turnComplete` marca a assistente como não falando antes de todo áudio enfileirado necessariamente ter sido reproduzido, enfraquecendo a detecção de interrupção no fim das respostas.

## P1

- Sessão reconectada não usa o `sessionResumptionUpdate` do Gemini; uma queda recria uma sessão e depende apenas do snapshot persistido.
- `buildSystemInstruction()` engole falhas de sync sem telemetria; quando memória/contexto falha, a sessão degrada silenciosamente.
- Chamadas de ferramenta no Gemini 3.1 são síncronas por limitação do modelo; ações remotas lentas precisam feedback/estado explícito para não parecer silêncio.
- A integração de TTS não-Live registrou 429 por quota nos deploys anteriores; deve permanecer apenas como fallback e com circuito de falha.

## P2

- Telemetria deve registrar `wake -> setupComplete`, `speechEnd -> firstAudio`, `toolCall -> toolResponse`, `interruption -> silence` e reconexões por motivo.
- Adicionar testes de regressão para comando na mesma frase da wake word, fala longa (>15 s), interrupção durante áudio e tool call lento.

## Meta de qualidade

Prioridade: estabilidade do loop de voz > novas ferramentas. Só depois de wake/turn-taking/barge-in/reconexão estarem consistentes vale ampliar WhatsApp, PC e Codex.
