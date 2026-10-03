import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const expected = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
const client = new Client({name: 'package-smoke', version: '1.0.0'});
const transport = new StdioClientTransport({command: 'node', args: [process.argv[2]], stderr: 'inherit'});
try {
  await client.connect(transport);
  assert.equal(client.getServerVersion().version, expected.version);
  const result = await client.listTools();
  assert.equal(result.tools.length, 6);
  assert.ok(result.tools.some(tool => tool.name === 'rtl_review'));
  console.log(`PASS: packed MCP ${expected.version}, six tools registered`);
} finally {
  await client.close();
}
