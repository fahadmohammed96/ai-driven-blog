import { Module } from "@nestjs/common";
// Depend on another module via its public barrel, never its internals.
import { TenancyModule } from "../tenancy";
import { ContentService } from "./content.service";
import { ArticlesController } from "./articles.controller";

@Module({
  imports: [TenancyModule],
  controllers: [ArticlesController],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}
