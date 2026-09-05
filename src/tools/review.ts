import * as path from 'node:path';
import * as fs from 'node:fs';
import { z } from 'zod';
import { ToolRunner } from '../runner.js';
import { parseVerilatorXml } from '../parsers/ast.js';
import {
  evaluateAstRules,
  parseVerilatorOutput,
  computeReviewSummary,
} from '../rules/engine.js';
import { ReviewViolation } from '../parsers/types.js';

export const rtlReviewSchema = z.object({
  verilog_sources: z
    .array(z.string())
    .min(1)
    .describe('List of Verilog/SystemVerilog source files to review'),
  top_module: z
    .string()
    .optional()
    .describe('Top module name for AST hierarchy analysis'),
  ruleset: z
    .enum(['strict', 'standard', 'relaxed'])
    .optional()
    .default('standard')
    .describe('Rule severity enforcement level (default: standard)'),
  include_info: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether to include info-level violations (e.g. unused signals)'),
  cwd: z.string().optional().describe('Optional working directory'),
});

export async function handleRtlReview(
  runner: ToolRunner,
  args: z.infer<typeof rtlReviewSchema>
) {
  const baseCwd = path.resolve(args.cwd || process.cwd());
  const sourceFilesMap = new Map<string, string>();
  let linesAnalyzed = 0;

  for (const src of args.verilog_sources) {
    const fullPath = path.isAbsolute(src) ? src : path.join(baseCwd, src);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        sourceFilesMap.set(src, content);
        sourceFilesMap.set(fullPath, content);
        linesAnalyzed += content.split('\n').length;
      } catch {
        // Continue if reading fails
      }
    }
  }

  // 1. Generate XML AST
  const astRes = await runner.generateXmlAst(args.verilog_sources, {
    topModule: args.top_module,
    cwd: args.cwd,
  });

  // 2. Run semantic linting
  const lintOutput = await runner.runLint(args.verilog_sources, {
    topModule: args.top_module,
    cwd: args.cwd,
  });

  const compilerViolations = parseVerilatorOutput(lintOutput);

  let astViolations: ReviewViolation[] = [];
  let metrics = {
    modulesAnalyzed: 0,
    alwaysBlocksAnalyzed: 0,
    sequentialBlocks: 0,
    combinationalBlocks: 0,
    linesAnalyzed,
  };

  if (astRes.xml && astRes.xml.includes('<verilator_xml>')) {
    const parsedAst = parseVerilatorXml(astRes.xml, sourceFilesMap);
    const evalRes = evaluateAstRules(parsedAst);
    astViolations = evalRes.violations;
    metrics = {
      ...evalRes.metrics,
      linesAnalyzed,
    };
  } else if (astRes.exitCode !== 0) {
    // AST generation failed (syntax error or missing file)
    astViolations.push({
      ruleId: 'SYNTAX_OR_PARSE_ERROR',
      severity: 'error',
      file: args.verilog_sources[0] || 'unknown',
      line: 1,
      message: `Failed to generate Verilator AST: ${astRes.stderr.trim() || 'Unknown parse error'}`,
      fixSuggestion: 'Check syntax and ensure all referenced modules/headers exist.',
    });
  }

  const summary = computeReviewSummary(
    astViolations,
    compilerViolations,
    metrics,
    {
      ruleset: args.ruleset,
      includeInfo: args.include_info,
    }
  );

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(summary, null, 2),
      },
    ],
  };
}
