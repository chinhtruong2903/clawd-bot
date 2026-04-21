import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'dotenv';
import type { CommandResult } from './types';

const execFileAsync = promisify(execFile);

export type ClawbotInstance = {
  id: string;
  name: string;
  containerName: string;
  gatewayPort: number;
  sshPort: number;
  token: string;
  image: string;
  volumeName: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
};

type InstancesFile = {
  activeId: string;
  instances: ClawbotInstance[];
};

type CreateInstanceInput = {
  name?: string;
  containerName?: string;
  gatewayPort?: number;
  sshPort?: number;
  token?: string;
};

@Injectable()
export class InstancesService {
  private readonly rootDir = process.env.CLAWBOT_ROOT || resolve(process.cwd(), '..');
  private readonly rootEnv = this.loadRootEnv();
  private readonly filePath = resolve(this.rootDir, '.clawbot', 'instances.json');
  private readonly imageName = process.env.OPENCLAW_IMAGE || 'clawd-bot-openclaw';

  list() {
    const state = this.readState();
    return {
      activeId: state.activeId,
      instances: state.instances.map((instance) => this.publicInstance(instance)),
    };
  }

  getActive() {
    const state = this.readState();
    return state.instances.find((instance) => instance.id === state.activeId) ?? state.instances[0];
  }

  get(id?: string) {
    const state = this.readState();
    const instance = id
      ? state.instances.find((candidate) => candidate.id === id)
      : state.instances.find((candidate) => candidate.id === state.activeId) ?? state.instances[0];

    if (!instance) {
      throw new Error(`Unknown Clawbot instance: ${id || state.activeId}`);
    }

    return instance;
  }

  async create(input: CreateInstanceInput) {
    const state = this.readState();
    const now = new Date().toISOString();
    const name = input.name?.trim() || `clawbot-${state.instances.length + 1}`;
    const id = this.slug(name);
    const containerName = input.containerName?.trim() || `openclaw-${id}`;
    if (state.instances.some((instance) => instance.id === id)) {
      return {
        ok: false,
        error: `Instance "${id}" already exists.`,
      };
    }
    if (!this.isManagedContainer(containerName) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,127}$/.test(containerName)) {
      return {
        ok: false,
        error: 'Container name must be a safe Docker name and start with "openclaw-".',
      };
    }
    if (state.instances.some((instance) => instance.containerName === containerName)) {
      return {
        ok: false,
        error: `Container "${containerName}" is already used by another Clawbot instance.`,
      };
    }

    const gatewayPort = this.safePort(input.gatewayPort, this.nextPort(state.instances, 18789));
    const sshPort = this.safePort(input.sshPort, this.nextPort(state.instances, 2222, 'sshPort'));
    const instance: ClawbotInstance = {
      id,
      name,
      containerName,
      gatewayPort,
      sshPort,
      token: input.token?.trim() || this.randomToken(),
      image: this.imageName,
      volumeName: `openclaw_${id}_home`,
      workspacePath: resolve(this.rootDir, 'workspace'),
      createdAt: now,
      updatedAt: now,
    };

    state.instances.push(instance);
    state.activeId = instance.id;
    this.writeState(state);

    return {
      ok: true,
      instance: this.publicInstance(instance),
    };
  }

  setActive(id: string) {
    const state = this.readState();
    const instance = state.instances.find((candidate) => candidate.id === id);
    if (!instance) {
      return {
        ok: false,
        error: `Instance "${id}" not found.`,
      };
    }

    state.activeId = id;
    this.writeState(state);
    return {
      ok: true,
      activeId: id,
      instance: this.publicInstance(instance),
    };
  }

  async start(id?: string) {
    const instance = this.get(id);
    const exists = await this.containerExists(instance.containerName);
    if (exists) {
      return this.runDocker(['start', instance.containerName]);
    }

    await this.ensureImage();
    return this.runDocker([
      'run',
      '-d',
      '--name',
      instance.containerName,
      '--restart',
      'unless-stopped',
      '-e',
      `TZ=${this.rootEnv.TZ || 'Asia/Saigon'}`,
      '-e',
      `ROOT_PASSWORD=${this.rootEnv.ROOT_PASSWORD || 'root@123'}`,
      '-e',
      'OPENCLAW_GATEWAY_BIND=lan',
      '-e',
      'OPENCLAW_GATEWAY_PORT=18789',
      '-e',
      `OPENCLAW_GATEWAY_TOKEN=${instance.token}`,
      '-e',
      'OPENCLAW_ENABLE_RESPONSES_API=true',
      '-p',
      `${instance.gatewayPort}:18789`,
      '-p',
      `${instance.sshPort}:22`,
      '-v',
      `${instance.volumeName}:/home/openclaw/.openclaw`,
      '-v',
      `${instance.workspacePath}:/workspace`,
      instance.image,
    ]);
  }

  async stop(id?: string) {
    return this.runDocker(['stop', this.get(id).containerName]);
  }

  async restart(id?: string) {
    return this.runDocker(['restart', this.get(id).containerName]);
  }

  async delete(id: string) {
    const state = this.readState();
    const instance = state.instances.find((candidate) => candidate.id === id);
    if (!instance) {
      return {
        ok: false,
        error: `Instance "${id}" not found.`,
      };
    }

    if (!this.isManagedContainer(instance.containerName)) {
      return {
        ok: false,
        error: `Refusing to delete unmanaged container "${instance.containerName}".`,
      };
    }

    const removeContainer = await this.runDocker(['rm', '-f', instance.containerName], 60_000);
    const removeVolume = this.isManagedVolume(instance.volumeName)
      ? await this.runDocker(['volume', 'rm', instance.volumeName], 60_000)
      : {
          ok: true,
          command: 'skip volume remove',
          stdout: '',
          stderr: `Skipped unmanaged volume "${instance.volumeName}".`,
        };

    const nextInstances = state.instances.filter((candidate) => candidate.id !== id);
    const nextActiveId = state.activeId === id ? nextInstances[0]?.id || '' : state.activeId;
    this.writeState({
      activeId: nextActiveId,
      instances: nextInstances,
    });

    return {
      ok: removeContainer.ok && removeVolume.ok,
      removed: this.publicInstance(instance),
      container: removeContainer,
      volume: removeVolume,
      activeId: nextActiveId,
    };
  }

  async buildImage() {
    return this.runDocker(['build', '-t', this.imageName, '.'], 10 * 60_000);
  }

  baseUrl(instance: ClawbotInstance) {
    return `http://127.0.0.1:${instance.gatewayPort}`;
  }

  redact(command: string, instance: ClawbotInstance) {
    return command.replaceAll(instance.token, '<redacted>');
  }

  private readState(): InstancesFile {
    if (!existsSync(this.filePath)) {
      const state = this.defaultState();
      this.writeState(state);
      return state;
    }

    const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as InstancesFile;
    if (!parsed.instances?.length) {
      const state = this.defaultState();
      this.writeState(state);
      return state;
    }
    return parsed;
  }

  private writeState(state: InstancesFile) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(state, null, 2));
  }

  private defaultState(): InstancesFile {
    const now = new Date().toISOString();
    const token = process.env.OPENCLAW_GATEWAY_TOKEN || this.rootEnv.OPENCLAW_GATEWAY_TOKEN || 'local-dev-token-change-me';
    const instance: ClawbotInstance = {
      id: 'local',
      name: 'Local OpenClaw',
      containerName: 'openclaw-local',
      gatewayPort: 18789,
      sshPort: 2222,
      token,
      image: this.imageName,
      volumeName: 'clawd-bot_openclaw_home',
      workspacePath: resolve(this.rootDir, 'workspace'),
      createdAt: now,
      updatedAt: now,
    };

    return {
      activeId: instance.id,
      instances: [instance],
    };
  }

  private publicInstance(instance: ClawbotInstance) {
    return {
      ...instance,
      token: instance.token ? '<set>' : '',
      baseUrl: this.baseUrl(instance),
    };
  }

  private isManagedContainer(containerName: string) {
    return containerName === 'openclaw-local' || containerName.startsWith('openclaw-');
  }

  private isManagedVolume(volumeName: string) {
    return volumeName === 'clawd-bot_openclaw_home' || volumeName.startsWith('openclaw_');
  }

  private async ensureImage() {
    const result = await this.runDocker(['image', 'inspect', this.imageName], 20_000);
    if (result.ok) {
      return result;
    }
    return this.buildImage();
  }

  private async containerExists(containerName: string) {
    const result = await this.runDocker(['container', 'inspect', containerName], 20_000);
    return result.ok;
  }

  private async runDocker(args: string[], timeout = 120_000): Promise<CommandResult> {
    const command = 'docker';
    const printable = [command, ...args].join(' ');
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: this.rootDir,
        timeout,
        windowsHide: true,
        shell: false,
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

  private safePort(value: number | undefined, fallback: number) {
    if (!Number.isFinite(value)) {
      return fallback;
    }
    return Math.max(1024, Math.min(65535, Math.trunc(value ?? fallback)));
  }

  private nextPort(instances: ClawbotInstance[], start: number, key: 'gatewayPort' | 'sshPort' = 'gatewayPort') {
    const used = new Set(instances.map((instance) => instance[key]));
    let port = start;
    while (used.has(port)) {
      port += 1;
    }
    return port;
  }

  private slug(value: string) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || `clawbot-${Date.now()}`;
  }

  private randomToken() {
    return `clawbot-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }

  private loadRootEnv(): Record<string, string> {
    const candidates = [resolve(this.rootDir, '.env'), resolve(dirname(this.rootDir), '.env')];
    for (const file of candidates) {
      if (existsSync(file)) {
        return parse(readFileSync(file));
      }
    }
    return {};
  }
}
