import { InputFile } from "grammy";
import type { Bot, Context } from "grammy";
import { AppDatabase } from "../db.js";
import {
  backupFrequencyLabel,
  buildBackupFileName,
  buildLogsCsv,
  summarizeBackupContent
} from "./backup.js";

interface BackupSchedulerDeps {
  bot: Bot<Context>;
  db: AppDatabase;
  intervalMs?: number;
}

export interface BackupSchedulerHandle {
  stop(): void;
}

export function startBackupScheduler(deps: BackupSchedulerDeps): BackupSchedulerHandle {
  const intervalMs = deps.intervalMs ?? 60_000;
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }

    running = true;
    try {
      const due = deps.db.listDueBackupSettings(new Date().toISOString());
      for (const setting of due) {
        try {
          const backup = buildLogsCsv(deps.db, setting.telegramId);
          const drinks = deps.db.listDrinks(setting.telegramId, "all");
          const fileName = buildBackupFileName(setting.telegramId, backup.generatedAt);

          await deps.bot.api.sendDocument(
            setting.telegramId,
            new InputFile(Buffer.from(backup.csv, "utf-8"), fileName),
            {
              caption: [
                "Автоматический CSV-бэкап логов.",
                `Частота: ${backupFrequencyLabel(setting.frequency)}`,
                summarizeBackupContent(drinks, backup.rows)
              ].join("\n")
            }
          );

          deps.db.markBackupSent(setting.telegramId, setting.frequency);
        } catch (error) {
          console.error(`Auto backup failed for ${setting.telegramId}:`, error);
          deps.db.postponeBackupRun(setting.telegramId, 120);
        }
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  void tick();

  return {
    stop() {
      clearInterval(timer);
    }
  };
}
