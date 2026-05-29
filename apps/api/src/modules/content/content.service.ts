import { Injectable } from "@nestjs/common";
// Cross-module dependency via the PUBLIC barrel (allowed by the boundary rule).
import { TenancyService } from "../tenancy";
// Shared kernel (always importable).
import { SystemClock, type Clock } from "../../platform";

@Injectable()
export class ContentService {
  private readonly clock: Clock = new SystemClock();

  constructor(private readonly tenancy: TenancyService) {}

  scopedStamp(): { tenantId: string; ts: string } {
    return {
      tenantId: this.tenancy.current().tenantId,
      ts: this.clock.now().toISOString(),
    };
  }
}
