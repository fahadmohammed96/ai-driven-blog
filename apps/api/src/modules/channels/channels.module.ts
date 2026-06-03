import { Module } from "@nestjs/common";
import { TenancyModule } from "../tenancy";
import { ChannelsController } from "./channels.controller";

/**
 * Channels (Step B): connect/disconnect a tenant's social channels over the
 * integration gateway's sealed, per-tenant credential store. The provider
 * consent/handshake is stubbed at the boundary (DEBT-008).
 */
@Module({
  imports: [TenancyModule],
  controllers: [ChannelsController],
})
export class ChannelsModule {}
