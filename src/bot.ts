import { Bot, InlineKeyboard, InputFile, Keyboard } from "grammy";
import type { Context } from "grammy";
import type { AppConfig } from "./config.js";
import { AppDatabase } from "./db.js";
import { randomToken, normalizeSingleLine, splitTelegramMessage } from "./lib/format.js";
import { parseEntryInput } from "./lib/parsers.js";
import {
  backupFrequencyLabel,
  buildBackupFileName,
  buildLogsCsv,
  formatBackupDate,
  summarizeBackupContent
} from "./services/backup.js";
import { RecipePolisher } from "./services/llm.js";
import { generateQrSvg } from "./services/qr.js";
import type { BackupFrequency, Drink, JournalEntry } from "./types.js";

const MENU_NEW_DRINK = "➕ Новый напиток";
const MENU_CURRENT_DRINKS = "📂 Текущие напитки";
const MENU_ARCHIVED_DRINKS = "🗄 Архивные напитки";
const MENU_QR = "🔗 QR напитка";
const MENU_BACKUP = "💾 Бэкап CSV";
const ENTRY_FORMAT_HINT = "ДД.ММ.ГГГГ | текст";

const STATE_AWAIT_DRINK_NAME = "await_drink_name";
const STATE_AWAIT_ENTRY_TEXT = "await_entry_text";
const STATE_AWAIT_GIFT_RECIPIENT = "await_gift_recipient";
const STATE_AWAIT_GIFT_MESSAGE_DECISION = "await_gift_message_decision";
const STATE_AWAIT_GIFT_MESSAGE_TEXT = "await_gift_message_text";

type BotDeps = {
  config: AppConfig;
  db: AppDatabase;
  polisher: RecipePolisher;
};

type QrMode = "drink" | "gift";

interface GiftDraftPayload {
  drinkId: string;
  recipient: string;
  bottleCode: string;
}

export function createTelegramBot(deps: BotDeps): Bot<Context> {
  const bot = new Bot<Context>(deps.config.telegramToken);

  bot.use(async (ctx, next) => {
    if (ctx.from) {
      deps.db.ensureUser({
        telegramId: String(ctx.from.id),
        username: ctx.from.username ?? null,
        firstName: ctx.from.first_name ?? null
      });
    }

    await next();
  });

  bot.command("start", async (ctx) => {
    const telegramId = getTelegramId(ctx);
    deps.db.clearUserState(telegramId);

    await ctx.reply(
      [
        "Дневник напитков запущен.",
        "Главное меню: Новый напиток, Текущие, Архивные, QR, Бэкап CSV.",
        "Используйте /help для подсказки."
      ].join("\n"),
      { reply_markup: mainKeyboard() }
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "Команды:",
        "/start - открыть меню",
        "/cancel - отменить текущий шаг",
        "",
        "Логика:",
        "- в Текущих: добавить запись или архивировать напиток;",
        "- в Архивных: вернуть напиток в текущие;",
        "- в QR: выбрать тип QR (обычный/подарочный), затем напиток.",
        "- в Бэкап CSV: ручной экспорт и настройка автоотправки в Telegram.",
        "",
        "Формат записи:",
        "24.02.2026 | Сделал перелив, добавил 50 г меда",
        "или просто текст (дата подставится сегодняшняя)."
      ].join("\n"),
      { reply_markup: mainKeyboard() }
    );
  });

  bot.command("cancel", async (ctx) => {
    const telegramId = getTelegramId(ctx);
    deps.db.clearUserState(telegramId);
    await ctx.reply("Текущий сценарий отменен.", { reply_markup: mainKeyboard() });
  });

  bot.on("callback_query:data", async (ctx) => {
    const telegramId = getTelegramId(ctx);
    const data = ctx.callbackQuery.data;

    if (data.startsWith("current:open:")) {
      const drinkId = data.slice("current:open:".length);
      const drink = deps.db.getDrinkForOwner(drinkId, telegramId);
      if (!drink || drink.archivedAt) {
        await ctx.answerCallbackQuery({ text: "Текущий напиток не найден", show_alert: true });
        return;
      }

      await ctx.answerCallbackQuery();
      await showCurrentDrinkActions(ctx, drink);
      return;
    }

    if (data.startsWith("current:add:")) {
      const drinkId = data.slice("current:add:".length);
      const drink = deps.db.getDrinkForOwner(drinkId, telegramId);
      if (!drink || drink.archivedAt) {
        await ctx.answerCallbackQuery({
          text: "Напиток не найден или уже в архиве",
          show_alert: true
        });
        return;
      }

      deps.db.setUserState(telegramId, STATE_AWAIT_ENTRY_TEXT, drink.id);
      await ctx.answerCallbackQuery({ text: `Выбран: ${drink.name}` });
      await ctx.reply(
        [
          `Запись для ${drink.name}.`,
          "Отправьте текст в формате:",
          ENTRY_FORMAT_HINT,
          "или просто текст."
        ].join("\n")
      );
      return;
    }

    if (data.startsWith("current:history:")) {
      const drinkId = data.slice("current:history:".length);
      const drink = deps.db.getDrinkForOwner(drinkId, telegramId);
      if (!drink) {
        await ctx.answerCallbackQuery({ text: "Напиток не найден", show_alert: true });
        return;
      }

      await ctx.answerCallbackQuery();
      await sendDrinkHistory(ctx, deps.db, drink);
      return;
    }

    if (data.startsWith("current:archive:")) {
      const drinkId = data.slice("current:archive:".length);
      const drink = deps.db.getDrinkForOwner(drinkId, telegramId);
      if (!drink || drink.archivedAt) {
        await ctx.answerCallbackQuery({ text: "Напиток уже в архиве или не найден", show_alert: true });
        return;
      }

      const archived = deps.db.archiveDrink(drink.id, telegramId);
      await ctx.answerCallbackQuery({ text: archived ? "Перенесено в архив" : "Не удалось архивировать" });
      await ctx.reply(`Напиток "${drink.name}" перенесен в архив.`);
      return;
    }

    if (data.startsWith("archived:open:")) {
      const drinkId = data.slice("archived:open:".length);
      const drink = deps.db.getDrinkForOwner(drinkId, telegramId);
      if (!drink || !drink.archivedAt) {
        await ctx.answerCallbackQuery({ text: "Архивный напиток не найден", show_alert: true });
        return;
      }

      await ctx.answerCallbackQuery();
      await showArchivedDrinkActions(ctx, drink);
      return;
    }

    if (data.startsWith("archived:history:")) {
      const drinkId = data.slice("archived:history:".length);
      const drink = deps.db.getDrinkForOwner(drinkId, telegramId);
      if (!drink) {
        await ctx.answerCallbackQuery({ text: "Напиток не найден", show_alert: true });
        return;
      }

      await ctx.answerCallbackQuery();
      await sendDrinkHistory(ctx, deps.db, drink);
      return;
    }

    if (data.startsWith("archived:restore:")) {
      const drinkId = data.slice("archived:restore:".length);
      const drink = deps.db.getDrinkForOwner(drinkId, telegramId);
      if (!drink || !drink.archivedAt) {
        await ctx.answerCallbackQuery({ text: "Напиток не в архиве", show_alert: true });
        return;
      }

      const restored = deps.db.unarchiveDrink(drink.id, telegramId);
      await ctx.answerCallbackQuery({ text: restored ? "Возвращено в текущие" : "Не удалось вернуть" });
      await ctx.reply(`Напиток "${drink.name}" возвращен в текущие.`);
      return;
    }

    if (data === "qr-type:drink") {
      await ctx.answerCallbackQuery();
      await askQrDrinkSelection(ctx, deps.db, telegramId, "drink");
      return;
    }

    if (data === "qr-type:gift") {
      await ctx.answerCallbackQuery();
      await askQrDrinkSelection(ctx, deps.db, telegramId, "gift");
      return;
    }

    if (data.startsWith("qr:drink:")) {
      const drinkId = data.slice("qr:drink:".length);
      const drink = deps.db.getDrinkForOwner(drinkId, telegramId);
      if (!drink) {
        await ctx.answerCallbackQuery({ text: "Напиток не найден", show_alert: true });
        return;
      }

      await ctx.answerCallbackQuery();
      await sendDrinkQr(ctx, deps, drink);
      return;
    }

    if (data.startsWith("qr:gift:")) {
      const drinkId = data.slice("qr:gift:".length);
      const drink = deps.db.getDrinkForOwner(drinkId, telegramId);
      if (!drink) {
        await ctx.answerCallbackQuery({ text: "Напиток не найден", show_alert: true });
        return;
      }

      deps.db.setUserState(telegramId, STATE_AWAIT_GIFT_RECIPIENT, drink.id);
      await ctx.answerCallbackQuery({ text: `Выбран: ${drink.name}` });
      await ctx.reply([`Подарочный QR для ${drink.name}.`, "Введите имя получателя:"].join("\n"));
      return;
    }

    if (data === "gift-msg:none" || data === "gift-msg:add") {
      const state = deps.db.getUserState(telegramId);
      if (!state || state.step !== STATE_AWAIT_GIFT_MESSAGE_DECISION) {
        await ctx.answerCallbackQuery({ text: "Шаг устарел. Начните заново через QR напитка.", show_alert: true });
        return;
      }

      const draft = parseGiftDraftPayload(state.payload);
      if (!draft) {
        deps.db.clearUserState(telegramId);
        await ctx.answerCallbackQuery({ text: "Не удалось прочитать данные. Начните заново.", show_alert: true });
        return;
      }

      if (data === "gift-msg:none") {
        await ctx.answerCallbackQuery();
        await finalizeGiftQr(ctx, deps, telegramId, draft, null);
        return;
      }

      deps.db.setUserState(telegramId, STATE_AWAIT_GIFT_MESSAGE_TEXT, JSON.stringify(draft));
      await ctx.answerCallbackQuery();
      await ctx.reply("Введите сообщение для получателя:");
      return;
    }

    if (data === "backup:export") {
      await ctx.answerCallbackQuery();
      await sendBackupCsvViaContext(ctx, deps, telegramId, "Ручной CSV-бэкап логов.");
      return;
    }

    if (data.startsWith("backup:set:")) {
      const frequency = parseBackupFrequency(data.slice("backup:set:".length));
      if (!frequency) {
        await ctx.answerCallbackQuery({ text: "Неверная частота", show_alert: true });
        return;
      }

      const setting = deps.db.setBackupFrequency(telegramId, frequency);
      await ctx.answerCallbackQuery({ text: `Сохранено: ${backupFrequencyLabel(setting.frequency)}` });
      await sendBackupMenu(ctx, deps.db, telegramId, "Настройки автобэкапа обновлены.");
      return;
    }

    await ctx.answerCallbackQuery();
  });

  bot.on("message:text", async (ctx) => {
    const telegramId = getTelegramId(ctx);
    const rawText = ctx.message.text.trim();
    const text = normalizeSingleLine(rawText);

    if (!rawText || rawText.startsWith("/")) {
      return;
    }

    if (text === MENU_NEW_DRINK) {
      deps.db.setUserState(telegramId, STATE_AWAIT_DRINK_NAME);
      await ctx.reply("Введите название напитка (например: Сидр, Медовуха вишня):");
      return;
    }

    if (text === MENU_CURRENT_DRINKS) {
      await sendCurrentDrinksMenu(ctx, deps.db, telegramId);
      return;
    }

    if (text === MENU_ARCHIVED_DRINKS) {
      await sendArchivedDrinksMenu(ctx, deps.db, telegramId);
      return;
    }

    if (text === MENU_QR) {
      await sendQrTypeMenu(ctx);
      return;
    }

    if (text === MENU_BACKUP) {
      await sendBackupMenu(ctx, deps.db, telegramId);
      return;
    }

    const state = deps.db.getUserState(telegramId);
    if (!state) {
      await ctx.reply("Не понял команду. Используйте /help или кнопки меню.", {
        reply_markup: mainKeyboard()
      });
      return;
    }

    if (state.step === STATE_AWAIT_DRINK_NAME) {
      const drinkName = rawText;
      if (drinkName.length < 2) {
        await ctx.reply("Название слишком короткое. Введите минимум 2 символа.");
        return;
      }

      const drink = deps.db.createDrink(telegramId, drinkName);
      deps.db.setUserState(telegramId, STATE_AWAIT_ENTRY_TEXT, drink.id);
      await ctx.reply(
        [
          `Напиток создан: ${drink.name}`,
          "Добавьте первую запись.",
          "Отправьте текст в формате:",
          ENTRY_FORMAT_HINT,
          "или просто текст."
        ].join("\n"),
        { reply_markup: mainKeyboard() }
      );
      return;
    }

    if (state.step === STATE_AWAIT_ENTRY_TEXT) {
      if (!state.payload) {
        deps.db.clearUserState(telegramId);
        await ctx.reply("Шаг сброшен, выберите напиток заново.", { reply_markup: mainKeyboard() });
        return;
      }

      const drink = deps.db.getDrinkForOwner(state.payload, telegramId);
      if (!drink) {
        deps.db.clearUserState(telegramId);
        await ctx.reply("Напиток не найден. Выберите его заново.", { reply_markup: mainKeyboard() });
        return;
      }
      if (drink.archivedAt) {
        deps.db.clearUserState(telegramId);
        await ctx.reply("Этот напиток в архиве. Для новой записи сначала верните его в текущие.", {
          reply_markup: mainKeyboard()
        });
        return;
      }

      let parsed: { entryDate: string; text: string };
      try {
        parsed = parseEntryInput(rawText);
      } catch {
        await ctx.reply(`Не смог прочитать запись. Используйте формат ${ENTRY_FORMAT_HINT} или просто текст.`);
        return;
      }

      await ctx.reply("Сохраняю запись и исправляю текст...");
      const polishedRaw = await deps.polisher.polish(drink.name, parsed.text);
      const polished = polishedRaw ? cleanupPolishedText(polishedRaw) : null;

      deps.db.createEntry({
        drinkId: drink.id,
        telegramId,
        entryDate: parsed.entryDate,
        rawText: parsed.text,
        polishedText: polished
      });

      deps.db.clearUserState(telegramId);

      await ctx.reply(
        [
          `Запись сохранена для ${drink.name}.`,
          `Дата: ${parsed.entryDate}`,
          polished ? "Текст аккуратно исправлен и сохранен." : "Сохранен исходный текст."
        ].join("\n"),
        { reply_markup: mainKeyboard() }
      );
      return;
    }

    if (state.step === STATE_AWAIT_GIFT_RECIPIENT) {
      if (!state.payload) {
        deps.db.clearUserState(telegramId);
        await ctx.reply("Шаг сброшен. Начните заново через QR напитка.", { reply_markup: mainKeyboard() });
        return;
      }

      const drink = deps.db.getDrinkForOwner(state.payload, telegramId);
      if (!drink) {
        deps.db.clearUserState(telegramId);
        await ctx.reply("Напиток не найден. Начните заново через QR напитка.", { reply_markup: mainKeyboard() });
        return;
      }

      const recipient = rawText.trim();
      if (recipient.length < 2) {
        await ctx.reply("Имя получателя слишком короткое. Введите еще раз.");
        return;
      }

      const bottleCode = deps.db.getNextGiftBottleCode(drink.id);
      const draft: GiftDraftPayload = { drinkId: drink.id, recipient, bottleCode };
      deps.db.setUserState(telegramId, STATE_AWAIT_GIFT_MESSAGE_DECISION, JSON.stringify(draft));

      const keyboard = new InlineKeyboard()
        .text("Без сообщения", "gift-msg:none")
        .text("Добавить сообщение", "gift-msg:add");

      await ctx.reply(
        [
          `Получатель: ${recipient}`,
          `Номер бутылки: ${bottleCode}`,
          "Добавить персональное сообщение?"
        ].join("\n"),
        { reply_markup: keyboard }
      );
      return;
    }

    if (state.step === STATE_AWAIT_GIFT_MESSAGE_TEXT) {
      const draft = parseGiftDraftPayload(state.payload);
      if (!draft) {
        deps.db.clearUserState(telegramId);
        await ctx.reply("Не удалось прочитать данные. Начните заново через QR напитка.", {
          reply_markup: mainKeyboard()
        });
        return;
      }

      const message = rawText.trim() || null;
      await finalizeGiftQr(ctx, deps, telegramId, draft, message);
      return;
    }

    deps.db.clearUserState(telegramId);
    await ctx.reply("Состояние было сброшено. Повторите действие через меню.", {
      reply_markup: mainKeyboard()
    });
  });

  bot.catch((error) => {
    console.error("Telegram bot error:", error.error);
  });

  return bot;
}

async function sendCurrentDrinksMenu(ctx: Context, db: AppDatabase, telegramId: string): Promise<void> {
  const drinks = db.listCurrentDrinks(telegramId);
  if (drinks.length === 0) {
    await ctx.reply("Текущих напитков пока нет. Создайте новый напиток.", {
      reply_markup: mainKeyboard()
    });
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const drink of drinks) {
    keyboard.text(drink.name, `current:open:${drink.id}`).row();
  }

  await ctx.reply("Текущие напитки. Выберите напиток:", { reply_markup: keyboard });
}

async function sendArchivedDrinksMenu(ctx: Context, db: AppDatabase, telegramId: string): Promise<void> {
  const drinks = db.listArchivedDrinks(telegramId);
  if (drinks.length === 0) {
    await ctx.reply("Архивных напитков пока нет.", { reply_markup: mainKeyboard() });
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const drink of drinks) {
    keyboard.text(drink.name, `archived:open:${drink.id}`).row();
  }

  await ctx.reply("Архивные напитки. Выберите напиток:", { reply_markup: keyboard });
}

async function showCurrentDrinkActions(ctx: Context, drink: Drink): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text("📝 Добавить запись", `current:add:${drink.id}`)
    .row()
    .text("📚 История", `current:history:${drink.id}`)
    .row()
    .text("📦 Архивировать", `current:archive:${drink.id}`);

  await ctx.reply(`Напиток: ${drink.name}\nВыберите действие:`, { reply_markup: keyboard });
}

async function showArchivedDrinkActions(ctx: Context, drink: Drink): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text("📚 История", `archived:history:${drink.id}`)
    .row()
    .text("♻️ Вернуть в текущие", `archived:restore:${drink.id}`);
  await ctx.reply(`Архивный напиток: ${drink.name}\nВыберите действие:`, { reply_markup: keyboard });
}

async function sendQrTypeMenu(ctx: Context): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text("Обычный QR", "qr-type:drink")
    .row()
    .text("Подарочный QR", "qr-type:gift");

  await ctx.reply("Выберите тип QR:", { reply_markup: keyboard });
}

async function askQrDrinkSelection(
  ctx: Context,
  db: AppDatabase,
  telegramId: string,
  mode: QrMode
): Promise<void> {
  const drinks = db.listDrinks(telegramId, "all");
  if (drinks.length === 0) {
    await ctx.reply("Напитков пока нет. Сначала создайте напиток.", { reply_markup: mainKeyboard() });
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const drink of drinks) {
    const label = drink.archivedAt ? `${drink.name} (архив)` : drink.name;
    const callback = mode === "drink" ? `qr:drink:${drink.id}` : `qr:gift:${drink.id}`;
    keyboard.text(label, callback).row();
  }

  await ctx.reply(mode === "drink" ? "Выберите напиток для обычного QR:" : "Выберите напиток для подарочного QR:", {
    reply_markup: keyboard
  });
}

async function sendBackupMenu(
  ctx: Context,
  db: AppDatabase,
  telegramId: string,
  header: string | null = null
): Promise<void> {
  const setting = db.getBackupSetting(telegramId);
  const keyboard = new InlineKeyboard()
    .text("📤 Экспорт сейчас", "backup:export")
    .row()
    .text("Выкл", "backup:set:off")
    .text("7 дней", "backup:set:weekly")
    .row()
    .text("14 дней", "backup:set:biweekly")
    .text("30 дней", "backup:set:monthly");

  const lines = [
    header,
    "Бэкап CSV отправляется в этот Telegram-чат.",
    `Текущая частота: ${backupFrequencyLabel(setting.frequency)}`,
    `Следующая отправка: ${formatBackupDate(setting.nextRunAt)}`,
    `Последняя отправка: ${formatBackupDate(setting.lastSentAt)}`
  ].filter(Boolean);

  await ctx.reply(lines.join("\n"), { reply_markup: keyboard });
}

async function sendDrinkHistory(ctx: Context, db: AppDatabase, drink: Drink): Promise<void> {
  const entries = db.listEntriesByDrink(drink.id);
  if (entries.length === 0) {
    await ctx.reply(`По напитку ${drink.name} пока нет записей.`);
    return;
  }

  const formatted = formatHistoryText(drink.name, entries);
  const chunks = splitTelegramMessage(formatted);
  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
}

function formatHistoryText(drinkName: string, entries: JournalEntry[]): string {
  const blocks = entries.map((entry, index) => {
    const rawText = normalizeHistoryText(entry.rawText);
    const polished = entry.polishedText ? normalizePolishedForHistory(entry.polishedText) : null;
    const lines = [`${index + 1}. ${entry.entryDate}`, rawText];

    if (shouldShowPolishedBlock(rawText, polished)) {
      lines.push("_____________________________");
      lines.push("Полный рецепт, компановка от гпт:");
      lines.push(polished ?? "");
      if (!hasObservationsHeading(polished ?? "")) {
        lines.push("");
        lines.push("Наблюдения, если есть:");
      }
    }

    return lines.join("\n");
  });

  return [`История: ${drinkName}`, ...blocks].join("\n\n");
}

async function sendDrinkQr(ctx: Context, deps: BotDeps, drink: Drink): Promise<void> {
  const refreshed = await polishMissingEntriesForDrink(deps, drink);
  if (refreshed > 0) {
    await ctx.reply(`Перед генерацией QR исправил оформление ${refreshed} записей.`);
  }

  let share = deps.db.findShareLinkByDrink(drink.id, "drink");
  if (!share) {
    const creatorTelegramId = ctx.from ? String(ctx.from.id) : drink.ownerTelegramId;
    share = deps.db.createShareLink({
      token: createUniqueToken(deps.db),
      type: "drink",
      drinkId: drink.id,
      createdByTelegramId: creatorTelegramId
    });
  }

  const url = `${deps.config.publicBaseUrl}/q/${share.token}`;
  const svg = await generateQrSvg(url);

  await ctx.replyWithDocument(new InputFile(Buffer.from(svg, "utf-8"), `${drink.name}-qr.svg`), {
    caption: `QR напитка ${drink.name}\n${url}`
  });
}

async function finalizeGiftQr(
  ctx: Context,
  deps: BotDeps,
  telegramId: string,
  draft: GiftDraftPayload,
  giftMessage: string | null
): Promise<void> {
  const drink = deps.db.getDrinkForOwner(draft.drinkId, telegramId);
  if (!drink) {
    deps.db.clearUserState(telegramId);
    await ctx.reply("Напиток не найден. Начните заново через QR напитка.", { reply_markup: mainKeyboard() });
    return;
  }

  const shareLink = deps.db.createShareLink({
    token: createUniqueToken(deps.db),
    type: "gift",
    drinkId: drink.id,
    createdByTelegramId: telegramId,
    giftRecipient: draft.recipient,
    bottleCode: draft.bottleCode,
    giftMessage
  });

  const url = `${deps.config.publicBaseUrl}/q/${shareLink.token}`;
  const svg = await generateQrSvg(url);

  await ctx.replyWithDocument(new InputFile(Buffer.from(svg, "utf-8"), `gift-${shareLink.token}.svg`), {
    caption: [
      `Подарочный QR для ${drink.name}`,
      `Получатель: ${draft.recipient}`,
      `Номер бутылки: ${draft.bottleCode}`,
      url
    ].join("\n")
  });

  deps.db.clearUserState(telegramId);
  await ctx.reply("Подарочная ссылка создана и сохранена в базе.", { reply_markup: mainKeyboard() });
}

async function sendBackupCsvViaContext(
  ctx: Context,
  deps: BotDeps,
  telegramId: string,
  title: string
): Promise<void> {
  const backup = buildLogsCsv(deps.db, telegramId);
  const drinks = deps.db.listDrinks(telegramId, "all");
  const fileName = buildBackupFileName(telegramId, backup.generatedAt);

  await ctx.replyWithDocument(new InputFile(Buffer.from(backup.csv, "utf-8"), fileName), {
    caption: [title, summarizeBackupContent(drinks, backup.rows)].join("\n")
  });
}

async function polishMissingEntriesForDrink(deps: BotDeps, drink: Drink): Promise<number> {
  if (!deps.polisher.enabled) {
    return 0;
  }

  const entries = deps.db.listEntriesByDrink(drink.id);
  let updated = 0;

  for (const entry of entries) {
    if (entry.polishedText) {
      continue;
    }

    const polished = await deps.polisher.polish(drink.name, entry.rawText);
    if (!polished) {
      continue;
    }

    deps.db.updateEntryPolishedText(entry.id, cleanupPolishedText(polished));
    updated += 1;
  }

  return updated;
}

function parseGiftDraftPayload(payload: string | null): GiftDraftPayload | null {
  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as Partial<GiftDraftPayload>;
    if (!parsed.drinkId || !parsed.recipient || !parsed.bottleCode) {
      return null;
    }

    return {
      drinkId: parsed.drinkId,
      recipient: parsed.recipient,
      bottleCode: parsed.bottleCode
    };
  } catch {
    return null;
  }
}

function cleanupPolishedText(text: string): string {
  return text
    .replace(/```/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1 ($2)")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeHistoryText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function normalizePolishedForHistory(text: string): string {
  const cleaned = cleanupPolishedText(text)
    .replace(/^Напиток:\s*.*$/gim, "")
    .replace(/\n*Следующий шаг:\s*[\s\S]*$/im, "")
    .replace(/^Наблюдения:\s*$/gim, "Наблюдения, если есть:")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned;
}

function shouldShowPolishedBlock(rawText: string, polishedText: string | null): boolean {
  if (!polishedText) {
    return false;
  }

  const rawNormalized = rawText.toLowerCase().replace(/\s+/g, " ").trim();
  const polishedNormalized = polishedText.toLowerCase().replace(/\s+/g, " ").trim();

  if (!polishedNormalized || polishedNormalized === rawNormalized) {
    return false;
  }

  if (/^запуск:\s*/i.test(polishedText) && polishedText.length <= rawText.length + 20) {
    return false;
  }

  return true;
}

function hasObservationsHeading(text: string): boolean {
  return /наблюдения/i.test(text);
}

function parseBackupFrequency(value: string): BackupFrequency | null {
  if (value === "off" || value === "weekly" || value === "biweekly" || value === "monthly") {
    return value;
  }

  return null;
}

function createUniqueToken(db: AppDatabase): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const token = randomToken(14);
    if (!db.getShareLinkByToken(token)) {
      return token;
    }
  }

  throw new Error("Failed to generate unique token");
}

function getTelegramId(ctx: Context): string {
  if (!ctx.from) {
    throw new Error("Telegram user id is missing in context");
  }

  return String(ctx.from.id);
}

function mainKeyboard(): Keyboard {
  return new Keyboard()
    .text(MENU_NEW_DRINK)
    .text(MENU_CURRENT_DRINKS)
    .row()
    .text(MENU_ARCHIVED_DRINKS)
    .text(MENU_QR)
    .row()
    .text(MENU_BACKUP)
    .resized()
    .persistent();
}
