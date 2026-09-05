# @zesun33/mcp-rtl-review

> Model Context Protocol (MCP) server for AST-backed static RTL code review, semantic bug detection, and code review scoring.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Protocol: MCP](https://img.shields.io/badge/protocol-MCP_stdio-blueviolet)](https://modelcontextprotocol.io)
[![Runtime: Rootless Podman](https://img.shields.io/badge/runtime-rootless_podman-brightgreen)](#execution-runtime)

`mcp-rtl-review` equips AI coding agents and IDEs (**Cursor**, **Windsurf**, **GitHub Copilot / OpenAI Codex**, **Claude Code**, **Google Antigravity**, **OpenCode**, **Cline**) with structured tools to perform semantic Verilog/SystemVerilog code reviews. It programmatically enforces the cognitive rubrics established in [`hw-agent-skills/skills/rtl-reviewer`](../hw-agent-skills/skills/rtl-reviewer/SKILL.md), parsing full typed ASTs to catch race conditions, improper assignment styles, inverted reset polarities, and bitwidth truncations.

---

## ⚡ Quick Tour: See It in Action

### Why AI Agents Need `mcp-rtl-review`
| Without `mcp-rtl-review` (Syntax Linters) | With `mcp-rtl-review` (AST-Backed Semantic Audit) |
| :--- | :--- |
| `verible-lint` only catches surface formatting and whitespace | Analyzes **full typed AST** for deep semantic hardware bugs |
| Misses blocking assignments (`=`) inside clocked sequential blocks | Flags **`SEQ_BLOCKING_ASSIGN`** with exact line and non-blocking `<=` fix |
| Silent active-low reset polarity bugs survive to simulation | Detects **`RESET_POLARITY_MISMATCH`** between sensitivity and `if` branch |
| Implicit bitwidth truncation requires reading manual compiler logs | Immediate **`WIDTH_MISMATCH`** alerts with expected vs actual bitwidths |
| Agent has no feedback on overall design quality | Computes a deterministic **0–100 RTL Quality Score** |
| Requires local installation of Verilator, Python, and C++ compilers | **Zero host configuration** (runs via isolated rootless Podman) |

### Real Agent Scenarios in 60 Seconds

#### 1. Probing the Environment (Zero-Config Verification)
```json
// Tool Call: rtl_toolchain_info
{
  "runtime": "podman",
  "image": "localhost/zesun33/verilog",
  "verilatorVersion": "Verilator 5.020 2024-01-01 rev (Debian 5.020-1)",
  "rulesSupported": [
    "SEQ_BLOCKING_ASSIGN",
    "COMB_NONBLOCKING_ASSIGN",
    "RESET_POLARITY_MISMATCH",
    "WIDTH_MISMATCH",
    "UNDRIVEN_NET",
    "COMBINATIONAL_LOOP",
    "UNUSED_SIGNAL"
  ]
}
```

#### 2. Clean Golden Module Audit (Score 100/100)
```json
// Tool Call: rtl_review {"verilog_sources": ["clean_counter.v"], "top_module": "clean_counter"}
{
  "passed": true,
  "score": 100,
  "totalViolations": 0,
  "errors": 0,
  "warnings": 0,
  "info": 0,
  "violations": [],
  "metrics": {
    "modulesAnalyzed": 1,
    "alwaysBlocksAnalyzed": 1,
    "sequentialBlocks": 1,
    "combinationalBlocks": 0,
    "linesAnalyzed": 16
  },
  "rulesChecked": ["SEQ_BLOCKING_ASSIGN", "COMB_NONBLOCKING_ASSIGN", "RESET_POLARITY_MISMATCH", "WIDTH_MISMATCH", "UNDRIVEN_NET", "COMBINATIONAL_LOOP", "UNUSED_SIGNAL"]
}
```

#### 3. Catching Simulation Race Conditions (Blocking Assignment in Sequential Block)
```json
// Tool Call: rtl_check_assignments {"verilog_sources": ["blocking_in_seq.v"], "top_module": "blocking_in_seq"}
{
  "passed": false,
  "totalViolations": 2,
  "blockingInSeq": [
    {
      "file": "fixtures/blocking_in_seq.v",
      "line": 11,
      "variable": "count",
      "message": "Blocking assignment '=' to 'count' inside sequential (clocked) block. This causes simulation race conditions.",
      "fixSuggestion": "Replace '=' with non-blocking assignment '<=' to 'count'."
    },
    {
      "file": "fixtures/blocking_in_seq.v",
      "line": 13,
      "variable": "count",
      "message": "Blocking assignment '=' to 'count' inside sequential (clocked) block. This causes simulation race conditions.",
      "fixSuggestion": "Replace '=' with non-blocking assignment '<=' to 'count'."
    }
  ],
  "nonBlockingInComb": []
}
```

#### 4. Flagging Inverted Reset Polarity
```json
// Tool Call: rtl_review {"verilog_sources": ["reset_mismatch.v"], "top_module": "reset_mismatch"}
{
  "passed": false,
  "score": 85,
  "errors": 1,
  "warnings": 0,
  "violations": [
    {
      "ruleId": "RESET_POLARITY_MISMATCH",
      "severity": "error",
      "file": "fixtures/reset_mismatch.v",
      "line": 10,
      "message": "Reset polarity inversion: sensitivity list declares active-low reset 'rst_n', but if condition checks active-high 'rst_n'.",
      "fixSuggestion": "Change condition to 'if (!rst_n)' to match sensitivity list polarity."
    }
  ]
}
```

#### 5. Detecting Bitwidth Truncation & Expansion
```json
// Tool Call: rtl_check_widths {"verilog_sources": ["width_mismatch.v"], "top_module": "width_mismatch"}
{
  "passed": false,
  "totalMismatches": 1,
  "widthMismatches": [
    {
      "file": "fixtures/width_mismatch.v",
      "line": 9,
      "expectedWidth": 4,
      "actualWidth": 8,
      "message": "Operator ASSIGN expects 4 bits on the Assign RHS, but Assign RHS's VARREF 'in_b' generates 8 bits.",
      "fixSuggestion": "Verify signal widths and explicitly slice or sign-extend operands to avoid unintended truncation."
    }
  ]
}
```

---

## Tools Exposed

| Tool | Parameters | Engine | Description |
| :--- | :--- | :--- | :--- |
| `rtl_review` | `verilog_sources: string[]`<br>`top_module?: string`<br>`ruleset?: "strict" \| "standard" \| "relaxed"`<br>`include_info?: boolean`<br>`cwd?: string` | Verilator XML AST + Diagnostics | Full AST-backed static RTL review evaluating assignment discipline, reset polarity, bitwidths, and undriven nets, returning a 0–100 Quality Score. |
| `rtl_check_assignments` | `verilog_sources: string[]`<br>`top_module?: string`<br>`cwd?: string` | AST Assignment Visitor | Audits source files specifically for assignment discipline violations (`=` in sequential or `<=` in combinational). |
| `rtl_check_widths` | `verilog_sources: string[]`<br>`top_module?: string`<br>`cwd?: string` | Verilator Semantic Lint | Performs bitwidth analysis to identify implicit truncation and unintended extension bugs. |
| `rtl_toolchain_info` | `cwd?: string` | Probe | Returns container/host runtime and version information for the Verilator AST parser and supported rule catalog. |

---

## Client Configuration

To register `mcp-rtl-review` with your AI IDE or agent, add it to your configuration file (e.g., `.cursor/mcp.json`, `claude_desktop_config.json`, or Windsurf settings):

```json
{
  "mcpServers": {
    "rtl-review": {
      "command": "node",
      "args": ["/path/to/mcp-rtl-review/dist/index.js"],
      "env": {
        "MCP_RTL_REVIEW_RUNTIME": "podman",
        "MCP_RTL_REVIEW_IMAGE": "localhost/zesun33/verilog"
      }
    }
  }
}
```

### Universal Compatibility
Works seamlessly across all modern AI coding environments:
- **Cursor**: Configure in `.cursor/mcp.json`.
- **Windsurf**: Configure in `~/.codeium/windsurf/mcp_config.json`.
- **GitHub Copilot / OpenAI Codex**: Configure via Copilot MCP settings or Codex tool proxy.
- **Claude Code**: Configure via `claude mcp add rtl-review node /path/to/dist/index.js`.
- **Google Antigravity**: Load as workspace MCP server in `antigravity.json`.
- **OpenCode & Cline**: Direct stdio JSON-RPC connection.

---

## Verification & Testing

Strict 6-gate verification suite matching the portfolio engineering standard:

```bash
# Full verification (all 6 gates)
./scripts/verify.sh

# Target specific gates
./scripts/verify.sh --gate 1   # Spec lock & package integrity
./scripts/verify.sh --gate 2   # Static build (TypeScript)
./scripts/verify.sh --gate 3   # Unit tests (AST parser & rule engine)
./scripts/verify.sh --gate 4   # Live Podman container integration tests
./scripts/verify.sh --gate 5   # Stdio JSON-RPC contract check
./scripts/verify.sh --gate 6   # Documentation validation
```

---

## License

Apache-2.0 © 2026 Md Zesun Ahmed Mia
