// PM2 process file for the TalentBridge API.
//   pm2 start deploy/ecosystem.config.cjs --env production
//   pm2 save && pm2 startup        (once, so it restarts after a reboot)
//
// Secrets are NOT stored here. The API reads /var/www/talentbridge/shared/server.env (mode 600) via dotenv
// (DOTENV_CONFIG_PATH below).
module.exports = {
  apps: [
    {
      name: 'talentbridge-api',
      cwd: '/var/www/talentbridge/current/server',
      script: 'src/index.js',
      exec_mode: 'fork', // the API is stateless; use "cluster" + instances once rate limiting moves to a shared store (Redis)
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '15s',
      restart_delay: 3000,
      max_memory_restart: '400M',
      kill_timeout: 10000, // matches graceful shutdown in src/index.js
      time: true,
      merge_logs: true,
      out_file: '/var/log/talentbridge/api.out.log',
      error_file: '/var/log/talentbridge/api.err.log',
      env: { NODE_ENV: 'development' },
      // dotenv (loaded by src/config/env.js) reads this file; it is chmod 600 and outside the release folders
      env_production: { NODE_ENV: 'production', PORT: 4000, DOTENV_CONFIG_PATH: '/var/www/talentbridge/shared/server.env' },
    },
  ],
};
