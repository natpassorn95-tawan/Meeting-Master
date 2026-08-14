// PM2 ecosystem for Meeting Master (會議大師) — Windows production host.
//
// Run from anywhere; paths resolve relative to THIS file, so the app root is the
// parent folder (…/meeting-master). CommonJS (.cjs) because the app's package.json
// is "type": "module" and PM2 config must be CommonJS.
//
// ENV NOTE: server/index.js loads its own .env at startup via Node's built-in
// process.loadEnvFile("../.env") (Node 20.12+/22+/24). So the LINE tokens,
// PUBLIC_BASE_URL, LIFF_ID, etc. in meeting-master/.env are picked up
// automatically — PM2 does NOT need to inject them. The `env` block below only
// sets a couple of defaults; anything in .env wins for the keys the app reads
// through process.env because loadEnvFile runs inside the process and overrides.
// If you prefer PM2 to own the environment instead, add the vars under `env`.

const path = require('path');
const appRoot = path.resolve(__dirname, '..'); // …/meeting-master
const logDir = path.join(__dirname, 'logs');    // …/meeting-master/windows-service/logs

module.exports = {
  apps: [
    {
      name: 'meeting-master',
      script: 'server/index.js',
      cwd: appRoot,
      exec_mode: 'fork', // single Express process (in-memory/file store — do NOT cluster)
      instances: 1,
      autorestart: true, // (a) auto-restart on crash
      max_memory_restart: '400M', // (c) restart if RSS exceeds 400 MB
      min_uptime: '10s', // must stay up 10s to count as a good start
      max_restarts: 20, // give up after 20 crash-loops in a row (then restart the service)
      restart_delay: 2000, // wait 2s between restarts (avoid tight crash loops)
      watch: false, // never hot-reload a production service
      env: {
        NODE_ENV: 'production',
        PORT: '8899',
      },
      // Merged, timestamped logs under windows-service/logs/.
      out_file: path.join(logDir, 'meeting-master.out.log'),
      error_file: path.join(logDir, 'meeting-master.err.log'),
      merge_logs: true,
      time: true, // prefix each log line with a timestamp
    },
  ],
};
