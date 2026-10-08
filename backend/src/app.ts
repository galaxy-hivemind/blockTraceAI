import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { config } from "./config/env";
import { authRouter } from "./routes/auth";
import { healthRouter } from "./routes/health";
import { evidenceRouter } from "./routes/evidence";
import { incidentsRouter } from "./routes/incidents";
import { protectedRouter } from "./routes/protected";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: config.frontendUrl,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser(config.sessionSecret));
  app.use(healthRouter);
  app.use(authRouter);
  app.use(evidenceRouter);
  app.use(incidentsRouter);
  app.use(protectedRouter);

  return app;
}
