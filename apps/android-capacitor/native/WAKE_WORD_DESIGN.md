# Wake word nativo

`Sexta-feira` deve ser detectada no aparelho antes de enviar qualquer conteúdo ao Core. O detector roda no foreground service Android e apenas abre a captura/transcrição após a ativação. Assim, ficar aguardando a palavra não consome tokens Gemini.

A implementação final será um plugin Capacitor/Kotlin que expõe ao frontend eventos `wakeWordDetected`, `listeningStarted`, `listeningStopped` e comandos para iniciar/parar o serviço.
