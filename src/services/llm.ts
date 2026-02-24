import OpenAI from "openai";
import { z } from "zod";

interface LlmConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
}

export interface ExtractedRecipeFacts {
  ingredients: Array<{ name: string; amount: string }>;
}

const factsSchema = z.object({
  ingredients: z
    .array(
      z.object({
        name: z.string().min(1),
        amount: z.string().min(1)
      })
    )
    .default([])
});

export class RecipePolisher {
  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor(config: LlmConfig) {
    this.model = config.model;

    if (!config.apiKey) {
      this.client = null;
      return;
    }

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl
    });
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async polish(drinkName: string, entryText: string): Promise<string | null> {
    if (!this.client) {
      return null;
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content:
              [
                "Ты корректор технологического дневника напитков.",
                "Разрешено только:",
                "- исправить орфографию, пунктуацию и пробелы;",
                "- слегка структурировать текст коротким списком по исходным фактам, если это уместно.",
                "Запрещено:",
                "- добавлять советы, рекомендации, выводы, предупреждения;",
                "- добавлять новые факты, ингредиенты, действия или планы.",
                "Ответ только на русском, только чистый текст, без Markdown."
              ].join("\n")
          },
          {
            role: "user",
            content: [
              `Напиток: ${drinkName}`,
              "Отредактируй запись аккуратно без расширения смысла и без рекомендаций.",
              "Текст записи:",
              entryText
            ].join("\n")
          }
        ]
      });

      const content = response.choices[0]?.message?.content?.trim();
      return content || null;
    } catch (error) {
      console.error("ProxyAPI polishing failed:", error);
      return null;
    }
  }

  async extractRecipeFacts(drinkName: string, sourceText: string): Promise<ExtractedRecipeFacts | null> {
    if (!this.client) {
      return null;
    }

    const normalized = sourceText.trim();
    if (!normalized) {
      return null;
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "Ты извлекаешь строго факты из технологических записей напитка.",
              "Верни только JSON без markdown.",
              "Не выдумывай факты.",
              "Верни объект только с одним полем ingredients.",
              "Формат JSON:",
              '{ "ingredients": [{"name":"...", "amount":"..."}] }',
              "Если ингредиенты не найдены, верни пустой массив.",
              "ingredients заполняй только тем, что явно есть в тексте."
            ].join("\n")
          },
          {
            role: "user",
            content: [`Напиток: ${drinkName}`, "Записи:", normalized].join("\n\n")
          }
        ]
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        return null;
      }

      const parsed = JSON.parse(content);
      const facts = factsSchema.parse(parsed);

      return {
        ingredients: facts.ingredients.slice(0, 8).map((item) => ({
          name: item.name.trim(),
          amount: item.amount.trim()
        }))
      };
    } catch (error) {
      console.error("ProxyAPI facts extraction failed:", error);
      return null;
    }
  }
}
