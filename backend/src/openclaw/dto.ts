import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChatRequestDto {
  @ApiProperty({
    description: 'Message to send to OpenClaw.',
    example: 'Xin chao, ban dang ket noi voi frontend chua?',
  })
  message!: string;

  @ApiPropertyOptional({
    description: 'OpenClaw model id.',
    default: 'openclaw',
    example: 'openclaw',
  })
  model?: string;

  @ApiPropertyOptional({
    description: 'Target OpenClaw agent id. Reserved for future routing.',
    example: 'main',
  })
  agentId?: string;

  @ApiPropertyOptional({
    description: 'Maximum output tokens for the response.',
    default: 512,
    example: 768,
  })
  maxOutputTokens?: number;

  @ApiPropertyOptional({
    description: 'Streaming is reserved for future support. Current backend sends non-streaming requests.',
    default: false,
    example: false,
  })
  stream?: boolean;
}

export class CommandResultDto {
  @ApiProperty()
  ok!: boolean;

  @ApiProperty()
  command!: string;

  @ApiProperty()
  stdout!: string;

  @ApiProperty()
  stderr!: string;

  @ApiPropertyOptional()
  code?: number;
}

export class JsonResultDto {
  @ApiProperty()
  ok!: boolean;

  @ApiPropertyOptional()
  status?: number;

  @ApiPropertyOptional({ type: Object })
  data?: unknown;

  @ApiPropertyOptional()
  raw?: string;

  @ApiPropertyOptional()
  error?: string;
}

export class ChatResponseDto extends JsonResultDto {
  @ApiPropertyOptional({
    description: 'Extracted assistant text from the OpenResponses payload.',
    example: 'Frontend da ket noi va hoat dong roi.',
  })
  outputText?: string;
}

export class UsageCostDto extends JsonResultDto {}

export class CreateInstanceDto {
  @ApiProperty({
    description: 'Human friendly Clawbot instance name.',
    example: 'research-bot',
  })
  name!: string;

  @ApiPropertyOptional({
    description: 'Docker container name. For safety it must start with openclaw-.',
    example: 'openclaw-research-bot',
  })
  containerName?: string;

  @ApiPropertyOptional({
    description: 'Host port to publish the OpenClaw gateway.',
    example: 18790,
  })
  gatewayPort?: number;

  @ApiPropertyOptional({
    description: 'Host port to publish SSH.',
    example: 2223,
  })
  sshPort?: number;

  @ApiPropertyOptional({
    description: 'Gateway token for this instance. A token will be generated when omitted.',
    example: 'change-me-strong-token',
  })
  token?: string;
}

export class SetActiveInstanceDto {
  @ApiProperty({
    description: 'Clawbot instance id.',
    example: 'research-bot',
  })
  instanceId!: string;
}

export class InstanceDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  containerName!: string;

  @ApiProperty()
  gatewayPort!: number;

  @ApiProperty()
  sshPort!: number;

  @ApiProperty()
  token!: string;

  @ApiProperty()
  baseUrl!: string;
}

export class InstancesResponseDto {
  @ApiProperty()
  activeId!: string;

  @ApiProperty({ type: [InstanceDto] })
  instances!: InstanceDto[];
}

export class InstanceActionResponseDto extends JsonResultDto {
  @ApiPropertyOptional({ type: InstanceDto })
  instance?: InstanceDto;
}
