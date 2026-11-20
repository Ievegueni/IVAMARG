-- Dados: completa "viewAll" nos perfis default (a migração commercial só cobriu parte dos módulos).
UPDATE "Role" SET "permissions" = array_append("permissions", 'finance.viewAll')
  WHERE "name" = 'Financeiro' AND NOT ('finance.viewAll' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'production.viewAll')
  WHERE "name" = 'Produção/Stock' AND NOT ('production.viewAll' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'stock.viewAll')
  WHERE "name" = 'Produção/Stock' AND NOT ('stock.viewAll' = ANY("permissions"));
