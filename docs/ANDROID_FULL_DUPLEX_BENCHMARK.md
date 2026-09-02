# SEXTA Android Full-Duplex Benchmark

Objetivo: validar que o modo nativo Android continua ouvindo o usuário enquanto a SEXTA fala, sem transformar eco do próprio alto-falante em interrupção falsa.

## Arquitetura sob teste

- captura contínua de microfone durante fala da SEXTA;
- `VOICE_COMMUNICATION` como fonte preferida, com fallback para `VOICE_RECOGNITION`;
- `MODE_IN_COMMUNICATION` durante a sessão;
- `AcousticEchoCanceler`, `NoiseSuppressor` e `AutomaticGainControl` quando disponíveis;
- evento Gemini Live `interrupted` limpa imediatamente o `AudioTrack`;
- telemetria enviada para `/api/live-metrics` com `kind=android_full_duplex_v1`.

## Métricas

- `interruptToSilenceMs`: tempo entre o primeiro candidato local de fala do usuário durante a saída da SEXTA e o evento remoto de interrupção;
- `bargeInRms`: pico RMS observado no candidato de barge-in;
- `audioSource`: `VOICE_COMMUNICATION` ou fallback;
- disponibilidade/estado de AEC, redução de ruído e AGC.

## Critérios de aceitação

1. O microfone não pode ser pausado só porque `assistantSpeaking=true`.
2. Ao dizer “pera”, “não”, “calma” ou começar uma nova frase durante a fala da SEXTA, o áudio da SEXTA deve parar sem continuar tocando chunks antigos.
3. Meta inicial: `interruptToSilenceMs` mediano abaixo de 500 ms e nenhum caso recorrente acima de 800 ms em rede estável.
4. A própria voz da SEXTA não deve causar interrupções recorrentes em volume normal.
5. Se `VOICE_COMMUNICATION` não inicializar, a conversa deve continuar pelo fallback sem crash.
6. Encerrar a sessão deve liberar AudioRecord, AudioTrack, efeitos de áudio e restaurar o modo anterior do AudioManager.

## Matriz manual

| Cenário | Volumes/condições | Repetições | Resultado esperado |
| --- | --- | ---: | --- |
| Barge-in curto | “pera” durante resposta | 10 | SEXTA para e ouve |
| Barge-in longo | nova pergunta durante resposta | 10 | nova fala chega completa |
| Backchannel | “aham”, “uhum” | 10 | observar falsos cortes; não otimizar antes de medir |
| Eco | alto-falante 25/50/75/100% | 5 cada | sem self-interrupt recorrente |
| Distância | 0,5 m / 1 m / 2 m | 5 cada | interrupção ainda detectável |
| Ruído | TV/conversa ambiente | 10 | sem explosão de falsos turnos |
| Headset/Bluetooth | quando disponível | 10 | full-duplex continua funcional |
| Fim de sessão | ativar/desativar repetidamente | 10 | sem microfone preso/crash |

## Próximos passos depois de aprovado

- calibrar threshold local usando telemetria real em vez de valores fixos;
- separar backchannel de interrupção real;
- criar score automatizado por versão do Voice Core;
- só depois avançar para Router/Event Bus/Mission Manager.
