# Plataforma SaaS de Estudos e Mentoria
## Primeiro Tenant: Mentoria Coelho

> Documento-base de arquitetura funcional, técnica e de produto.
> Objetivo: orientar a implementação no VS Code e no Supabase de uma plataforma SaaS multi-tenant para estudos, mentoria, acompanhamento, gamificação, engajamento, desempenho acadêmico e gestão financeira.

---

# 1. Visão do Produto

O projeto começou como um sistema desenvolvido para o cliente **Mentoria Coelho**, porém a arquitetura será construída desde o início como uma **plataforma SaaS multi-tenant**.

A Mentoria Coelho será o **primeiro tenant/cliente da plataforma**.

A mesma base deverá permitir, no futuro:

- vender o sistema para outras mentorias;
- atender cursos preparatórios;
- atender escolas e plataformas de estudo;
- criar ambientes white label;
- permitir identidade visual própria por cliente;
- permitir regras específicas por cliente;
- permitir múltiplos mentores e organizações;
- permitir planos comerciais diferentes;
- ativar ou desativar recursos por plano;
- manter isolamento completo dos dados entre clientes.

A arquitetura deve evitar qualquer dependência estrutural específica da Mentoria Coelho.

---

# 2. Princípio Central da Arquitetura

```text
PLATAFORMA SaaS
        ↓
TENANT / CLIENTE
        ↓
ORGANIZAÇÕES / TURMAS
        ↓
MENTORES
        ↓
ALUNOS
```

Exemplo:

```text
Plataforma SaaS
├── Tenant 001 — Mentoria Coelho
│   ├── Organização OAB 2027
│   ├── Organização Concurso Fiscal
│   └── Organização Revisão Intensiva
├── Tenant 002 — Preparatório Alfa
└── Tenant 003 — Mentoria Jurídica Silva
```

---

# 3. Perfis e Papéis

Perfis principais:

```text
SUPER_ADMIN
TENANT_ADMIN
MENTOR
STUDENT
```

## 3.1 SUPER_ADMIN

Responsável pelo SaaS como um todo.

Pode:

- visualizar e gerenciar todos os tenants;
- criar, bloquear ou liberar tenants;
- configurar planos e features;
- acompanhar uso da plataforma;
- gerenciar assinatura dos tenants;
- configurar regras globais;
- acessar logs e auditoria;
- prestar suporte;
- intervir em qualquer tenant quando necessário.

## 3.2 TENANT_ADMIN

Administrador de um cliente específico.

Pode:

- gerenciar usuários do tenant;
- cadastrar mentores e alunos;
- criar organizações e turmas;
- configurar regras;
- configurar XP;
- configurar níveis e brasões;
- configurar missões e conquistas;
- configurar notificações;
- configurar ranking;
- configurar conteúdos;
- configurar identidade;
- gerenciar financeiro interno;
- acompanhar desempenho global do tenant.

## 3.3 MENTOR

O mentor também pode configurar regras, respeitando o escopo das suas organizações/turmas.

Pode:

- acompanhar suas organizações;
- acompanhar suas turmas;
- acompanhar seus alunos;
- criar e ajustar regras para suas organizações;
- configurar XP;
- configurar metas;
- configurar missões;
- configurar conquistas;
- configurar notificações;
- configurar parâmetros de acompanhamento;
- criar tarefas, hábitos e eventos;
- acompanhar provas e desempenho;
- visualizar ranking;
- visualizar streaks;
- visualizar conquistas;
- enviar mensagens de incentivo;
- acompanhar financeiro relacionado aos próprios alunos, quando permitido.

## 3.4 STUDENT

Pode:

- acessar o próprio perfil;
- visualizar seu plano;
- acompanhar sua organização;
- concluir tarefas;
- concluir hábitos;
- participar de eventos;
- registrar provas;
- visualizar desempenho;
- acompanhar XP;
- acompanhar nível;
- acompanhar brasões;
- acompanhar streak;
- acompanhar conquistas;
- acompanhar missões;
- acompanhar ranking;
- receber notificações;
- acompanhar evolução pessoal.

---

# 4. Multi-Tenant

Entidade central:

```text
tenants
```

## 4.1 Tabela `tenants`

```text
id
name
slug
status
plan_id
created_at
updated_at
```

Quase todas as tabelas de negócio deverão possuir:

```text
tenant_id
```

quando os dados pertencerem a um cliente específico.

---

# 5. Associação de Usuários ao Tenant

Evitar depender apenas de:

```text
profiles.role
```

Criar:

```text
tenant_members
```

## 5.1 Tabela `tenant_members`

```text
id
tenant_id
user_id
role
status
joined_at
created_at
updated_at
```

Isso permite que um mesmo usuário possua papéis diferentes em tenants diferentes.

---

# 6. Autenticação e Perfil

O Supabase Auth será responsável pela autenticação.

```text
auth.users
    ↓
profiles
```

## 6.1 Tabela `profiles`

```text
id uuid → auth.users.id
full_name
email
phone
avatar_url
birth_date
status
created_at
updated_at
```

Papéis e permissões devem ser resolvidos principalmente por `tenant_members`.

---

# 7. Login

## 7.1 Visualização da senha

Funcionalidade de frontend.

Alternar entre:

```html
type="password"
```

e:

```html
type="text"
```

Nenhuma alteração no Supabase é necessária.

---

# 8. White Label

Cada tenant poderá possuir identidade própria.

Criar:

```text
tenant_settings
```

## 8.1 Tabela `tenant_settings`

```text
id
tenant_id
platform_name
logo_url
favicon_url
primary_color
secondary_color
accent_color
support_email
support_phone
custom_domain
ranking_enabled
gamification_enabled
financial_enabled
push_enabled
created_at
updated_at
```

---

# 9. Planos do SaaS

Criar:

```text
plans
plan_features
tenant_subscriptions
tenant_features
```

Exemplos:

```text
Starter
Professional
Enterprise / White Label
```

Possíveis limites:

```text
número de alunos
número de mentores
número de organizações
storage
push notifications
analytics
white label
custom domain
```

---

# 10. Feature Flags

Criar:

```text
plan_features
tenant_features
```

Exemplos:

```text
gamification
ranking
push_notifications
financial
advanced_analytics
white_label
custom_domain
missions
achievements
```

Fluxo:

```text
tenant possui feature?
        ↓
sim → exibir
não → ocultar/bloquear
```

---

# 11. Organizações de Estudo

Criar:

```text
organizations
organization_members
```

## 11.1 `organizations`

```text
id
tenant_id
name
description
logo_url
status
start_date
end_date
created_at
updated_at
```

## 11.2 `organization_members`

```text
id
tenant_id
organization_id
user_id
member_role
status
joined_at
created_at
updated_at
```

---

# 12. Hierarquia de Configuração

As regras devem permitir herança:

```text
GLOBAL
↓
TENANT
↓
ORGANIZAÇÃO
```

Exemplo:

```text
Global:
Concluir tarefa = 10 XP

Tenant Mentoria Coelho:
Concluir tarefa = 15 XP

Organização OAB Intensiva:
Concluir tarefa = 20 XP
```

Prioridade:

```text
Regra da organização
↓
se não existir
Regra do tenant
↓
se não existir
Regra global
```

---

# 13. Admin e Mentor Configuram Regras

```text
SUPER_ADMIN
→ regras globais

TENANT_ADMIN
→ regras do tenant e das organizações

MENTOR
→ regras das próprias organizações/turmas
```

As alterações devem respeitar RLS e escopo de permissão.

---

# 14. Planejamento de Estudos

Criar:

```text
study_plans
study_plan_items
```

## 14.1 `study_plans`

```text
id
tenant_id
organization_id
student_id
mentor_id
name
cycle_id
start_date
end_date
status
created_at
updated_at
```

## 14.2 `study_plan_items`

```text
id
tenant_id
study_plan_id
type
title
description
subject_id
scheduled_date
completed_at
status
xp_reward
created_at
updated_at
```

Tipos:

```text
task
habit
event
study
review
exercise
exam
```

---

# 15. Ciclos e Disciplinas

Criar:

```text
cycles
subjects
cycle_subjects
```

## 15.1 `cycles`

```text
id
tenant_id
organization_id
name
description
start_date
end_date
status
created_at
updated_at
```

## 15.2 `subjects`

```text
id
tenant_id
name
description
status
created_at
updated_at
```

---

# 16. Desempenho em Provas

Criar:

```text
exam_results
```

Campos:

```text
id
tenant_id
student_id
organization_id
cycle_id
exam_name
exam_date
total_questions
answered_questions
correct_answers
wrong_answers
blank_answers
score
max_score
percentage
accuracy_percentage
duration_minutes
notes
created_at
updated_at
```

Cálculos:

```text
accuracy_percentage =
correct_answers / answered_questions * 100

percentage =
score / max_score * 100
```

---

# 17. Hábitos

Criar:

```text
habits
habit_completions
```

## 17.1 `habits`

```text
id
tenant_id
organization_id
created_by
title
description
frequency
xp_reward
active
created_at
updated_at
```

## 17.2 `habit_completions`

```text
id
tenant_id
habit_id
user_id
completed_at
created_at
```

---

# 18. Tarefas

Criar:

```text
tasks
task_completions
```

## 18.1 `tasks`

```text
id
tenant_id
organization_id
student_id
mentor_id
title
description
due_date
status
xp_reward
created_at
updated_at
```

## 18.2 `task_completions`

```text
id
tenant_id
task_id
user_id
completed_at
created_at
```

---

# 19. Eventos

Criar:

```text
events
event_participations
```

---

# 20. Motor de Gamificação

Criar:

```text
xp_rules
xp_transactions
levels
achievements
achievement_rules
user_achievements
missions
mission_rules
mission_progress
streak_rules
streaks
personal_records
celebration_events
motivational_messages
ranking_rules
```

---

# 21. XP

Não utilizar somente um campo acumulado no perfil.

Criar:

```text
xp_transactions
```

## 21.1 `xp_transactions`

```text
id
tenant_id
organization_id
user_id
source_type
source_id
xp_amount
description
created_at
```

XP acumulado:

```text
SUM(xp_transactions.xp_amount)
```

---

# 22. Regras de XP

Criar:

```text
xp_rules
```

Campos:

```text
id
tenant_id nullable
organization_id nullable
created_by
action_type
name
description
xp_amount
daily_limit
weekly_limit
active
created_at
updated_at
```

---

# 23. Níveis

Criar:

```text
levels
```

Campos:

```text
id
tenant_id nullable
organization_id nullable
level_number
name
description
min_xp
max_xp
badge_url
active
created_at
updated_at
```

Exemplo:

```text
Nível 1 — Iniciante
Nível 2 — Aprendiz
Nível 3 — Persistente
Nível 4 — Estrategista
Nível 5 — Especialista
Nível 6 — Mestre
```

---

# 24. Brasões

Cada nível pode possuir um brasão.

Arquivos no Supabase Storage.

```text
level-badges/
tenant-id/
level-04.png
```

---

# 25. Conquistas

Criar:

```text
achievements
achievement_rules
user_achievements
```

Exemplos:

```text
7 dias seguidos
100 questões
500 questões
Primeiro simulado
90% de aproveitamento
30 horas de estudo
Top 3 semanal
```

---

# 26. Missões

Criar:

```text
missions
mission_rules
mission_progress
```

Exemplos:

```text
Concluir 5 hábitos
Resolver 150 questões
Estudar 4 dias na semana
Realizar 2 simulados
Cumprir 100% das tarefas
```

---

# 27. Streaks

Criar:

```text
streak_rules
streaks
```

Acompanhar:

```text
sequência atual
maior sequência
última atividade válida
```

---

# 28. Recordes Pessoais

Criar:

```text
personal_records
```

Exemplos:

```text
melhor nota
maior taxa de acerto
maior quantidade de questões
maior sequência
maior tempo de estudo
```

---

# 29. Ranking

Ranking prioritariamente dentro da organização.

Filtros:

```text
Hoje
Semana
Mês
Ciclo
Geral
```

Tipos:

```text
Mais XP
Maior evolução
Maior consistência
Mais hábitos concluídos
Mais questões
```

---

# 30. Celebrações

Criar:

```text
celebration_events
```

Tipos:

```text
LEVEL_UP
ACHIEVEMENT_UNLOCKED
MISSION_COMPLETED
STREAK_REACHED
PERSONAL_BEST
RANK_UP
GOAL_COMPLETED
```

O backend gera o evento.

O frontend decide como exibir:

```text
toast
modal
confete
animação
badge
```

---

# 31. Notificações Internas

Criar:

```text
notifications
```

Campos:

```text
id
tenant_id
user_id
title
message
type
action_url
read_at
created_at
```

---

# 32. Push Externo

Arquitetura:

```text
Evento
↓
notifications
↓
Database Webhook
↓
Supabase Edge Function
↓
Provedor Push
↓
Dispositivo
```

Criar:

```text
push_devices
```

---

# 33. Plataforma do Mentor

Dashboard sugerido:

```text
Alunos ativos
Turmas
Média de progresso
Alunos em risco
Questões realizadas
Taxa de acerto
Horas estudadas
Tarefas concluídas
XP da turma
Streak médio
Conquistas desbloqueadas
```

---

# 34. Insights para o Mentor

Criar futuramente:

```text
student_alerts
student_insights
mentor_messages
```

Exemplos:

```text
4 dias sem atividade
queda de desempenho
sequência interrompida
baixa conclusão
melhora significativa
novo recorde
subiu no ranking
```

---

# 35. Perfil do Aluno para o Mentor

Exibir:

```text
Visão geral
Organização
Agenda
Hábitos
Questões
Provas
Desempenho
XP
Nível
Conquistas
Missões
Streak
Histórico
Observações
```

---

# 36. Analytics

Criar:

```text
daily_user_metrics
weekly_user_metrics
study_sessions
```

## 36.1 `daily_user_metrics`

```text
tenant_id
user_id
date
study_minutes
questions_answered
correct_answers
tasks_completed
habits_completed
xp_earned
```

---

# 37. Financeiro da Mentoria

Separar do financeiro do SaaS.

Criar:

```text
student_subscriptions
student_payments
```

Representa:

```text
Mentoria ↔ Aluno
```

---

# 38. Financeiro do SaaS

Criar:

```text
plans
tenant_subscriptions
tenant_invoices
```

Representa:

```text
Plataforma SaaS ↔ Tenant
```

---

# 39. Uploads e Storage

Buckets sugeridos:

```text
avatars
tenant-assets
level-badges
achievement-badges
materials
organization-files
exam-files
```

Sempre considerar `tenant_id`.

---

# 40. Segurança e RLS

A autorização deve ser garantida no banco.

Nunca depender somente de:

```javascript
if (user.role === "mentor")
```

RLS:

```text
SUPER_ADMIN
→ acesso global

TENANT_ADMIN
→ acesso ao próprio tenant

MENTOR
→ acesso às próprias organizações/turmas

STUDENT
→ acesso aos próprios dados e dados permitidos da organização
```

---

# 41. Auditoria

Criar:

```text
audit_logs
```

Registrar:

```text
tenant_id
user_id
action
entity_type
entity_id
old_value
new_value
created_at
```

Especialmente para:

```text
XP
níveis
regras
missões
conquistas
financeiro
permissões
```

---

# 42. Templates de Jornada

Criar futuramente:

```text
journey_templates
journey_template_items
```

Exemplos:

```text
OAB Intensiva
Concurso 90 Dias
Vestibular
Revisão Final
```

Um template poderá conter:

```text
ciclos
hábitos
missões
XP
níveis
metas
conquistas
```

---

# 43. Experiência Motivacional

O sistema deve ser construído em quatro camadas:

```text
ORGANIZAÇÃO
O que preciso fazer?

EXECUÇÃO
O que estou fazendo agora?

PROGRESSO
Quanto evoluí?

RECOMPENSA
O que conquistei?
```

O aluno deve sentir:

```text
progresso
evolução
recompensa
reconhecimento
conquista
```

---

# 44. Dashboard do Aluno

Exemplo conceitual:

```text
Bom dia 👋

Meta de hoje
████████████░░░░ 72%

3 de 5 tarefas concluídas

🔥 Sequência: 8 dias
⭐ 2.950 XP
🏅 Nível 4 — Estrategista

Próxima conquista
Resolver 500 questões
437 / 500

Ranking da turma
#3
↑ subiu 1 posição
```

---

# 45. Ajustes Identificados

- [ ] Adicionar visualização da senha no login
- [ ] Corrigir página do perfil
- [ ] Corrigir barra de progresso responsiva
- [ ] Implementar multi-tenant
- [ ] Criar tenants
- [ ] Criar tenant_members
- [ ] Criar tenant_settings
- [ ] Criar organizações
- [ ] Criar vínculos de usuários
- [ ] Criar planejamento de estudos
- [ ] Criar ciclos
- [ ] Criar disciplinas
- [ ] Criar hábitos
- [ ] Criar tarefas
- [ ] Criar eventos
- [ ] Criar provas
- [ ] Criar desempenho
- [ ] Criar XP
- [ ] Criar níveis
- [ ] Criar brasões
- [ ] Criar conquistas
- [ ] Criar missões
- [ ] Criar streaks
- [ ] Criar recordes pessoais
- [ ] Criar ranking
- [ ] Criar celebrações
- [ ] Criar notificações
- [ ] Criar push externo
- [ ] Criar plataforma do mentor
- [ ] Criar insights do mentor
- [ ] Criar financeiro da mentoria
- [ ] Criar financeiro SaaS
- [ ] Criar planos
- [ ] Criar feature flags
- [ ] Criar white label
- [ ] Implementar RLS
- [ ] Criar auditoria
- [ ] Criar analytics agregados

---

# 46. Ordem Recomendada de Implementação

## Fase 1 — Fundação SaaS

- Supabase Auth
- profiles
- tenants
- tenant_members
- tenant_settings
- roles
- enums
- triggers
- RLS
- audit_logs
- migrations

## Fase 2 — Organizações

- organizations
- organization_members
- mentor ↔ aluno
- permissões

## Fase 3 — White Label e Features

- identidade do tenant
- feature flags
- planos
- limites

## Fase 4 — Estrutura Acadêmica

- ciclos
- disciplinas
- planos de estudo
- hábitos
- tarefas
- eventos

## Fase 5 — Provas e Desempenho

- cadastro de prova
- questões
- acertos
- erros
- notas
- aproveitamento
- histórico
- analytics

## Fase 6 — Gamificação

- XP
- níveis
- brasões
- conquistas
- missões
- streaks
- recordes
- ranking
- celebrações

## Fase 7 — Mentor

- dashboard
- turmas
- alunos
- insights
- alertas
- acompanhamento

## Fase 8 — Comunicação

- notificações
- realtime
- toasts
- push
- mensagens do mentor

## Fase 9 — Financeiro

- financeiro da mentoria
- financeiro SaaS
- planos
- assinaturas
- pagamentos
- inadimplência

## Fase 10 — Refinamento

- responsividade
- performance
- testes RLS
- testes de integração
- logs
- analytics
- UX
- acessibilidade

---

# 47. Estrutura Inicial de Tabelas

```text
AUTH
auth.users

CORE SaaS
profiles
tenants
tenant_members
tenant_settings

PLANOS SaaS
plans
plan_features
tenant_subscriptions
tenant_invoices
tenant_features

ORGANIZAÇÕES
organizations
organization_members

ESTUDO
cycles
subjects
cycle_subjects
study_plans
study_plan_items
study_sessions

HÁBITOS
habits
habit_completions

TAREFAS
tasks
task_completions

EVENTOS
events
event_participations

PROVAS
exam_results

GAMIFICAÇÃO
xp_rules
xp_transactions
levels
achievements
achievement_rules
user_achievements
missions
mission_rules
mission_progress
streak_rules
streaks
personal_records
ranking_rules
celebration_events
motivational_messages

COMUNICAÇÃO
notifications
push_devices
mentor_messages

MENTOR
student_alerts
student_insights

ANALYTICS
daily_user_metrics
weekly_user_metrics

FINANCEIRO DA MENTORIA
student_subscriptions
student_payments

CONTEÚDO
materials

TEMPLATES
journey_templates
journey_template_items

SISTEMA
system_settings
audit_logs
```

---

# 48. Diretriz Técnica

Todas as mudanças estruturais devem preferencialmente ser realizadas por migrations SQL versionadas.

Estrutura sugerida:

```text
supabase/
└── migrations/
    ├── 001_core_saas.sql
    ├── 002_profiles_and_members.sql
    ├── 003_rls_foundation.sql
    ├── 004_organizations.sql
    ├── 005_tenant_settings.sql
    ├── 006_plans_and_features.sql
    ├── 007_study_structure.sql
    ├── 008_exam_results.sql
    ├── 009_gamification.sql
    ├── 010_notifications.sql
    ├── 011_mentor_analytics.sql
    ├── 012_student_financial.sql
    └── 013_saas_financial.sql
```

Evitar criar estrutura definitiva apenas pelo Table Editor.

---

# 49. Regras Importantes para Implementação

1. Nunca misturar dados entre tenants.
2. Toda query sensível deve considerar `tenant_id`.
3. RLS deve proteger o banco mesmo que o frontend seja manipulado.
4. Regras de gamificação não devem ficar fixas no frontend.
5. Admin e Mentor podem configurar regras dentro dos seus respectivos escopos.
6. XP deve possuir histórico em `xp_transactions`.
7. Financeiro da mentoria e financeiro SaaS são domínios diferentes.
8. White label deve ser configuração, não fork de código.
9. Recursos comerciais devem usar feature flags.
10. A Mentoria Coelho deve ser tratada como primeiro tenant real da plataforma.

---

# 50. Próximo Passo Técnico

Antes de implementar ranking, gamificação ou financeiro, criar a fundação multi-tenant.

Primeira entrega técnica recomendada:

```text
01. enums e tipos
02. profiles
03. tenants
04. tenant_members
05. tenant_settings
06. organizations
07. organization_members
08. funções auxiliares de autorização
09. triggers
10. índices
11. constraints
12. RLS
13. policies
14. audit_logs
15. buckets iniciais de Storage
```

---

# 51. Objetivo da Primeira Migration

Produzir migrations seguras e idempotentes para a base SaaS contendo:

- enums;
- tenants;
- profiles;
- tenant_members;
- tenant_settings;
- organizations;
- organization_members;
- índices;
- constraints;
- funções auxiliares;
- triggers;
- políticas RLS;
- auditoria;
- preparação para Storage.

Após essa etapa, conectar progressivamente a UX já existente da Mentoria Coelho ao Supabase.

---

# 52. Status Conceitual do Projeto

```text
Produto:
Plataforma SaaS de Estudos e Mentoria

Primeiro cliente:
Mentoria Coelho

Modelo:
Multi-tenant

Possibilidade futura:
White Label

Perfis:
SUPER_ADMIN
TENANT_ADMIN
MENTOR
STUDENT

Foco:
Organização
Acompanhamento
Gamificação
Engajamento
Desempenho
Conquistas
Mentoria
Financeiro
```

Este documento deve ser utilizado como **fonte de verdade inicial para a implementação técnica**.
