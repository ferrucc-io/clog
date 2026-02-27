# clog

**Runtime-driven debugging for AI coding agents.**

Many bugs can't be found by reading code. Race conditions, stale state, wrong execution order, unexpected input shapes you can debug these only when your code runs.

clog gives your AI agent its own way to collect logs so it can debug from real execution data instead of guessing from static code, or have you copy paste things manually.

## Why runtime data matters

When you describe a bug to an AI coding agent, it reads your source code, forms a hypothesis, and proposes a fix. Sometimes that works. But for bugs that depend on timing, state, or data flow reading code isn't enough. The agent needs to see what happened.

clog bridges that gap. It's a lightweight local server that collects logs from your running application and makes them available to the agent.

The agent handles the entire loop: instrument, reproduce, observe, diagnose. So you're not manually adding print statements, copying output, and pasting it into chat.


## How it works

clog has two parts: a **CLI** that runs a local log server, and a **skill** that teaches your agent the debugging workflow.

```
┌──────────────┐     POST /log       ┌──────────────┐
│   Your App   │ ──────────────────► │ clog server  │
│ (_clog calls)│   localhost:2999    │  (~/.clog/)  │
└──────────────┘                     └──────┬───────┘
                                            │
                                     ndjson log file
                                            │
                                     ┌──────▼───────┐
                                     │   AI Agent   │
                                     │  /reproduce  │
                                     └──────────────┘
```

The server runs in the background on port 2999. Your application code sends structured JSON to it via simple HTTP POSTs. Each entry gets timestamped and appended to a log file. The agent reads this log to trace exactly what happened, in what order, with what values.

---

## The debugging workflow

When you invoke `/reproduce`, the agent follows a structured five-phase process:

### 1. Understand the bug
The agent asks you what's wrong, what you expected, and how to trigger it. It reads the relevant source code to build context.

### 2. Instrument the code
The agent adds lightweight `_clog()` calls at strategic points — function entry and exit, branch decisions, variable values before and after transformations, loop state, error handlers. These are temporary. They exist only to capture the runtime trace.

### 3. You reproduce the bug
You trigger the issue as you normally would. Every `_clog()` call fires a POST to the local server. The structured log builds up in real time.

### 4. Analyze the trace
The agent reads the log chronologically and finds the exact point where actual behavior diverged from expected behavior. Not a guess — an observation, backed by timestamped data.

### 5. Fix and clean up
The agent proposes a fix targeting the root cause, removes all `_clog()` instrumentation from your code, and clears the log file. Your codebase is left clean.

---

## Getting started

### Install

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/ferrucc-io/clog/releases/latest/download/clog-installer.sh | sh
```

### Setup (once per project)

```bash
clog init     # installs the /reproduce skill into .claude/skills/
clog start    # starts the log server
```

### Debug

```
> /reproduce the sidebar doesn't collapse on mobile
```

The agent takes it from there.

---

## When to use clog

**Good fit:**
- State-dependent bugs — wrong values flowing through the system
- Timing issues — events firing in the wrong order
- Conditional logic errors — the wrong branch executing
- Data transformation bugs — input looks right, output doesn't
- Intermittent failures — need to capture what happens when it breaks

**Probably overkill:**
- Typos, syntax errors, or obvious logic mistakes
- Build or configuration issues
- Bugs where reading the code makes the cause immediately clear

---

## CLI reference

### Server management

```bash
clog start    # start the background log server
clog stop     # stop the server
clog status   # show server PID, port, and log file size
```

### Reading logs

With no subcommand, clog prints the latest log lines:

```bash
clog                        # show the latest 10 lines
clog -n 50                  # show the latest 50 lines
clog -q "TypeError"         # show the latest 10 lines matching "TypeError"
clog -n 100 -q "userId"    # show the latest 100 lines matching "userId"
```

The `-q` flag does a simple substring match against each log line, so you can filter by step name, error type, field value — whatever you need.

### Project setup

```bash
clog init     # install the /reproduce skill into .claude/skills/
```

### Cleanup

```bash
clog clear    # truncate the log file
```

---

## Language support

clog is language-agnostic. Anything that can POST JSON to `http://localhost:2999/log` works. The skill ships with drop-in helpers for common languages:

**Python**
```python
import urllib.request, json
def _clog(data):
    try:
        urllib.request.urlopen(urllib.request.Request(
            "http://localhost:2999/log",
            data=json.dumps(data).encode(),
            headers={"Content-Type": "application/json"},
            method="POST"))
    except: pass
```

**JavaScript / TypeScript**
```javascript
function _clog(data) {
  fetch("http://localhost:2999/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).catch(() => {});
}
```

**Rust**
```rust
fn _clog(data: &impl serde::Serialize) {
    let _ = reqwest::blocking::Client::new()
        .post("http://localhost:2999/log")
        .json(data)
        .send();
}
```

**Any language** via curl:
```bash
curl -s -X POST http://localhost:2999/log \
  -H 'Content-Type: application/json' \
  -d '{"step":"checkout","cart_total":42.50}'
```

---

## What the logs look like

Each entry is a single JSON line with an auto-added timestamp:

```json
{"ts":"2026-02-27T14:23:01.456Z","data":{"step":"handleClick","button":"submit","formValid":false}}
{"ts":"2026-02-27T14:23:01.458Z","data":{"step":"validateForm","errors":["email required"]}}
{"ts":"2026-02-27T14:23:01.460Z","data":{"step":"handleClick:exit","submitted":false}}
```

The agent reads these to reconstruct the execution path. The `step` field marks the location, and the rest is whatever data is relevant to that point in the code.

---

## Works with any AI coding agent

| Tool | How |
|---|---|
| **Claude Code** | Native integration. Run `clog init` and use `/reproduce`. |
| **Codex (OpenAI)** | Copy the skill prompt from `.claude/skills/reproduce/SKILL.md` into your Codex instructions. The server and `_clog()` helpers work the same way. |
| **Any agent** | The server and NDJSON log format are tool-agnostic. Point any agent at `~/.clog/logs/clog.ndjson`. |

---

## Architecture

clog is deliberately simple:

- **Single Rust binary** — no runtime dependencies
- **Axum HTTP server** on localhost:2999
- **NDJSON storage** at `~/.clog/logs/clog.ndjson`
- **Background process** with PID tracking in `~/.clog/server.json`
- **CORS enabled** — works from browser apps too

---

<p align="center">

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/ferrucc-io/clog/releases/latest/download/clog-installer.sh | sh && clog init && clog start
```

Then just `/reproduce`.

</p>

---

## Acknowledgments

Inspired by [Cursor's debug mode](https://docs.cursor.com/agent/debug), which demonstrated the value of letting AI agents observe runtime behavior to diagnose bugs.
