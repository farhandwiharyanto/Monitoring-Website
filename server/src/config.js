import "dotenv/config";
import path from "node:path";

export const config = {
  port: Number(process.env.PORT || 3001),
  jwtSecret: process.env.JWT_SECRET || "pulsewatch-dev-secret-change-me",
  databaseUrl: process.env.DATABASE_URL,
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "admin123",
  baseUrl: process.env.BASE_URL || "http://localhost:3001",
  clientDist: path.resolve(process.env.CLIENT_DIST || "../client/dist"),
};
