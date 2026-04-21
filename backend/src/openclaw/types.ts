export interface CommandResult {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  code?: number;
}

export interface JsonResult<T = unknown> {
  ok: boolean;
  status?: number;
  data?: T;
  raw?: string;
  error?: string;
}

export interface ChatRequest {
  message?: string;
  model?: string;
  agentId?: string;
  maxOutputTokens?: number;
  stream?: boolean;
}
