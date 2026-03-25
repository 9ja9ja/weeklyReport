module.exports = {
  apps: [
    {
      name: 'antigravity',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000 -H 0.0.0.0',
      cwd: 'C:/AI IDE/Antigravity',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOSTNAME: '0.0.0.0',
      },
    },
  ],
};
