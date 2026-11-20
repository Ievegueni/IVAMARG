import type { FastifyInstance } from 'fastify';
import { verifyMetaSignature } from '../../integrations/meta';
import { queue } from '../../jobs/queues';
import { env } from '../../lib/env';
import { AppError } from '../../lib/errors';

// Webhooks Meta (WhatsApp, Messenger, Instagram). Validar, enfileirar, responder 200 depressa.
export async function webhookRoutes(app: FastifyInstance) {
  // Corpo bruto necessário para validar a assinatura (só neste âmbito).
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  const limit = { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } };

  app.get<{ Querystring: Record<string, string> }>('/meta', limit, async (req, reply) => {
    const q = req.query;
    if (env.META_VERIFY_TOKEN && q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === env.META_VERIFY_TOKEN) {
      return reply.type('text/plain').send(q['hub.challenge']);
    }
    throw new AppError(403, 'FORBIDDEN', 'Token de verificação inválido');
  });

  app.post('/meta', limit, async (req) => {
    if (!env.META_APP_SECRET) throw new AppError(503, 'NOT_CONFIGURED', 'Integração Meta não configurada');
    const raw = req.body as Buffer;
    if (!verifyMetaSignature(raw, req.headers['x-hub-signature-256'] as string | undefined, env.META_APP_SECRET)) {
      throw new AppError(401, 'INVALID_SIGNATURE', 'Assinatura inválida');
    }
    await queue('meta-inbound').add('event', JSON.parse(raw.toString('utf8')));
    return { ok: true };
  });
}
