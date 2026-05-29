import { UnauthorizedException } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { verifyPassword } from "./password";

export interface AuthConfig {
  founderEmail: string;
  founderPasswordHash: string;
  jwtSecret: string;
  tokenTtlSeconds?: number;
}

export interface AuthPrincipal {
  sub: string;
}

export const AUTH_CONFIG = Symbol("AUTH_CONFIG");

/**
 * Minimal self-hosted auth (ADR-0010), n=1: verifies the founder's credentials
 * and issues a JWT session. Plain class (provided via factory) so it is unit
 * testable without Nest DI.
 */
export class AuthService {
  constructor(private readonly config: AuthConfig) {}

  login(email: string, password: string): { token: string } {
    const ok =
      email === this.config.founderEmail &&
      this.config.founderPasswordHash.length > 0 &&
      verifyPassword(password, this.config.founderPasswordHash);
    if (!ok) {
      throw new UnauthorizedException("invalid credentials");
    }
    const token = jwt.sign({ sub: email }, this.config.jwtSecret, {
      expiresIn: this.config.tokenTtlSeconds ?? 3600,
    });
    return { token };
  }

  verify(token: string): AuthPrincipal {
    try {
      const payload = jwt.verify(token, this.config.jwtSecret);
      if (typeof payload !== "string" && typeof payload.sub === "string") {
        return { sub: payload.sub };
      }
    } catch {
      // fall through to the throw below
    }
    throw new UnauthorizedException("invalid token");
  }
}
