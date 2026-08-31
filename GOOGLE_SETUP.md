# SEXTA 1.1 — Google Workspace

A build já contém o fluxo OAuth e as ferramentas. Para conectar sua conta Google, falta criar um OAuth Client no projeto Google Cloud usado pelo Gemini.

Projeto atual informado: `971977513875`.

## 1. Ative as APIs no Google Cloud

Ative estas APIs no projeto:

- Gmail API
- Google Calendar API
- Google Drive API
- People API
- Google Docs API
- Google Sheets API
- Google Tasks API

## 2. Configure a tela de consentimento OAuth

No Google Auth Platform / OAuth consent screen:

- Use seu próprio projeto de desenvolvimento.
- Enquanto estiver testando, mantenha o app como **Testing**.
- Adicione a sua conta Google em **Test users**.
- O app solicita acesso amplo porque a SEXTA deve operar Gmail, Agenda, Drive, Contatos, Docs, Sheets e Tasks por voz.

## 3. Crie um OAuth Client

Crie uma credencial OAuth 2.0 do tipo **Web application**.

Nome sugerido: `SEXTA Local`.

Redirect URI local:

`http://localhost:3000/api/google/callback`

Depois, para Vercel, crie outro redirect URI com o domínio HTTPS da SEXTA:

`https://SEU-DOMINIO.vercel.app/api/google/callback`

## 4. Coloque as credenciais no `.env.local`

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback
SEXTA_TIMEZONE=America/Sao_Paulo
```

Não coloque Client Secret no frontend.

## 5. Rode a SEXTA

```bash
npm run dev
```

Abra `http://localhost:3000`, vá em **Integrações > Google Workspace > Conectar Google** e autorize sua conta.

O refresh token do Google é salvo localmente em `.sexta-google-token.enc`, criptografado com `SEXTA_SERVER_SECRET`. Esse arquivo está no `.gitignore`.

## Comandos já prontos

- `Sexta-feira, o que eu tenho amanhã na agenda?`
- `Sexta-feira, adiciona na minha agenda dia 31 de agosto aniversário da minha namorada.`
- `Sexta-feira, tem email não lido?`
- `Sexta-feira, manda um email para Gabriel dizendo amanhã eu confirmo.`
- `Sexta-feira, procura no meu Drive apostila Windows.`
- `Sexta-feira, qual o telefone do Gabriel?`
- `Sexta-feira, cria um documento chamado Ideias.`
- `Sexta-feira, cria uma planilha chamada Orçamento.`
- `Sexta-feira, cria uma tarefa para revisar o projeto amanhã.`

## ChatGPT handoff

- `Sexta-feira, pergunta pro ChatGPT: ...`
- Copie a resposta no ChatGPT.
- `Sexta-feira, pega a resposta do ChatGPT.`

A SEXTA tenta ler o clipboard do navegador. Se isso for bloqueado pelo navegador, ela usa o Agent Windows quando ele estiver online.
