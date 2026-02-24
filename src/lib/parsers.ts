import { todayIso } from "./format.js";

export function parseEntryInput(input: string): { entryDate: string; text: string } {
  const raw = input.trim();
  if (!raw) {
    throw new Error("Пустая запись");
  }

  const separatorMatch = raw.match(/^(.+?)\s*\|\s*(.+)$/s);
  if (!separatorMatch) {
    return { entryDate: todayIso(), text: raw };
  }

  const maybeDate = separatorMatch[1]?.trim() ?? "";
  const text = separatorMatch[2]?.trim() ?? "";
  if (!text) {
    throw new Error("После даты нет текста");
  }

  const date = parseFlexibleDate(maybeDate);
  if (!date) {
    return { entryDate: todayIso(), text: raw };
  }

  return { entryDate: date, text };
}

function parseFlexibleDate(input: string): string | null {
  const value = input.trim();

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return value;
  }

  const ru = value.match(/^(\d{2})\.(\d{2})(?:\.(\d{4}))?$/);
  if (ru) {
    const day = Number(ru[1]);
    const month = Number(ru[2]);
    const year = Number(ru[3] ?? new Date().getFullYear());

    if (day < 1 || day > 31 || month < 1 || month > 12) {
      return null;
    }

    return `${year.toString().padStart(4, "0")}-${month
      .toString()
      .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  }

  return null;
}
