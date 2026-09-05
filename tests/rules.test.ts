import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAstRules,
  parseVerilatorOutput,
  computeReviewSummary,
  extractAssignmentViolations,
  extractWidthViolations,
} from '../src/rules/engine.js';
import { ParsedAst } from '../src/parsers/types.js';

test('evaluateAstRules flags SEQ_BLOCKING_ASSIGN in sequential block', () => {
  const ast: ParsedAst = {
    files: new Map([['d', 'counter.v']]),
    modules: [
      {
        name: 'counter',
        file: 'counter.v',
        alwaysBlocks: [
          {
            loc: { fileId: 'd', startLine: 5, startCol: 1, endLine: 12, endCol: 1, raw: '' },
            isSequential: true,
            senItems: [{ edgeType: 'POS', signalName: 'clk' }],
            assignments: [
              {
                type: 'blocking',
                line: 8,
                column: 15,
                file: 'counter.v',
                targetVar: 'count',
              },
            ],
          },
        ],
      },
    ],
  };

  const { violations, metrics } = evaluateAstRules(ast);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].ruleId, 'SEQ_BLOCKING_ASSIGN');
  assert.equal(violations[0].severity, 'error');
  assert.equal(violations[0].line, 8);
  assert.ok(violations[0].message.includes("count"));
  assert.ok(violations[0].fixSuggestion.includes("<="));
  assert.equal(metrics.sequentialBlocks, 1);
});

test('evaluateAstRules flags COMB_NONBLOCKING_ASSIGN in combinational block', () => {
  const ast: ParsedAst = {
    files: new Map([['d', 'alu.v']]),
    modules: [
      {
        name: 'alu',
        file: 'alu.v',
        alwaysBlocks: [
          {
            loc: { fileId: 'd', startLine: 5, startCol: 1, endLine: 10, endCol: 1, raw: '' },
            isSequential: false,
            senItems: [],
            assignments: [
              {
                type: 'nonblocking',
                line: 7,
                column: 10,
                file: 'alu.v',
                targetVar: 'out_val',
              },
            ],
          },
        ],
      },
    ],
  };

  const { violations, metrics } = evaluateAstRules(ast);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].ruleId, 'COMB_NONBLOCKING_ASSIGN');
  assert.equal(violations[0].severity, 'warning');
  assert.equal(violations[0].line, 7);
  assert.ok(violations[0].fixSuggestion.includes("="));
  assert.equal(metrics.combinationalBlocks, 1);
});

test('evaluateAstRules flags RESET_POLARITY_MISMATCH', () => {
  const ast: ParsedAst = {
    files: new Map([['d', 'reg_block.v']]),
    modules: [
      {
        name: 'reg_block',
        file: 'reg_block.v',
        alwaysBlocks: [
          {
            loc: { fileId: 'd', startLine: 5, startCol: 1, endLine: 15, endCol: 1, raw: '' },
            isSequential: true,
            senItems: [
              { edgeType: 'POS', signalName: 'clk' },
              { edgeType: 'NEG', signalName: 'rst_n' },
            ],
            assignments: [],
            hasResetMismatch: true,
            resetMismatchDetails: {
              resetName: 'rst_n',
              expectedCondition: '!rst_n',
              actualCondition: 'rst_n',
              line: 8,
            },
          },
        ],
      },
    ],
  };

  const { violations } = evaluateAstRules(ast);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].ruleId, 'RESET_POLARITY_MISMATCH');
  assert.equal(violations[0].severity, 'error');
  assert.equal(violations[0].line, 8);
  assert.ok(violations[0].fixSuggestion.includes('!rst_n'));
});

test('parseVerilatorOutput parses WIDTHTRUNC and UNDRIVEN warnings', () => {
  const rawOutput = `%Warning-WIDTHTRUNC: fixtures/width_mismatch.v:9:17: Operator ASSIGN expects 4 bits on the Assign RHS, but Assign RHS's VARREF 'in_b' generates 8 bits.
%Warning-UNDRIVEN: fixtures/undriven.v:4:12: Signal is not driven, nor used: 'unconn_net'
%Warning-UNUSEDSIGNAL: fixtures/unused.v:2:5: Signal is not used: 'temp'`;

  const violations = parseVerilatorOutput(rawOutput);
  assert.equal(violations.length, 3);

  assert.equal(violations[0].ruleId, 'WIDTH_MISMATCH');
  assert.equal(violations[0].severity, 'warning');
  assert.equal(violations[0].line, 9);
  assert.equal(violations[0].column, 17);

  assert.equal(violations[1].ruleId, 'UNDRIVEN_NET');
  assert.equal(violations[1].severity, 'warning');

  assert.equal(violations[2].ruleId, 'UNUSED_SIGNAL');
  assert.equal(violations[2].severity, 'info');
});

test('computeReviewSummary calculates score and handles rulesets correctly', () => {
  const metrics = {
    modulesAnalyzed: 1,
    alwaysBlocksAnalyzed: 2,
    sequentialBlocks: 1,
    combinationalBlocks: 1,
    linesAnalyzed: 50,
  };

  // Clean design -> score 100
  const cleanSummary = computeReviewSummary([], [], metrics);
  assert.equal(cleanSummary.passed, true);
  assert.equal(cleanSummary.score, 100);
  assert.equal(cleanSummary.errors, 0);
  assert.equal(cleanSummary.warnings, 0);

  // Design with 1 error and 1 warning
  const dirtySummary = computeReviewSummary(
    [
      {
        ruleId: 'SEQ_BLOCKING_ASSIGN',
        severity: 'error',
        file: 'test.v',
        line: 10,
        message: 'Blocking assign',
        fixSuggestion: 'Use <=',
      },
    ],
    [
      {
        ruleId: 'WIDTH_MISMATCH',
        severity: 'warning',
        file: 'test.v',
        line: 15,
        message: 'Truncation',
        fixSuggestion: 'Slice operand',
      },
    ],
    metrics
  );

  assert.equal(dirtySummary.passed, false);
  assert.equal(dirtySummary.errors, 1);
  assert.equal(dirtySummary.warnings, 1);
  // 100 - 15 - 5 = 80
  assert.equal(dirtySummary.score, 80);
});

test('extractAssignmentViolations and extractWidthViolations partition correctly', () => {
  const violations = [
    {
      ruleId: 'SEQ_BLOCKING_ASSIGN',
      severity: 'error' as const,
      file: 'counter.v',
      line: 12,
      message: "Blocking assignment '=' to 'count' inside sequential block.",
      fixSuggestion: "Replace '=' with '<='.",
    },
    {
      ruleId: 'WIDTH_MISMATCH',
      severity: 'warning' as const,
      file: 'math.v',
      line: 20,
      message: "Operator ASSIGN expects 4 bits on RHS, but generates 8 bits.",
      fixSuggestion: "Slice to [3:0].",
    },
  ];

  const assignRes = extractAssignmentViolations(violations);
  assert.equal(assignRes.passed, false);
  assert.equal(assignRes.blockingInSeq.length, 1);
  assert.equal(assignRes.blockingInSeq[0].variable, 'count');
  assert.equal(assignRes.nonBlockingInComb.length, 0);

  const widthRes = extractWidthViolations(violations);
  assert.equal(widthRes.passed, false);
  assert.equal(widthRes.widthMismatches.length, 1);
  assert.equal(widthRes.widthMismatches[0].expectedWidth, 4);
  assert.equal(widthRes.widthMismatches[0].actualWidth, 8);
});
