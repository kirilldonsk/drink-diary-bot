import { appConfig } from "./config.js";
import { createTelegramBot } from "./bot.js";
import { AppDatabase } from "./db.js";
import { startBackupScheduler } from "./services/backupScheduler.js";
import { createHttpServer } from "./server.js";
import { RecipePolisher } from "./services/llm.js";

async function main(): Promise<void> {
  const db = new AppDatabase(appConfig.dbPath);

  const polisher = new RecipePolisher({
    apiKey: appConfig.proxyApiKey,
    baseUrl: appConfig.proxyApiBaseUrl,
    model: appConfig.proxyApiModel
  });

  const bot = createTelegramBot({
    config: appConfig,
    db,
    polisher
  });

  const server = createHttpServer({
    config: appConfig,
    db
  });
  const backupScheduler = startBackupScheduler({ bot, db });

  let shuttingDown = false;

  const stop = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log("Shutting down...");
    backupScheduler.stop();
    bot.stop();
    await server.close();
    db.close();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void stop();
  });
  process.once("SIGTERM", () => {
    void stop();
  });

  await server.listen({
    port: appConfig.port,
    host: "0.0.0.0"
  });

  void bot.start({
    drop_pending_updates: true,
    onStart: (botInfo) => {
      const llmStatus = polisher.enabled ? "enabled" : "disabled";
      console.log(`Bot @${botInfo.username} started. ProxyAPI polishing: ${llmStatus}`);
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
