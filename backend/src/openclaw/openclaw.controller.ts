import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ChatRequestDto, ChatResponseDto, CommandResultDto, JsonResultDto, UsageCostDto } from './dto';
import { OpenclawService } from './openclaw.service';

@ApiTags('openclaw')
@Controller('api/openclaw')
export class OpenclawController {
  constructor(private readonly openclaw: OpenclawService) {}

  @ApiOperation({ summary: 'Get backend, Docker, and OpenClaw status.' })
  @ApiOkResponse({ description: 'Aggregated runtime status.' })
  @Get('status')
  status(@Query('instanceId') instanceId?: string) {
    return this.openclaw.status(instanceId);
  }

  @ApiOperation({ summary: 'Check OpenClaw health and readiness.' })
  @ApiOkResponse({ description: 'Health and readyz results.' })
  @Get('health')
  health(@Query('instanceId') instanceId?: string) {
    return this.openclaw.health(instanceId);
  }

  @ApiOperation({ summary: 'List models exposed by OpenClaw OpenResponses API.' })
  @ApiOkResponse({ type: JsonResultDto })
  @Get('models')
  models(@Query('instanceId') instanceId?: string) {
    return this.openclaw.models(instanceId);
  }

  @ApiOperation({ summary: 'Read docker compose logs for the OpenClaw service.' })
  @ApiQuery({ name: 'tail', required: false, example: 200, description: 'Number of log lines to return.' })
  @ApiOkResponse({ type: CommandResultDto })
  @Get('logs')
  logs(@Query('tail') tail?: string, @Query('instanceId') instanceId?: string) {
    return this.openclaw.logs(Number(tail ?? 200), instanceId);
  }

  @ApiOperation({ summary: 'Get OpenClaw token and cost usage summary.' })
  @ApiQuery({ name: 'days', required: false, example: 30, description: 'Number of days to include.' })
  @ApiOkResponse({ type: UsageCostDto })
  @Get('usage-cost')
  usageCost(@Query('days') days?: string, @Query('instanceId') instanceId?: string) {
    return this.openclaw.usageCost(Number(days ?? 30), instanceId);
  }

  @ApiOperation({ summary: 'Send a message to OpenClaw through the backend proxy.' })
  @ApiBody({ type: ChatRequestDto })
  @ApiOkResponse({ type: ChatResponseDto })
  @Post('chat')
  chat(@Body() body: ChatRequestDto, @Query('instanceId') instanceId?: string) {
    return this.openclaw.chat(body, instanceId);
  }

  @ApiOperation({ summary: 'Start the local Docker Compose OpenClaw stack.' })
  @ApiOkResponse({ type: CommandResultDto })
  @Post('docker/start')
  start(@Query('instanceId') instanceId?: string) {
    return this.openclaw.startDocker(instanceId);
  }

  @ApiOperation({ summary: 'Stop the local Docker Compose OpenClaw stack.' })
  @ApiOkResponse({ type: CommandResultDto })
  @Post('docker/stop')
  stop(@Query('instanceId') instanceId?: string) {
    return this.openclaw.stopDocker(instanceId);
  }

  @ApiOperation({ summary: 'Restart the local Docker Compose OpenClaw stack.' })
  @ApiOkResponse({ type: CommandResultDto })
  @Post('docker/restart')
  restart(@Query('instanceId') instanceId?: string) {
    return this.openclaw.restartDocker(instanceId);
  }

  @ApiOperation({ summary: 'Build and start the local Docker Compose OpenClaw stack.' })
  @ApiOkResponse({ type: CommandResultDto })
  @Post('docker/build')
  build() {
    return this.openclaw.buildDocker();
  }

  @ApiOperation({ summary: 'Enable OpenClaw OpenResponses HTTP endpoint in local config.' })
  @ApiOkResponse({ type: CommandResultDto })
  @Post('enable-responses')
  enableResponses() {
    return this.openclaw.enableResponsesApi();
  }
}
