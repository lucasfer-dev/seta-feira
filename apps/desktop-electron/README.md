# SEXTA Desktop 1.3 (Windows)

Cliente Electron da mesma SEXTA cloud. Fica na bandeja, inicia o PC Agent e também faz o **espelho local do Knowledge Vault** para uma pasta normal de Markdown que pode ser aberta pelo Obsidian.

## Desenvolvimento

1. Deixe o Core em `http://localhost:3000` ou defina `SEXTA_WEB_URL`.
2. Rode `npm install` e `npm run dev` nesta pasta.
3. Abra **Memória → Escolher pasta do Vault** e selecione/crie o diretório que será aberto pelo Obsidian.

O sync é bidirecional: alterações `.md` feitas no Obsidian sobem para o Vault cloud; versões cloud mais recentes descem para a pasta local. `.obsidian`, `.trash` e `.git` são ignorados.

Para distribuição `.exe`, ainda é necessário adicionar empacotamento/assinatura e o ícone final.
