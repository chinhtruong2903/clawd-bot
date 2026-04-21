import { resolve } from 'node:path';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { spawn, type IPty } from 'node-pty';

type TerminalSession = {
  shell: IPty;
};

const allowedOrigins = (process.env.PANEL_ALLOWED_ORIGINS ?? 'http://127.0.0.1:3000,http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

@WebSocketGateway({
  namespace: 'terminal',
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
})
export class TerminalGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly rootDir = process.env.CLAWBOT_ROOT || resolve(process.cwd(), '..');
  private readonly sessions = new Map<string, TerminalSession>();

  handleConnection(socket: Socket) {
    this.startHostShell(socket);
  }

  handleDisconnect(socket: Socket) {
    this.stopShell(socket.id);
  }

  @SubscribeMessage('terminal:input')
  input(@ConnectedSocket() socket: Socket, @MessageBody() data: string) {
    const session = this.sessions.get(socket.id);
    if (!session) {
      this.startHostShell(socket);
    }
    this.sessions.get(socket.id)?.shell.write(data);
  }

  @SubscribeMessage('terminal:resize')
  resize(@ConnectedSocket() socket: Socket, @MessageBody() size: { cols?: number; rows?: number }) {
    const session = this.sessions.get(socket.id);
    if (!session) {
      return;
    }

    const cols = Number.isFinite(size?.cols) ? Math.max(20, Math.min(240, Math.trunc(size.cols ?? 100))) : 100;
    const rows = Number.isFinite(size?.rows) ? Math.max(8, Math.min(80, Math.trunc(size.rows ?? 30))) : 30;
    session.shell.resize(cols, rows);
  }

  @SubscribeMessage('terminal:restart')
  restart(@ConnectedSocket() socket: Socket) {
    this.stopShell(socket.id);
    this.startHostShell(socket);
  }

  @SubscribeMessage('terminal:container')
  container(@ConnectedSocket() socket: Socket, @MessageBody() data: { name?: string; shell?: string }) {
    this.stopShell(socket.id);
    const name = data?.name?.trim() || 'openclaw-local';
    const shell = data?.shell?.trim() || 'bash';
    this.startDockerShell(socket, name, shell);
  }

  private startHostShell(socket: Socket) {
    const shell = this.spawnHostShell();
    this.bindShell(socket, shell, `Connected to ${this.shellName()} in ${this.rootDir}\r\n`);
  }

  private startDockerShell(socket: Socket, containerName: string, shellName: string) {
    const shell = spawn('docker', ['exec', '-it', containerName, shellName], {
      name: 'xterm-color',
      cols: 100,
      rows: 30,
      cwd: this.rootDir,
      env: process.env,
    });
    this.bindShell(socket, shell, `Attached to container ${containerName} (${shellName})\r\n`);
  }

  private bindShell(socket: Socket, shell: IPty, banner: string) {
    this.sessions.set(socket.id, { shell });
    socket.emit('terminal:data', banner);

    shell.onData((chunk) => {
      socket.emit('terminal:data', chunk);
    });

    shell.onExit(({ exitCode }) => {
      socket.emit('terminal:data', `\r\n[terminal exited with code ${exitCode}]\r\n`);
      if (this.sessions.get(socket.id)?.shell === shell) {
        this.sessions.delete(socket.id);
      }
    });
  }

  private stopShell(socketId: string) {
    const session = this.sessions.get(socketId);
    if (!session) {
      return;
    }

    session.shell.kill();
    this.sessions.delete(socketId);
  }

  private spawnHostShell() {
    if (process.platform === 'win32') {
      return spawn('powershell.exe', ['-NoLogo'], {
        name: 'xterm-color',
        cols: 100,
        rows: 30,
        cwd: this.rootDir,
        env: process.env,
      });
    }

    return spawn(process.env.SHELL || 'bash', ['-i'], {
      name: 'xterm-color',
      cols: 100,
      rows: 30,
      cwd: this.rootDir,
      env: process.env,
    });
  }

  private shellName() {
    return process.platform === 'win32' ? 'PowerShell' : process.env.SHELL || 'bash';
  }
}
