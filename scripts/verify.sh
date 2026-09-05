#!/usr/bin/env bash
# verify.sh — Verification flow for @zesun33/mcp-rtl-review.
#
# Mirrors the strict engineering standard from hw-agent-tooling.
# Each gate is independent and exits non-zero on failure.
#
# Usage:
#   ./scripts/verify.sh              # full verification
#   ./scripts/verify.sh --gate N     # run only gate N

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

GATE=""
for arg in "$@"; do
  case "$arg" in
    --gate) shift; GATE="${1:-}" ;;
    --gate=*) GATE="${arg#--gate=}" ;;
    -h|--help)
      echo "verify.sh — mcp-rtl-review verification suite"
      echo "  --gate N       Run only the given gate (1..6)"
      echo "                   1  spec lock & package integrity"
      echo "                   2  static typecheck & build"
      echo "                   3  unit tests (parsers & contract)"
      echo "                   4  fixture integration (podman verilator ast & review)"
      echo "                   5  stdio protocol contract (json-rpc probe)"
      echo "                   6  docs verification"
      exit 0
      ;;
  esac
done

pass() { echo -e "\033[0;32m[PASS]\033[0m Gate $1: $2"; }
fail() { echo -e "\033[0;31m[FAIL]\033[0m Gate $1: $2"; exit 1; }

run_gate_1() {
  echo "--- Gate 1: Spec Lock & Package Integrity ---"
  test -f package.json || fail 1 "package.json missing"
  test -f tsconfig.json || fail 1 "tsconfig.json missing"
  pass 1 "Package files present and locked"
}

run_gate_2() {
  echo "--- Gate 2: Static Quality & Build ---"
  npm run build || fail 2 "TypeScript compilation failed"
  test -f dist/index.js || fail 2 "dist/index.js not produced"
  pass 2 "TypeScript compiled cleanly"
}

run_gate_3() {
  echo "--- Gate 3: Unit Tests (Parsers & Schema Contract) ---"
  npm run test:unit || fail 3 "Unit tests failed"
  pass 3 "Unit and schema contract tests passed"
}

run_gate_4() {
  echo "--- Gate 4: Fixture Integration (Podman Verilator AST & Review) ---"
  npx tsx --test tests/integration.test.ts || fail 4 "Integration tests failed"
  pass 4 "Podman container integration passed on RTL review fixtures"
}

run_gate_5() {
  echo "--- Gate 5: Protocol Contract (stdio JSON-RPC) ---"
  RESPONSE=$(echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js)
  echo "${RESPONSE}" | grep -q "rtl_review" || fail 5 "Tools list does not contain rtl_review"
  echo "${RESPONSE}" | grep -q "rtl_check_assignments" || fail 5 "Tools list does not contain rtl_check_assignments"
  pass 5 "Stdio JSON-RPC contract validated"
}

run_gate_6() {
  echo "--- Gate 6: Docs Verification ---"
  test -f README.md || fail 6 "README.md missing"
  grep -q "rtl_review" README.md || fail 6 "README missing rtl_review docs"
  grep -q "Quick Tour" README.md || fail 6 "README missing Quick Tour showcase"
  grep -q "mcpServers" README.md || fail 6 "README missing client configuration snippets"
  pass 6 "Documentation complete with Quick Tour and client config snippets"
}

case "${GATE}" in
  1) run_gate_1 ;;
  2) run_gate_2 ;;
  3) run_gate_3 ;;
  4) run_gate_4 ;;
  5) run_gate_5 ;;
  6) run_gate_6 ;;
  "")
    run_gate_1
    run_gate_2
    run_gate_3
    run_gate_4
    run_gate_5
    run_gate_6
    echo ""
    echo -e "\033[0;32m=== All Gates Cleared: mcp-rtl-review Verified ===\033[0m"
    ;;
  *)
    fail "?" "Unknown gate: ${GATE}"
    ;;
esac
