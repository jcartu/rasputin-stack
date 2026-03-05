module.exports = {
  apps: [{
    name: "platform-proxy-v9",
    script: "/home/user/.openclaw/workspace/platform-proxy/proxy_v9.py",
    interpreter: "python3",
    cwd: "/home/user/.openclaw/workspace/platform-proxy",
    env: {
      MINIMAX_API_KEY: ""${MINIMAX_API_KEY}"",
      operator_PROXY_PORT: "8889",
      ZEN_OPENCODE_API_KEY: ""${ZEN_OPENCODE_API_KEY}"",
      OPENCODE_API_KEY: ""${ZEN_OPENCODE_API_KEY}""
    }
  }]
};
