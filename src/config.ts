import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  PUBLIC_BASE_URL: z.string().url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DB_PATH: z.string().min(1).default("./data/drinks.sqlite"),
  PROXYAPI_KEY: z.string().optional(),
  PROXYAPI_BASE_URL: z.string().url().default("https://openai.api.proxyapi.ru/v1"),
  PROXYAPI_MODEL: z.string().default("openai/gpt-4o-mini")
});

const parsed = schema.parse(process.env);

export const appConfig = {
  telegramToken: parsed.TELEGRAM_BOT_TOKEN,
  publicBaseUrl: parsed.PUBLIC_BASE_URL.replace(/\/$/, ""),
  port: parsed.PORT,
  dbPath: parsed.DB_PATH,
  proxyApiKey: parsed.PROXYAPI_KEY,
  proxyApiBaseUrl: parsed.PROXYAPI_BASE_URL,
  proxyApiModel: parsed.PROXYAPI_MODEL
};

export type AppConfig = typeof appConfig;
