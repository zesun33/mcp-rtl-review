import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const packed = JSON.parse(fs.readFileSync(process.argv[2]))[0];
// Newly accepted npm publications can take time to appear on registry edges.
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    const published = JSON.parse(execFileSync('npm', ['view', `${packed.name}@${packed.version}`,
      'version', 'dist.integrity', '--json', '--prefer-online'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}));
    assert.equal(published.version, packed.version);
    assert.equal(published['dist.integrity'], packed.integrity);
    console.log(`PASS: registry ${packed.name}@${packed.version} matches tested tarball`);
    process.exit(0);
  } catch (error) {
    if (attempt === 11) throw error;
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
}
