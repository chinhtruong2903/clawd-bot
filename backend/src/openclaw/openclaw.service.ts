import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { InstancesService, type ClawbotInstance } from './instances.service';
import type { ChatRequest, CommandResult, JsonResult } from './types';

const execFileAsync = promisify(execFile);

@Injectable()
export class OpenclawService {
  private readonly rootDir = process.env.CLAWBOT_ROOT || resolve(process.cwd(), '..');

  constructor(private readonly instances: InstancesService) {}

  async status(instanceId?: string) {
    const instance = this.instances.get(instanceId);
    const [docker, health, ready, models] = await Promise.all([
      this.dockerPs(instance),
      this.healthz(instance),
      this.readyz(instance),
      this.models(instance.id),
    ]);

    return {
      rootDir: this.rootDir,
      instance: {
        id: instance.id,
        name: instance.name,
        containerName: instance.containerName,
        gatewayPort: instance.gatewayPort,
        sshPort: instance.sshPort,
      },
      openclawBaseUrl: this.instances.baseUrl(instance),
      hasGatewayToken: Boolean(instance.token),
      docker,
      health,
      ready,
      models,
    };
  }

  async health(instanceId?: string) {
    const instance = this.instances.get(instanceId);
    const [health, ready] = await Promise.all([this.healthz(instance), this.readyz(instance)]);
    return { health, ready };
  }

  async models(instanceId?: string) {
    const instance = this.instances.get(instanceId);
    return this.requestJson(instance, '/v1/models', {
      headers: this.authHeaders(instance),
    });
  }

  async chat(body: ChatRequest, instanceId?: string) {
    const instance = this.instances.get(instanceId);
    const message = body.message?.trim();
    if (!message) {
      return {
        ok: false,
        error: 'Message is required.',
      };
    }

    const result = await this.requestJson(
      instance,
      '/v1/responses',
      {
        method: 'POST',
        headers: {
          ...this.authHeaders(instance),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: body.model || 'openclaw',
          input: message,
          max_output_tokens: body.maxOutputTokens ?? 512,
          stream: false,
        }),
      },
      180_000,
    );

    return {
      ...result,
      outputText: this.extractOutputText(result.data),
    };
  }

  async startDocker(instanceId?: string) {
    return this.instances.start(instanceId);
  }

  async stopDocker(instanceId?: string) {
    return this.instances.stop(instanceId);
  }

  async restartDocker(instanceId?: string) {
    return this.instances.restart(instanceId);
  }

  async buildDocker() {
    return this.instances.buildImage();
  }

  async logs(tail: number, instanceId?: string) {
    const instance = this.instances.get(instanceId);
    const safeTail = Number.isFinite(tail) ? Math.min(Math.max(Math.trunc(tail), 20), 1000) : 200;
    return this.runDocker(['logs', `--tail=${safeTail}`, instance.containerName], 60_000);
  }

  async usageCost(days: number, instanceId?: string) {
    const instance = this.instances.get(instanceId);
    const safeDays = Number.isFinite(days) ? Math.min(Math.max(Math.trunc(days), 1), 365) : 30;
    const result = await this.runHostCommand(
      'docker',
      [
        'exec',
        instance.containerName,
        'openclaw',
        'gateway',
        'usage-cost',
        '--json',
        '--days',
        String(safeDays),
        '--token',
        instance.token,
        '--url',
        'ws://127.0.0.1:18789',
      ],
      30_000,
      this.rootDir,
    );

    if (!result.ok) {
      return {
        ok: false,
        command: this.instances.redact(result.command, instance),
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code,
      };
    }

    try {
      return {
        ok: true,
        data: JSON.parse(result.stdout),
        command: this.instances.redact(result.command, instance),
      };
    } catch (error) {
      return {
        ok: false,
        command: this.instances.redact(result.command, instance),
        raw: result.stdout,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async enableResponsesApi() {
    return this.runHostCommand(
      'openclaw',
      [
        'config',
        'set',
        'gateway.http.endpoints.responses.enabled',
        'true',
        '--strict-json',
      ],
      60_000,
    );
  }

  private async dockerPs(instance: ClawbotInstance) {
    return this.runDocker(['ps', '--filter', `name=${instance.containerName}`, '--format', '{{json .}}'], 20_000);
  }

  private async healthz(instance: ClawbotInstance) {
    return this.requestJson(instance, '/healthz');
  }

  private async readyz(instance: ClawbotInstance) {
    return this.requestJson(instance, '/readyz');
  }

  private async requestJson<T = unknown>(
    instance: ClawbotInstance,
    path: string,
    init: RequestInit = {},
    timeoutMs = 15_000,
  ): Promise<JsonResult<T>> {
    const url = new URL(path, this.instances.baseUrl(instance));

    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const contentType = response.headers.get('content-type') ?? '';
      const raw = await response.text();
      const data = contentType.includes('application/json') && raw ? (JSON.parse(raw) as T) : undefined;

      return {
        ok: response.ok,
        status: response.status,
        data,
        raw: data ? undefined : raw,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async runDocker(args: string[], timeout = 120_000): Promise<CommandResult> {
    return this.runHostCommand('docker', args, timeout, this.rootDir, false);
  }

  private async runHostCommand(
    command: string,
    args: string[],
    timeout: number,
    cwd = this.rootDir,
    useShell = process.platform === 'win32',
  ): Promise<CommandResult> {
    const printable = [command, ...args].join(' ');

    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd,
        timeout,
        windowsHide: true,
        shell: useShell,
        maxBuffer: 1024 * 1024 * 5,
      });

      return {
        ok: true,
        command: printable,
        stdout,
        stderr,
      };
    } catch (error) {
      const err = error as Error & { code?: number; stdout?: string; stderr?: string };
      return {
        ok: false,
        command: printable,
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? err.message,
        code: err.code,
      };
    }
  }

  private authHeaders(instance: ClawbotInstance): Record<string, string> {
    return instance.token ? { Authorization: `Bearer ${instance.token}` } : {};
  }
  private extractOutputText(data: unknown): string {
    if (!data || typeof data !== 'object') {
      return '';
    }

    const record = data as Record<string, unknown>;
    if (typeof record.output_text === 'string') {
      return record.output_text;
    }

    const output = Array.isArray(record.output) ? record.output : [];
    const chunks: string[] = [];
    for (const item of output) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const content = (item as Record<string, unknown>).content;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const part of content) {
        if (!part || typeof part !== 'object') {
          continue;
        }
        const text = (part as Record<string, unknown>).text;
        if (typeof text === 'string') {
          chunks.push(text);
        }
      }
    }

    return chunks.join('\n').trim();
  }
}
