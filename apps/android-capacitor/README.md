# SEXTA Android 1.3

Cliente Android nativo via Capacitor. Usa a mesma interface/Core cloud da SEXTA.

## O que fica nativo
- push FCM;
- microfone e áudio;
- foreground service;
- wake word `Sexta-feira` (plugin Kotlin dedicado);
- Bluetooth/fone;
- notificações do Android;
- espelho local do Knowledge Vault para Obsidian Mobile via Storage Access Framework.

## Gerar o projeto Android
Com Node + Android Studio/SDK instalados:
`npm install`
`npx cap add android`
`npx cap sync android`
`npx cap open android`

Use `SEXTA_WEB_URL=https://...` apontando para o Core hospedado. Durante emulador, o padrão é `http://10.0.2.2:3000`.

## Memória Obsidian

Veja `VAULT_SYNC_SETUP.md`. O Vault cloud é do Supabase; o plugin nativo espelha as notas Markdown para uma pasta escolhida pelo usuário, que pode ser aberta também pelo Obsidian Mobile.
