import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TerminalRunRequestDto {
  @ApiProperty({
    description: 'Command to run on the backend host.',
    example: 'docker version',
  })
  command!: string;

  @ApiPropertyOptional({
    description: 'Optional working directory. Defaults to CLAWBOT_ROOT.',
    example: 'D:\\Desktop\\clawd-bot',
  })
  cwd?: string;
}

export class TerminalRunResponseDto {
  @ApiProperty()
  ok!: boolean;

  @ApiProperty()
  command!: string;

  @ApiProperty()
  cwd!: string;

  @ApiProperty()
  stdout!: string;

  @ApiProperty()
  stderr!: string;

  @ApiPropertyOptional()
  code?: number;
}

export class DockerContainerDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  image!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  state!: string;
}

export class DockerContainersResponseDto {
  @ApiProperty()
  ok!: boolean;

  @ApiProperty({ type: [DockerContainerDto] })
  containers!: DockerContainerDto[];

  @ApiPropertyOptional()
  error?: string;
}
