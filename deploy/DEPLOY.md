# Deploy — Plataforma Ivamarg (VPS Ubuntu 22.04/24.04)

## 1. Pré-requisitos (uma vez)

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx postgresql-16 redis-server git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm i -g pm2 && pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M && pm2 set pm2-logrotate:retain 30
sudo timedatectl set-timezone Africa/Luanda
```

Base de dados: `sudo -u postgres createuser -P ivamarg && sudo -u postgres createdb -O ivamarg ivamarg`.

## 2. Código e configuração

```bash
sudo mkdir -p /srv/ivamarg && sudo chown $USER /srv/ivamarg
git clone <repositório> /srv/ivamarg && cd /srv/ivamarg
cp apps/api/.env.example apps/api/.env   # preencher: segredos, APP_URL=https://gestao.ivamarg.ao, NODE_ENV=production
npm ci
npm -w apps/api run db:deploy            # migrações (nunca db push / migrate dev em produção)
npm run db:seed                          # perfis, etapas, categorias… (idempotente). Mudar a palavra-passe do admin no 1.º acesso.
npm run build
pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
```

`JWT_SECRET`: `openssl rand -hex 32`. Sem `CLOUDINARY_URL` os ficheiros ficam em `UPLOAD_DIR` (só aceitável em teste).

## 3. Nginx + HTTPS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/ivamarg   # ajustar o domínio
sudo ln -s /etc/nginx/sites-available/ivamarg /etc/nginx/sites-enabled/
sudo certbot --nginx -d gestao.ivamarg.ao && sudo nginx -t && sudo systemctl reload nginx
```

## 4. Backups

- O worker faz `pg_dump` diário às 02:00 (Luanda) para `BACKUP_DIR`, guarda 30 dias e copia para o Cloudinary se configurado.
- Verificação de restauro (mensal, ou após mudanças): `npm -w apps/api run backup:verify` — restaura numa base temporária e compara contagens.
- Restauro real: `npm -w apps/api run db:restore -- <ficheiro.dump> <url-base-nova>`; validar; depois apontar `DATABASE_URL` para a base restaurada e `pm2 restart all`.

## 5. Actualizações

```bash
cd /srv/ivamarg && git pull && npm ci && npm -w apps/api run db:deploy && npm run build && pm2 restart all
```

## 6. Integrações ao activar

| Integração | Variáveis | Depois |
|---|---|---|
| Vendus | `VENDUS_API_URL`, `VENDUS_API_KEY` | `npm -w apps/api run vendus:check`; mudar `vendus.mode` para `normal` no backoffice |
| Meta (WhatsApp/Messenger/IG) | `META_*`, `WA_*`, `FB_*`, `IG_*` | Webhook: `https://<domínio>/api/webhooks/meta` (token = `META_VERIFY_TOKEN`); desligar `comms.sandbox`; activar as flags |
| Futurix SMS | `FUTURIX_SMS_*` | confirmar formato do pedido; activar flag `sms` |
| Email | `SMTP_*` | — |
