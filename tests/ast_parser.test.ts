import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocation, parseVerilatorXml } from '../src/parsers/ast.js';

test('parseLocation extracts components accurately', () => {
  const loc = parseLocation('d,12,19,12,21');
  assert.equal(loc.fileId, 'd');
  assert.equal(loc.startLine, 12);
  assert.equal(loc.startCol, 19);
  assert.equal(loc.endLine, 12);
  assert.equal(loc.endCol, 21);
});

test('parseVerilatorXml identifies sequential always block with non-blocking assignment', () => {
  const xml = `<?xml version="1.0" ?>
<verilator_xml>
  <files>
    <file id="d" filename="counter.v" language="1800-2017"/>
  </files>
  <netlist>
    <module loc="d,1,8,1,15" name="counter">
      <always loc="d,8,5,8,11">
        <sentree loc="d,8,12,8,13">
          <senitem loc="d,8,14,8,21" edgeType="POS">
            <varref name="clk"/>
          </senitem>
          <senitem loc="d,8,29,8,36" edgeType="NEG">
            <varref name="rst_n"/>
          </senitem>
        </sentree>
        <begin loc="d,8,44,8,49">
          <assigndly loc="d,10,19,10,21">
            <varref name="count"/>
          </assigndly>
        </begin>
      </always>
    </module>
  </netlist>
</verilator_xml>`;

  const ast = parseVerilatorXml(xml);
  assert.equal(ast.modules.length, 1);
  const mod = ast.modules[0];
  assert.equal(mod.name, 'counter');
  assert.equal(mod.file, 'counter.v');
  assert.equal(mod.alwaysBlocks.length, 1);

  const alw = mod.alwaysBlocks[0];
  assert.equal(alw.isSequential, true);
  assert.equal(alw.senItems.length, 2);
  assert.equal(alw.senItems[0].edgeType, 'POS');
  assert.equal(alw.senItems[0].signalName, 'clk');
  assert.equal(alw.senItems[1].edgeType, 'NEG');
  assert.equal(alw.senItems[1].signalName, 'rst_n');

  assert.equal(alw.assignments.length, 1);
  assert.equal(alw.assignments[0].type, 'nonblocking');
  assert.equal(alw.assignments[0].targetVar, 'count');
  assert.equal(alw.assignments[0].line, 10);
});

test('parseVerilatorXml identifies combinational always block with blocking assignment', () => {
  const xml = `<?xml version="1.0" ?>
<verilator_xml>
  <files>
    <file id="f" filename="alu.v" language="1800-2017"/>
  </files>
  <netlist>
    <module loc="f,1,8,1,11" name="alu">
      <always loc="f,5,5,5,11">
        <begin loc="f,5,15,5,20">
          <assign loc="f,6,13,6,14">
            <varref name="result"/>
          </assign>
        </begin>
      </always>
    </module>
  </netlist>
</verilator_xml>`;

  const ast = parseVerilatorXml(xml);
  assert.equal(ast.modules.length, 1);
  const mod = ast.modules[0];
  assert.equal(mod.alwaysBlocks.length, 1);
  const alw = mod.alwaysBlocks[0];
  assert.equal(alw.isSequential, false);
  assert.equal(alw.assignments.length, 1);
  assert.equal(alw.assignments[0].type, 'blocking');
  assert.equal(alw.assignments[0].targetVar, 'result');
});

test('parseVerilatorJson reads an actual 5.050 tree, file metadata, and normalized reset branches', async () => {
  const fs = await import('node:fs');
  const { parseVerilatorJson } = await import('../src/parsers/ast.js');
  const tree = fs.readFileSync(new URL('../fixtures/clean_counter.tree.json', import.meta.url), 'utf8');
  const metadata = fs.readFileSync(new URL('../fixtures/clean_counter.tree.meta.json', import.meta.url), 'utf8');
  const source = fs.readFileSync(new URL('../fixtures/clean_counter.v', import.meta.url), 'utf8');
  const ast = parseVerilatorJson(tree, metadata, new Map([['fixtures/clean_counter.v', source]]));
  assert.equal(ast.modules.length, 1); // Synthetic constant pool in miscsp is excluded.
  assert.equal(ast.modules[0].file, 'fixtures/clean_counter.v');
  const alw = ast.modules[0].alwaysBlocks[0];
  assert.equal(alw.loc.startLine, 8);
  assert.equal(alw.loc.startCol, 5);
  assert.equal(alw.isSequential, true);
  assert.deepEqual(alw.senItems, [{edgeType:'POS',signalName:'clk'}, {edgeType:'NEG',signalName:'rst_n'}]);
  assert.equal(alw.assignments.length, 2);
  assert.ok(alw.assignments.every(a => a.type === 'nonblocking' && a.targetVar === 'count'));
  assert.equal(alw.hasResetMismatch, false);
});

test('JSON assignments use lhsp as the destination even when rhsp names another variable', async () => {
  const { parseVerilatorJson } = await import('../src/parsers/ast.js');
  const tree = {type:'NETLIST', modulesp:[{type:'MODULE', name:'example', loc:'a,1:1,1:8', stmtsp:[
    {type:'ALWAYS', loc:'a,2:1,2:7', sentreep:[], stmtsp:[
      {type:'ASSIGN', loc:'a,3:7,3:8', rhsp:[{type:'VARREF',name:'input_value'}], lhsp:[{type:'VARREF',name:'output_value'}]},
    ]},
  ]}]};
  const ast = parseVerilatorJson(JSON.stringify(tree), '{"files":{"a":{"filename":"example.v"}}}');
  const assign = ast.modules[0].alwaysBlocks[0].assignments[0];
  assert.equal(assign.type, 'blocking');
  assert.equal(assign.targetVar, 'output_value');
  assert.equal(assign.line, 3);
  assert.equal(assign.column, 7);
});
