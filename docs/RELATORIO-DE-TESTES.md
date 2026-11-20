# Relatório de testes - Plataforma Ivamarg

Data: 10/11/2026 · Ambiente: desenvolvimento local (Docker: Postgres + Redis + Mailpit)

## Como foi testado

1. **Testes automáticos** (`npm run test`): **130 testes, todos a passar** (25 de regras partilhadas + 105 da API com base de dados real).
2. **Varrimento no browser** de todos os ecrãs, como Administrador: 43 ecrãs de listagem + 9 ecrãs de detalhe abriram sem erros.
3. **Testes manuais no browser** dos fluxos novos (RH, gráficos dos relatórios, QR), em desktop (1440 px) e telemóvel (390 px).

Legenda: ✅ funciona e foi verificado · ⚠️ funciona, com nota · ⛔ depende de credenciais externas que ainda não existem

---

## Resultado por módulo

### Acesso e administração
| Funcionalidade | Estado | Como foi verificado |
|---|---|---|
| Login, sessão, renovação e logout | ✅ | teste automático |
| Bloqueio após 5 tentativas falhadas | ✅ | teste automático |
| Utilizador desactivado perde o acesso logo | ✅ | teste automático |
| Limite de utilizadores activos (6) | ✅ | teste automático |
| Perfis e permissões por módulo/acção | ✅ | teste automático + browser |
| Permissões extra por utilizador (ninguém altera as suas) | ✅ | teste automático + browser |
| Todas as rotas privadas exigem permissão | ✅ | teste automático (verifica todas as rotas) |
| Carteira: comercial só vê os seus clientes/propostas/OPs/documentos | ✅ | teste automático |
| Auditoria (quem, quando, antes/depois) | ✅ | teste automático + browser |
| Recuperar palavra-passe por email | ⚠️ | funciona com o Mailpit local; em produção precisa do SMTP |

### Backoffice (configurações)
| Funcionalidade | Estado | Notas |
|---|---|---|
| Linhas de negócio e estados do funil | ✅ | browser |
| Configurações gerais (limite de aprovação, lotes, margem, tamanhos…) | ✅ | browser |
| Etapas, secções, operadores, defeitos, valor por peça | ✅ | browser + teste automático |
| Comissões, KPIs, categorias de despesa | ✅ | browser + teste automático |
| Modelos de mensagem e automações | ✅ | browser + teste automático |
| Categorias de documentos (com permissões) | ✅ | teste automático |
| Feature flags (Meta, chamadas WhatsApp, SMS) | ✅ | desligadas por defeito |
| Regras de salário (INSS/IRT) e feriados | ✅ | novo; o servidor valida os dados antes de gravar |

### Comercial
| Funcionalidade | Estado | Notas |
|---|---|---|
| Clientes: ficha, contactos, timeline | ✅ | |
| Duplicados por NIF / telefone / email | ✅ | teste automático |
| Importação Excel/CSV com pré-visualização | ✅ | teste automático |
| Pipeline Kanban; "Perdido" exige motivo | ✅ | |
| Propostas: versões imutáveis após envio | ✅ | teste automático |
| Aprovação acima do limite (comercial não aprova, gestor aprova) | ✅ | teste automático |
| PDF da proposta com logótipo | ✅ | |
| Proposta aceite → encomenda / obra / furo / contrato | ✅ | teste automático |
| Contratos | ✅ | browser |

### Produção - fábrica de uniformes
| Funcionalidade | Estado | Notas |
|---|---|---|
| Catálogo com ficha técnica (BOM por tamanho) | ✅ | |
| Encomenda com grelha de tamanhos | ✅ | teste automático |
| OP: necessidades de material, faltas, reserva ao libertar | ✅ | teste automático |
| Divisão em lotes | ✅ | teste automático |
| **QR code dos lotes** | ✅ | etiquetas PDF geradas; os QR foram lidos e abrem o lote certo no chão de fábrica |
| Chão de fábrica: PIN → ler QR → iniciar/concluir | ✅ | teste automático; ecrã do PIN verificado no browser |
| Fluxo parcial entre etapas, etapa externa | ✅ | teste automático |
| Qualidade: defeitos, retrabalho, refugo | ✅ | teste automático |
| Consumo teórico vs real, custo por peça, margem | ✅ | teste automático |
| Pagamento à peça por operador | ✅ | teste automático + browser |

### Stock
| Funcionalidade | Estado | Notas |
|---|---|---|
| Artigos, armazéns, stock disponível = físico - reservado | ✅ | |
| Entradas com custo médio ponderado | ✅ | teste automático |
| Saídas/transferências não excedem o disponível; ajuste exige motivo | ✅ | teste automático |
| Compras e recepção (sem receber duas vezes) | ✅ | teste automático |
| Inventário com aprovação | ✅ | teste automático (sem inventários nos dados de demonstração) |
| Importação de artigos com stock inicial | ✅ | teste automático |
| Alerta de stock mínimo | ✅ | |

### Operações
| Funcionalidade | Estado | Notas |
|---|---|---|
| Obras: fases, orçado vs real, materiais, despesas | ✅ | teste automático + browser |
| Furos: etapas configuráveis, resultado (profundidade, caudal) | ✅ | teste automático |
| Limpeza: plano de visitas, registo de execução | ✅ | teste automático + browser |

### Recursos humanos (novo)
| Funcionalidade | Estado | Notas |
|---|---|---|
| Lista e ficha de trabalhadores (BI, NIF, INSS, contrato, salário, IBAN) | ✅ | browser + teste automático |
| Ligação a operador da fábrica (produção à peça entra no salário) | ✅ | verificado: 6.240 Kz de produção à peça no recibo |
| Assiduidade diária (estado, entrada/saída, horas extra) | ✅ | browser |
| Resumo mensal de assiduidade | ✅ | teste automático |
| Férias: dias úteis, feriados, saldo anual, sobreposição | ✅ | teste automático + browser (pedido de 9 dias aprovado) |
| Aprovar férias marca a assiduidade; cancelar remove | ✅ | teste automático |
| Folha de salários: processar, ajustar prémios/descontos, recalcular | ✅ | browser + teste automático |
| INSS 3% / 8% e IRT por escalões | ⚠️ | cálculos conferidos à mão; **os valores da tabela têm de ser validados pelo contabilista** (editáveis em Configurações) |
| Aprovar → pagar; folha aprovada fica bloqueada | ✅ | teste automático |
| Recibos de vencimento em PDF | ✅ | PDF aberto e conferido |
| Permissões: comercial não vê; financeiro vê e exporta, não altera | ✅ | teste automático |

### Documentos
| Funcionalidade | Estado | Notas |
|---|---|---|
| Upload com metadados, ligação a entidades, timeline | ✅ | teste automático |
| Versões, links assinados e temporários | ✅ | teste automático |
| Alertas de validade (30/15/7 dias e expirado) | ✅ | teste automático |
| Permissões por categoria (RH só Admin/Gestor) | ✅ | teste automático |
| Armazenamento Cloudinary | ⛔ | agora guarda localmente; falta a conta Cloudinary |

### Tarefas e agenda
| Funcionalidade | Estado | Notas |
|---|---|---|
| Tarefas com responsável, prazo e entidade ligada | ✅ | teste automático |
| Lembretes de atraso (uma vez por dia) | ✅ | teste automático |
| Agenda; convidados notificados | ✅ | teste automático |

### Comunicação
| Funcionalidade | Estado | Notas |
|---|---|---|
| Caixa de entrada, ligação ao cliente, criação de lead | ✅ | teste automático |
| Janela de 24h e templates WhatsApp | ✅ | teste automático |
| Automações (encomenda pronta, pagamento em atraso…) | ✅ | teste automático |
| Chamadas WhatsApp (modo sandbox) | ✅ | teste automático |
| Envio real WhatsApp / Messenger / Instagram / SMS | ⛔ | em modo sandbox até haver aprovação Meta e conta Futurix |

### Financeiro e facturação
| Funcionalidade | Estado | Notas |
|---|---|---|
| Contas a receber, pagamentos parciais/totais, anulação | ✅ | teste automático |
| Alertas de pagamento em atraso | ✅ | teste automático |
| Receitas, despesas, centros de custo | ✅ | |
| Comissões (cálculo, aprovação, pagamento) | ✅ | teste automático |
| Emissão de facturas no Vendus | ⛔ | fila e retries testados com API simulada; falta a API key do cliente (as facturas de teste aparecem como "Falhou") |

### Relatórios, KPIs e dashboards
| Funcionalidade | Estado | Notas |
|---|---|---|
| Relatórios por período, linha de negócio e utilizador | ✅ | teste automático |
| **Gráficos em cada relatório** (para reuniões) | ✅ | browser |
| KPIs com meta e barra de progresso | ✅ | browser |
| Botão "Imprimir / apresentar" | ⚠️ | menus e filtros escondem-se ao imprimir; a pré-visualização de impressão não foi aberta nesta ronda |
| Exportação PDF e Excel | ✅ | teste automático |
| Dashboards Direcção / Comercial / Produção / Financeiro | ✅ | teste automático + browser |

### Telemóvel
| Funcionalidade | Estado | Notas |
|---|---|---|
| Menu lateral em gaveta, sino de notificações | ✅ | browser a 390 px |
| Cartões de resumo em 2 colunas, formulários sem zoom no iPhone | ✅ | browser |
| Linhas das propostas em cartões | ✅ | browser |
| Tabelas largas (ex.: férias, salários) | ⚠️ | deslizam na horizontal; os dados ficam todos acessíveis |
| Ecrã do chão de fábrica | ✅ | teclado de PIN grande, pensado para o telemóvel |

---

## Pendentes (dependem do cliente ou de credenciais)
- Vendus: API key e validação da conta.
- Meta (WhatsApp/Messenger/Instagram), Futurix SMS, SMTP, Cloudinary: contas e credenciais.
- VPS e domínio para o deploy (ver `deploy/DEPLOY.md`).
- Tabela do IRT e regras do INSS: validar com o contabilista.
- Feriados: só estão configurados os de 2026; acrescentar os de 2027 em Configurações.
