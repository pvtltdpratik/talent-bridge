// PM2 process file for the TalentBridge API.
//   TB_ROOT=/home/ubuntu/talentbridge pm2 start deploy/ecosystem.config.cjs --env production
//   pm2 save                       (once the process list looks right)
//
// Paths default to /var/www/talentbridge; set TB_ROOT / TB_LOG_DIR for another layout (e.g. a home directory
// when the deploy user cannot write to /var/www). Secrets are NOT stored here: the API reads
// <TB_ROOT>/shared/server.env (mode 600) through dotenv (DOTENV_CONFIG_PATH).
const root = process.env.TB_ROOT || '/var/www/talentbridge';
const logs = process.env.TB_LOG_DIR || '/var/log/talentbridge';

module.exports = {
  apps: [
    {
      name: 'talentbridge-api',
      cwd: `${root}/current/server`,
      script: 'src/index.js',
      exec_mode: 'fork', // stateless; switch to "cluster" once rate limiting moves to a shared store (Redis)
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '15s',
      restart_delay: 3000,
      max_memory_restart: '400M',
      kill_timeout: 10000, // matches graceful shutdown in src/index.js
      time: true,
      merge_logs: true,
      out_file: `${logs}/api.out.log`,
      error_file: `${logs}/api.err.log`,
      env: { NODE_ENV: 'development' },
      env_production: { NODE_ENV: 'production', PORT: 4000, DOTENV_CONFIG_PATH: `${root}/shared/server.env` },
    },
  ],
};
