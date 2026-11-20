// PM2: API + worker de filas. Logs rodados com o módulo pm2-logrotate (ver deploy/DEPLOY.md).
module.exports = {
  apps: [
    { name: 'ivamarg-api', cwd: 'apps/api', script: 'dist/server.js', node_args: '--env-file=.env', max_memory_restart: '600M', time: true },
    { name: 'ivamarg-worker', cwd: 'apps/api', script: 'dist/worker.js', node_args: '--env-file=.env', max_memory_restart: '600M', time: true },
  ],
};
