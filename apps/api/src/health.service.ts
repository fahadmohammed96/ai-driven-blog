import { Injectable } from "@nestjs/common";
import { healthStatus, type HealthStatus } from "./health";

@Injectable()
export class HealthService {
  status(): HealthStatus {
    return healthStatus();
  }
}
