# CLAUDE.md — Plataforma de Gestão Integrada Ivamarg

> Especificação técnica completa. Ler antes de qualquer tarefa. O plano de execução está em `SPRINTS.md`.

---

## 1. Contexto

| Item | Valor |
|---|---|
| Cliente | Ivamarg, Lda — Luanda |
| Fornecedor | COMUNICA — Prestação de Serviços |
| Linhas de negócio | Construção civil e obras públicas · Fábrica de uniformes · Limpeza e jardinagem · Furos de água |
| Utilizadores | Até 6 (limite configurável) |
| Acesso | Web responsivo (desktop, tablet, telemóvel). Sem app nativa. Sem offline. |
| Idioma da UI | Português (Angola) |
| Moeda | AOA — **sempre inteiros** (sem decimais) |
| Fuso horário | `Africa/Luanda` |
| Facturação | **Vendus** (o sistema NÃO emite facturas; integra via API) |
| Prioridade do cliente | **Controlo de produção da fábrica de uniformes** |
| Prazo | 20 dias (ver `SPRINTS.md`) |

### Princípios
1. Produção e stock são o núcleo. Nunca comprometer estes módulos por causa de outros.
2. Tudo o que o cliente deixou "em aberto" é **configurável no backoffice**, nunca hardcoded (secções, etapas, operadores, modelo de pagamento, defeitos, estados do funil, comissões, limites de aprovação, KPIs).
3. Canais Meta e chamadas WhatsApp ficam atrás de **feature flags** (dependem de aprovação externa).
4. Cada acção relevante gera registo de auditoria.

---

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node.js 20 + Fastify |
| ORM / BD | Prisma + PostgreSQL |
| Filas / jobs | BullMQ + Redis |
| Frontend | React 18 + Vite + Tailwind |
| Validação | Zod (schemas partilhados entre API e web) |
| Ficheiros | Cloudinary (`resource_type: raw` para documentos, entrega autenticada / URLs assinados) |
| SMS | Futurix SMS |
| Email | SMTP (Nodemailer) |
| PDF | Geração server-side (propostas, relatórios, etiquetas QR) |
| QR | Geração server-side; leitura via câmara do browser |
| Gráficos | Recharts |
| Testes | Vitest |
| Deploy | VPS (PM2 + Nginx) |

> A máquina de desenvolvimento é Windows: scripts npm devem ser cross-platform (usar `cross-env`, `rimraf`; evitar comandos bash nos `package.json`).

---

## 3. Estrutura do repositório

```
ivamarg/
├─ CLAUDE.md
├─ SPRINTS.md
├─ package.json            # workspaces
├─ apps/
│  ├─ api/                 # Fastify
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma
│  │  │  └─ seed.ts
│  │  └─ src/
│  │     ├─ server.ts
│  │     ├─ plugins/       # auth, rbac, audit, prisma, redis, errors
│  │     ├─ modules/       # um diretório por módulo (routes, service, schemas)
│  │     ├─ integrations/  # vendus, meta, futurix-sms, smtp, cloudinary
│  │     ├─ jobs/          # workers BullMQ
│  │     └─ lib/           # money, dates, pdf, qr, pagination
│  └─ web/                 # React + Vite
│     └─ src/
│        ├─ app/           # router, layout, providers
│        ├─ modules/       # espelha os módulos da API
│        ├─ components/    # UI partilhada
│        └─ lib/           # api client, formatters, hooks
└─ packages/
   └─ shared/              # schemas Zod, enums, tipos, constantes de permissões
```

Cada módulo da API: `routes.ts`, `service.ts`, `schemas.ts`, `*.test.ts`. Rotas finas, lógica nos services.

---

## 4. Convenções

- **Código** em inglês (identificadores, tabelas, rotas). **UI e mensagens** em português.
- Valores monetários: `Int` em AOA. Formatar só na UI (`1.440.000 Kz`).
- Quantidades de material: `Decimal(12,3)` (metros de tecido, kg, unidades).
- Datas guardadas em UTC, apresentadas em `Africa/Luanda`.
- IDs: `cuid()`.
- Soft delete (`deletedAt`) em entidades de negócio; nunca apagar histórico de produção, stock ou financeiro.
- Paginação em todas as listagens (`page`, `pageSize`, `search`, `sort`).
- Erros com formato único: `{ error: { code, message, details? } }`.
- Toda a escrita relevante passa pelo plugin de auditoria.
- Sem segredos no código. Tudo em `.env`.
- Migrações Prisma sempre versionadas; nunca `db push` em produção.

---

## 5. Módulos

### 5.1 Administração e acesso
- Login (email + palavra-passe, bcrypt), sessão JWT (access curto + refresh em cookie httpOnly). Refresh rodado a cada uso com 60 s de tolerância para o token anterior (rede móvel instável).
- Perfis padrão: **Administrador, Gestor, Comercial, Produção/Stock, Financeiro**. Perfis editáveis.
- Permissões por módulo e acção (`view`, `create`, `edit`, `delete`, `approve`, `export`).
- Limite de utilizadores activos (default 6) em `Setting`.
- Auditoria: quem, quando, entidade, acção, antes/depois (JSON).
- Implementação: permissões guardadas em `Role.permissions` (`"módulo.acção"`, ver `packages/shared/src/permissions.ts`) em vez de tabelas `Permission`/`RolePermission`. Refresh token opaco (hash em `Session`, rodado a cada refresh). Bloqueio: 5 falhas → 15 min. Rate limit login: 10/min.
- Âmbito "carteira": acção `viewAll` ("Ver todos") por módulo. Sem ela, o utilizador só vê registos de que é responsável (`ownerId`); encomendas/contratos seguem o responsável do cliente. Helper: `apps/api/src/lib/scope.ts`.

### 5.2 Backoffice (configurações)
Configurável sem código:
- Linhas de negócio.
- Estados do funil por linha de negócio.
- Limite de aprovação de propostas (valor em AOA) e aprovadores.
- Secções e etapas de produção (ordem, interna/externa, activa).
- Operadores e modelo de pagamento (fixo, à peça, misto).
- Tipos de defeito.
- Regras de comissão.
- KPIs activos e metas.
- Modelos de mensagem e automações.
- Categorias e pastas de documentos.
- Feature flags (Meta, chamadas WhatsApp, SMS).

### 5.3 Clientes
- Ficha: nome, NIF, telefone(s), email, morada, linha(s) de negócio, comercial responsável, notas, tags.
- Contactos múltiplos por cliente (empresa).
- Histórico unificado (timeline): interacções, mensagens, propostas, encomendas, pagamentos, documentos.
- Detecção de duplicados por NIF / telefone / email.
- Importação Excel/CSV com pré-visualização e relatório de erros.

### 5.4 Pipeline de vendas
- Oportunidade: cliente, linha de negócio, valor previsto, estado, comercial, data prevista de fecho, origem (canal).
- Kanban por linha de negócio. Estados configuráveis (default: Novo, Em negociação, Proposta enviada, Aprovado, Perdido).
- Motivo de perda obrigatório ao marcar "Perdido".
- Carteira por comercial (filtro e permissão: o comercial vê só a sua carteira, salvo permissão).

### 5.5 Propostas e contratos
- Proposta: itens (artigo/serviço, qtd, preço, desconto) ou fases (obras). Totais em AOA.
- Versões (v1, v2…) imutáveis após envio.
- PDF com marca do cliente final (logo configurável no backoffice).
- **Aprovação**: se `total >= limite`, estado `PENDING_APPROVAL` → aprovador aprova/rejeita com comentário.
- Proposta aceite pelo cliente →
  - linha **uniformes**: gera **Encomenda**;
  - linha **obras / furos**: gera **Obra / Furo**;
  - linha **limpeza**: gera **Contrato recorrente**.
- Contratos: datas, valor, periodicidade, renovação, documento anexo.
- Implementação (S1): estados `DRAFT → (PENDING_APPROVAL → APPROVED | REJECTED) → SENT → ACCEPTED | DECLINED`. Envio marca `sentAt` na versão (imutável); alterações depois disso = nova versão. Aprovadores = utilizadores com `pipeline.approve`, notificados in-app + email. Aceitação converte numa transacção e move a oportunidade ligada para o estado `isWon`. Limpeza → contrato mensal (valor da proposta = valor por período), ajustável no contrato.
- Propostas sem IVA discriminado (nota no PDF: impostos na factura Vendus). **Confirmar com o cliente** se a proposta deve mostrar IVA.

### 5.6 Tarefas e agenda
- Tarefa: título, descrição, responsável, prazo, prioridade, estado, entidade ligada (cliente, oportunidade, encomenda, obra…).
- Calendário (reuniões, compromissos, visitas).
- Notificações in-app + email de tarefas a vencer/em atraso (job diário + lembretes).

### 5.7 Produção — Fábrica de uniformes ⭐
**Fluxo:** Encomenda → Ordem de Produção (OP) → Etapas → Qualidade → Embalagem → Entrega → Factura (Vendus).

**Catálogo / ficha técnica (`ProductModel`)**
- Modelo, referência, preço base, fotos.
- BOM: material (`StockItem`), consumo por tamanho (`Decimal`), unidade.
- Tempo padrão por etapa (minutos/peça) — opcional, para eficiência.

**Encomenda (`Order`)**
- Cliente, prazo, prioridade, personalização (nome, logótipo, notas), estado.
- Linhas: modelo + grelha de tamanhos (`{ "S": 10, "M": 25, ... }`).
- Entregas parciais.

**Ordem de Produção (`ProductionOrder`)**
- Gerada a partir da encomenda (1 OP por linha ou por encomenda — configurável).
- Cálculo de necessidades = Σ(qtd por tamanho × consumo por tamanho) por material.
- Verificação de stock → lista de faltas → alerta.
- Ao **libertar** a OP: reserva de material.
- Divisão em **lotes** (`Lot`), cada um com **QR code** e etiqueta PDF imprimível.

**Etapas (`StageLog`)**
- Etapas vêm do backoffice (ordem configurável). Default: Corte, Costura, Bordado/Estampagem, Acabamento, Embalagem.
- Registo por leitura do QR do lote: **iniciar** / **concluir** com quantidades (concluídas, rejeitadas), operador, data/hora.
- Etapa **externa** (subcontratada): fornecedor, data de envio, data de retorno, quantidades enviadas/recebidas, custo.
- Uma etapa só inicia quando a anterior tem quantidade concluída disponível (permite fluxo parcial).

**Qualidade**
- Inspecção por lote: aprovadas, defeituosas (por tipo de defeito), retrabalho, refugo.
- Retrabalho volta à etapa definida; refugo dá baixa definitiva.

**Consumo e custo**
- Consumo **teórico** (BOM) vs **real** (saídas de stock para a OP). Desvio em % por OP.
- Custo por peça = material real + mão-de-obra (conforme modelo de pagamento) + custo externo.
- Margem por encomenda = preço de venda − custo total. Alerta se abaixo do mínimo configurado.

**Operadores**
- Secção, modelo de pagamento (fixo / à peça com valor por etapa / misto).
- Se à peça: cálculo do valor a pagar por período a partir dos `StageLog`.

**Implementação (S2)**
- Qualidade é uma etapa do tipo `QUALITY` na sequência (default antes da Embalagem): aprovadas seguem, retrabalho volta a uma etapa anterior, refugo sai. Rejeitadas noutras etapas contam como refugo.
- Fluxo por lote: `entrada(k) = concluídas(k−1) + retrabalho enviado para k`; `disponível = entrada − iniciadas` (`apps/api/src/modules/production/calc.ts`). Concluir exige que concluídas + rejeitadas (+ retrabalho) = iniciadas.
- Etapa externa = mesmo `StageLog` com fornecedor (iniciar = envio, concluir = retorno + custo). Registada no escritório.
- Libertar OP com faltas exige confirmação (`force`): reserva o disponível e notifica stock. Necessidades gravadas em `MaterialRequirement` na libertação (alterar a BOM depois não muda OPs libertadas).
- Mão-de-obra: `labourCost` fixado no `StageLog` ao concluir (valor por peça da etapa/modelo nesse momento). Operadores FIXED não entram no custo por peça (salário fixo só no relatório de pagamento).
- Custo médio ponderado por artigo (todos os armazéns), `Decimal(14,4)`; valores monetários em `Int`.
- PIN do operador guardado como HMAC (único). Token de operador (`kind: 'op'`, 12h) só acede a `/api/floor`; o ecrã termina a sessão após 3 min sem uso.
- Fotos de modelos e logótipo guardados como data URL (≤ 500 KB) até haver Cloudinary — migrar no S3.
- Linha de encomenda com **cor** e **detalhe** (texto livre); fecham com as restantes linhas quando há OP.
- OP imprimível em PDF (`/production/orders/:id/pdf`, sem custos): artigos (cor/detalhe/grelha), materiais, lotes × etapas (concluídas ou em branco para registo manual) e assinaturas.

**Ecrã de chão de fábrica** (mobile-first)
- Login simplificado do operador (PIN) num dispositivo partilhado.
- Ler QR → ver lote → iniciar/concluir → introduzir quantidades. Mínimo de toques.

### 5.8 Stock
- Artigos (`StockItem`): matéria-prima, materiais de obra, consumíveis. Unidade, custo médio, stock mínimo.
- Armazéns múltiplos.
- Movimentos (`StockMovement`): `IN`, `OUT`, `TRANSFER`, `ADJUSTMENT`, `RESERVE`, `RELEASE`. Sempre com origem (OP, obra, compra, inventário).
- Custo médio ponderado recalculado nas entradas.
- Stock disponível = físico − reservado.
- Alerta de stock mínimo (job).
- Inventário: contagem, diferenças, ajuste com aprovação.
- Fornecedores e compras (registo simples: fornecedor, itens, custos, data de recepção → entrada de stock).
- **O stock é gerido exclusivamente nesta plataforma.** Não há stock de produto acabado (produção só por encomenda). O Vendus recebe apenas catálogo e documentos.

### 5.9 Gestão documental (básica)
Repositório central de documentos da empresa e dos processos.
- Upload (PDF, imagens, Word, Excel), máx. 20 MB por ficheiro.
- **Pastas e categorias** configuráveis (ex.: Contratos, Alvarás e licenças, Certidões, Fichas técnicas, Projectos/plantas, RH, Fornecedores).
- **Ligação a entidades**: cliente, oportunidade, proposta, contrato, encomenda, OP, obra, furo, fornecedor, utilizador. O documento aparece na timeline da entidade.
- **Versões**: novo upload sobre um documento cria nova versão; versões anteriores ficam acessíveis.
- **Metadados**: título, descrição, tags, data de emissão, **data de validade**.
- **Alertas de validade**: job diário notifica documentos a expirar (30/15/7 dias, configurável) e expirados.
- **Pesquisa** por título, tags, categoria, entidade, datas.
- **Pré-visualização** de PDF e imagens no browser.
- **Permissões** por categoria (ex.: RH só Administrador/Gestor).
- Download com URL assinado e temporário. Auditoria de upload, download e eliminação.
- Fora de âmbito: assinatura digital, OCR, workflows de aprovação documental, edição online.
- Implementação (S3): ficheiros em Cloudinary (`raw`, `authenticated`) quando `CLOUDINARY_URL` existe, senão em disco (`UPLOAD_DIR`, só desenvolvimento) servidos por `/api/files` com URL assinado HMAC de 5 min. Edita/versiona quem tem `documents.edit` ou quem criou o documento. Alertas de validade guardam `lastAlertDays` para não repetir.

### 5.10 Integração Vendus
- API v1 com API key por utilizador Vendus (`VENDUS_API_KEY`).
- Funções usadas: emissão de documentos, listagem/PDF de documentos, CRUD de clientes, CRUD de produtos.
- Fluxo: encomenda entregue / proposta aceite → "Emitir factura" → chamada API → guardar `vendusDocumentId`, número, PDF.
- Sincronização de clientes e produtos (push da plataforma para o Vendus; mapear IDs em `externalRefs`).
- Estado de pagamento: actualizado manualmente ou por consulta periódica (job), conforme o que a API permitir.
- **Primeira tarefa do projecto: validar a API com a conta do cliente** e registar limitações aqui.
- Todas as chamadas via fila (retries com backoff) e registo em `IntegrationLog`.
- **Implementação (S3):** `Invoice` (PENDING → ISSUED | FAILED) criada pelo pedido e emitida pelo worker `vendus` (5 tentativas, backoff exponencial; sem API key falha logo). Cliente e modelo são enviados ao Vendus na emissão e mapeados em `ExternalRef`. Documentos saem em `vendus.mode = tests` até a validação estar feita — mudar para `normal` no backoffice depois. PDF pedido ao Vendus a cada visualização (`documents/{id}.pdf`).
- **Estado (S0):** por validar — sem API key. Cliente em `apps/api/src/integrations/vendus.ts` (HTTP Basic, API key como utilizador); validação com `npm -w apps/api run vendus:check`. Confirmar: domínio para contas de Angola (`vendus.co.ao`?), `mode: "tests"` nos documentos, consulta de estado de pagamento.

### 5.11 Comunicação
**Caixa de entrada única** (`Conversation`, `Message`)
- Canais: WhatsApp (Cloud API), Facebook Messenger, Instagram, email; SMS só envio.
- Conversa ligada ao cliente (match por telefone / email / ID de canal; criação de lead se novo).
- Atribuição a utilizador, estado (aberta, pendente, fechada), notas internas.
- Respostas dentro da janela de 24h; fora dela só **templates aprovados** (WhatsApp). Instagram/Messenger: só resposta a mensagens recebidas.
- Webhooks Meta: validar `X-Hub-Signature-256`, responder 200 rápido, processar em fila.

**Implementação (S4)**
- Sandbox (`comms.sandbox`, ligado por defeito): envios WhatsApp/Messenger/Instagram/SMS ficam `SIMULATED` e registados em `IntegrationLog`; simulador de recepção no backoffice usa o mesmo `processInbound` do webhook. Desligar só com contas aprovadas.
- Conversa única por `(canal, contacto)`; match de cliente por telefone normalizado (WhatsApp/SMS), email, ou `ExternalRef` (Messenger/Instagram). Sem match → cliente com tag `lead`. Atribuída ao comercial do cliente, ou a quem responde primeiro.
- Webhooks idempotentes (`Message.externalId` único). Estados de entrega (sent/delivered/read) actualizam a mensagem.
- Parâmetros do template WhatsApp = valores das variáveis pela ordem em que aparecem no texto (`Message.templateVars`).
- Email: só envio a partir da plataforma (sem recepção/IMAP).
- **Futurix:** formato do pedido (`POST` JSON `{sender, to, message}` com Bearer) assumido — validar.

**Templates e automações**
- Modelos com variáveis (`{{cliente}}`, `{{encomenda}}`, `{{valor}}`…).
- Gatilhos: proposta enviada, encomenda pronta, pagamento em atraso, tarefa a vencer, documento a expirar.
- Canal por automação (WhatsApp, SMS, email).

**Chamadas WhatsApp** (feature flag)
- WhatsApp Cloud API Calling via WebRTC no browser.
- Recebidas e efectuadas (estas só com consentimento do cliente).
- Registo da chamada na timeline (duração, utilizador, resultado).
- Activação depende de elegibilidade Meta — construir, mas manter desligado até aprovação.

### 5.12 Financeiro
- Contas a receber por cliente (a partir de facturas Vendus e contratos): valor, vencimento, pago, em aberto, atraso.
- Registo de pagamentos (parcial/total, método, data).
- Receitas e despesas (categorias, linha de negócio, centro de custo: obra/encomenda).
- Comissões: regras configuráveis (percentagem ou valor fixo; por comercial, produto ou linha de negócio; base: valor facturado ou valor recebido). Cálculo por período, estado (calculada, aprovada, paga).

**Implementação (S5)**
- `Receivable` nasce com a factura emitida (ou manual). Estado (aberto/parcial/pago/atraso) é derivado de `paid` e `dueDate`. Cada pagamento gera receita automática (categoria "Recebimentos de clientes"); anular repõe saldo e remove a receita.
- Comissões: comercial = responsável da proposta (ou do cliente). Regra mais específica por linha da factura: produto > comercial > linha > geral. FIXO com produto = por unidade; sem produto = por documento. Base "recebido" proporcional ao pago. Recalcular o período apaga só as `CALCULATED`.
- Relatórios no ecrã (JSON) e exportação PDF/Excel pela fila `reports`; "os seus" (CLAUDE.md §7) aplicado no servidor.
- **Fornecedores e prestadores** (mesma tabela `Supplier` do stock): `Payable` = compra/serviço a pagar (categoria de despesa, centro de custo, vencimento). Cada `SupplierPayment` gera despesa automática (`FinancialEntry.supplierPaymentId`); anular repõe a dívida e remove a despesa. "Pago no acto" cria a dívida já liquidada. Requer `finance.viewAll`. Compras de stock recebidas **não** criam dívida automaticamente.

### 5.13 Operações (outras linhas de negócio)
- **Obras**: fases, orçado vs real, materiais consumidos (stock), equipa, estado, documentos.
- **Limpeza e jardinagem**: contratos recorrentes, planeamento de visitas/equipas, registo de execução.
- **Furos de água**: orçamento, localização, execução por etapas, materiais, resultado (profundidade, caudal — campos livres), documentos.

**Implementação (S6)**
- Obras e furos partilham serviço (`apps/api/src/modules/operations`): fases (`ProjectPhase`), consumo de stock (saídas com `sourceType` PROJECT/BOREHOLE), despesas com centro de custo (`FinancialEntry.entity`). Orçado vs real = material (custo médio na saída) + despesas.
- Proposta de obra em fases → fases da obra com o orçamento de cada fase. Furo → etapas de `boreholes.stages`. Resultado do furo em JSON livre.
- Limpeza: plano no contrato (dias da semana + hora + equipa) gera `ServiceVisit` (idempotente); execução com checklist (`cleaning.checklist`) e registo na timeline.
- Permissões: módulo `operations` (default: Gestor total; Produção/Stock ver+criar+editar; Comercial/Financeiro ver).
- Chamadas: eventos `calls` do webhook → `CallLog`; atender = `pre_accept` + `accept` com SDP answer gerado no browser; efectuar só com `callConsentAt`. Sandbox simula sinalização (sem áudio). **Validar com a Meta:** formato exacto dos eventos de chamada e do pedido de permissão de chamada ao cliente.

### 5.14 Desempenho e relatórios
KPIs (activáveis no backoffice):
- Tarefas concluídas no prazo (%), tempo médio de conclusão.
- Produção: peças/dia por operador e secção, tempo por etapa, eficiência (vs tempo padrão), gargalos.
- Qualidade: taxa de defeito, retrabalho, refugo.
- Comercial: conversão, valor vendido, ciclo de venda, por comercial.
- Encomendas/obras entregues no prazo.

Relatórios: vendas, clientes, produção, stock, desempenho, financeiro. Filtros por período, linha de negócio, utilizador. Exportação PDF e Excel.

### 5.15 Dashboards
- **Direcção**: produção (kanban por etapa, produção do dia, atrasos, gargalos), qualidade, stock crítico/em falta, consumo acima do previsto, comercial, margens, valores a receber, ranking de produtividade, documentos a expirar.
- **Comercial**: a minha carteira, oportunidades, propostas pendentes, tarefas.
- **Produção**: OPs em curso, lotes por etapa, faltas de material.
- **Financeiro**: em aberto, atrasos, comissões.

### 5.16 Notificações
- In-app (sino + contador), email; WhatsApp/SMS quando activos.
- Preferências por utilizador.
- Alertas: tarefa a vencer, OP em risco de atraso, material insuficiente, defeito acima do limite, etapa parada > X horas, consumo acima do teórico, stock mínimo, documento a expirar, pagamento em atraso, proposta para aprovar.

### 5.17 Recursos humanos (controle de pessoal)
- **Trabalhadores** (`Employee`): identificação (BI, NIF, n.º INSS), função, departamento, contrato, remuneração (base + subsídios), IBAN, dias de férias/ano, ligação opcional a um `Operator` da fábrica.
- **Assiduidade** (`Attendance`): registo diário por trabalhador (presente, atraso, falta injustificada/justificada, férias, doença, feriado), entrada/saída, horas extra. Resumo mensal.
- **Férias e ausências** (`Leave`): pedido → aprovação (`hr.approve`). Conta dias úteis (sem fins-de-semana nem feriados `hr.holidays`). Saldo anual; aprovar marca a assiduidade, cancelar remove.
- **Relógio biométrico**: importação do CSV/Excel do relógio (colunas `sJobNo`, `sName`, `Date`, `Time`; sem IN/OUT). Lido no browser, calculado no servidor (`attendanceFromPunches` em `packages/shared/src/hr.ts`). Trabalhador ↔ `Employee.biometricId`. Entrada = 1.ª marcação, saída = última (marcações a < 30 min contam como uma; marcação única depois do meio do horário = saída). Atraso/horas extra (meias horas) pelo horário `hr.schedule`; fins-de-semana/feriados = tudo extra; dias úteis sem marcação = falta. Substitui no período só Presente/Atraso/Falta; justificações, férias e doença ficam. Marcações sem n.º (`'NULL`) ignoradas; n.º sem trabalhador listado na pré-visualização.
- **Pagamento dos salários** por recibo (`SalaryPayment`): seleccionar todos / por departamento / trabalhadores; % do líquido (ex.: 50% agora) ou valor fixo (um trabalhador), nunca acima do que falta. Folha `APPROVED → PARTIAL → PAID` automático; reabrir só sem pagamentos. Cada pagamento = despesa "Salários" (`FinancialEntry.salaryPaymentId`); anular repõe. Só o líquido entra nas despesas (INSS/IRT a entregar ao Estado não são lançados).
- **Mensagens ao trabalhador** (`modules/hr/alerts.ts`): SMS se a flag `sms` estiver activa e houver telefone, senão email. Aniversário (job 08:00, `hr.birthdayMessage`; 29/02 → 28/02) + aviso aos RH no sino. Documentos ligados ao trabalhador (`DocumentLink.entity = 'Employee'`, secção na ficha) com validade: no alerta de validade o trabalhador recebe `hr.documentMessage`. Mensagem vazia = não enviar.
- **Alertas de atraso** (job `payments-overdue`, 07:20): recebimentos (já existia), dívidas a fornecedores (`finance.payablesAlertDays` antes, 1.º dia de atraso e semanal) e salários (`hr.payDay`: 3 dias antes, no dia e semanalmente enquanto houver valor em falta; mês corrente e 2 anteriores). Sem estado guardado: o calendário decide quando repetir.
- **Documento justificativo** no pedido de ausência (`Leave.attachmentKey`, mesmo storage dos documentos, URL assinado).
- **Folhas de salário** (`PayrollRun`, `Payslip`): processamento mensal = base + subsídios + horas extra + produção à peça (operador ligado) + prémios − faltas injustificadas; INSS 3%/8%; IRT por escalões. Regras em `hr.payroll` (backoffice, **a validar pelo contabilista**), guardadas na folha para reprodutibilidade. Rascunho → aprovada → paga. Recibos PDF.

---

## 6. Modelo de dados (resumo Prisma)

> Nomes indicativos. Todas as entidades de negócio têm `id`, `createdAt`, `updatedAt`, `createdById`, `deletedAt?`.

**Acesso e sistema**
`User`, `Role`, `Permission`, `RolePermission`, `Session`, `AuditLog`, `Setting`, `FeatureFlag`, `Notification`, `IntegrationLog`, `ExternalRef (entity, entityId, system, externalId)`

**Base comercial**
`BusinessLine`, `PipelineStage (businessLineId, order, isWon, isLost)`, `Client`, `ClientContact`, `Interaction`, `Tag`, `Opportunity`, `Proposal`, `ProposalVersion`, `ProposalItem`, `Approval`, `Contract`

**Tarefas**
`Task`, `CalendarEvent`

**Produção**
`ProductModel`, `BomLine (productModelId, stockItemId, size, consumption)`, `Order`, `OrderLine (sizeGrid Json)`, `Delivery`, `ProductionOrder`, `ProductionSection`, `ProductionStage (order, type INTERNAL|EXTERNAL)`, `Lot (qrCode)`, `StageLog (lotId, stageId, operatorId, startedAt, finishedAt, qtyDone, qtyRejected)`, `ExternalJob`, `QualityInspection`, `DefectType`, `InspectionDefect`, `Operator`, `PayModel`

**Stock**
`StockItem`, `Warehouse`, `StockLevel (itemId, warehouseId, onHand, reserved)`, `StockMovement`, `Supplier`, `Purchase`, `PurchaseLine`, `InventoryCount`, `InventoryLine`

**Documentos**
`DocumentFolder (parentId?, permissions)`, `DocumentCategory`, `Document (title, categoryId, folderId, tags, issuedAt?, expiresAt?)`, `DocumentVersion (documentId, version, fileUrl, mime, size, uploadedById)`, `DocumentLink (documentId, entity, entityId)`

**Comunicação**
`Channel`, `Conversation`, `Message`, `MessageTemplate`, `Automation`, `CallLog`

**Financeiro**
`Invoice (vendusDocumentId, number, total, dueDate)`, `Receivable`, `Payment`, `Expense`, `ExpenseCategory`, `CommissionRule`, `Commission`

**Operações**
`Project (obra)`, `ProjectPhase`, `CleaningContract`, `ServiceVisit`, `Borehole`, `BoreholeStage`

**RH**
`Employee`, `Attendance`, `Leave`, `PayrollRun`, `Payslip`

**KPIs**
`KpiDefinition`, `KpiTarget`

---

## 7. Permissões (default)

| Módulo | Admin | Gestor | Comercial | Produção/Stock | Financeiro |
|---|---|---|---|---|---|
| Backoffice | total | ver | — | — | — |
| Clientes | total | total | carteira | ver | ver |
| Pipeline / propostas | total | total + aprovar | carteira | — | ver |
| Produção | total | total | ver encomendas | total | ver custos |
| Stock | total | total | ver | total | ver |
| Documentos | total | total | por categoria | por categoria | por categoria |
| Comunicação | total | total | as suas conversas | — | cobranças |
| Financeiro | total | total | as suas comissões | — | total |
| Relatórios / KPIs | total | total | os seus | produção | financeiro |
| RH | total | total | — | — | ver + exportar |

---

## 8. Jobs (BullMQ)

| Fila | Função |
|---|---|
| `vendus` | Emissão de facturas, sync de clientes/produtos, estado de pagamento |
| `meta-inbound` | Processamento de webhooks WhatsApp/Messenger/Instagram |
| `outbound` | Envio WhatsApp, SMS (Futurix), email |
| `automations` | Avaliação de gatilhos |
| `alerts` | Stock mínimo, atrasos de OP, etapas paradas, documentos a expirar, pagamentos em atraso (cron) |
| `reports` | Geração de PDF/Excel pesados |
| `backup` | `pg_dump` diário + retenção |

---

## 9. Variáveis de ambiente

```
NODE_ENV=
PORT=
DATABASE_URL=
REDIS_URL=
JWT_SECRET=
APP_URL=
CLOUDINARY_URL=
SMTP_HOST= SMTP_PORT= SMTP_USER= SMTP_PASS= SMTP_FROM=
FUTURIX_SMS_API_URL= FUTURIX_SMS_API_KEY= FUTURIX_SMS_SENDER=
VENDUS_API_URL= VENDUS_API_KEY=
META_APP_ID= META_APP_SECRET= META_VERIFY_TOKEN=
WA_PHONE_NUMBER_ID= WA_BUSINESS_ACCOUNT_ID= WA_ACCESS_TOKEN=
FB_PAGE_ID= FB_PAGE_ACCESS_TOKEN=
IG_ACCOUNT_ID=
TZ=Africa/Luanda
```

---

## 10. Requisitos não funcionais

- HTTPS obrigatório (Nginx + Let's Encrypt).
- Rate limiting no login e webhooks.
- Palavras-passe bcrypt; bloqueio após tentativas falhadas.
- Backups diários da BD com retenção de 30 dias; ficheiros no Cloudinary.
- Tempo de resposta alvo < 500 ms nas listagens comuns.
- Logs estruturados (pino) com rotação.
- UI responsiva; ecrã de chão de fábrica optimizado para telemóvel.
- Protecção de dados pessoais: acesso mínimo, auditoria, exportação/eliminação de dados de cliente a pedido.

---

## 11. Comandos

```
npm install
npm run docker:up      # Postgres (5442), Redis (6392), Mailpit (SMTP 1025, UI http://localhost:8025)
npm run dev            # api + worker + web
npm run db:migrate     # prisma migrate dev
npm run db:seed        # perfis, permissões, etapas default, defeitos default, linhas de negócio
npm run test           # testes de integração usam a BD <nome>_test (não destrutivo)
npm run typecheck
npm run build
npm run start          # produção (PM2)
```

---

## 12. Regras para desenvolvimento

1. Seguir `SPRINTS.md` por ordem. Marcar tarefas concluídas (`[x]`).
2. Não avançar de sprint sem os critérios de aceitação do sprint actual cumpridos.
3. Qualquer valor em aberto do cliente → configuração no backoffice, nunca constante.
4. Testes obrigatórios para: cálculo de necessidades de material, movimentos e reservas de stock, custo por peça, comissões, regras de aprovação, janela de 24h Meta.
5. Integrações externas sempre por fila, com retry e `IntegrationLog`.
6. Ao descobrir limitação de uma API externa, registar na secção correspondente deste ficheiro.
7. Textos da UI em português de Angola; formatação monetária `1.234.567 Kz`.
