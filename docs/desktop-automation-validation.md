# Automação Windows e navegador: operação e validação

## Mudanças

- `agent/windows-ui.mjs`: EnumWindows substitui a enumeração por processo, preservando múltiplas janelas do mesmo aplicativo. A seleção usa texto literal, sem wildcard PowerShell. Título exato tem prioridade e ambiguidades retornam candidatos; `handle` permite selecionar uma janela específica. Restaura apenas minimizadas e confere o HWND ativo após a ativação. As filas de entrada anexadas são sempre desanexadas.
- UI Automation registra provedores de controles legados, fornece árvore com retângulos e estados, prioriza controles interativos, usa Invoke/Selection/Toggle/Legacy antes de clique no retângulo atual com teste de oclusão. Preenchimento prefere ValuePattern, verifica leitura posterior e bloqueia senhas. O fallback literal não interpreta texto como atalhos e bloqueia caracteres de controle. Clique, rolagem e atalhos exigem observação posterior diferente.
- `agent/browser-agent.mjs`: CDP com alvo fixado por operação e comandos serializados. O snapshot mantém referências aos elementos, com índices exclusivos a cada snapshot, rejeitando elementos desconectados ou alterados. Ações não recalculam uma lista ordinal. Após agir, o snapshot anterior é invalidado. O preenchimento usa setter nativo e eventos de edição, sem Enter ou submissão automática. Histórico usa IDs de entradas CDP; reload verifica mudança do documento. Operações sem evidência retornam falha.
- `agent/agent-v3.mjs` e `lib/pc-desktop-tools.mjs`: falha interna não pode virar `done`/`completed`. Espera do transporte ampliada para acomodar execução e verificação.
- `lib/tool-core.mjs`: limita o planejador à sua declaração de ferramentas e exige evidência no trace antes de anunciar conclusão.

## Navegador dedicado

O Browser Agent usa Chrome/Edge com perfil próprio (`~/.sexta-browser-profile`) e porta CDP local (padrão 9223). Ele não consegue inspecionar abas de um Chrome já aberto sem depuração remota. A seleção para automação e o foco observado são informados separadamente em `browser_tabs`.

O campo `status: loaded` indica carregamento verificado, não código HTTP nem auditoria da aplicação. Abrir uma página não prova que seu backend ou todas as funções estão corretos.

Os índices de elementos devem vir do snapshot mais recente, inclusive do novo snapshot retornado por click/type. Não reutilize índices anteriores. URLs sem protocolo recebem `https://`; outros protocolos e credenciais embutidas são bloqueados.

## Testes executáveis

```powershell
node --test tests/*.test.mjs
node --test tests/windows-ui.test.mjs
$env:SEXTA_TEST_BROWSER = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
node --test tests/browser-agent.test.mjs
```

O teste Windows abre uma aplicação Windows Forms real e chama os módulos de produção. O teste CDP abre um navegador real e um servidor HTTP local. Nenhum deles simula resposta do sistema operacional ou substitui as funções por mocks. Em plataformas sem Windows o teste nativo aparece como SKIP; sem `SEXTA_TEST_BROWSER`, o teste do navegador também aparece como SKIP. Os passos dedicados dos smokes exigem essas integrações.

## Validação no PC do usuário

Após atualizar o código do Web Core e o Agent local (um Electron já instalado mantém sua cópia embarcada até ser atualizado):

1. Inicie a SEXTA e confirme Agent online, permissões locais de UI/browser e modo de autonomia apropriado.
2. Abra duas janelas do VS Code com títulos semelhantes. Peça para listar janelas e focar uma pelo título distintivo. Para título ambíguo, escolha o handle retornado. Confirme `verified: true` e HWND correspondente em `after`.
3. Minimize o VS Code e repita o foco; maximize e repita. Confirme restauração da minimizada e preservação da maximizada.
4. Com uma aplicação simples ativa, leia a árvore, clique em um controle identificado, preencha um editor com “Lucas” e confira `after`. Teste rolagem onde exista ScrollPattern e um atalho permitido com efeito observável.
5. Peça “abre github.com”, “vê quais abas estão abertas”, “preenche essa busca com React”, “volta”, “avança” e “atualiza”. Confira os resultados estruturados. Login, quando necessário, permanece manual.
6. Execute “abre o GitHub e entra no Envista” com o repositório realmente disponível na página. A análise de erros depende do conteúdo que a ferramenta consegue observar, não é uma auditoria automática de código.

## Limites reais

- Windows pode recusar foco mesmo com as APIs corretas, especialmente em outra sessão, desktop seguro ou diferença de privilégios. O resultado deve ser falha, nunca sucesso inventado. Não há promessa de contornar UAC ou desktop seguro.
- Aplicações precisam expor UI Automation. Interfaces desenhadas em canvas, árvores truncadas e provedores incompletos podem não apresentar evidência verificável.
- Snapshot DOM cobre o documento principal; iframes e shadow roots fechados não estão cobertos. Não há fallback automático para coordenadas no navegador.
- Um clique sem mudança observável é `failed/unverified`, ainda que tenha sido despachado. Isso evita inventar sucesso, mas pode exigir observação mais específica em algumas aplicações.
- Uma mudança observada confirma o efeito local, não garante por si só o objetivo semântico completo de um pedido aberto. O fluxo de voz, autenticação real e ambiente do usuário precisam de validação local.
- Nenhum módulo de voz, Android, Vault, Supabase, Google, WhatsApp ou Habitat foi reescrito.

Referências: [SetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow), [provedores UIA](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-overview), [CDP Page](https://chromedevtools.github.io/devtools-protocol/tot/Page/).
