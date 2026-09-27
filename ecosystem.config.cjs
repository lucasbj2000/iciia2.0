module.exports = {
  apps: [{
    name: 'iciia-crm',
    script: 'src/server.mjs',
    cwd: __dirname,
    instances: 1,              // Baileys mantiene sockets en memoria: NO usar cluster
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '1200M',
    watch: false,
    env: { NODE_ENV: 'production' },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    time: true
  }]
};
