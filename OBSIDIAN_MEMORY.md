# SEXTA 1.3 — Memória Obsidian

A memória de longo prazo da SEXTA agora tem duas camadas:

- **Supabase**: conversa, dispositivos, eventos, notificações e estado em tempo real.
- **Knowledge Vault**: notas Markdown legíveis por pessoas, organizadas como um Vault do Obsidian.

## Estrutura inicial

```text
SEXTA Vault/
├── 00 - Início.md
├── pessoas/
│   └── Índice de Pessoas.md
├── projetos/
│   └── Índice de Projetos.md
├── preferencias/
│   └── Preferências.md
├── eventos/
│   └── Eventos.md
├── ideias/
│   └── Ideias.md
├── decisoes/
│   └── Decisões.md
└── memorias/
    └── Memórias.md
```

Quando uma memória permanente é criada, a SEXTA gera uma nota Markdown com frontmatter, origem, importância e link para o índice. A nota também é indexada no Core e pode voltar ao prompt quando for relevante.

## Windows

No `SEXTA Desktop`:

1. Abra **Memória**.
2. Clique em **Escolher pasta do Vault**.
3. Selecione/crie uma pasta que você também abrirá como Vault no Obsidian.
4. Clique em **Sincronizar agora**.
5. **Abrir no Obsidian** usa `obsidian://` para abrir a mesma pasta.

O Electron lê/grava `.md` recursivamente e ignora `.obsidian`, `.trash` e `.git`.

## Android

O cliente Capacitor inclui `native/VaultBridgePlugin.kt`. Depois de gerar o projeto Android, siga `apps/android-capacitor/VAULT_SYNC_SETUP.md`.

O plugin usa o seletor de diretório do Android (Storage Access Framework). Você escolhe o Vault uma vez e a permissão de leitura/escrita é persistida pelo sistema.

## Sincronização bidirecional

A ordem é proposital:

1. baixa a lista cloud;
2. lê os `.md` locais;
3. envia apenas os arquivos locais diferentes;
4. conflitos mantêm a versão com timestamp cloud mais recente;
5. baixa novamente o estado final;
6. escreve as notas finais no Vault local.

Assim uma edição feita diretamente no Obsidian pode voltar para a SEXTA.

## Privacidade

O Vault pode conter informações pessoais. Não coloque senhas, cookies, chaves de API, `.env` ou credenciais nas notas. Segredos de integração ficam fora do prompt e fora do Markdown.

O ZIP de desenvolvimento desta conversa inclui chaves temporárias em `.env.local` por escolha explícita do proprietário. Troque essas chaves antes de compartilhar o ZIP com terceiros.
