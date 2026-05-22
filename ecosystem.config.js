module.exports = {
  apps: [
    {
      name: "nocloud",
      script: "npm",
      args: "start",
      cwd: "./",
      env: {
        NODE_ENV: "production",
        PORT: 8080
      },
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "1G",
      restart_delay: 4000
    }
  ]
};
