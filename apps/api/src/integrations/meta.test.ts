import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseWebhook, verifyMetaSignature } from './meta';

describe('verifyMetaSignature', () => {
  const body = Buffer.from('{"object":"whatsapp_business_account"}');
  const sig = 'sha256=' + createHmac('sha256', 'segredo').update(body).digest('hex');

  it('aceita assinatura correcta', () => expect(verifyMetaSignature(body, sig, 'segredo')).toBe(true));
  it('rejeita segredo errado', () => expect(verifyMetaSignature(body, sig, 'outro')).toBe(false));
  it('rejeita corpo alterado', () => expect(verifyMetaSignature(Buffer.from('{}'), sig, 'segredo')).toBe(false));
  it('rejeita header ausente ou malformado', () => {
    expect(verifyMetaSignature(body, undefined, 'segredo')).toBe(false);
    expect(verifyMetaSignature(body, 'sha1=abc', 'segredo')).toBe(false);
  });
});

describe('parseWebhook', () => {
  it('WhatsApp: mensagem com nome do contacto e estado de entrega', () => {
    const ev = parseWebhook({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: {
        contacts: [{ wa_id: '244923000111', profile: { name: 'Ana' } }],
        messages: [{ from: '244923000111', id: 'wamid.1', timestamp: '1794300000', type: 'text', text: { body: 'Olá' } }],
        statuses: [{ id: 'wamid.0', status: 'read' }],
      } }] }],
    });
    expect(ev).toEqual([
      { kind: 'message', channel: 'WHATSAPP', from: '244923000111', name: 'Ana', externalId: 'wamid.1', at: new Date(1794300000000), type: 'TEXT', text: 'Olá', mediaId: undefined },
      { kind: 'status', externalId: 'wamid.0', status: 'READ', error: undefined },
    ]);
  });
  it('Messenger: ignora ecos das nossas mensagens', () => {
    const ev = parseWebhook({ object: 'page', entry: [{ messaging: [
      { sender: { id: 'psid1' }, timestamp: 1, message: { mid: 'm1', text: 'Bom dia' } },
      { sender: { id: 'page' }, timestamp: 2, message: { mid: 'm2', text: 'eco', is_echo: true } },
    ] }] });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ channel: 'MESSENGER', from: 'psid1', text: 'Bom dia' });
  });
});
