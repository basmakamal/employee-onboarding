# Production deployment — onboarding.riyada-ksa.com

Target: Ubuntu 22.04 · Apache 2.4 · MySQL 8 · Node 22 · Redis · PM2
App path: `/var/www/RiyadaOnboarding`, owned and run by the dedicated user `onboarding`.

Principle: one unprivileged user owns the app and runs it; secrets are readable
only by that user and root; the MySQL user is scoped to a single database.

## 0. Before you start
- DNS `A` record for `onboarding.riyada-ksa.com` → server IP (certbot needs it live).
- Firewall / Oracle security list: only 22, 80, 443 open. Node (4000) and Redis (6379) stay on localhost.
- You are logged in as a sudo-capable user.

## 1. Dedicated app user (SSH + SFTP, no sudo)
```bash
sudo adduser --disabled-password --gecos "Riyada Onboarding deploy" onboarding
sudo usermod -aG www-data onboarding
sudo mkdir -p /home/onboarding/.ssh && sudo chmod 700 /home/onboarding/.ssh
sudo nano /home/onboarding/.ssh/authorized_keys      # paste your public key
sudo chmod 600 /home/onboarding/.ssh/authorized_keys
sudo chown -R onboarding:onboarding /home/onboarding/.ssh
```
Optional, for password SFTP (FileZilla): `sudo passwd onboarding`.

## 2. App folder — readable by the app user, Apache and root only
```bash
sudo mkdir -p /var/www/RiyadaOnboarding
sudo chown onboarding:www-data /var/www/RiyadaOnboarding
sudo chmod 750 /var/www/RiyadaOnboarding    # owner rwx, www-data r-x, others nothing
```
After cloning (step 6), tighten the backend, which holds `.env` and uploaded documents:
```bash
sudo chmod 700 /var/www/RiyadaOnboarding/backend
```
Result: Apache (www-data) can read `frontend/dist`; only `onboarding` and root can read the backend.

## 3. MySQL — one database, one user, nothing else
```bash
openssl rand -base64 24        # → use as the DB password below
sudo mysql -u root -p
```
```sql
CREATE DATABASE riyada_onboarding CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'riyada_onb'@'localhost' IDENTIFIED BY 'REPLACE_WITH_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON riyada_onboarding.* TO 'riyada_onb'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```
The user can create/alter/drop tables inside `riyada_onboarding` (Prisma migrations
need that) and cannot see or touch any other database.

## 4. Runtime (skip whatever is already installed)
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs redis-server
sudo systemctl enable --now redis-server
sudo npm install -g pm2
sudo a2enmod proxy proxy_http headers rewrite ssl
```

## 5. Become the app user
```bash
sudo -iu onboarding
```
Steps 6–8 run as `onboarding`.

## 6. Deploy key + clone
```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "onboarding@riyada-live"
cat ~/.ssh/github_deploy.pub     # add at GitHub → repo → Settings → Deploy keys (read-only)
printf 'Host github.com\n  IdentityFile ~/.ssh/github_deploy\n  IdentitiesOnly yes\n' > ~/.ssh/config
chmod 600 ~/.ssh/config
git clone --branch main git@github.com:basmakamal/employee-onboarding.git /var/www/RiyadaOnboarding
```
Use `develop` instead of `main` if that is what should go live.

## 7. Backend `.env`
```bash
cd /var/www/RiyadaOnboarding/backend
cat > .env <<ENV
NODE_ENV=production
PORT=4000
DATABASE_URL=mysql://riyada_onb:REPLACE_WITH_STRONG_PASSWORD@127.0.0.1:3306/riyada_onboarding
JWT_ACCESS_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
APP_URL=https://onboarding.riyada-ksa.com
UPLOAD_DIR=/var/www/RiyadaOnboarding/backend/storage
REDIS_URL=redis://127.0.0.1:6379
SLA_TICK_MINUTES=5
NOTIFIER=console
ENV
chmod 600 .env
```
Mail: keep `NOTIFIER=console` and configure SMTP in the admin Settings screen after first
login (applies without restart), or set `NOTIFIER=smtp` with `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` here.

## 8. Install, migrate, seed, build, start
```bash
cd /var/www/RiyadaOnboarding/backend
npm ci
npx prisma generate
npx prisma migrate deploy
npx prisma db seed          # first admin + SLA rules — run ONCE, never again
npm run build

cd ../frontend
npm ci
npm run build               # → frontend/dist, what Apache serves

cd ../backend
pm2 start dist/index.js  --name onboarding-api    --time
pm2 start dist/worker.js --name onboarding-worker --time
pm2 save
exit                        # back to your sudo user
```
PM2 on boot, for the onboarding user, then lock the backend folder:
```bash
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u onboarding --hp /home/onboarding
sudo chmod 700 /var/www/RiyadaOnboarding/backend
```

## 9. Apache vhost
```bash
sudo nano /etc/apache2/sites-available/onboarding.conf
```
```apache
<VirtualHost *:80>
    ServerName onboarding.riyada-ksa.com
    DocumentRoot /var/www/RiyadaOnboarding/frontend/dist

    <Directory /var/www/RiyadaOnboarding/frontend/dist>
        Options -Indexes
        AllowOverride None
        Require all granted
        FallbackResource /index.html
    </Directory>

    ProxyPreserveHost On
    ProxyPass        /api http://127.0.0.1:4000/api
    ProxyPassReverse /api http://127.0.0.1:4000/api
    # Server-sent events must stream, not buffer
    <Location /api/events>
        ProxyPass http://127.0.0.1:4000/api/events flushpackets=on
    </Location>

    ErrorLog  ${APACHE_LOG_DIR}/onboarding-error.log
    CustomLog ${APACHE_LOG_DIR}/onboarding-access.log combined
</VirtualHost>
```
```bash
sudo a2ensite onboarding.conf
sudo apache2ctl configtest && sudo systemctl reload apache2
```

## 10. TLS + HTTP→HTTPS redirect
```bash
sudo certbot --apache -d onboarding.riyada-ksa.com --redirect
```
Certbot writes `onboarding-le-ssl.conf`, enables it, and adds the permanent 80→443
redirect. Renewal is automatic (`systemctl status certbot.timer`).

Optional — retire the test hostname by forwarding it:
```apache
# /etc/apache2/sites-available/test-onboarding-redirect.conf
<VirtualHost *:80>
    ServerName test-onboarding.riyada-ksa.com
    Redirect permanent / https://onboarding.riyada-ksa.com/
</VirtualHost>
```
```bash
sudo a2ensite test-onboarding-redirect.conf && sudo systemctl reload apache2
```

## 11. Verify
```bash
curl -s http://127.0.0.1:4000/api/ready                 # {"status":"ready","checks":{"db":"up"}}
curl -sI http://onboarding.riyada-ksa.com/ | head -3    # 301 → https
curl -s https://onboarding.riyada-ksa.com/api/health
sudo -iu onboarding pm2 ls
sudo -u nobody ls /var/www/RiyadaOnboarding/backend     # "Permission denied" = correct
```
Log in with the seeded admin and **change its email and password immediately** — the
seed uses example.com addresses that can never receive mail.

## 12. Backups — not optional on production
```bash
sudo mkdir -p /var/backups/onboarding && sudo chown onboarding:onboarding /var/backups/onboarding
sudo -iu onboarding crontab -e
```
```cron
15 2 * * * mysqldump -u riyada_onb -p'REPLACE_WITH_STRONG_PASSWORD' riyada_onboarding | gzip > /var/backups/onboarding/db-$(date +\%F).sql.gz && tar czf /var/backups/onboarding/files-$(date +\%F).tgz -C /var/www/RiyadaOnboarding/backend storage && find /var/backups/onboarding -mtime +14 -delete
```
Copy that folder off the server (rclone / scp) — a backup on the same disk is not a backup.

## 13. Updating later
```bash
sudo -iu onboarding
cd /var/www/RiyadaOnboarding && git pull
cd backend  && npm ci && npx prisma generate && npx prisma migrate deploy && npm run build
cd ../frontend && npm ci && npm run build
pm2 restart onboarding-api onboarding-worker
```
