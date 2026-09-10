# SEXTA PC Control v2

Objetivo: permitir que a SEXTA opere programas Windows a pedido do usuário, com automação estrutural primeiro e visão/coordenadas apenas como fallback.

## Ações normais sem confirmação extra

- abrir aplicativo permitido pelo resolvedor local;
- listar janelas;
- focar/restaurar janela;
- minimizar, maximizar e restaurar;
- mover e redimensionar;
- fechar uma janela de aplicativo quando o usuário pedir;
- observar UI Automation;
- clicar/selecionar controles não sensíveis;
- preencher campos não sensíveis;
- usar atalhos seguros;
- navegar no Browser Agent por DOM/CDP.

## Ações que exigem confirmação explícita no turno atual

- controles finais de envio/publicação;
- excluir/remover conteúdo ou arquivos;
- pagamentos, compras e transferências;
- instalar/desinstalar;
- substituir/sobrescrever dados relevantes;
- qualquer ação irreversível ou com efeito externo relevante.

## Sempre bloqueado na automação genérica

- ler senha, PIN, código 2FA ou segredo;
- preencher automaticamente senha/PIN/2FA em ferramenta genérica;
- expor shell genérico arbitrário ao modelo.

## Estratégia técnica

1. Janela: Win32 HWND (`EnumWindows`, `ShowWindowAsync`, `SetForegroundWindow`, `SetWindowPos`, `WM_CLOSE`) com verificação do estado real.
2. Controles: Microsoft UI Automation com padrões semânticos (`Invoke`, `SelectionItem`, `Toggle`, `ExpandCollapse`, `Value`, `Scroll`, `Window`, `Transform`).
3. Teclado/mouse: somente como fallback quando o provider não expõe um padrão adequado e quando a ação não é sensível.
4. Browser: CDP/DOM continua sendo o caminho primário para Chrome/Edge dedicados.
5. Toda ação deve seguir Observe -> Act -> Verify e nunca considerar "comando enviado" como sucesso.
