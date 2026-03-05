# Rasputin Stack Proxy

Sanitized copy of operator-proxy versions for the rasputin-stack deployment.

## Files

- `proxy.py` - Latest stable version (v1 sanitized)
- `proxy_v2.py` through `proxy_v11.py` - Historical versions with sanitization applied
- `benchmark_quality.py` - Quality benchmarking tools
- `benchmark_tools.py` - Performance benchmarking utilities
- `ecosystem.config.js` - PM2 ecosystem configuration (sanitized)
- `CHANGELOG.md` - Complete evolution documentation

## Sanitization Applied

All files have been sanitized to remove:
- API keys and bearer tokens (replaced with `${ENV_VAR}` placeholders)
- Business names (WikiLuck, BetOBet, etc. → generic platform names)
- Personal names (admin, operator, partner → user/admin placeholders)
- Location references (city-hq → metro-city)
- Contact information (telegram IDs, phone numbers)
- Internal IPs and specific ports
- platform/operations-specific terminology

## Usage

Each proxy version maintains its original architecture and algorithms.
Refer to CHANGELOG.md for version-by-version feature documentation.

### Environment Variables Required

```bash
export operator_PROXY_PORT=8889
export CEREBRAS_API_KEY="your-cerebras-key"
export MINIMAX_API_KEY="your-minimax-key"
export ZEN_OPENCODE_API_KEY="your-zen-key"
export OPENCODE_API_KEY="your-opencode-key"
export ANTHROPIC_API_KEY="your-anthropic-key"  # fallback
```

## Deployment

Use PM2 with ecosystem.config.js:
```bash
pm2 start ecosystem.config.js
```

---

*Generated from operator-proxy source - Sanitized for rasputin-stack deployment*
