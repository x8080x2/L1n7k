module.exports = {
  apps: [{
    name: 'outlook-automation',
    script: './server.js',
    instances: 'max',
    exec_mode: 'cluster',
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    env_staging: {
      NODE_ENV: 'staging',
      PORT: 5001
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s'
  }],

  deploy: {
    production: {
      user: 'ubuntu',
      host: 'YOUR_SERVER_IP',
      ref: 'origin/main',
      repo: 'https://github.com/x8080x2/L1n7k.git',
      path: '/var/www/outlook-automation',
      'pre-deploy-local': '',
      'post-deploy': 'npm install --production && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
};