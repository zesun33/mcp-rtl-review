import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolRunner } from './runner.js';
import {
  handleRtlReview,
  rtlReviewSchema,
} from './tools/review.js';
import {
  handleRtlCheckAssignments,
  rtlCheckAssignmentsSchema,
} from './tools/assignments.js';
import {
  handleRtlCheckWidths,
  rtlCheckWidthsSchema,
} from './tools/widths.js';
import {
  handleRtlToolchainInfo,
  rtlToolchainInfoSchema,
} from './tools/toolchain.js';
import {
  handleRtlCheckResets,
  rtlCheckResetsSchema,
} from './tools/resets.js';
import {
  buildAssertion,
  rtlGenerateAssertionSchema,
} from './tools/assertion.js';

export function createServer(): Server {
  const runner = new ToolRunner();

  const server = new Server(
    {
      name: '@zesun33/mcp-rtl-review',
      version: '0.2.1',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const tools: Tool[] = [
    {
      name: 'rtl_review',
      description:
        'Performs full AST-backed static RTL review and semantic code audit on Verilog/SystemVerilog designs, evaluating assignment discipline, reset usage and polarity, bitwidths, undriven nets, latch/case hazards, and synthesis constructs, and computing a 0–100 quality score with actionable fix suggestions.',
      inputSchema: {
        type: 'object',
        properties: {
          verilog_sources: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of Verilog/SystemVerilog source files to review.',
          },
          top_module: {
            type: 'string',
            description: 'Top module name for AST hierarchy analysis.',
          },
          ruleset: {
            type: 'string',
            enum: ['strict', 'standard', 'relaxed'],
            description: 'Rule severity enforcement level (default: standard).',
          },
          include_info: {
            type: 'boolean',
            description: 'Whether to include info-level violations (e.g. unused signals).',
          },
          cwd: {
            type: 'string',
            description: 'Optional working directory where source files reside.',
          },
        },
        required: ['verilog_sources'],
      },
    },
    {
      name: 'rtl_check_assignments',
      description:
        "Audits Verilog/SystemVerilog source files specifically for assignment discipline violations: blocking '=' in sequential clocked blocks, or non-blocking '<=' in combinational blocks.",
      inputSchema: {
        type: 'object',
        properties: {
          verilog_sources: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of Verilog/SystemVerilog source files to audit.',
          },
          top_module: {
            type: 'string',
            description: 'Top module name for AST hierarchy analysis.',
          },
          cwd: {
            type: 'string',
            description: 'Optional working directory where source files reside.',
          },
        },
        required: ['verilog_sources'],
      },
    },
    {
      name: 'rtl_check_widths',
      description:
        'Performs semantic bitwidth analysis on Verilog/SystemVerilog designs, detecting implicit truncation and bit expansion mismatches.',
      inputSchema: {
        type: 'object',
        properties: {
          verilog_sources: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of Verilog/SystemVerilog source files to check.',
          },
          top_module: {
            type: 'string',
            description: 'Top module name for hierarchy analysis.',
          },
          cwd: {
            type: 'string',
            description: 'Optional working directory where source files reside.',
          },
        },
        required: ['verilog_sources'],
      },
    },
    {
      name: 'rtl_check_resets',
      description:
        'Audits reset usage per sequential block: presence, identity, edge, and polarity agreement, with per-block findings.',
      inputSchema: {
        type: 'object',
        properties: {
          verilog_sources: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of Verilog/SystemVerilog source files to audit.',
          },
          top_module: {
            type: 'string',
            description: 'Top module name for AST hierarchy analysis.',
          },
          cwd: {
            type: 'string',
            description: 'Optional working directory where source files reside.',
          },
        },
        required: ['verilog_sources'],
      },
    },
    {
      name: 'rtl_generate_assertion',
      description:
        'Generates a SystemVerilog Assertion (SVA) scaffold from a property template (no_x_after_reset, reset_value, req_ack_handshake, onehot) with a TODO to bind and prove it. Scaffolding only — prove before signoff.',
      inputSchema: {
        type: 'object',
        properties: {
          signal: {
            type: 'string',
            description: 'Signal the property reasons about.',
          },
          clock: {
            type: 'string',
            description: 'Clock signal name (default: clk).',
          },
          reset: {
            type: 'string',
            description: 'Reset signal name (required for reset-bound properties).',
          },
          reset_active_low: {
            type: 'boolean',
            description: 'Whether reset is active-low (default: true).',
          },
          property_type: {
            type: 'string',
            enum: ['no_x_after_reset', 'reset_value', 'req_ack_handshake', 'onehot'],
            description: 'Property template to instantiate.',
          },
          ack_signal: {
            type: 'string',
            description: 'Acknowledge signal (required for req_ack_handshake).',
          },
          reset_value: {
            type: 'string',
            description: "Expected value after reset (default: '0').",
          },
        },
        required: ['signal', 'property_type'],
      },
    },
    {
      name: 'rtl_toolchain_info',
      description:
        'Returns active container/host runtime and version information for the Verilator AST parser and supported rule list.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: {
            type: 'string',
            description: 'Optional workspace directory.',
          },
        },
      },
    },
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      if (name === 'rtl_review') {
        const parsedArgs = rtlReviewSchema.parse(args);
        return await handleRtlReview(runner, parsedArgs);
      }

      if (name === 'rtl_check_assignments') {
        const parsedArgs = rtlCheckAssignmentsSchema.parse(args);
        return await handleRtlCheckAssignments(runner, parsedArgs);
      }

      if (name === 'rtl_check_widths') {
        const parsedArgs = rtlCheckWidthsSchema.parse(args);
        return await handleRtlCheckWidths(runner, parsedArgs);
      }

      if (name === 'rtl_check_resets') {
        const parsedArgs = rtlCheckResetsSchema.parse(args);
        return await handleRtlCheckResets(runner, parsedArgs);
      }

      if (name === 'rtl_generate_assertion') {
        const parsedArgs = rtlGenerateAssertionSchema.parse(args);
        const result = buildAssertion(parsedArgs);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      if (name === 'rtl_toolchain_info') {
        const parsedArgs = rtlToolchainInfoSchema.parse(args);
        return await handleRtlToolchainInfo(runner, parsedArgs);
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: msg }, null, 2) }],
        isError: true,
      };
    }
  });

  return server;
}
