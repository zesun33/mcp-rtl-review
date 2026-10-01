import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolRunner } from '../src/runner.js';
import { parseGeneratedAst } from '../src/parsers/ast.js';

// Exercise the real bash runner using a fake executable, so compiler failure,
// cleanup, path quoting, and legacy selection are tested without containers.
async function withVerilator(mode: string, action: (runner: ToolRunner, record: string, work: string) => Promise<void>) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rtl-ast-runner-'));
  const record = path.join(work, 'arguments.json');
  const bin = path.join(work, 'verilator');
  fs.writeFileSync(bin, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(${JSON.stringify(mode === 'xml' ? '--xml-only' : '--json-only')});
  process.exit(0);
}
const dir = args[args.indexOf('-Mdir') + 1];
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({args, dir}));
if (${JSON.stringify(mode)} === 'fail') { console.error('syntax error at source:7'); process.exit(42); }
if (${JSON.stringify(mode)} === 'empty') process.exit(0);
if (${JSON.stringify(mode)} === 'xml') {
  fs.writeFileSync(path.join(dir, 'Vdut.xml'), '<verilator_xml><files><file id="a" filename="dut.v"/></files><netlist><module name="dut" loc="a,1,1,1,4"/></netlist></verilator_xml>');
} else {
  fs.writeFileSync(args[args.indexOf('--json-only-output')+1], JSON.stringify({type:'NETLIST', modulesp:[{type:'MODULE', name:'dut', loc:'a,1:1,1:4', stmtsp:[]}]}));
  fs.writeFileSync(args[args.indexOf('--json-only-meta-output')+1], JSON.stringify({files:{a:{filename:'dut.v'}}}));
}
`, {mode:0o755});
  const previousPath = process.env.PATH;
  process.env.PATH = work + path.delimiter + previousPath;
  try {
    const runner = new ToolRunner();
    runner.setRuntime('host');
    await action(runner, record, work);
  } finally {
    process.env.PATH = previousPath;
    fs.rmSync(work, {recursive:true, force:true});
  }
}

test('JSON AST runner preserves literal filenames and cleans its temporary directory', async () => {
  await withVerilator('json', async (runner, record, work) => {
    const source = 'source with spaces $(touch injected).v';
    const result = await runner.generateAst([source], {topModule:'dut', cwd:work});
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.format, 'json');
    assert.equal(parseGeneratedAst(result).modules[0].file, 'dut.v');
    const args = JSON.parse(fs.readFileSync(record, 'utf8'));
    assert.ok(args.args.includes(source));
    assert.equal(fs.existsSync(path.join(work, 'injected')), false);
    assert.equal(fs.existsSync(args.dir), false);
  });
});

test('Legacy toolchain without JSON output still uses XML', async () => {
  await withVerilator('xml', async (runner, record) => {
    const result = await runner.generateAst(['dut.v']);
    assert.equal(result.format, 'xml');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(parseGeneratedAst(result).modules[0].name, 'dut');
    const args = JSON.parse(fs.readFileSync(record, 'utf8'));
    assert.ok(args.args.includes('--xml-only'));
    assert.equal(fs.existsSync(args.dir), false);
  });
});

test('Compiler failure keeps its exit status and diagnostics through cleanup', async () => {
  await withVerilator('fail', async (runner, record) => {
    const result = await runner.generateAst(['broken.v']);
    assert.equal(result.exitCode, 42);
    assert.match(result.stderr, /syntax error at source:7/);
    assert.equal(result.content, '');
    const args = JSON.parse(fs.readFileSync(record, 'utf8'));
    assert.equal(fs.existsSync(args.dir), false);
  });
});

test('Compiler success without output files is an AST failure', async () => {
  await withVerilator('empty', async (runner) => {
    const result = await runner.generateAst(['dut.v']);
    assert.notEqual(result.exitCode, 0);
    assert.throws(() => parseGeneratedAst(result), /did not produce an AST/);
  });
});
