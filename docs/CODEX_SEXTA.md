# Integração Codex da SEXTA

A SEXTA delega tarefas de programação ao Codex CLI instalado e autenticado no agente Windows. O celular não executa o Codex localmente: ele envia a tarefa ao agente Windows conectado.

Segurança: somente projetos configurados na allowlist local do agente podem ser usados. A execução usa sandbox do Codex e não usa `OPENAI_API_KEY` da SEXTA.
