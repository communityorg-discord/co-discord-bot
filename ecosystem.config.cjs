module.exports = {
  apps: [{
    name: 'co-discord-bot',
    script: 'src/index.js',
    cwd: '/home/vpcommunityorganisation/clawd/services/co-discord-bot',
    env_production: {
      NODE_ENV: 'production'
    },
    max_memory_restart: '500M',
    autorestart: true,
    restart_delay: 1000,
  }]
};
