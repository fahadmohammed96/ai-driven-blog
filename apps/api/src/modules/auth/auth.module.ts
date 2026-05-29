import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService, type AuthConfig } from "./auth.service";
import { hashPassword } from "./password";

function configFromEnv(): AuthConfig {
  const hash =
    process.env.FOUNDER_PASSWORD_HASH ??
    (process.env.FOUNDER_PASSWORD ? hashPassword(process.env.FOUNDER_PASSWORD) : "");
  return {
    founderEmail: process.env.FOUNDER_EMAIL ?? "founder@example.com",
    founderPasswordHash: hash,
    jwtSecret: process.env.JWT_SECRET ?? "dev-insecure-secret",
  };
}

@Module({
  controllers: [AuthController],
  providers: [{ provide: AuthService, useFactory: () => new AuthService(configFromEnv()) }],
  exports: [AuthService],
})
export class AuthModule {}
