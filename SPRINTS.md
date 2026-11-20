# SPRINTS.md — Plataforma de Gestão Integrada Ivamarg

> Plano de execução em 20 dias. Especificação em `CLAUDE.md`.
> Marcar `[x]` ao concluir. Não avançar sem os critérios de aceitação cumpridos.

## Visão geral

| Sprint | Dias | Foco | Marco |
|---|---|---|---|
| S0 | 1–2 | Fundação | Login, permissões, backoffice base; Vendus e Meta iniciados |
| S1 | 3–5 | Comercial | Clientes, pipeline, propostas, aprovações, encomendas |
| S2 | 6–8 | **Produção + Stock** | Fábrica a funcionar de ponta a ponta |
| S3 | 9–10 | Vendus, tarefas, documentos, dashboards | **Entrega intermédia** |
| S4 | 11–13 | Comunicação | Caixa única, templates, automações, SMS |
| S5 | 14–15 | Financeiro e desempenho | Comissões, KPIs, relatórios |
| S6 | 16–17 | Operações + chamadas | Obras, limpeza, furos; chamadas WhatsApp |
| S7 | 18–19 | Qualidade e migração | Testes, dados reais, correcções |
| S8 | 20 | Go-live | Formação e entrada em funcionamento |

## Dependências externas (pedir no Dia 1)

- [ ] API key do Vendus (conta do cliente)
- [ ] Conta Meta Business do cliente + início da verificação
- [ ] Número dedicado para WhatsApp Cloud API
- [ ] Página Facebook e conta Instagram profissional ligadas
- [ ] Credenciais Futurix SMS e SMTP
- [ ] VPS, domínio e DNS
- [ ] Dados para migração: clientes, artigos, stock inicial (até Dia 5)
- [ ] Pelo menos 1 ficha técnica real de uniforme (até Dia 6)

---

## S0 — Fundação (Dias 1–2)

**Infra e projecto**
- [x] Monorepo (`apps/api`, `apps/web`, `packages/shared`), scripts cross-platform
- [x] Fastify com plugins: prisma, redis, auth, rbac, audit, errors, rate-limit
- [x] React + Vite + Tailwind, layout base, router, cliente API, tema
- [x] Prisma schema inicial (acesso, sistema, settings, feature flags, business lines)
- [x] BullMQ configurado (workers base)
- [ ] Deploy inicial na VPS (PM2 + Nginx + HTTPS) — ambiente de staging — ⛔ aguarda VPS/domínio (pronto: `deploy/DEPLOY.md`, `deploy/nginx.conf`, `ecosystem.config.cjs`)

**Acesso**
- [x] Login, refresh token, logout, recuperação de palavra-passe
- [x] Perfis e permissões (seed dos 5 perfis default)
- [x] Gestão de utilizadores com limite configurável (default 6)
- [x] Auditoria (`AuditLog`) e ecrã de consulta

**Backoffice base**
- [x] Settings genéricas, linhas de negócio, feature flags
- [x] Seed: etapas de produção default, tipos de defeito default, estados do funil default

**Integrações**
- [ ] **Validar API Vendus** (emitir documento de teste, criar cliente/produto) e registar limitações no `CLAUDE.md` — ⛔ aguarda API key (script pronto: `npm -w apps/api run vendus:check`)
- [ ] Cliente Cloudinary (upload raw + URL assinado) — ⛔ sem conta; passa para o S3 (gestão documental, onde é usado)
- [ ] Iniciar processos Meta (app, webhooks de verificação) — endpoint de verificação + validação de assinatura feitos; ⛔ app Meta aguarda conta do cliente

**Aceitação:** utilizador entra, vê só o que o perfil permite; acções ficam auditadas; staging acessível por HTTPS; Vendus testado.

---

## S1 — Comercial (Dias 3–5)

**Clientes**
- [x] CRUD de clientes e contactos, tags, linha de negócio, comercial responsável
- [x] Timeline do cliente (estrutura genérica para todos os eventos)
- [x] Detecção de duplicados (NIF, telefone, email)
- [x] Importação Excel/CSV com pré-visualização e relatório de erros

**Pipeline**
- [x] Oportunidades, kanban por linha de negócio, drag & drop
- [x] Estados configuráveis no backoffice; motivo de perda obrigatório
- [x] Carteira por comercial (filtro + regra de permissão)

**Propostas e contratos**
- [x] Propostas com itens ou fases, totais em AOA inteiros
- [x] Versões imutáveis após envio
- [x] PDF da proposta
- [x] Fluxo de aprovação com limite configurável + notificação ao aprovador
- [x] Aceitação → gera Encomenda (uniformes) / Obra / Furo / Contrato recorrente
- [x] Contratos (datas, valor, periodicidade, renovação) — documento anexo entra com a gestão documental (S3)

**Encomendas (base)**
- [x] Encomenda com linhas, grelha de tamanhos, personalização, prazo, prioridade

**Testes:** regras de aprovação; conversão proposta → encomenda.
**Aceitação:** fluxo completo cliente → oportunidade → proposta → aprovação → encomenda.

---

## S2 — Produção + Stock (Dias 6–8) ⭐

**Stock**
- [x] Artigos, unidades, armazéns, níveis (físico/reservado)
- [x] Movimentos IN/OUT/TRANSFER/ADJUSTMENT/RESERVE/RELEASE com origem
- [x] Custo médio ponderado
- [x] Fornecedores e compras (recepção → entrada)
- [x] Inventário com ajuste aprovado
- [x] Alerta de stock mínimo (job)

**Catálogo e fichas técnicas**
- [x] Modelos de uniforme, fotos, preço base
- [x] BOM com consumo por tamanho; tempo padrão por etapa (opcional)

**Backoffice de produção**
- [x] Secções, etapas (ordem, interna/externa), operadores, modelo de pagamento, tipos de defeito

**Ordens de Produção**
- [x] Gerar OP a partir da encomenda
- [x] Cálculo de necessidades de material + lista de faltas + alerta
- [x] Libertar OP → reserva de stock
- [x] Divisão em lotes; QR por lote; etiquetas PDF

**Chão de fábrica**
- [x] Ecrã mobile: login por PIN, leitura de QR pela câmara, iniciar/concluir etapa, quantidades
- [x] Fluxo parcial entre etapas
- [x] Etapas externas (envio/retorno/custo)
- [x] Inspecção de qualidade: defeitos, retrabalho, refugo

**Custos**
- [x] Consumo teórico vs real por OP
- [x] Custo por peça (material + mão-de-obra + externo) e margem por encomenda
- [x] Cálculo de pagamento à peça por operador/período

**Testes:** necessidades de material; reservas e baixas; custo por peça; pagamento à peça.
**Aceitação:** uma encomenda real percorre todas as etapas via QR, consome stock e mostra custo e margem.

---

## S3 — Vendus, tarefas, documentos, dashboards (Dias 9–10)

**Vendus**
- [x] Emitir factura a partir de encomenda/proposta/contrato (fila + retry + log) — testado com API simulada; ⛔ emissão real aguarda API key
- [x] Guardar número, ID e PDF (PDF lido do Vendus a pedido); mostrar na timeline
- [x] Sync de clientes e produtos (`ExternalRef`) — push no momento da emissão
- [ ] Estado de pagamento (conforme capacidade validada no S0) — ⛔ depende da validação da API; registo manual de pagamentos no S5

**Tarefas e agenda**
- [x] Tarefas (responsável, prazo, prioridade, entidade ligada)
- [x] Calendário de eventos
- [x] Lembretes e alertas de atraso (job)

**Gestão documental (básica)**
- [x] Pastas e categorias configuráveis, com permissões por categoria
- [x] Upload (PDF, imagens, Word, Excel; máx. 20 MB) para Cloudinary
- [x] Metadados: título, descrição, tags, data de emissão, data de validade
- [x] Ligação a entidades (cliente, proposta, contrato, encomenda, OP, obra, furo, fornecedor, utilizador) + timeline
- [x] Versões de documento
- [x] Pesquisa e filtros
- [x] Pré-visualização de PDF e imagem; download com URL assinado temporário
- [x] Alertas de validade (30/15/7 dias, configurável) — job diário
- [x] Auditoria de upload, download e eliminação

**Notificações e dashboards**
- [x] Centro de notificações in-app + email
- [x] Dashboard da direcção (produção, qualidade, stock, comercial, margens, documentos a expirar)
- [x] Dashboards comercial e produção

**Aceitação:** factura emitida no Vendus a partir de uma encomenda; documento com validade gera alerta; dashboards com dados reais.

### 🔶 Entrega intermédia (Dia 10) — validação pelo cliente

---

## S4 — Comunicação (Dias 11–13)

- [x] Webhooks Meta (verificação + `X-Hub-Signature-256`) → fila `meta-inbound`
- [x] WhatsApp Cloud API: receber/enviar texto e media — implementado; ⛔ testado em sandbox (aguarda conta Meta)
- [x] Messenger e Instagram: receber/responder — implementado; ⛔ testado em sandbox
- [x] Email: envio e associação à conversa (só envio; recepção por email exigiria IMAP — fora do âmbito actual)
- [x] Caixa de entrada única: lista, filtro por canal/estado/utilizador, atribuição, notas internas
- [x] Match conversa ↔ cliente; criação de lead para contacto novo
- [x] Controlo da janela de 24h; envio fora dela só com template
- [x] Modelos de mensagem com variáveis
- [x] Automações (proposta enviada, encomenda pronta, pagamento em atraso, tarefa a vencer, documento a expirar) — "pagamento em atraso" dispara a partir do S5
- [x] SMS via Futurix — cliente genérico; ⛔ formato da API por validar com credenciais
- [x] Alertas por WhatsApp para a direcção (automação com destinatário "Direcção"; requer template aprovado)
- [x] Tudo atrás de feature flags + modo sandbox (`comms.sandbox`)

**Testes:** janela de 24h; validação de assinatura; match de cliente.
**Aceitação:** mensagem recebida no WhatsApp aparece na ficha do cliente e é respondida pela plataforma (ou simulada em sandbox, se a Meta ainda não aprovou).

---

## S5 — Financeiro e desempenho (Dias 14–15)

- [x] Contas a receber (facturas Vendus + contratos + manuais), pagamentos parciais/totais, anulação, alerta de atraso
- [x] Receitas e despesas por categoria, linha de negócio e centro de custo
- [x] Regras de comissão configuráveis; cálculo por período; aprovação e pagamento
- [x] KPIs configuráveis com metas
- [x] Relatórios: vendas, clientes, produção, stock, desempenho, financeiro
- [x] Exportação PDF e Excel (fila `reports`)

**Testes:** cálculo de comissões (percentagem/fixo; facturado/recebido).
**Aceitação:** direcção vê produtividade por operador e comissões por comercial de um período.

---

## S6 — Operações + chamadas (Dias 16–17)

- [x] Obras: fases, orçado vs real, materiais (stock), equipa, documentos
- [x] Limpeza e jardinagem: contratos recorrentes, planeamento de visitas, execução
- [x] Furos de água: orçamento, etapas de execução, materiais, resultado, documentos
- [x] Chamadas WhatsApp (WebRTC): receber/efectuar, consentimento, registo na timeline — **feature flag desligada** até elegibilidade Meta; testado em sandbox (sinalização e registo; áudio real só com a conta Meta)

**Aceitação:** uma obra consome stock e mostra orçado vs real; chamada testada em ambiente de teste.

---

## S7 — Qualidade e migração (Dias 18–19)

- [x] Testes end-to-end dos fluxos principais (comercial → produção → factura → pagamento) — `apps/api/src/e2e.test.ts`
- [x] Revisão de permissões por perfil — matriz automática dos 5 perfis vs §7 (corrigido `viewAll` em falta nos perfis Financeiro e Produção/Stock)
- [x] Revisão de responsividade (chão de fábrica no telemóvel)
- [x] Performance das listagens e dashboards — 4–7 ms nas listagens e 56 ms no dashboard com 5.000 clientes
- [ ] Migração dos dados reais do cliente — ⛔ aguarda os ficheiros; ferramentas prontas: importação de clientes e de artigos + stock inicial (Excel/CSV, com pré-visualização)
- [x] Backups diários configurados e restauro testado (`backup:verify`)
- [x] Correcção de defeitos

**Aceitação:** zero erros bloqueantes; dados reais carregados; restauro de backup testado.

---

## S8 — Go-live (Dia 20)

- [ ] Deploy em produção — ⛔ aguarda VPS/domínio (guia em `deploy/DEPLOY.md`)
- [ ] Criação dos utilizadores reais — no dia (Administração › Utilizadores)
- [ ] Formação: direcção, comerciais, produção/stock, financeiro — presencial
- [ ] Formação do chão de fábrica (leitura QR) + impressão das primeiras etiquetas — presencial
- [x] Manual rápido por perfil — `docs/manual-rapido-por-perfil.pdf`
- [ ] Acompanhamento no primeiro dia de uso — presencial

**Aceitação:** cliente em operação com a primeira encomenda real registada na plataforma.

---

## Fora de âmbito (orçamentar à parte)

- App nativa / modo offline
- Assinatura digital, OCR e workflows de aprovação documental
- Integrações além de Vendus, Meta, Futurix SMS e email
- Utilizadores acima do limite contratado
- Alterações e melhoramentos após a entrega
