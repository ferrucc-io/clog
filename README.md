# clog

**Debug with runtime traces instead of copy-pasting logs.**

Some bugs depend on timing, state, and execution order. clog gives your AI agent a local way to instrument code, collect structured logs from the running app, and find the root cause from what actually happened.

## When to use clog

- State bugs - wrong values flowing through the system
- Timing issues - events firing in the wrong order
- Conditional logic errors - the wrong branch executing
- Data transformation bugs - input looks right, output doesn't
- Intermittent failures - need to capture what happens when it breaks

If the bug is obvious from reading code (typos, syntax errors, config issues), you do not need clog.

## Quick start (Claude Code)

```bash
# Install the CLI
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/ferrucc-io/clog/releases/latest/download/clog-installer.sh | sh

# In your project directory
clog init     # adds the /reproduce skill to .claude/skills/
clog start    # starts a local log server on port 2999
```

Then tell Claude about your bug:

```
> /reproduce the sidebar doesn't collapse on mobile
```

The agent asks clarifying questions, adds temporary `_clog()` calls, reads the runtime trace, fixes the bug, and removes the instrumentation.

## Other agents

- **Codex (OpenAI)** - run `clog init`, copy `.claude/skills/reproduce/SKILL.md` into your Codex instructions, then start the server with `clog start`.
- **Any agent** - start the server with `clog start`, instrument code to POST JSON to `http://localhost:2999/log`, and inspect `~/.clog/logs/clog.ndjson`.

## What `/reproduce` does

1. **Agent asks about the bug** - what is broken, what you expected, and how to trigger it
2. **Agent adds `_clog()` calls to your code** - temporary logging at key points
3. **You reproduce the bug** - each `_clog()` call sends structured JSON to the local server
4. **Agent reads the logs** - finds where behavior diverged from what was expected
5. **Agent fixes the bug and cleans up** - removes the instrumentation and clears the log file

---

## What the logs look like

Each entry is a single JSON line with an auto-added timestamp:

```json
{"ts":"2026-02-27T14:23:01.456Z","data":{"step":"handleClick","button":"submit","formValid":false}}
{"ts":"2026-02-27T14:23:01.458Z","data":{"step":"validateForm","errors":["email required"]}}
{"ts":"2026-02-27T14:23:01.460Z","data":{"step":"handleClick:exit","submitted":false}}
```

## CLI reference

```bash
clog start                 # start the background log server
clog stop                  # stop the server
clog status                # show server PID, port, log file size

clog                       # show the latest 10 log lines
clog -n 50                 # show the latest 50 lines
clog -q "TypeError"        # filter lines matching "TypeError"
clog -n 100 -q "userId"    # combine count and filter

clog init                  # install the /reproduce skill into .claude/skills/
clog clear                 # truncate the log file
```

## Language support

clog is language-agnostic. Anything that can POST JSON to `http://localhost:2999/log` works. If you are using `/reproduce`, the agent will add the helper for your language. Otherwise, you can use one of these:

<details>
<summary><strong>Python</strong></summary>

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
</details>

<details>
<summary><strong>JavaScript / TypeScript</strong></summary>

```javascript
function _clog(data) {
  fetch("http://localhost:2999/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).catch(() => {});
}
```
</details>

<details>
<summary><strong>Rust</strong></summary>

```rust
fn _clog(data: &impl serde::Serialize) {
    let _ = reqwest::blocking::Client::new()
        .post("http://localhost:2999/log")
        .json(data)
        .send();
}
```
</details>

<details>
<summary><strong>Any language (curl)</strong></summary>

```bash
curl -s -X POST http://localhost:2999/log \
  -H 'Content-Type: application/json' \
  -d '{"step":"checkout","cart_total":42.50}'
```
</details>

## Architecture

- **Single Rust binary** — no runtime dependencies
- **Axum HTTP server** on localhost:2999
- **NDJSON storage** at `~/.clog/logs/clog.ndjson`
- **Background process** with PID tracking in `~/.clog/server.json`
- **CORS enabled** — works from browser apps too

---

## Acknowledgments

Inspired by [Cursor's debug mode](https://docs.cursor.com/agent/debug), which demonstrated the value of letting AI agents observe runtime behavior to diagnose bugs.
