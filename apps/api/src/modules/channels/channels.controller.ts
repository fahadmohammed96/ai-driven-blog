import { BadRequestException, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { CHANNELS, channelSchema, type Channel } from "@blogs/contracts";
import { DB } from "../../platform/tokens";
import type { Db } from "../../platform/db/client";
import {
  createCredentialStore,
  type DbCredentialStore,
  type OAuthToken,
} from "../../platform/integration";
import { TenancyService } from "../tenancy";

interface ChannelConnection {
  channel: Channel;
  connected: boolean;
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * DEBT-008 boundary. The REAL flow performs an OAuth2 authorization-code
 * exchange with the provider (Meta for Instagram, etc.) to obtain this token.
 * Here that external handshake is STUBBED — we synthesize a token set and seal
 * it in the SAME encrypted, per-tenant store (crypto + RLS are real). Swapping
 * in the real provider exchange later changes ONLY this function.
 */
function stubExchange(channel: Channel): OAuthToken {
  return {
    accessToken: `stub-${channel}-access`,
    refreshToken: `stub-${channel}-refresh`,
    expiresAt: Date.now() + NINETY_DAYS_MS,
  };
}

/**
 * Channel connection onboarding (Step B). Connect/disconnect a tenant's social
 * channel and report its connection status. Reuses the integration gateway's
 * sealed (AES-256-GCM), RLS-isolated credential store — the connection state is
 * REAL; only the provider consent/handshake is stubbed (DEBT-008).
 */
@Controller("channels")
export class ChannelsController {
  private readonly store: DbCredentialStore;

  constructor(
    @Inject(DB) db: Db,
    private readonly tenancy: TenancyService,
  ) {
    this.store = createCredentialStore(db);
  }

  private get tenantId(): string {
    return this.tenancy.current().tenantId;
  }

  @Get()
  async list(): Promise<{ channels: ChannelConnection[] }> {
    const tenantId = this.tenantId;
    const channels = await Promise.all(
      CHANNELS.map(async (channel) => ({
        channel,
        connected: (await this.store.load(tenantId, channel)) !== null,
      })),
    );
    return { channels };
  }

  @Post(":channel/connect")
  async connect(@Param("channel") raw: string): Promise<ChannelConnection> {
    const channel = this.parseChannel(raw);
    await this.store.save(this.tenantId, channel, stubExchange(channel));
    return { channel, connected: true };
  }

  @Post(":channel/disconnect")
  async disconnect(@Param("channel") raw: string): Promise<ChannelConnection> {
    const channel = this.parseChannel(raw);
    await this.store.delete(this.tenantId, channel);
    return { channel, connected: false };
  }

  private parseChannel(raw: string): Channel {
    const parsed = channelSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(`unknown channel: ${raw}`);
    return parsed.data;
  }
}
