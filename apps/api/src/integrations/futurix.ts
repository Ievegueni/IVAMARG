import { logged } from '../jobs/integration-log';
import { env } from '../lib/env';

// Futurix SMS - ⚠️ formato do pedido por validar com a documentação/conta do cliente (CLAUDE.md §5.11).
export async function sendSms(to: string, text: string) {
  if (!env.FUTURIX_SMS_API_URL || !env.FUTURIX_SMS_API_KEY) throw new Error('Credenciais Futurix SMS em falta');
  return logged('futurix', 'sms.send', { to, length: text.length }, async () => {
    const res = await fetch(env.FUTURIX_SMS_API_URL!, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.FUTURIX_SMS_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: env.FUTURIX_SMS_SENDER, to, message: text }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Futurix ${res.status}: ${body.slice(0, 300)}`);
    return body ? JSON.parse(body) : null;
  });
}
