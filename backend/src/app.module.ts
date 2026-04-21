import { Module } from '@nestjs/common';
import { InstancesController } from './openclaw/instances.controller';
import { InstancesService } from './openclaw/instances.service';
import { OpenclawController } from './openclaw/openclaw.controller';
import { OpenclawService } from './openclaw/openclaw.service';
import { TerminalController } from './terminal/terminal.controller';
import { TerminalGateway } from './terminal/terminal.gateway';
import { TerminalService } from './terminal/terminal.service';

@Module({
  controllers: [OpenclawController, InstancesController, TerminalController],
  providers: [OpenclawService, InstancesService, TerminalService, TerminalGateway],
})
export class AppModule {}
