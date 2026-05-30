import { Module } from "@nestjs/common";
import { TenancyModule } from "../../modules/tenancy";
import { ItinerariesController } from "./itineraries.controller";

/** Travel vertical HTTP surface (itineraries, photos, article generation). */
@Module({
  imports: [TenancyModule],
  controllers: [ItinerariesController],
})
export class TravelModule {}
