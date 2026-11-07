const path = require('node:path');
const fs = require('node:fs');
fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });

module.exports = {
  apps: [{
    name: 'acbot',
    cwd: __dirname,
    script: './src/index.js',
    interpreter: 'node',
    node_args: ['--env-file=.env'],
    exec_mode: 'fork',
    instances: 1,
    watch: false,
    autorestart: true,
    wait_ready: true,
    listen_timeout: 60000,
    kill_timeout: 5000,
    min_uptime: 10000,
    max_restarts: 10,
    exp_backoff_restart_delay: 1000,
    max_memory_restart: '300M',
    out_file: './logs/acbot-out.log',
    error_file: './logs/acbot-error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    env: {
      NODE_ENV: 'production',
      BOT_DATA_DIR: path.join(__dirname, '.runtime', 'data'),
      TZ: 'Asia/Bangkok',
    },
  }],
};
