import { XMLParser, XMLValidator } from 'fast-xml-parser';
import fs from 'fs';
import {
  AstGenerationResult,
  AstLocation,
  AstSenItem,
  AstAssignment,
  AstAlwaysBlock,
  AstModule,
  ParsedAst,
} from './types.js';

export function parseLocation(locStr: string): AstLocation {
  if (!locStr) {
    return {
      fileId: '',
      startLine: 1,
      startCol: 1,
      endLine: 1,
      endCol: 1,
      raw: '',
    };
  }

  // XML uses comma-separated coordinates; JSON uses file,line:col,line:col.
  const parts = locStr.replace(/:/g, ',').split(',');
  return {
    fileId: parts[0] || '',
    startLine: parseInt(parts[1] || '1', 10),
    startCol: parseInt(parts[2] || '1', 10),
    endLine: parseInt(parts[3] || parts[1] || '1', 10),
    endCol: parseInt(parts[4] || parts[2] || '1', 10),
    raw: locStr,
  };
}

export function parseVerilatorXml(
  xmlContent: string,
  sourceFilesContent?: Map<string, string>
): ParsedAst {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => {
      return [
        'file',
        'module',
        'always',
        'senitem',
        'assign',
        'assigndly',
        'var',
        'begin',
      ].includes(name);
    },
  });

  const parsed = parser.parse(xmlContent);
  const filesMap = new Map<string, string>();

  // Extract files mapping
  const filesList = parsed?.verilator_xml?.files?.file;
  if (Array.isArray(filesList)) {
    for (const f of filesList) {
      if (f['@_id'] && f['@_filename']) {
        filesMap.set(f['@_id'], f['@_filename']);
      }
    }
  }

  const modules: AstModule[] = [];
  const moduleList = parsed?.verilator_xml?.netlist?.module;

  if (Array.isArray(moduleList)) {
    for (const mod of moduleList) {
      const modName = mod['@_name'] || 'unknown';
      const modLoc = parseLocation(mod['@_loc'] || '');
      const modFile = filesMap.get(modLoc.fileId) || modLoc.fileId;

      const alwaysBlocks: AstAlwaysBlock[] = [];
      const alwaysList = mod['always'];

      if (Array.isArray(alwaysList)) {
        for (const alw of alwaysList) {
          const alwLoc = parseLocation(alw['@_loc'] || '');
          const alwFile = filesMap.get(alwLoc.fileId) || modFile;

          // Extract sensitivity items
          const senItems: AstSenItem[] = [];
          const sentree = alw['sentree'];
          if (sentree) {
            const rawSenItems = sentree['senitem'];
            if (Array.isArray(rawSenItems)) {
              for (const s of rawSenItems) {
                const edgeType = s['@_edgeType'] as 'POS' | 'NEG' | undefined;
                const varref = s['varref'];
                const signalName = varref ? varref['@_name'] : undefined;
                senItems.push({ edgeType, signalName });
              }
            }
          }

          const isSequential = senItems.some((s) => s.edgeType === 'POS' || s.edgeType === 'NEG');

          // Collect all assignments in this always block
          const assignments: AstAssignment[] = [];
          collectAssignments(alw, filesMap, alwFile, assignments);

          // Check reset polarity if sequential and has active-low reset
          let hasResetMismatch = false;
          let resetMismatchDetails: AstAlwaysBlock['resetMismatchDetails'] = undefined;

          const negReset = senItems.find(
            (s) => s.edgeType === 'NEG' && s.signalName && /rst|reset/i.test(s.signalName)
          );

          if (negReset && negReset.signalName) {
            const resetName = negReset.signalName;
            // Check top if in always block
            const topIf = findFirstIf(alw);
            if (topIf) {
              const ifLoc = parseLocation(topIf['@_loc'] || '');
              // Check if condition checks reset signal
              const condVar = topIf['varref'];
              const condVarName = condVar ? condVar['@_name'] : undefined;

              if (condVarName === resetName) {
                // In Verilator AST, if the source code was:
                // if (rst_n) begin count <= 0; ... end
                // then child 1 (first begin block) contains the reset assignments.
                // If source code was if (!rst_n) begin count <= 0; ... end
                // Verilator inverts it: child 1 is the else block, and child 2 is the then block (reset).
                // Let's also check the actual source line if available
                let isConditionActiveHigh = false;
                if (sourceFilesContent && sourceFilesContent.has(alwFile)) {
                  const content = sourceFilesContent.get(alwFile)!;
                  const lines = content.split('\n');
                  const srcLine = lines[ifLoc.startLine - 1] || '';
                  // Match "if (rst_n)" or "if ( rst_n )" without ! or ~
                  const re = new RegExp(`if\\s*\\(\\s*${resetName}\\s*\\)`);
                  if (re.test(srcLine)) {
                    isConditionActiveHigh = true;
                  }
                } else {
                  // Inspect AST: if first begin child contains reset assignments (e.g. 0)
                  const firstBegin = getIfFirstBranch(topIf);
                  if (firstBegin && hasConstantZeroAssignment(firstBegin)) {
                    isConditionActiveHigh = true;
                  }
                }

                if (isConditionActiveHigh) {
                  hasResetMismatch = true;
                  resetMismatchDetails = {
                    resetName,
                    expectedCondition: `!${resetName}`,
                    actualCondition: resetName,
                    line: ifLoc.startLine,
                  };
                }
              }
            }
          }

          alwaysBlocks.push({
            loc: alwLoc,
            isSequential,
            senItems,
            assignments,
            hasResetMismatch,
            resetMismatchDetails,
          });
        }
      }

      modules.push({
        name: modName,
        file: modFile,
        alwaysBlocks,
      });
    }
  }

  return { files: filesMap, modules };
}

function collectAssignments(
  node: any,
  filesMap: Map<string, string>,
  defaultFile: string,
  assignments: AstAssignment[]
): void {
  if (!node || typeof node !== 'object') {
    return;
  }

  // Check if node has 'assign'
  if (node['assign']) {
    const assigns = Array.isArray(node['assign']) ? node['assign'] : [node['assign']];
    for (const a of assigns) {
      const loc = parseLocation(a['@_loc'] || '');
      const file = filesMap.get(loc.fileId) || defaultFile;
      const targetVar = extractTargetVar(a);
      assignments.push({
        type: 'blocking',
        line: loc.startLine,
        column: loc.startCol,
        file,
        targetVar,
      });
      collectAssignments(a, filesMap, defaultFile, assignments);
    }
  }

  // Check if node has 'assigndly'
  if (node['assigndly']) {
    const assigns = Array.isArray(node['assigndly']) ? node['assigndly'] : [node['assigndly']];
    for (const a of assigns) {
      const loc = parseLocation(a['@_loc'] || '');
      const file = filesMap.get(loc.fileId) || defaultFile;
      const targetVar = extractTargetVar(a);
      assignments.push({
        type: 'nonblocking',
        line: loc.startLine,
        column: loc.startCol,
        file,
        targetVar,
      });
      collectAssignments(a, filesMap, defaultFile, assignments);
    }
  }

  // Recurse down children
  for (const key of Object.keys(node)) {
    if (key === 'assign' || key === 'assigndly' || key.startsWith('@_')) {
      continue;
    }
    const val = node[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        collectAssignments(item, filesMap, defaultFile, assignments);
      }
    } else if (typeof val === 'object') {
      collectAssignments(val, filesMap, defaultFile, assignments);
    }
  }
}

function extractTargetVar(assignNode: any): string | undefined {
  // In Verilator AST, assign children usually have:
  // varref as LHS (last child or first child)
  if (assignNode['varref']) {
    const varref = Array.isArray(assignNode['varref'])
      ? assignNode['varref'][assignNode['varref'].length - 1]
      : assignNode['varref'];
    return varref['@_name'];
  }
  return undefined;
}

function findFirstIf(node: any): any {
  if (!node || typeof node !== 'object') return null;
  if (node['if']) {
    return Array.isArray(node['if']) ? node['if'][0] : node['if'];
  }
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_')) continue;
    const val = node[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        const found = findFirstIf(item);
        if (found) return found;
      }
    } else if (typeof val === 'object') {
      const found = findFirstIf(val);
      if (found) return found;
    }
  }
  return null;
}

function getIfFirstBranch(ifNode: any): any {
  if (ifNode['begin']) {
    return Array.isArray(ifNode['begin']) ? ifNode['begin'][0] : ifNode['begin'];
  }
  return null;
}

function hasConstantZeroAssignment(node: any): boolean {
  if (!node || typeof node !== 'object') return false;
  if (node['const']) {
    const c = Array.isArray(node['const']) ? node['const'][0] : node['const'];
    const name = c['@_name'] || '';
    if (name.endsWith("'h0") || name.endsWith("'b0") || name === "1'b0" || name === "0") {
      return true;
    }
  }
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_')) continue;
    const val = node[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (hasConstantZeroAssignment(item)) return true;
      }
    } else if (typeof val === 'object') {
      if (hasConstantZeroAssignment(val)) return true;
    }
  }
  return false;
}

/** Parse the modern Verilator JSON tree and its separate file-ID metadata. */
export function parseVerilatorJson(
  treeContent: string,
  metadataContent: string,
  sourceFilesContent?: Map<string, string>
): ParsedAst {
  const tree = JSON.parse(treeContent);
  const metadata = JSON.parse(metadataContent);
  if (tree?.type !== 'NETLIST' || !Array.isArray(tree.modulesp)
      || !metadata?.files || typeof metadata.files !== 'object') {
    throw new Error('Unsupported Verilator JSON AST or file metadata');
  }
  const files = new Map<string, string>();
  for (const [id, entry] of Object.entries(metadata.files)) {
    const filename = (entry as { filename?: string }).filename;
    if (typeof filename === 'string') files.set(id, filename);
  }
  const modules: AstModule[] = [];
  // modulesp is the elaborated design. Do not include the synthetic constant-pool
  // module reachable through miscsp, which is not a user RTL module.
  for (const mod of tree.modulesp) {
    if (mod.type !== 'MODULE') continue;
    const modLoc = parseLocation(mod.loc || '');
    const file = files.get(modLoc.fileId) || modLoc.fileId;
    const alwaysBlocks: AstAlwaysBlock[] = [];
    for (const alw of findJsonNodes(mod, 'ALWAYS')) {
      const loc = parseLocation(alw.loc || '');
      const alwFile = files.get(loc.fileId) || file;
      const senItems: AstSenItem[] = findJsonNodes(alw, 'SENITEM').map((item) => ({
        edgeType: item.edgeType,
        signalName: findJsonNodes(item, 'VARREF')[0]?.name,
      }));
      const assignments: AstAssignment[] = findJsonNodes(alw, 'ASSIGN', 'ASSIGNDLY').map((assign) => {
        const assignLoc = parseLocation(assign.loc || '');
        return {
          type: assign.type === 'ASSIGNDLY' ? 'nonblocking' : 'blocking',
          file: files.get(assignLoc.fileId) || alwFile,
          line: assignLoc.startLine,
          column: assignLoc.startCol,
          targetVar: findJsonNodes(assign.lhsp?.[0], 'VARREF')[0]?.name,
        };
      });
      const isSequential = senItems.some((item) => item.edgeType === 'POS' || item.edgeType === 'NEG');
      const negReset = senItems.find((item) => item.edgeType === 'NEG'
        && item.signalName && /rst|reset/i.test(item.signalName));
      let resetMismatchDetails: AstAlwaysBlock['resetMismatchDetails'];
      if (negReset?.signalName) {
        const resetName = negReset.signalName;
        const topIf = findJsonNodes(alw, 'IF')[0];
        if (topIf?.condp?.[0]?.type === 'VARREF' && topIf.condp[0].name === resetName) {
          const ifLoc = parseLocation(topIf.loc || '');
          const source = sourceFilesContent?.get(alwFile);
          // Elaboration normalizes !rst_n by swapping then/else branches. Use
          // original RTL when available, just as the XML parser does.
          const activeHigh = source !== undefined
            ? new RegExp(`if\\s*\\(\\s*${resetName}\\s*\\)`).test(source.split('\n')[ifLoc.startLine - 1] || '')
            : (topIf.thensp || []).some((branch: any) =>
              findJsonNodes(branch, 'ASSIGN', 'ASSIGNDLY').some((assign) =>
                (assign.rhsp || []).some((rhs: any) => rhs.type === 'CONST'
                  && /(?:'h0|'b0|^0)$/.test(rhs.name || ''))));
          if (activeHigh) {
            resetMismatchDetails = { resetName, expectedCondition: `!${resetName}`,
              actualCondition: resetName, line: ifLoc.startLine };
          }
        }
      }
      alwaysBlocks.push({ loc, senItems, isSequential, assignments,
        hasResetMismatch: !!resetMismatchDetails, resetMismatchDetails });
    }
    modules.push({ name: mod.name || 'unknown', file, alwaysBlocks });
  }
  return { files, modules };
}

function findJsonNodes(node: any, ...types: string[]): any[] {
  if (!node || typeof node !== 'object') return [];
  const result: any[] = types.includes(node.type) ? [node] : [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) result.push(...findJsonNodes(child, ...types));
    }
  }
  return result;
}

/** Reject missing/invalid ASTs even when the compiler incorrectly exits zero. */
export function parseGeneratedAst(
  result: AstGenerationResult,
  sourceFilesContent?: Map<string, string>
): ParsedAst {
  if (result.exitCode !== 0 || !result.content.trim()) {
    throw new Error(result.stderr.trim() || 'Verilator did not produce an AST');
  }
  if (result.format === 'xml' && XMLValidator.validate(result.content) !== true) {
    throw new Error('Malformed Verilator XML AST');
  }
  const ast = result.format === 'json'
    ? parseVerilatorJson(result.content, result.metadata || '', sourceFilesContent)
    : parseVerilatorXml(result.content, sourceFilesContent);
  if (ast.modules.length === 0) throw new Error('Verilator AST contains no design modules');
  return ast;
}
