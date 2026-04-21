import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DockerContainersResponseDto, TerminalRunRequestDto, TerminalRunResponseDto } from './dto';
import { TerminalService } from './terminal.service';

@ApiTags('terminal')
@Controller('api/terminal')
export class TerminalController {
  constructor(private readonly terminal: TerminalService) {}

  @ApiOperation({ summary: 'Run a local shell command from the frontend terminal.' })
  @ApiBody({ type: TerminalRunRequestDto })
  @ApiOkResponse({ type: TerminalRunResponseDto })
  @Post('run')
  run(@Body() body: TerminalRunRequestDto) {
    return this.terminal.run(body);
  }

  @ApiOperation({ summary: 'List Docker containers available for terminal attach.' })
  @ApiOkResponse({ type: DockerContainersResponseDto })
  @Get('containers')
  containers() {
    return this.terminal.containers();
  }
}
