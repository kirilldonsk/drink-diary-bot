import type { AppDatabase } from "../db.js";
import type { BackupFrequency, Drink } from "../types.js";

const CSV_HEADERS = [
  "record_type",
  "telegram_id",
  "drink_id",
  "drink_name",
  "drink_archived_at",
  "entry_id",
  "entry_date",
  "raw_text",
  "polished_text",
  "share_link_id",
  "share_type",
  "share_token",
  "gift_recipient",
  "bottle_code",
  "gift_message",
  "created_at",
  "updated_at",
  "generated_at"
] as const;

export interface BackupCsvResult {
  csv: string;
  rows: number;
  generatedAt: string;
}

export function buildLogsCsv(db: AppDatabase, telegramId: string): BackupCsvResult {
  const generatedAt = new Date().toISOString();
  const drinks = db.listDrinks(telegramId, "all");
  const entries = db.listEntriesForBackup(telegramId);
  const shares = db.listShareLinksForBackup(telegramId);

  const lines: string[] = [];
  lines.push(CSV_HEADERS.map(csvEscape).join(","));

  for (const drink of drinks) {
    lines.push(
      toCsvLine([
        "drink",
        telegramId,
        drink.id,
        drink.name,
        drink.archivedAt,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        drink.createdAt,
        drink.updatedAt,
        generatedAt
      ])
    );
  }

  for (const entry of entries) {
    lines.push(
      toCsvLine([
        "entry",
        telegramId,
        entry.drinkId,
        entry.drinkName,
        entry.drinkArchivedAt,
        entry.id,
        entry.entryDate,
        entry.rawText,
        entry.polishedText,
        null,
        null,
        null,
        null,
        null,
        null,
        entry.createdAt,
        entry.updatedAt,
        generatedAt
      ])
    );
  }

  for (const share of shares) {
    lines.push(
      toCsvLine([
        "share_link",
        telegramId,
        share.drinkId,
        share.drinkName,
        share.drinkArchivedAt,
        null,
        null,
        null,
        null,
        share.id,
        share.type,
        share.token,
        share.giftRecipient,
        share.bottleCode,
        share.giftMessage,
        share.createdAt,
        null,
        generatedAt
      ])
    );
  }

  return {
    csv: `${lines.join("\n")}\n`,
    rows: drinks.length + entries.length + shares.length,
    generatedAt
  };
}

export function buildBackupFileName(telegramId: string, generatedAt: string): string {
  const stamp = generatedAt.replace(/[:.]/g, "-");
  return `backup-${telegramId}-${stamp}.csv`;
}

export function backupFrequencyLabel(frequency: BackupFrequency): string {
  if (frequency === "weekly") return "раз в 7 дней";
  if (frequency === "biweekly") return "раз в 14 дней";
  if (frequency === "monthly") return "раз в 30 дней";
  return "выключено";
}

export function formatBackupDate(iso: string | null): string {
  if (!iso) return "-";
  return iso.replace("T", " ").slice(0, 16);
}

function toCsvLine(values: Array<string | null>): string {
  return values.map(csvEscape).join(",");
}

function csvEscape(value: string | null): string {
  const normalized = value ?? "";
  const escaped = normalized.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function summarizeBackupContent(drinks: Drink[], rows: number): string {
  return `Напитков: ${drinks.length}\nВсего строк в CSV: ${rows}`;
}
