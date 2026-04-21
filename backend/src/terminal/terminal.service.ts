import { Injectable } from '@nestjs/common';
import { exec } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { TerminalRunRequestDto } from './dto';

const execAsync = promisify(exec);

@Injectable()
export class TerminalService {
  private readonly rootDir = process.env.CLAWBOT_ROOT || resolve(process.cwd(), '..');

  async containers() {
    try {
      const { stdout } = await execAsync(
        'docker ps -a --format "{{json .}}"',
        {
          cwd: this.rootDir,
          timeout: 30_000,
          windowsHide: true,
          maxBuffer: 1024 * 1024 * 2,
        },
      );

      const containers = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, string>)
        .map((item) => ({
          id: item.ID ?? '',
          name: item.Names ?? '',
          image: item.Image ?? '',
          status: item.Status ?? '',
          state: item.State ?? '',
        }));

      return {
        ok: true,
        containers,
      };
    } catch (error) {
      return {
        ok: false,
        containers: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async run(body: TerminalRunRequestDto) {
    const command = body.command?.trim();
    if (!command) {
      return {
        ok: false,
        command: '',
        cwd: this.rootDir,
        stdout: '',
        stderr: 'Command is required.',
      };
    }

    const cwd = this.safeCwd(body.cwd);

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: 120_000,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 5,
      });

      return {
        ok: true,
        command,
        cwd,
        stdout,
        stderr,
      };
    } catch (error) {
      const err = error as Error & { code?: number; stdout?: string; stderr?: string };
      return {
        ok: false,
        command,
        cwd,
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? err.message,
        code: err.code,
      };
    }
  }

  private safeCwd(cwd?: string) {
    if (!cwd?.trim()) {
      return this.rootDir;
    }

    const requested = resolve(cwd);
    if (!existsSync(requested)) {
      return this.rootDir;
    }

    const root = realpathSync(this.rootDir).toLowerCase();
    const actual = realpathSync(requested).toLowerCase();
    return actual.startsWith(root) ? requested : this.rootDir;
  }
}
