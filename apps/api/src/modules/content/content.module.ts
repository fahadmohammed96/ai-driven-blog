import { Module } from "@nestjs/common";
// Depend on another module via its public barrel, never its internals.
import { TenancyModule } from "../tenancy";
import { ContentService } from "./content.service";

@Module({
  imports: [TenancyModule],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}
