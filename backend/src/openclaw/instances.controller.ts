import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateInstanceDto, InstanceActionResponseDto, InstancesResponseDto, SetActiveInstanceDto } from './dto';
import { InstancesService } from './instances.service';

@ApiTags('instances')
@Controller('api/instances')
export class InstancesController {
  constructor(private readonly instances: InstancesService) {}

  @ApiOperation({ summary: 'List Clawbot instances managed by this backend.' })
  @ApiOkResponse({ type: InstancesResponseDto })
  @Get()
  list() {
    return this.instances.list();
  }

  @ApiOperation({ summary: 'Create a new Clawbot Docker instance definition.' })
  @ApiBody({ type: CreateInstanceDto })
  @ApiOkResponse({ type: InstanceActionResponseDto })
  @Post()
  create(@Body() body: CreateInstanceDto) {
    return this.instances.createAndStart(body);
  }

  @ApiOperation({ summary: 'Set the active Clawbot instance used by default.' })
  @ApiBody({ type: SetActiveInstanceDto })
  @ApiOkResponse({ type: InstanceActionResponseDto })
  @Post('active')
  setActive(@Body() body: SetActiveInstanceDto) {
    return this.instances.setActive(body.instanceId);
  }

  @ApiOperation({ summary: 'Start a Clawbot instance container.' })
  @ApiOkResponse({ type: InstanceActionResponseDto })
  @Post(':id/start')
  start(@Param('id') id: string) {
    return this.instances.start(id);
  }

  @ApiOperation({ summary: 'Stop a Clawbot instance container.' })
  @ApiOkResponse({ type: InstanceActionResponseDto })
  @Post(':id/stop')
  stop(@Param('id') id: string) {
    return this.instances.stop(id);
  }

  @ApiOperation({ summary: 'Restart a Clawbot instance container.' })
  @ApiOkResponse({ type: InstanceActionResponseDto })
  @Post(':id/restart')
  restart(@Param('id') id: string) {
    return this.instances.restart(id);
  }

  @ApiOperation({ summary: 'Delete a managed Clawbot instance container and registry entry.' })
  @ApiOkResponse({ type: InstanceActionResponseDto })
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.instances.delete(id);
  }

  @ApiOperation({ summary: 'Build the OpenClaw Docker image used by instances.' })
  @ApiOkResponse({ type: InstanceActionResponseDto })
  @Post('image/build')
  buildImage() {
    return this.instances.buildImage();
  }
}
