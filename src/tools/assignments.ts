import * as path from 'node:path';
import * as fs from 'node:fs';
import { z } from 'zod';
import { ToolRunner } from '../runner.js';
import { parseVerilatorXml } from '../parsers/ast.js';
import {
  evaluateAstRules,
  extractAssignmentViolations,
} from '../rules/engine.js';

export const rtlCheckAssignmentsSchema = z.object({
  verilog_sources: z
    .array(z.string())
    .min(1)
    .describe('List of Verilog/SystemVerilog source files to audit for assignment discipline'),
  top_module: z
    .string()
    .optional()
    .describe('Top module name for AST hierarchy analysis'),
  cwd: z.string().optional().describe('Optional working directory'),
});

export async function handleRtlCheckAssignments(
  runner: ToolRunner,
  args: z.infer<typeof rtlCheckAssignmentsSchema>
) {
  const baseCwd = path.resolve(args.cwd || process.cwd());
  const sourceFilesMap = new Map<string, string>();

  for (const src of args.verilog_sources) {
    const fullPath = path.isAbsolute(src) ? src : path.join(baseCwd, src);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        sourceFilesMap.set(src, content);
        sourceFilesMap.set(fullPath, content);
      } catch {
        // Continue if reading fails
      }
    }
  }

  const astRes = await runner.generateXmlAst(args.verilog_sources, {
    topModule: args.top_module,
    cwd: args.cwd,
  });

  if (!astRes.xml || !astRes.xml.includes('<verilator_xml>')) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              passed: false,
              totalViolations: 1,
              blockingInSeq: [],
              nonBlockingInComb: [],
              error: `Failed to generate AST: ${astRes.stderr.trim() || 'Unknown error'}`,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  const parsedAst = parseVerilatorXml(astRes.xml, sourceFilesMap);
  const evalRes = evaluateAstRules(parsedAst);
  const result = extractAssignmentViolations(evalRes.violations);

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
