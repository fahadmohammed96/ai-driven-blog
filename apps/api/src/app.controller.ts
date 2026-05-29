import { Controller, Get } from "@nestjs/common";
import { HealthService } from "./health.service";
import type { HealthStatus } from "./health";

@Controller()
export class AppController {
  constructor(private readonly health: HealthService) {}

  @Get("health")
  getHealth(): HealthStatus {
    return this.health.status();
  }
}
