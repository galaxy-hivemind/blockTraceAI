import { createApp } from "./app";
import { config } from "./config/env";
import { prisma } from "./config/prisma";

const app = createApp();

app.listen(config.port, () => {
  console.log(`BlockTrace backend listening on http://localhost:${config.port}`);
});

async function shutdown(): Promise<void> {
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
