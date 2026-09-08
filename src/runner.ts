import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { ToolchainInfo } from './parsers/types.js';
import { SUPPORTED_RULES } from './rules/engine.js';

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type RuntimeType = 'podman' | 'docker' | 'host';

export class ToolRunner {
  private runtime: RuntimeType;
  private imageName: string;

  constructor() {
    const envRuntime = process.env.MCP_RTL_REVIEW_RUNTIME as RuntimeType | undefined;
    this.imageName = process.env.MCP_RTL_REVIEW_IMAGE || 'ghcr.io/zesun33/verilog';

    if (envRuntime && ['podman', 'docker', 'host'].includes(envRuntime)) {
      this.runtime = envRuntime;
    } else {
      this.runtime = 'podman';
    }
  }

  public getRuntime(): RuntimeType {
    return this.runtime;
  }

  public getImageName(): string {
    return this.imageName;
  }

  public setRuntime(runtime: RuntimeType): void {
    this.runtime = runtime;
  }

  public async execute(
    command: string,
    args: string[],
    options: RunOptions = {}
  ): Promise<RunResult> {
    const cwd = path.resolve(options.cwd || process.cwd());
    const timeoutMs = options.timeoutMs ?? 15000;

    let finalCommand = command;
    let finalArgs = args;

    if (this.runtime === 'podman' || this.runtime === 'docker') {
      finalCommand = this.runtime;
      const containerArgs: string[] = ['run', '--rm'];

      if (this.runtime === 'podman') {
        containerArgs.push('--storage-opt', 'overlay.ignore_chown_errors=true');
      }

      containerArgs.push(
        '-v',
        `${cwd}:/workspace:Z`,
        '-w',
        '/workspace',
        this.imageName,
        command,
        ...args
      );

      finalArgs = containerArgs;
    }

    return new Promise<RunResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const child = spawn(finalCommand, finalArgs, {
        cwd,
        env: {
          ...process.env,
          ...(options.env || {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!settled) {
            child.kill('SIGKILL');
          }
        }, 1000);
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });

      child.on('error', (err: Error) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve({
            exitCode: 1,
            stdout,
            stderr: `${stderr}\nProcess spawn error: ${err.message}`,
            timedOut: false,
          });
        }
      });

      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve({
            exitCode: code ?? (timedOut ? 124 : 1),
            stdout,
            stderr,
            timedOut,
          });
        }
      });
    });
  }

  public async getToolchainInfo(cwd?: string): Promise<ToolchainInfo> {
    const res = await this.execute('verilator', ['--version'], { cwd });
    const version = res.stdout.trim() || res.stderr.trim() || 'Verilator unknown';
    return {
      runtime: this.runtime,
      image: this.runtime === 'host' ? 'host-native' : this.imageName,
      verilatorVersion: version,
      rulesSupported: SUPPORTED_RULES,
    };
  }

  public async generateXmlAst(
    sources: string[],
    options: { topModule?: string; cwd?: string; timeoutMs?: number } = {}
  ): Promise<{ xml: string; stderr: string; exitCode: number }> {
    const topArgs = options.topModule ? ['--top-module', options.topModule] : [];
    // We execute a bash command inside the container that outputs XML directly to stdout
    const bashScript = `
TMPDIR=$(mktemp -d)
verilator --xml-only -Wno-fatal ${topArgs.join(' ')} ${sources.join(' ')} -Mdir "$TMPDIR" > /dev/null 2>&1
cat "$TMPDIR"/V*.xml 2>/dev/null
rm -rf "$TMPDIR"
`;
    const res = await this.execute('bash', ['-c', bashScript], {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? 20000,
    });

    return {
      xml: res.stdout,
      stderr: res.stderr,
      exitCode: res.exitCode,
    };
  }

  public async runLint(
    sources: string[],
    options: { topModule?: string; cwd?: string; timeoutMs?: number } = {}
  ): Promise<string> {
    const topArgs = options.topModule ? ['--top-module', options.topModule] : [];
    const args = ['--lint-only', '-Wall', '-Wno-fatal', ...topArgs, ...sources];
    const res = await this.execute('verilator', args, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? 15000,
    });
    return `${res.stdout}\n${res.stderr}`;
  }
}
