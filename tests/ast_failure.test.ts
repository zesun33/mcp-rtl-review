import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRunner } from '../src/runner.js';
import { AstGenerationResult } from '../src/parsers/types.js';
import { handleRtlReview } from '../src/tools/review.js';
import { handleRtlCheckAssignments } from '../src/tools/assignments.js';
import { handleRtlCheckResets } from '../src/tools/resets.js';

class FailedAstRunner extends ToolRunner {
  constructor(private result: AstGenerationResult) { super(); }
  override async generateAst(): Promise<AstGenerationResult> { return this.result; }
  override async runLint(): Promise<string> { return ''; }
}

const cases: [string, AstGenerationResult][] = [
  ['empty output with zero exit', {format:'json', content:'', exitCode:0, stderr:''}],
  ['malformed JSON', {format:'json', content:'{', metadata:'{}', exitCode:0, stderr:''}],
  ['missing JSON metadata', {format:'json', content:'{"type":"NETLIST","modulesp":[]}', exitCode:0, stderr:''}],
  ['no design modules', {format:'json', content:'{"type":"NETLIST","modulesp":[]}', metadata:'{"files":{}}', exitCode:0, stderr:''}],
  ['malformed XML', {format:'xml', content:'<verilator_xml><netlist><module name="broken">', exitCode:0, stderr:''}],
  ['invalid XML document', {format:'xml', content:'<unrelated/>', exitCode:0, stderr:''}],
  ['compiler failure with partial output', {format:'xml', content:'<verilator_xml><netlist><module name="partial"/></netlist></verilator_xml>', exitCode:42, stderr:'compiler failed'}],
];
for (const [label, result] of cases) {
  test(`AST failure never passes review, assignments, or reset audit: ${label}`, async () => {
    const runner = new FailedAstRunner(result);
    const args = {verilog_sources:['fixtures/clean_counter.v']};
    const review = JSON.parse((await handleRtlReview(runner, args)).content[0].text);
    assert.equal(review.passed, false);
    assert.ok(review.errors >= 1);
    assert.ok(review.violations.some((v: any) => v.ruleId === 'SYNTAX_OR_PARSE_ERROR'));
    for (const handler of [handleRtlCheckAssignments, handleRtlCheckResets]) {
      const audit = JSON.parse((await handler(runner, args)).content[0].text);
      assert.equal(audit.passed, false);
      assert.match(audit.error, /Failed to generate or parse AST/);
    }
  });
}
