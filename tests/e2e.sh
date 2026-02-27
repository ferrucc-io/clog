#!/usr/bin/env bash
# End-to-end test for clog: start server, post a log, query it, clear, stop.
# Run from the project root directory.
set -e

CLOG="$(pwd)/target/debug/clog"
PASSED=0
FAILED=0
TOTAL=0

# ── helpers ──────────────────────────────────────────────────────────────────

pass() {
    PASSED=$((PASSED + 1))
    TOTAL=$((TOTAL + 1))
    echo "  PASS: $1"
}

fail() {
    FAILED=$((FAILED + 1))
    TOTAL=$((TOTAL + 1))
    echo "  FAIL: $1"
}

check() {
    # Usage: check "description" <exit_code>
    if [ "$2" -eq 0 ]; then
        pass "$1"
    else
        fail "$1"
    fi
}

cleanup() {
    echo ""
    echo "── cleanup ────────────────────────────────────────────────────────"
    $CLOG stop 2>/dev/null || true
}

trap cleanup EXIT

# ── build ────────────────────────────────────────────────────────────────────

echo "── building project ─────────────────────────────────────────────────"
cargo build 2>&1
echo ""

# ── pre-test cleanup ─────────────────────────────────────────────────────────

echo "── pre-test cleanup ─────────────────────────────────────────────────"
$CLOG stop  2>/dev/null || true
$CLOG clear 2>/dev/null || true
echo ""

# ── tests ────────────────────────────────────────────────────────────────────

echo "── running tests ────────────────────────────────────────────────────"

# (a) clog start
$CLOG start 2>/dev/null
check "clog start succeeds" $?

# (b) clog status — should say "running"
STATUS_OUT=$($CLOG status 2>&1)
if echo "$STATUS_OUT" | grep -q "running"; then
    pass "clog status reports running"
else
    fail "clog status reports running (got: $STATUS_OUT)"
fi

# (c) python3 test-app/hello-world.py
PY_OUT=$(python3 test-app/hello-world.py 2>&1)
PY_RC=$?
check "hello-world.py exits successfully" $PY_RC
if [ $PY_RC -ne 0 ]; then
    echo "       python output: $PY_OUT"
fi

# (d) clog latest -n 1 — should contain hello-world and Hello from Python!
sleep 0.2
LATEST=$($CLOG -n 1 2>/dev/null)
if echo "$LATEST" | grep -q "hello-world"; then
    pass "latest contains 'hello-world'"
else
    fail "latest contains 'hello-world' (got: $LATEST)"
fi

if echo "$LATEST" | grep -q "Hello from Python!"; then
    pass "latest contains 'Hello from Python!'"
else
    fail "latest contains 'Hello from Python!' (got: $LATEST)"
fi

# (e) clog clear — then latest should produce no output
$CLOG clear 2>/dev/null
LATEST_AFTER_CLEAR=$($CLOG -n 1 2>/dev/null)
if [ -z "$LATEST_AFTER_CLEAR" ]; then
    pass "latest is empty after clear"
else
    fail "latest is empty after clear (got: $LATEST_AFTER_CLEAR)"
fi

# (f) clog init — installs skill into a temp directory
INIT_DIR=$(mktemp -d)
(cd "$INIT_DIR" && $CLOG init 2>/dev/null)
if [ -f "$INIT_DIR/.claude/skills/reproduce/SKILL.md" ]; then
    pass "clog init creates .claude/skills/reproduce/SKILL.md"
else
    fail "clog init creates .claude/skills/reproduce/SKILL.md"
fi

# verify SKILL.md has the expected frontmatter
if grep -q "name: reproduce" "$INIT_DIR/.claude/skills/reproduce/SKILL.md"; then
    pass "SKILL.md contains correct frontmatter"
else
    fail "SKILL.md contains correct frontmatter"
fi

# running init again should be idempotent (no error)
INIT_AGAIN=$( (cd "$INIT_DIR" && $CLOG init) 2>&1)
if echo "$INIT_AGAIN" | grep -q "already installed"; then
    pass "clog init is idempotent"
else
    fail "clog init is idempotent (got: $INIT_AGAIN)"
fi
rm -rf "$INIT_DIR"

# (g) clog stop
$CLOG stop 2>/dev/null
check "clog stop succeeds" $?

# (h) clog status — should say "not running"
STATUS_AFTER=$($CLOG status 2>&1)
if echo "$STATUS_AFTER" | grep -q "not running"; then
    pass "clog status reports not running after stop"
else
    fail "clog status reports not running after stop (got: $STATUS_AFTER)"
fi

# ── summary ──────────────────────────────────────────────────────────────────

echo ""
echo "── summary ────────────────────────────────────────────────────────"
echo "  Total: $TOTAL   Passed: $PASSED   Failed: $FAILED"

if [ "$FAILED" -gt 0 ]; then
    echo "  RESULT: FAIL"
    exit 1
else
    echo "  RESULT: PASS"
    exit 0
fi
