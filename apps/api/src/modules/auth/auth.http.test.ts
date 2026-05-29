import "reflect-metadata";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AuthModule } from "./auth.module";

// Boots the real Nest HTTP app (DI metadata via swc) and exercises the
// auth endpoints end-to-end. Covers the controller/wiring, not just AuthService.
describe("auth HTTP", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.FOUNDER_EMAIL = "founder@test.dev";
    process.env.FOUNDER_PASSWORD = "founderpass";
    process.env.JWT_SECRET = "http-test-secret";
    delete process.env.FOUNDER_PASSWORD_HASH;

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("logs in the founder and authorizes /auth/me", async () => {
    const server = app.getHttpServer();
    const login = await request(server)
      .post("/auth/login")
      .send({ email: "founder@test.dev", password: "founderpass" })
      .expect(200);
    expect(login.body.token).toBeTruthy();

    const me = await request(server)
      .get("/auth/me")
      .set("Authorization", `Bearer ${login.body.token}`)
      .expect(200);
    expect(me.body.sub).toBe("founder@test.dev");
  });

  it("rejects a wrong password and a missing token", async () => {
    const server = app.getHttpServer();
    await request(server)
      .post("/auth/login")
      .send({ email: "founder@test.dev", password: "WRONG" })
      .expect(401);
    await request(server).get("/auth/me").expect(401);
  });
});
