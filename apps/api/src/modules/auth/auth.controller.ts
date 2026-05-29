import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthService } from "./auth.service";

interface LoginBody {
  email?: string;
  password?: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @HttpCode(200)
  login(@Body() body: LoginBody): { token: string } {
    return this.auth.login(body.email ?? "", body.password ?? "");
  }

  @Get("me")
  me(@Headers("authorization") authorization?: string): { sub: string } {
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    if (!token) {
      throw new UnauthorizedException("missing bearer token");
    }
    return this.auth.verify(token);
  }
}
