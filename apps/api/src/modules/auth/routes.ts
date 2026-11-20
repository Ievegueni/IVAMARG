import { forgotPasswordSchema, loginSchema, resetPasswordSchema } from '@ivamarg/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ctxOf } from '../../lib/audit';
import { env } from '../../lib/env';
import * as auth from './service';

const COOKIE = 'ivamarg_rt';

function setRefreshCookie(reply: FastifyReply, token: string) {
  reply.setCookie(COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: auth.SESSION_DAYS * 86400,
  });
}

export async function authRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/login', strict, async (req, reply) => {
    const { username, password } = loginSchema.parse(req.body);
    const r = await auth.login(app, { ...ctxOf(req), userAgent: req.headers['user-agent'] }, username, password);
    setRefreshCookie(reply, r.refreshToken);
    return { accessToken: r.accessToken, user: r.user };
  });

  app.post('/refresh', async (req, reply) => {
    const r = await auth.refresh(app, req.cookies[COOKIE]);
    setRefreshCookie(reply, r.refreshToken);
    return { accessToken: r.accessToken, user: r.user };
  });

  app.post('/logout', async (req, reply) => {
    await auth.logout(ctxOf(req), req.cookies[COOKIE]);
    reply.clearCookie(COOKIE, { path: '/api/auth' });
    return { ok: true };
  });

  app.post('/forgot-password', strict, async (req) => {
    await auth.forgotPassword(ctxOf(req), forgotPasswordSchema.parse(req.body).email);
    return { ok: true };
  });

  app.post('/reset-password', strict, async (req) => {
    const { token, password } = resetPasswordSchema.parse(req.body);
    await auth.resetPassword(ctxOf(req), token, password);
    return { ok: true };
  });

  app.get('/me', { preHandler: app.guard() }, async (req) => req.currentUser);
}
