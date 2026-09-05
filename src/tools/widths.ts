import { z } from 'zod';
import { ToolRunner } from '../runner.js';
import {
  parseVerilatorOutput,
  extractWidthViolations,
} from '../rules/engine.js';

export const rtlCheckWidthsSchema = z.object({
  verilog_sources: z
    .array(z.string())
    .min(1)
    .describe('List of Verilog/SystemVerilog source files to check for bitwidth mismatches'),
  top_module: z
    .string()
    .optional()
    .describe('Top module name for hierarchy analysis'),
  cwd: z.string().optional().describe('Optional working directory'),
});

export async function handleRtlCheckWidths(
  runner: ToolRunner,
  args: z.infer<typeof rtlCheckWidthsSchema>
) {
  const lintOutput = await runner.runLint(args.verilog_sources, {
    topModule: args.top_module,
    cwd: args.cwd,
  });

  const compilerViolations = parseVerilatorOutput(lintOutput);
  const result = extractWidthViolations(compilerViolations);

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
