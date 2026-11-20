import { prisma } from '../lib/prisma';

/** Executa uma chamada externa e regista-a em IntegrationLog (sucesso ou erro). */
export async function logged<T>(system: string, operation: string, request: unknown, fn: () => Promise<T>) {
  const start = Date.now();
  try {
    const response = await fn();
    await prisma.integrationLog.create({
      data: { system, operation, status: 'success', request: json(request), response: json(response), durationMs: Date.now() - start },
    });
    return response;
  } catch (err) {
    await prisma.integrationLog.create({
      data: { system, operation, status: 'error', request: json(request), error: String(err), durationMs: Date.now() - start },
    });
    throw err;
  }
}

const json = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
