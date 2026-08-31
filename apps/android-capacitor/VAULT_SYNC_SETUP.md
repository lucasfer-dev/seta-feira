# Vault Obsidian no Android

A SEXTA 1.3 usa um plugin nativo para deixar o usuário escolher a mesma pasta que o Obsidian Mobile usa como Vault.

## Depois de gerar o Android

1. Rode `npm install` e `npx cap add android`.
2. Copie `native/VaultBridgePlugin.kt` para `android/app/src/main/java/com/sexta/assistant/VaultBridgePlugin.kt`.
3. Em `android/app/build.gradle`, adicione a dependência AndroidX DocumentFile:

```gradle
implementation "androidx.documentfile:documentfile:1.1.0"
```

4. Registre o plugin no `MainActivity.kt` antes de `super.onCreate`/na inicialização conforme a estrutura gerada pelo Capacitor 8:

```kotlin
registerPlugin(VaultBridgePlugin::class.java)
```

5. Rode `npx cap sync android` e abra no Android Studio.

## Como funciona

- `ACTION_OPEN_DOCUMENT_TREE` abre o seletor de pasta do Android.
- A SEXTA pede permissão persistente de leitura/escrita somente para a árvore escolhida.
- `readNotes()` lê os `.md` recursivamente, ignorando `.obsidian`, `.trash` e `.git`.
- `writeNotes()` baixa as notas cloud para a mesma pasta.
- O Obsidian Mobile abre o mesmo Vault; alterações feitas nele voltam para a nuvem na próxima sincronização da SEXTA.

Não é necessário Obsidian Sync para o mecanismo da SEXTA: o Supabase é a camada de sincronização cloud.
