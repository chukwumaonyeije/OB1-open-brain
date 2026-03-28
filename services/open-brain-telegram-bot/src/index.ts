import Fastify from "fastify";
import cors from "@fastify/cors";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3002),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
});

const env = envSchema.parse(process.env);

const app = Fastify({ logger: true });
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const TELEGRAM_BASE = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

await app.register(cors, {
  origin: true,
});

async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`OpenRouter embeddings failed: ${response.status} ${message}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.`,
        },
        { role: "user", content: text },
      ],
    }),
  });

  const data = await response.json();
  try {
    return JSON.parse(data.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  }
}

async function sendTelegramMessage(chatId: number | string, text: string) {
  await fetch(`${TELEGRAM_BASE}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });
}

app.get("/health", async () => ({ status: "ok" }));

app.post("/telegram/webhook", async (request, reply) => {
  const body = request.body as {
    message?: {
      message_id: number;
      text?: string;
      chat: { id: number; type: string };
      from?: { username?: string; first_name?: string; last_name?: string };
      date?: number;
    };
  };

  const message = body.message;
  if (!message?.text?.trim()) {
    return reply.send({ ok: true, ignored: true });
  }

  const content = message.text.trim();
  const username =
    message.from?.username ||
    [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") ||
    "unknown";

  try {
    const existing = await supabase
      .from("thoughts")
      .select("id")
      .contains("metadata", {
        source: "telegram",
        telegram_message_id: message.message_id,
      })
      .limit(1);

    if ((existing.data ?? []).length > 0) {
      return reply.send({ ok: true, duplicate: true });
    }

    const [embedding, extracted] = await Promise.all([
      getEmbedding(content),
      extractMetadata(content),
    ]);

    const metadata = {
      ...extracted,
      source: "telegram",
      telegram_chat_id: message.chat.id,
      telegram_username: username,
      telegram_message_id: message.message_id,
      telegram_chat_type: message.chat.type,
      telegram_timestamp: message.date ?? null,
    };

    const insert = await supabase.from("thoughts").insert({
      content,
      embedding,
      metadata,
    });

    if (insert.error) {
      app.log.error(insert.error);
      await sendTelegramMessage(message.chat.id, `Capture failed: ${insert.error.message}`);
      return reply.code(500).send({ error: insert.error.message });
    }

    const type = String(metadata.type ?? "observation");
    const topics = Array.isArray(metadata.topics) ? metadata.topics.join(", ") : "uncategorized";
    await sendTelegramMessage(
      message.chat.id,
      `Captured as ${type}. Topics: ${topics}`
    );

    return reply.send({ ok: true, status: "captured" });
  } catch (error) {
    app.log.error(error);
    await sendTelegramMessage(message.chat.id, "Capture failed due to a server error.");
    return reply.code(500).send({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
