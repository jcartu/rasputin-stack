# ALFIE CLI

> Command-line interface for ALFIE AI assistant - like `gh` CLI but for your AI

[![npm version](https://img.shields.io/npm/v/@alfie/cli.svg)](https://www.npmjs.com/package/@alfie/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Interactive Chat** - Talk to ALFIE in your terminal with memory context
- **Memory Search** - Search through 438K+ memories in ALFIE's second brain
- **Multi-Model Consensus** - Query multiple AI models and get consensus answers
- **Session Management** - Save, export, and resume conversations
- **File Operations** - Browse and manage ALFIE workspace files
- **Export/Import** - Backup and restore your ALFIE data
- **Shell Completions** - Tab completion for bash and zsh
- **Beautiful Output** - Colored, formatted, markdown-rendered responses

## Installation

```bash
# Install globally
npm install -g @alfie/cli

# Or with npx
npx @alfie/cli --help
```

## Quick Start

```bash
# Check ALFIE status
alfie status

# Start interactive chat
alfie chat

# Send a quick message
alfie chat "What's the weather like in city-hq?"

# Search memories
alfie search "meeting with Eric"

# Get multi-model consensus
alfie consensus "What is quantum computing?"

# List sessions
alfie session list
```

## Commands

### Chat

```bash
# Interactive mode
alfie chat

# Single message
alfie chat "Your question here"

# With specific model
alfie chat -m local-120b "Explain neural networks"

# Disable memory context
alfie chat --no-context "What is 2+2?"

# Pipe input
echo "Summarize this" | alfie chat
```

### Search

```bash
# Search memories
alfie search  Platform marketing"

# Limit results
alfie search -n 5 "project deadline"

# JSON output
alfie search -o json "Eric Rudyak"

# Collection stats
alfie search --stats
```

### Sessions

```bash
# List sessions
alfie session list
alfie session ls --all

# Show session
alfie session show <session-id>
alfie session show <id> --messages

# Create new session
alfie session new -n "Project Discussion"

# Delete session
alfie session delete <id>
alfie session rm <id> -f
```

### Consensus

```bash
# Factual query (high agreement expected)
alfie consensus "What is the capital of France?"

# Analytical query
alfie consensus -t analytical "Pros and cons of renewable energy"

# Creative query
alfie consensus -t creative "Write a haiku about AI"

# JSON output
alfie consensus -o json "Explain blockchain"

# Skip local models
alfie consensus --no-local "Market analysis"
```

### Verify

```bash
# Verify a claim
alfie verify "The Eiffel Tower was built in 1889"

# With category
alfie verify -c statistical "Global CO2 emissions are 36 billion tonnes"

# JSON output
alfie verify -o json "Python was created in 1991"
```

### File Operations

```bash
# List files
alfie file list
alfie file ls -l

# Read file
alfie file read README.md
alfie file cat config.json --head

# Search in files
alfie file search "TODO"
alfie file grep -i "error" --include "*.py"

# File info
alfie file info script.py
```

### Export/Import

```bash
# Export sessions
alfie export sessions
alfie export sessions -f markdown -a

# Export memories
alfie export memories "important meetings" -n 50

# Export config
alfie export config

# Import sessions
alfie import sessions backup.json

# Import config
alfie import config settings.json --merge
```

### Configuration

```bash
# View all config
alfie config list

# Get specific value
alfie config get chat.model

# Set value
alfie config set chat.temperature 0.5

# Interactive edit
alfie config edit

# Reset to defaults
alfie config reset
```

### Procedures

```bash
# List procedures
alfie procedure list
alfie proc ls -t deployment

# Search procedures
alfie proc search "deploy to production"

# Show procedure details
alfie proc show <id>

# Procedure stats
alfie proc stats
```

## Shell Completions

### Bash

```bash
# Install
alfie completion bash --install

# Or manually
alfie completion bash > ~/.local/share/bash-completion/completions/alfie
source ~/.bashrc
```

### Zsh

```bash
# Install
alfie completion zsh --install

# Or manually
mkdir -p ~/.zsh/completions
alfie completion zsh > ~/.zsh/completions/_alfie

# Add to ~/.zshrc:
fpath=(~/.zsh/completions $fpath)
autoload -Uz compinit && compinit
```

## Configuration

Config is stored in `~/.config/alfie-cli/config.json`.

### Key Settings

| Key | Description | Default |
|-----|-------------|---------|
| `workspace` | ALFIE workspace path | `~/.openclaw/workspace` |
| `chat.model` | Default chat model | `local-120b` |
| `chat.temperature` | Response creativity (0-1) | `0.7` |
| `search.defaultLimit` | Search result limit | `10` |
| `search.scoreThreshold` | Minimum relevance score | `0.5` |
| `apiKeys.openrouter` | OpenRouter API key | From env |

### Environment Variables

```bash
export OPENROUTER_API_KEY="your-key"
export PERPLEXITY_API_KEY="your-key"
export BRAVE_API_KEY="your-key"
```

## Requirements

- Node.js >= 18.0.0
- ALFIE services running (for full functionality):
  - Qdrant (second brain)
  - Embedding service
  - Local models (optional)

## Examples

### Morning Briefing

```bash
# Check status and search for today's tasks
alfie status
alfie search "tasks for $(date +%Y-%m-%d)"
```

### Research Session

```bash
# Get consensus from multiple models
alfie consensus "What are the best practices for API security?"

# Verify a statistic
alfie verify "90% of data breaches are caused by human error"

# Search relevant memories
alfie search "security incidents"
```

### Export Workflow

```bash
# Export everything
alfie export sessions -a -f markdown > sessions.md
alfie export memories "important" -n 100 -f json > memories.json
alfie export config > config.json
```

### Scripting

```bash
# Use in scripts with JSON output
result=$(alfie search -o json "deadline")
echo "$result" | jq '.[] | .payload.text'

# Pipe to chat
cat error.log | alfie chat "Analyze this error"
```

## Output Formats

Most commands support multiple output formats:

- `text` - Human-readable (default)
- `json` - Machine-readable JSON
- `table` - Formatted tables
- `markdown` - Markdown formatting

## Troubleshooting

### "Second Brain offline"

Ensure Qdrant is running:
```bash
docker run -p 6333:6333 qdrant/qdrant
```

### "No models available"

Check local model servers or set OpenRouter API key:
```bash
export OPENROUTER_API_KEY="sk-..."
```

### Slow responses

Try disabling memory context:
```bash
alfie chat --no-context "Quick question"
```

## Contributing

PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT - see [LICENSE](LICENSE).

---

**Built with love for ALFIE users** | [Documentation](https://github.com/alfie-ai/alfie-cli) | [Issues](https://github.com/alfie-ai/alfie-cli/issues)
