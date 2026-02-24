import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { nowIso } from "./lib/format.js";
import type {
  BackupEntryExport,
  BackupFrequency,
  BackupSetting,
  BackupShareLinkExport,
  Drink,
  JournalEntry,
  ShareLink,
  ShareLinkType,
  UserState
} from "./types.js";

interface TelegramProfile {
  telegramId: string;
  username: string | null;
  firstName: string | null;
}

interface CreateEntryInput {
  drinkId: string;
  telegramId: string;
  entryDate: string;
  rawText: string;
  polishedText: string | null;
}

interface CreateShareLinkInput {
  token: string;
  type: ShareLinkType;
  drinkId: string;
  createdByTelegramId: string;
  giftRecipient?: string | null;
  bottleCode?: string | null;
  giftMessage?: string | null;
}

export class AppDatabase {
  private readonly db: any;

  constructor(dbPath: string) {
    const resolved = path.resolve(dbPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });

    this.db = new Database(resolved);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  ensureUser(profile: TelegramProfile): void {
    const now = nowIso();

    this.db
      .prepare(
        `
        INSERT INTO users (telegram_id, username, first_name, created_at, updated_at)
        VALUES (@telegramId, @username, @firstName, @now, @now)
        ON CONFLICT(telegram_id) DO UPDATE SET
          username = excluded.username,
          first_name = excluded.first_name,
          updated_at = excluded.updated_at
      `
      )
      .run({ ...profile, now });

    const nextBackupAt = getNextBackupRunAt("weekly", new Date(now));
    this.db
      .prepare(
        `
        INSERT INTO backup_settings (telegram_id, frequency, next_run_at, last_sent_at, updated_at)
        VALUES (?, 'weekly', ?, NULL, ?)
        ON CONFLICT(telegram_id) DO NOTHING
      `
      )
      .run(profile.telegramId, nextBackupAt, now);
  }

  createDrink(ownerTelegramId: string, name: string): Drink {
    const drink: Drink = {
      id: randomUUID(),
      ownerTelegramId,
      name,
      archivedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    this.db
      .prepare(
        `
        INSERT INTO drinks (id, owner_telegram_id, name, archived_at, created_at, updated_at)
        VALUES (@id, @ownerTelegramId, @name, @archivedAt, @createdAt, @updatedAt)
      `
      )
      .run(drink);

    return drink;
  }

  listDrinks(ownerTelegramId: string, scope: "all" | "active" | "archived" = "all"): Drink[] {
    const conditions = ["owner_telegram_id = @ownerTelegramId"];
    if (scope === "active") {
      conditions.push("archived_at IS NULL");
    } else if (scope === "archived") {
      conditions.push("archived_at IS NOT NULL");
    }

    const rows = this.db
      .prepare(
        `
        SELECT id, owner_telegram_id, name, archived_at, created_at, updated_at
        FROM drinks
        WHERE ${conditions.join(" AND ")}
        ORDER BY COALESCE(archived_at, updated_at) DESC, updated_at DESC
      `
      )
      .all({ ownerTelegramId });

    return rows.map(mapDrinkRow);
  }

  listCurrentDrinks(ownerTelegramId: string): Drink[] {
    return this.listDrinks(ownerTelegramId, "active");
  }

  listArchivedDrinks(ownerTelegramId: string): Drink[] {
    return this.listDrinks(ownerTelegramId, "archived");
  }

  getDrinkById(drinkId: string): Drink | null {
    const row = this.db
      .prepare(
        `
        SELECT id, owner_telegram_id, name, archived_at, created_at, updated_at
        FROM drinks
        WHERE id = ?
      `
      )
      .get(drinkId);

    return row ? mapDrinkRow(row) : null;
  }

  getDrinkForOwner(drinkId: string, ownerTelegramId: string): Drink | null {
    const row = this.db
      .prepare(
        `
        SELECT id, owner_telegram_id, name, archived_at, created_at, updated_at
        FROM drinks
        WHERE id = ? AND owner_telegram_id = ?
      `
      )
      .get(drinkId, ownerTelegramId);

    return row ? mapDrinkRow(row) : null;
  }

  archiveDrink(drinkId: string, ownerTelegramId: string): boolean {
    const archivedAt = nowIso();
    const result = this.db
      .prepare(
        `
        UPDATE drinks
        SET archived_at = ?, updated_at = ?
        WHERE id = ? AND owner_telegram_id = ? AND archived_at IS NULL
      `
      )
      .run(archivedAt, archivedAt, drinkId, ownerTelegramId);

    return result.changes > 0;
  }

  unarchiveDrink(drinkId: string, ownerTelegramId: string): boolean {
    const now = nowIso();
    const result = this.db
      .prepare(
        `
        UPDATE drinks
        SET archived_at = NULL, updated_at = ?
        WHERE id = ? AND owner_telegram_id = ? AND archived_at IS NOT NULL
      `
      )
      .run(now, drinkId, ownerTelegramId);

    return result.changes > 0;
  }

  createEntry(input: CreateEntryInput): JournalEntry {
    const entry: JournalEntry = {
      id: randomUUID(),
      drinkId: input.drinkId,
      telegramId: input.telegramId,
      entryDate: input.entryDate,
      rawText: input.rawText,
      polishedText: input.polishedText,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `
          INSERT INTO journal_entries (
            id,
            drink_id,
            telegram_id,
            entry_date,
            raw_text,
            polished_text,
            created_at,
            updated_at
          ) VALUES (
            @id,
            @drinkId,
            @telegramId,
            @entryDate,
            @rawText,
            @polishedText,
            @createdAt,
            @updatedAt
          )
        `
        )
        .run(entry);

      this.db
        .prepare(
          `UPDATE drinks SET updated_at = ? WHERE id = ?`
        )
        .run(nowIso(), input.drinkId);
    });

    tx();

    return entry;
  }

  listEntriesByDrink(drinkId: string): JournalEntry[] {
    const rows = this.db
      .prepare(
        `
        SELECT id, drink_id, telegram_id, entry_date, raw_text, polished_text, created_at, updated_at
        FROM journal_entries
        WHERE drink_id = ?
        ORDER BY entry_date DESC, created_at DESC
      `
      )
      .all(drinkId);

    return rows.map(mapEntryRow);
  }

  listEntriesForBackup(ownerTelegramId: string): BackupEntryExport[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          e.id,
          e.drink_id,
          d.name AS drink_name,
          d.archived_at AS drink_archived_at,
          e.entry_date,
          e.raw_text,
          e.polished_text,
          e.created_at,
          e.updated_at
        FROM journal_entries e
        INNER JOIN drinks d ON d.id = e.drink_id
        WHERE d.owner_telegram_id = ?
        ORDER BY e.entry_date DESC, e.created_at DESC
      `
      )
      .all(ownerTelegramId);

    return rows.map(mapBackupEntryRow);
  }

  updateEntryPolishedText(entryId: string, polishedText: string): void {
    this.db
      .prepare(`UPDATE journal_entries SET polished_text = ?, updated_at = ? WHERE id = ?`)
      .run(polishedText, nowIso(), entryId);
  }

  findShareLinkByDrink(drinkId: string, type: ShareLinkType): ShareLink | null {
    const row = this.db
      .prepare(
        `
        SELECT id, token, drink_id, type, gift_recipient, bottle_code, gift_message, created_by_telegram_id, created_at
        FROM share_links
        WHERE drink_id = ? AND type = ?
        ORDER BY created_at DESC
        LIMIT 1
      `
      )
      .get(drinkId, type);

    return row ? mapShareLinkRow(row) : null;
  }

  createShareLink(input: CreateShareLinkInput): ShareLink {
    const shareLink: ShareLink = {
      id: randomUUID(),
      token: input.token,
      drinkId: input.drinkId,
      type: input.type,
      giftRecipient: input.giftRecipient ?? null,
      bottleCode: input.bottleCode ?? null,
      giftMessage: input.giftMessage ?? null,
      createdByTelegramId: input.createdByTelegramId,
      createdAt: nowIso()
    };

    this.db
      .prepare(
        `
        INSERT INTO share_links (
          id,
          token,
          drink_id,
          type,
          gift_recipient,
          bottle_code,
          gift_message,
          created_by_telegram_id,
          created_at
        ) VALUES (
          @id,
          @token,
          @drinkId,
          @type,
          @giftRecipient,
          @bottleCode,
          @giftMessage,
          @createdByTelegramId,
          @createdAt
        )
      `
      )
      .run(shareLink);

    return shareLink;
  }

  getNextGiftBottleCode(drinkId: string): string {
    const row = this.db
      .prepare(
        `
        SELECT COUNT(*) AS gift_count
        FROM share_links
        WHERE drink_id = ? AND type = 'gift'
      `
      )
      .get(drinkId) as { gift_count?: number };

    const next = Number(row?.gift_count ?? 0) + 1;
    return next.toString().padStart(3, "0");
  }

  listShareLinksForBackup(ownerTelegramId: string): BackupShareLinkExport[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          s.id,
          s.drink_id,
          d.name AS drink_name,
          d.archived_at AS drink_archived_at,
          s.type,
          s.token,
          s.gift_recipient,
          s.bottle_code,
          s.gift_message,
          s.created_at
        FROM share_links s
        INNER JOIN drinks d ON d.id = s.drink_id
        WHERE d.owner_telegram_id = ?
        ORDER BY s.created_at DESC
      `
      )
      .all(ownerTelegramId);

    return rows.map(mapBackupShareLinkRow);
  }

  getShareLinkByToken(token: string): ShareLink | null {
    const row = this.db
      .prepare(
        `
        SELECT id, token, drink_id, type, gift_recipient, bottle_code, gift_message, created_by_telegram_id, created_at
        FROM share_links
        WHERE token = ?
      `
      )
      .get(token);

    return row ? mapShareLinkRow(row) : null;
  }

  setUserState(telegramId: string, step: string, payload: string | null = null): void {
    const now = nowIso();

    this.db
      .prepare(
        `
        INSERT INTO user_states (telegram_id, step, payload, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
          step = excluded.step,
          payload = excluded.payload,
          updated_at = excluded.updated_at
      `
      )
      .run(telegramId, step, payload, now);
  }

  getUserState(telegramId: string): UserState | null {
    const row = this.db
      .prepare(`SELECT telegram_id, step, payload, updated_at FROM user_states WHERE telegram_id = ?`)
      .get(telegramId);

    return row
      ? {
          telegramId: String(row.telegram_id),
          step: String(row.step),
          payload: row.payload ? String(row.payload) : null,
          updatedAt: String(row.updated_at)
        }
      : null;
  }

  clearUserState(telegramId: string): void {
    this.db.prepare(`DELETE FROM user_states WHERE telegram_id = ?`).run(telegramId);
  }

  getBackupSetting(telegramId: string): BackupSetting {
    const row = this.db
      .prepare(
        `
        SELECT telegram_id, frequency, next_run_at, last_sent_at, updated_at
        FROM backup_settings
        WHERE telegram_id = ?
      `
      )
      .get(telegramId);

    if (!row) {
      return {
        telegramId,
        frequency: "off",
        nextRunAt: null,
        lastSentAt: null,
        updatedAt: nowIso()
      };
    }

    return mapBackupSettingRow(row);
  }

  setBackupFrequency(telegramId: string, frequency: BackupFrequency): BackupSetting {
    const now = new Date();
    const nowValue = now.toISOString();
    const nextRunAt = getNextBackupRunAt(frequency, now);

    this.db
      .prepare(
        `
        INSERT INTO backup_settings (telegram_id, frequency, next_run_at, last_sent_at, updated_at)
        VALUES (?, ?, ?, NULL, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
          frequency = excluded.frequency,
          next_run_at = excluded.next_run_at,
          updated_at = excluded.updated_at
      `
      )
      .run(telegramId, frequency, nextRunAt, nowValue);

    return this.getBackupSetting(telegramId);
  }

  listDueBackupSettings(referenceTimeIso: string): BackupSetting[] {
    const rows = this.db
      .prepare(
        `
        SELECT telegram_id, frequency, next_run_at, last_sent_at, updated_at
        FROM backup_settings
        WHERE frequency != 'off'
          AND next_run_at IS NOT NULL
          AND next_run_at <= ?
        ORDER BY next_run_at ASC
        LIMIT 200
      `
      )
      .all(referenceTimeIso);

    return rows.map(mapBackupSettingRow);
  }

  markBackupSent(telegramId: string, frequency: BackupFrequency): void {
    const now = new Date();
    const nowValue = now.toISOString();
    const nextRunAt = getNextBackupRunAt(frequency, now);

    this.db
      .prepare(
        `
        UPDATE backup_settings
        SET last_sent_at = ?, next_run_at = ?, updated_at = ?
        WHERE telegram_id = ?
      `
      )
      .run(nowValue, nextRunAt, nowValue, telegramId);
  }

  postponeBackupRun(telegramId: string, minutes = 60): void {
    const now = new Date();
    const nowValue = now.toISOString();
    const nextRunAt = new Date(now.getTime() + minutes * 60 * 1000).toISOString();

    this.db
      .prepare(
        `
        UPDATE backup_settings
        SET next_run_at = ?, updated_at = ?
        WHERE telegram_id = ?
      `
      )
      .run(nextRunAt, nowValue, telegramId);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id TEXT PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS drinks (
        id TEXT PRIMARY KEY,
        owner_telegram_id TEXT NOT NULL,
        name TEXT NOT NULL,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (owner_telegram_id) REFERENCES users(telegram_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS journal_entries (
        id TEXT PRIMARY KEY,
        drink_id TEXT NOT NULL,
        telegram_id TEXT NOT NULL,
        entry_date TEXT NOT NULL,
        raw_text TEXT NOT NULL,
        polished_text TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (drink_id) REFERENCES drinks(id) ON DELETE CASCADE,
        FOREIGN KEY (telegram_id) REFERENCES users(telegram_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS share_links (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        drink_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('drink', 'gift')),
        gift_recipient TEXT,
        bottle_code TEXT,
        gift_message TEXT,
        created_by_telegram_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (drink_id) REFERENCES drinks(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by_telegram_id) REFERENCES users(telegram_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS user_states (
        telegram_id TEXT PRIMARY KEY,
        step TEXT NOT NULL,
        payload TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (telegram_id) REFERENCES users(telegram_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS backup_settings (
        telegram_id TEXT PRIMARY KEY,
        frequency TEXT NOT NULL CHECK(frequency IN ('off', 'weekly', 'biweekly', 'monthly')),
        next_run_at TEXT,
        last_sent_at TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (telegram_id) REFERENCES users(telegram_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_drinks_owner ON drinks(owner_telegram_id);
      CREATE INDEX IF NOT EXISTS idx_entries_drink ON journal_entries(drink_id);
      CREATE INDEX IF NOT EXISTS idx_share_links_drink ON share_links(drink_id);
      CREATE INDEX IF NOT EXISTS idx_backup_next_run ON backup_settings(next_run_at);
    `);

    this.ensureColumn("drinks", "archived_at", "TEXT");
  }

  private ensureColumn(tableName: string, columnName: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
    const hasColumn = columns.some((column: { name: string }) => column.name === columnName);

    if (!hasColumn) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }
}

function mapDrinkRow(row: Record<string, unknown>): Drink {
  return {
    id: String(row.id),
    ownerTelegramId: String(row.owner_telegram_id),
    name: String(row.name),
    archivedAt: row.archived_at === null ? null : String(row.archived_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapEntryRow(row: Record<string, unknown>): JournalEntry {
  return {
    id: String(row.id),
    drinkId: String(row.drink_id),
    telegramId: String(row.telegram_id),
    entryDate: String(row.entry_date),
    rawText: String(row.raw_text),
    polishedText: row.polished_text === null ? null : String(row.polished_text),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapShareLinkRow(row: Record<string, unknown>): ShareLink {
  return {
    id: String(row.id),
    token: String(row.token),
    drinkId: String(row.drink_id),
    type: String(row.type) as ShareLinkType,
    giftRecipient: row.gift_recipient === null ? null : String(row.gift_recipient),
    bottleCode: row.bottle_code === null ? null : String(row.bottle_code),
    giftMessage: row.gift_message === null ? null : String(row.gift_message),
    createdByTelegramId: String(row.created_by_telegram_id),
    createdAt: String(row.created_at)
  };
}

function mapBackupEntryRow(row: Record<string, unknown>): BackupEntryExport {
  return {
    id: String(row.id),
    drinkId: String(row.drink_id),
    drinkName: String(row.drink_name),
    drinkArchivedAt: row.drink_archived_at === null ? null : String(row.drink_archived_at),
    entryDate: String(row.entry_date),
    rawText: String(row.raw_text),
    polishedText: row.polished_text === null ? null : String(row.polished_text),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapBackupShareLinkRow(row: Record<string, unknown>): BackupShareLinkExport {
  return {
    id: String(row.id),
    drinkId: String(row.drink_id),
    drinkName: String(row.drink_name),
    drinkArchivedAt: row.drink_archived_at === null ? null : String(row.drink_archived_at),
    type: String(row.type) as ShareLinkType,
    token: String(row.token),
    giftRecipient: row.gift_recipient === null ? null : String(row.gift_recipient),
    bottleCode: row.bottle_code === null ? null : String(row.bottle_code),
    giftMessage: row.gift_message === null ? null : String(row.gift_message),
    createdAt: String(row.created_at)
  };
}

function mapBackupSettingRow(row: Record<string, unknown>): BackupSetting {
  return {
    telegramId: String(row.telegram_id),
    frequency: String(row.frequency) as BackupFrequency,
    nextRunAt: row.next_run_at === null ? null : String(row.next_run_at),
    lastSentAt: row.last_sent_at === null ? null : String(row.last_sent_at),
    updatedAt: String(row.updated_at)
  };
}

function getNextBackupRunAt(frequency: BackupFrequency, from: Date): string | null {
  if (frequency === "off") {
    return null;
  }

  const days =
    frequency === "weekly" ? 7 : frequency === "biweekly" ? 14 : frequency === "monthly" ? 30 : 0;
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}
