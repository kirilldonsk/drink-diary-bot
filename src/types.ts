export type ShareLinkType = "drink" | "gift";
export type BackupFrequency = "off" | "weekly" | "biweekly" | "monthly";

export interface Drink {
  id: string;
  ownerTelegramId: string;
  name: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JournalEntry {
  id: string;
  drinkId: string;
  telegramId: string;
  entryDate: string;
  rawText: string;
  polishedText: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShareLink {
  id: string;
  token: string;
  drinkId: string;
  type: ShareLinkType;
  giftRecipient: string | null;
  bottleCode: string | null;
  giftMessage: string | null;
  createdByTelegramId: string;
  createdAt: string;
}

export interface UserState {
  telegramId: string;
  step: string;
  payload: string | null;
  updatedAt: string;
}

export interface BackupSetting {
  telegramId: string;
  frequency: BackupFrequency;
  nextRunAt: string | null;
  lastSentAt: string | null;
  updatedAt: string;
}

export interface BackupEntryExport {
  id: string;
  drinkId: string;
  drinkName: string;
  drinkArchivedAt: string | null;
  entryDate: string;
  rawText: string;
  polishedText: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackupShareLinkExport {
  id: string;
  drinkId: string;
  drinkName: string;
  drinkArchivedAt: string | null;
  type: ShareLinkType;
  token: string;
  giftRecipient: string | null;
  bottleCode: string | null;
  giftMessage: string | null;
  createdAt: string;
}
