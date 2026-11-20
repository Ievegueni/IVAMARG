import { describe, expect, it } from 'vitest';
import { renderTemplate, sendPolicy, templateVariables } from './communication';

describe('janela de 24h (Meta)', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const h = (n: number) => new Date(now.getTime() - n * 3600_000);
  it('WhatsApp: livre dentro de 24h, só template depois', () => {
    expect(sendPolicy('WHATSAPP', h(23.9), now)).toMatchObject({ freeform: true, template: true, blocked: false });
    expect(sendPolicy('WHATSAPP', h(24), now)).toMatchObject({ freeform: false, template: true, blocked: false });
    expect(sendPolicy('WHATSAPP', null, now)).toMatchObject({ freeform: false, template: true });
  });
  it('Messenger/Instagram: só resposta dentro de 24h, sem templates', () => {
    expect(sendPolicy('MESSENGER', h(1), now)).toMatchObject({ freeform: true, blocked: false });
    expect(sendPolicy('INSTAGRAM', h(25), now)).toMatchObject({ freeform: false, template: false, blocked: true });
    expect(sendPolicy('INSTAGRAM', null, now).blocked).toBe(true);
  });
  it('email e SMS sem janela', () => {
    expect(sendPolicy('EMAIL', null, now)).toMatchObject({ freeform: true, blocked: false });
    expect(sendPolicy('SMS', h(100), now)).toMatchObject({ freeform: true, blocked: false });
  });
  it('indica quando a janela fecha', () => {
    expect(sendPolicy('WHATSAPP', h(2), now).closesAt?.toISOString()).toBe('2026-11-11T10:00:00.000Z');
  });
});

describe('templates', () => {
  it('substitui variáveis e deixa vazias as que faltam', () => {
    expect(renderTemplate('Olá {{cliente}}, a encomenda {{ encomenda }} está pronta. {{x}}', { cliente: 'Escola A', encomenda: 'ENC-1' })).toBe('Olá Escola A, a encomenda ENC-1 está pronta. ');
  });
  it('lista variáveis pela ordem, sem repetir', () => {
    expect(templateVariables('{{cliente}} {{valor}} {{cliente}}')).toEqual(['cliente', 'valor']);
  });
});
