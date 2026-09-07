import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolRunner } from '../src/runner.js';
import { handleRtlReview } from '../src/tools/review.js';
import { handleRtlCheckAssignments } from '../src/tools/assignments.js';
import { handleRtlCheckWidths } from '../src/tools/widths.js';
import { handleRtlToolchainInfo } from '../src/tools/toolchain.js';
import { handleRtlCheckResets } from '../src/tools/resets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

test('Integration: rtl_toolchain_info returns podman and Verilator version', async () => {
  const runner = new ToolRunner();
  const res = await handleRtlToolchainInfo(runner, { cwd: projectRoot });

  assert.ok(res.content[0].text);
  const data = JSON.parse(res.content[0].text);
  assert.equal(data.runtime, 'podman');
  assert.ok(data.verilatorVersion.includes('Verilator'));
  assert.ok(data.rulesSupported.includes('SEQ_BLOCKING_ASSIGN'));
});

test('Integration: clean_counter passes full review with score 100', async () => {
  const runner = new ToolRunner();
  const res = await handleRtlReview(runner, {
    verilog_sources: ['fixtures/clean_counter.v'],
    top_module: 'clean_counter',
    cwd: projectRoot,
  });

  const data = JSON.parse(res.content[0].text);
  assert.equal(data.passed, true);
  assert.equal(data.score, 100);
  assert.equal(data.errors, 0);
  assert.equal(data.warnings, 0);
  assert.equal(data.metrics.sequentialBlocks, 1);
});

test('Integration: blocking_in_seq flags SEQ_BLOCKING_ASSIGN and deducts score', async () => {
  const runner = new ToolRunner();
  const res = await handleRtlReview(runner, {
    verilog_sources: ['fixtures/blocking_in_seq.v'],
    top_module: 'blocking_in_seq',
    cwd: projectRoot,
  });

  const data = JSON.parse(res.content[0].text);
  assert.equal(data.passed, false);
  assert.ok(data.score <= 85);
  assert.ok(data.errors >= 1);

  const seqBlock = data.violations.find((v: any) => v.ruleId === 'SEQ_BLOCKING_ASSIGN');
  assert.ok(seqBlock, 'Must flag SEQ_BLOCKING_ASSIGN');
  assert.equal(seqBlock.severity, 'error');
  assert.ok(seqBlock.fixSuggestion.includes('<='));
});

test('Integration: rtl_check_assignments detects improper assignments in seq and comb', async () => {
  const runner = new ToolRunner();
  
  // Test blocking in seq
  const resSeq = await handleRtlCheckAssignments(runner, {
    verilog_sources: ['fixtures/blocking_in_seq.v'],
    top_module: 'blocking_in_seq',
    cwd: projectRoot,
  });
  const dataSeq = JSON.parse(resSeq.content[0].text);
  assert.equal(dataSeq.passed, false);
  assert.ok(dataSeq.blockingInSeq.length >= 1);
  assert.equal(dataSeq.blockingInSeq[0].variable, 'count');

  // Test non-blocking in comb
  const resComb = await handleRtlCheckAssignments(runner, {
    verilog_sources: ['fixtures/comb_nonblocking.v'],
    top_module: 'comb_nonblocking',
    cwd: projectRoot,
  });
  const dataComb = JSON.parse(resComb.content[0].text);
  assert.equal(dataComb.passed, false);
  assert.ok(dataComb.nonBlockingInComb.length >= 1);
  assert.equal(dataComb.nonBlockingInComb[0].variable, 'sum');
});

test('Integration: reset_mismatch flags RESET_POLARITY_MISMATCH', async () => {
  const runner = new ToolRunner();
  const res = await handleRtlReview(runner, {
    verilog_sources: ['fixtures/reset_mismatch.v'],
    top_module: 'reset_mismatch',
    cwd: projectRoot,
  });

  const data = JSON.parse(res.content[0].text);
  assert.equal(data.passed, false);

  const resetViolation = data.violations.find(
    (v: any) => v.ruleId === 'RESET_POLARITY_MISMATCH'
  );
  assert.ok(resetViolation, 'Must flag RESET_POLARITY_MISMATCH');
  assert.equal(resetViolation.severity, 'error');
  assert.ok(resetViolation.fixSuggestion.includes('!rst_n'));
});

test('Integration: rtl_check_widths detects truncation in width_mismatch', async () => {
  const runner = new ToolRunner();
  const res = await handleRtlCheckWidths(runner, {
    verilog_sources: ['fixtures/width_mismatch.v'],
    top_module: 'width_mismatch',
    cwd: projectRoot,
  });

  const data = JSON.parse(res.content[0].text);
  assert.equal(data.passed, false);
  assert.ok(data.widthMismatches.length >= 1);
  assert.equal(data.widthMismatches[0].expectedWidth, 4);
  assert.equal(data.widthMismatches[0].actualWidth, 8);
  assert.ok(data.widthMismatches[0].fixSuggestion.includes('slice'));
});

test('Integration: missing_reset flags MISSING_RESET with score 95', async () => {
  const runner = new ToolRunner();
  const res = await handleRtlReview(runner, {
    verilog_sources: ['fixtures/missing_reset.v'],
    top_module: 'missing_reset',
    cwd: projectRoot,
  });

  const data = JSON.parse(res.content[0].text);
  assert.equal(data.passed, false);
  assert.equal(data.score, 95);
  const v = data.violations.find((x: any) => x.ruleId === 'MISSING_RESET');
  assert.ok(v, 'Must flag MISSING_RESET');
  assert.equal(v.severity, 'warning');
});

test('Integration: latch_demo reports a single CASE_DEFAULT_MISSING (dedupe)', async () => {
  const runner = new ToolRunner();
  const res = await handleRtlReview(runner, {
    verilog_sources: ['fixtures/latch_demo.v'],
    top_module: 'latch_demo',
    cwd: projectRoot,
  });

  const data = JSON.parse(res.content[0].text);
  assert.equal(data.passed, false);
  const cases = data.violations.filter((x: any) => x.ruleId === 'CASE_DEFAULT_MISSING');
  assert.equal(cases.length, 1);
});

test('Integration: initial_block flags INITIAL_BLOCK_SYNTH', async () => {
  const runner = new ToolRunner();
  const res = await handleRtlReview(runner, {
    verilog_sources: ['fixtures/initial_block.v'],
    top_module: 'initial_block',
    cwd: projectRoot,
  });

  const data = JSON.parse(res.content[0].text);
  assert.equal(data.passed, false);
  assert.ok(data.violations.some((x: any) => x.ruleId === 'INITIAL_BLOCK_SYNTH'));
});

test('Integration: multidriver flags MULTIPLE_DRIVERS as error', async () => {
  const runner = new ToolRunner();
  const res = await handleRtlReview(runner, {
    verilog_sources: ['fixtures/multidriver.v'],
    top_module: 'multidriver',
    cwd: projectRoot,
  });

  const data = JSON.parse(res.content[0].text);
  assert.equal(data.passed, false);
  const v = data.violations.find((x: any) => x.ruleId === 'MULTIPLE_DRIVERS');
  assert.ok(v, 'Must flag MULTIPLE_DRIVERS');
  assert.equal(v.severity, 'error');
});

test('Integration: rtl_check_resets audits missing vs clean designs', async () => {
  const runner = new ToolRunner();
  const bad = await handleRtlCheckResets(runner, {
    verilog_sources: ['fixtures/missing_reset.v'],
    top_module: 'missing_reset',
    cwd: projectRoot,
  });
  const badData = JSON.parse(bad.content[0].text);
  assert.equal(badData.passed, false);
  assert.equal(badData.totalSequentialBlocks, 1);
  assert.equal(badData.blocksMissingReset, 1);
  assert.equal(badData.blocks[0].hasReset, false);

  const good = await handleRtlCheckResets(runner, {
    verilog_sources: ['fixtures/clean_counter.v'],
    top_module: 'clean_counter',
    cwd: projectRoot,
  });
  const goodData = JSON.parse(good.content[0].text);
  assert.equal(goodData.passed, true);
  assert.equal(goodData.blocksWithReset, 1);
  assert.equal(goodData.blocks[0].resetName, 'rst_n');
  assert.equal(goodData.blocks[0].resetEdge, 'NEG');
});
