// Validação da API Vendus (S0). Correr quando houver API key:  npm -w apps/api run vendus:check
// Cria cliente e produto de teste e emite um documento em modo de teste. Resultados ficam em IntegrationLog.
import { prisma } from '../lib/prisma';
import { vendus } from './vendus';

const step = async (name: string, fn: () => Promise<unknown>) => {
  try {
    const r = await fn();
    console.log(`✔ ${name}\n`, JSON.stringify(r, null, 2).slice(0, 1500));
    return r as Record<string, unknown>;
  } catch (e) {
    console.error(`✘ ${name}: ${(e as Error).message}`);
  }
};

await step('Conta', () => vendus('GET', 'account'));
await step('Listar clientes', () => vendus('GET', 'clients?per_page=3'));
await step('Listar documentos', () => vendus('GET', 'documents?per_page=3'));
await step('Registos (caixas)', () => vendus('GET', 'registers'));
const client = await step('Criar cliente de teste', () =>
  vendus('POST', 'clients', { name: 'TESTE Plataforma Ivamarg', fiscal_id: '999999990', email: 'teste@ivamarg.ao' }),
);
const product = await step('Criar produto de teste', () =>
  vendus('POST', 'products', { reference: 'TESTE-PLAT-001', title: 'Produto de teste plataforma', gross_price: 1000, unit_id: undefined }),
);
if (client && product) {
  await step('Emitir factura em modo de teste', () =>
    vendus('POST', 'documents', {
      type: 'FT',
      mode: 'tests',
      client: { id: client.id },
      items: [{ id: product.id, qty: 1 }],
    }),
  );
}
await prisma.$disconnect();
