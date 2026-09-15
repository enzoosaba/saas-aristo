# Execução e evidências

## Escopo entregue
Núcleo de organização da Mentoria Coelho, preservando as cinco rotas e a identidade visual. A implementação parte da base existente; não recria o projeto do zero. Contas, sessões, persistência, histórico por data, CRUD com arquivamento, planejamento e indicadores reais estão integrados. Mentor, aulas, questões e simulados completos não foram implementados nesta etapa.

## Fases
O plano detalhado está em PLANO-PRODUCAO.md. As fases 1–10 foram implementadas para o núcleo de organização; na fase 8, busca e tratamento explícito de rede substituem offline de escrita/upload, que não fazem parte deste núcleo. Na fase 10, apenas configurações do aluno; a área do mentor foi adicionada depois, em /mentoria, restrita a contas com papel de mentor. As fases 11–13 foram verificadas localmente. CI/Docker da fase 14 estão configurados, mas não executados externamente. Documentação da fase 15 entregue. Fases 16–17 pendentes: não há host, remoto Git, CLI Docker/Vercel ou credenciais de publicação neste ambiente.

Os commits foram realizados por entregas coerentes, agrupando algumas fases; os testes de navegador foram executados de forma integrada depois de conectar frontend e API. Não foram fabricados hashes nem simulados resultados para fases intermediárias.

## Resultados reais
- npm run verify: ESLint e TypeScript aprovados; 5 testes de domínio aprovados.
- npm run build: build standalone concluído, rotas compiladas.
- npm run test:e2e: 16/16 cenários aprovados em banco separado; 0 pageerrors.
- Rotas verificadas: Início, Rotina, Planos, Calendário, Perfil; larguras 320, 390, 768, 1100 e 1440 px, sem overflow horizontal.
- axe: nenhuma violação nos conjuntos WCAG 2 A/AA e 2.1 AA testados, tela de entrada e cinco rotas em temas dark/light, 390 e 1440 px.
- Lighthouse final: 100 desempenho, 100 acessibilidade, 100 boas práticas, 100 SEO. Medição local mobile na página inicial autenticada em http://localhost:3102, build de produção, Chromium/Edge headless e armazenamento preservado. Não representa todas as páginas, tráfego real ou host público.
- Não existe nota final de segurança: não houve pentest. Foram testados origem externa, validação, acesso anônimo, isolamento de conta, conflitos e revogação de sessões.
- npm audit durante a instalação final: 0 vulnerabilidades reportadas; não equivale a auditoria da lógica própria.
- Backup SQLite executado sobre banco de teste; integrity_check retornou ok.

Relatórios locais completos: test-results/functional-report.json, test-results/axe.json e test-results/lighthouse.json. A pasta é ignorada pelo Git para não versionar dados e saídas de testes. O CI está configurado para anexar resultados de E2E como artefato.

## Defeitos identificados e corrigidos durante a execução
- Persistência separada do protótipo substituída por fonte única no servidor.
- Datas de tarefa e realização separadas; registros de hábitos não sobrescrevem outros dias.
- Concorrência de escrita detectada por versão; refresh em segundo plano não sobrescreve mutação em andamento.
- Falha de rede convertida em mensagem útil em português, mantendo o formulário.
- Hierarquia dos títulos, nome acessível da marca e proporção de imagem ajustados após Lighthouse inicial (100/98/96/100).
- Seletores do teste foram ajustados para distinguir alertas do formulário do anunciador de rotas do Next e para respeitar a rota mantida após login.

## Antes do lançamento público
Definir host com disco persistente e HTTPS, integrar recuperação/verificação de e-mail, revisar política CSP, configurar observabilidade e backup externo, executar CI/container e validar a URL real. A arquitetura atual é de instância única; múltiplas réplicas exigem banco e rate limiter compartilhados. Não foi publicada uma URL fictícia.
