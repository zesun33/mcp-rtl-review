import {
  ParsedAst,
  ReviewViolation,
  ReviewSummary,
  ReviewMetrics,
  AssignmentCheckResult,
  WidthCheckResult,
} from '../parsers/types.js';

export const SUPPORTED_RULES = [
  'SEQ_BLOCKING_ASSIGN',
  'COMB_NONBLOCKING_ASSIGN',
  'RESET_POLARITY_MISMATCH',
  'WIDTH_MISMATCH',
  'UNDRIVEN_NET',
  'COMBINATIONAL_LOOP',
  'UNUSED_SIGNAL',
];

export interface ReviewOptions {
  ruleset?: 'strict' | 'standard' | 'relaxed';
  includeInfo?: boolean;
}

export function parseVerilatorOutput(output: string): ReviewViolation[] {
  const violations: ReviewViolation[] = [];
  const lines = output.split('\n');

  const warnRegex = /^%(Warning|Error)-([A-Z0-9_]+):\s+([^:]+):(\d+):(\d+):\s+(.*)$/;

  for (const line of lines) {
    const match = line.match(warnRegex);
    if (!match) continue;

    const [, sevStr, warnCode, file, lineStr, colStr, message] = match;
    const lineNum = parseInt(lineStr, 10);
    const colNum = parseInt(colStr, 10);

    let ruleId = warnCode;
    let severity: 'error' | 'warning' | 'info' =
      sevStr === 'Error' ? 'error' : 'warning';
    let fixSuggestion = 'Review and resolve this warning according to RTL design guidelines.';

    if (warnCode === 'WIDTHTRUNC' || warnCode === 'WIDTHEXPAND') {
      ruleId = 'WIDTH_MISMATCH';
      severity = 'warning';
      fixSuggestion =
        'Explicitly slice operands (e.g. signal[3:0]) or size constants to match destination width.';
    } else if (warnCode === 'UNDRIVEN') {
      ruleId = 'UNDRIVEN_NET';
      severity = 'warning';
      fixSuggestion =
        'Ensure the net is driven by a continuous assignment or within a procedural block.';
    } else if (warnCode === 'UNUSEDSIGNAL') {
      ruleId = 'UNUSED_SIGNAL';
      severity = 'info';
      fixSuggestion =
        'Remove unused wire/port or mark it with lint_off if intentionally unused.';
    } else if (warnCode === 'UNOPTFLAT') {
      ruleId = 'COMBINATIONAL_LOOP';
      severity = 'error';
      fixSuggestion =
        'Break the combinational feedback loop by inserting a clocked register or restructuring logic.';
    }

    violations.push({
      ruleId,
      severity,
      file,
      line: lineNum,
      column: colNum,
      message,
      fixSuggestion,
    });
  }

  return violations;
}

export function evaluateAstRules(ast: ParsedAst): {
  violations: ReviewViolation[];
  metrics: ReviewMetrics;
} {
  const violations: ReviewViolation[] = [];

  let modulesAnalyzed = 0;
  let alwaysBlocksAnalyzed = 0;
  let sequentialBlocks = 0;
  let combinationalBlocks = 0;

  for (const mod of ast.modules) {
    modulesAnalyzed++;

    for (const alw of mod.alwaysBlocks) {
      alwaysBlocksAnalyzed++;

      if (alw.isSequential) {
        sequentialBlocks++;

        // Rule: SEQ_BLOCKING_ASSIGN
        for (const assign of alw.assignments) {
          if (assign.type === 'blocking') {
            const varMsg = assign.targetVar ? ` to '${assign.targetVar}'` : '';
            violations.push({
              ruleId: 'SEQ_BLOCKING_ASSIGN',
              severity: 'error',
              file: assign.file,
              line: assign.line,
              column: assign.column,
              message: `Blocking assignment '='${varMsg} inside sequential (clocked) block. This causes simulation race conditions.`,
              fixSuggestion: `Replace '=' with non-blocking assignment '<='${varMsg}.`,
            });
          }
        }

        // Rule: RESET_POLARITY_MISMATCH
        if (alw.hasResetMismatch && alw.resetMismatchDetails) {
          const det = alw.resetMismatchDetails;
          violations.push({
            ruleId: 'RESET_POLARITY_MISMATCH',
            severity: 'error',
            file: mod.file,
            line: det.line,
            message: `Reset polarity inversion: sensitivity list declares active-low reset '${det.resetName}', but if condition checks active-high '${det.actualCondition}'.`,
            fixSuggestion: `Change condition to 'if (${det.expectedCondition})' to match sensitivity list polarity.`,
          });
        }
      } else {
        combinationalBlocks++;

        // Rule: COMB_NONBLOCKING_ASSIGN
        for (const assign of alw.assignments) {
          if (assign.type === 'nonblocking') {
            const varMsg = assign.targetVar ? ` to '${assign.targetVar}'` : '';
            violations.push({
              ruleId: 'COMB_NONBLOCKING_ASSIGN',
              severity: 'warning',
              file: assign.file,
              line: assign.line,
              column: assign.column,
              message: `Non-blocking assignment '<='${varMsg} inside combinational block. This creates unnecessary delta cycles and can infer latches.`,
              fixSuggestion: `Replace '<=' with blocking assignment '='${varMsg}.`,
            });
          }
        }
      }
    }
  }

  const metrics: ReviewMetrics = {
    modulesAnalyzed,
    alwaysBlocksAnalyzed,
    sequentialBlocks,
    combinationalBlocks,
    linesAnalyzed: 0,
  };

  return { violations, metrics };
}

export function computeReviewSummary(
  astViolations: ReviewViolation[],
  compilerViolations: ReviewViolation[],
  metrics: ReviewMetrics,
  options: ReviewOptions = {}
): ReviewSummary {
  const allViolations = [...astViolations, ...compilerViolations];

  // Filter based on ruleset and includeInfo
  const filtered = allViolations.filter((v) => {
    if (!options.includeInfo && v.severity === 'info') return false;
    if (options.ruleset === 'relaxed' && v.severity === 'info') return false;
    return true;
  });

  const errors = filtered.filter((v) => v.severity === 'error').length;
  const warnings = filtered.filter((v) => v.severity === 'warning').length;
  const info = filtered.filter((v) => v.severity === 'info').length;

  // Quality score formula: 100 - (errors * 15) - (warnings * 5) - (info * 1)
  let score = 100 - errors * 15 - warnings * 5 - info * 1;
  if (score < 0) score = 0;
  if (errors > 0 && score > 85) score = 85; // Cap score if there are fatal errors

  const passed = errors === 0 && (options.ruleset === 'relaxed' || warnings === 0);

  return {
    passed,
    score,
    totalViolations: filtered.length,
    errors,
    warnings,
    info,
    violations: filtered,
    metrics,
    rulesChecked: SUPPORTED_RULES,
  };
}

export function extractAssignmentViolations(violations: ReviewViolation[]): AssignmentCheckResult {
  const blockingInSeq = violations
    .filter((v) => v.ruleId === 'SEQ_BLOCKING_ASSIGN')
    .map((v) => ({
      file: v.file,
      line: v.line,
      variable:
        v.message.match(/to '([^']+)'/)?.[1] ||
        v.fixSuggestion.match(/to '([^']+)'/)?.[1] ||
        'unknown',
      message: v.message,
      fixSuggestion: v.fixSuggestion,
    }));

  const nonBlockingInComb = violations
    .filter((v) => v.ruleId === 'COMB_NONBLOCKING_ASSIGN')
    .map((v) => ({
      file: v.file,
      line: v.line,
      variable:
        v.message.match(/to '([^']+)'/)?.[1] ||
        v.fixSuggestion.match(/to '([^']+)'/)?.[1] ||
        'unknown',
      message: v.message,
      fixSuggestion: v.fixSuggestion,
    }));

  return {
    passed: blockingInSeq.length === 0 && nonBlockingInComb.length === 0,
    totalViolations: blockingInSeq.length + nonBlockingInComb.length,
    blockingInSeq,
    nonBlockingInComb,
  };
}

export function extractWidthViolations(violations: ReviewViolation[]): WidthCheckResult {
  const widthMismatches = violations
    .filter((v) => v.ruleId === 'WIDTH_MISMATCH')
    .map((v) => {
      const expMatch = v.message.match(/expects (\d+) bits/);
      const actMatch = v.message.match(/generates (\d+) bits/);
      return {
        file: v.file,
        line: v.line,
        expectedWidth: expMatch ? parseInt(expMatch[1], 10) : undefined,
        actualWidth: actMatch ? parseInt(actMatch[1], 10) : undefined,
        message: v.message,
        fixSuggestion: v.fixSuggestion,
      };
    });

  return {
    passed: widthMismatches.length === 0,
    totalMismatches: widthMismatches.length,
    widthMismatches,
  };
}
