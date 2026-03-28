import Fastify from "fastify";
import cors from "@fastify/cors";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  MCP_ACCESS_KEY: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
});

const env = envSchema.parse(process.env);

const app = Fastify({ logger: true });
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

type Metadata = Record<string, unknown>;

type RawThought = {
  id: string;
  content: string;
  metadata: Metadata | null;
  created_at: string;
  updated_at: string;
};

type SearchThought = RawThought & {
  similarity?: number;
};

await app.register(cors, {
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-brain-key"],
});

app.addHook("onRequest", async (request, reply) => {
  if (request.url === "/health") return;

  const provided = request.headers["x-brain-key"];
  if (!provided || provided !== env.MCP_ACCESS_KEY) {
    return reply.code(401).send({ error: "Invalid or missing access key" });
  }
});

function normalizeThought(row: RawThought | SearchThought) {
  const metadata = row.metadata ?? {};
  const similarity =
    "similarity" in row && typeof row.similarity === "number"
      ? row.similarity
      : undefined;
  return {
    id: row.id,
    uuid: row.id,
    content: row.content,
    type: String(metadata.type ?? "observation"),
    source_type: String(metadata.source ?? "mcp"),
    importance: Number(metadata.importance ?? 3),
    quality_score: Number(metadata.quality_score ?? 0),
    sensitivity_tier: String(metadata.sensitivity_tier ?? "standard"),
    metadata,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(typeof similarity === "number" ? { similarity } : {}),
  };
}

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

async function extractMetadata(text: string): Promise<Metadata> {
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

function applyThoughtFilters(
  query: any,
  filters: {
    type?: string;
    source_type?: string;
    importance_min?: number;
    quality_score_max?: number;
    exclude_restricted?: boolean;
  }
) {
  let nextQuery: any = query;

  if (filters.type) nextQuery = nextQuery.contains("metadata", { type: filters.type });
  if (filters.source_type) nextQuery = nextQuery.contains("metadata", { source: filters.source_type });
  if (typeof filters.importance_min === "number") {
    nextQuery = nextQuery.gte("metadata->>importance", String(filters.importance_min));
  }
  if (typeof filters.quality_score_max === "number") {
    nextQuery = nextQuery.lte("metadata->>quality_score", String(filters.quality_score_max));
  }
  if (filters.exclude_restricted !== false) {
    nextQuery = nextQuery.not("metadata->>sensitivity_tier", "eq", "restricted");
  }

  return nextQuery;
}

app.get("/health", async () => ({ status: "ok" }));

app.get("/thoughts", async (request, reply) => {
  const querySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    per_page: z.coerce.number().int().positive().max(100).default(25),
    type: z.string().optional(),
    source_type: z.string().optional(),
    importance_min: z.coerce.number().optional(),
    quality_score_max: z.coerce.number().optional(),
    sort: z.enum(["created_at", "updated_at"]).default("created_at"),
    order: z.enum(["asc", "desc"]).default("desc"),
    exclude_restricted: z.coerce.boolean().default(true),
  });

  const params = querySchema.parse(request.query);
  const from = (params.page - 1) * params.per_page;
  const to = from + params.per_page - 1;

  let dbQuery: any = supabase
    .from("thoughts")
    .select("id, content, metadata, created_at, updated_at", { count: "exact" })
    .order(params.sort, { ascending: params.order === "asc" })
    .range(from, to);

  dbQuery = applyThoughtFilters(dbQuery, params);

  const { data, count, error } = await dbQuery;
  if (error) return reply.code(500).send({ error: error.message });

  return {
    data: (data ?? []).map(normalizeThought),
    total: count ?? 0,
    page: params.page,
    per_page: params.per_page,
  };
});

app.get("/thought/:id", async (request, reply) => {
  const params = z.object({
    id: z.string().uuid(),
  }).parse(request.params);

  const query = z.object({
    exclude_restricted: z.coerce.boolean().default(true),
  }).parse(request.query);

  let dbQuery: any = supabase
    .from("thoughts")
    .select("id, content, metadata, created_at, updated_at")
    .eq("id", params.id)
    .single();

  if (query.exclude_restricted !== false) {
    dbQuery = dbQuery.not("metadata->>sensitivity_tier", "eq", "restricted");
  }

  const { data, error } = await dbQuery;
  if (error || !data) return reply.code(404).send({ error: "Thought not found" });

  return normalizeThought(data);
});

app.put("/thought/:id", async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({
    content: z.string().min(1).optional(),
    type: z.string().min(1).optional(),
    importance: z.number().int().min(1).max(5).optional(),
  }).parse(request.body);

  const { data: existing, error: fetchError } = await supabase
    .from("thoughts")
    .select("id, content, metadata")
    .eq("id", params.id)
    .single();

  if (fetchError || !existing) return reply.code(404).send({ error: "Thought not found" });

  let metadata = { ...(existing.metadata ?? {}) };
  let embedding: number[] | undefined;
  let content = existing.content;

  if (body.content && body.content !== existing.content) {
    content = body.content;
    const extracted = await extractMetadata(body.content);
    metadata = { ...metadata, ...extracted };
    embedding = await getEmbedding(body.content);
  }

  if (body.type) metadata.type = body.type;
  if (typeof body.importance === "number") metadata.importance = body.importance;

  const updatePayload: Record<string, unknown> = {
    content,
    metadata,
  };
  if (embedding) updatePayload.embedding = embedding;

  const { error } = await supabase.from("thoughts").update(updatePayload).eq("id", params.id);
  if (error) return reply.code(500).send({ error: error.message });

  return {
    id: params.id,
    action: "updated",
    message: "Thought updated successfully.",
  };
});

app.delete("/thought/:id", async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);

  const { error } = await supabase.from("thoughts").delete().eq("id", params.id);
  if (error) return reply.code(500).send({ error: error.message });

  return { id: params.id, action: "deleted", message: "Thought deleted successfully." };
});

app.post("/search", async (request, reply) => {
  const body = z.object({
    query: z.string().min(1),
    mode: z.enum(["semantic", "text"]).default("semantic"),
    limit: z.number().int().positive().max(100).default(25),
    page: z.number().int().positive().default(1),
    exclude_restricted: z.boolean().default(true),
  }).parse(request.body);

  const pageSize = body.limit;
  const page = body.page;

  if (body.mode === "text") {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    let query: any = supabase
      .from("thoughts")
      .select("id, content, metadata, created_at, updated_at", { count: "exact" })
      .ilike("content", `%${body.query}%`)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (body.exclude_restricted) {
      query = query.not("metadata->>sensitivity_tier", "eq", "restricted");
    }

    const { data, count, error } = await query;
    if (error) return reply.code(500).send({ error: error.message });

    const total = count ?? 0;
    return {
      results: (data ?? []).map(normalizeThought),
      count: data?.length ?? 0,
      total,
      page,
      per_page: pageSize,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
      mode: "text",
    };
  }

  const queryEmbedding = await getEmbedding(body.query);
  const fetchCount = Math.max(pageSize * page, 100);
  const rpc = await supabase.rpc("match_thoughts", {
    query_embedding: queryEmbedding,
    match_threshold: 0.2,
    match_count: fetchCount,
    filter: {},
  });

  if (rpc.error) return reply.code(500).send({ error: rpc.error.message });

  let rows = (rpc.data ?? []) as SearchThought[];
  if (body.exclude_restricted) {
    rows = rows.filter((row) => String(row.metadata?.sensitivity_tier ?? "standard") !== "restricted");
  }

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const paged = rows.slice(start, end).map(normalizeThought);

  return {
    results: paged,
    count: paged.length,
    total,
    page,
    per_page: pageSize,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
    mode: "semantic",
  };
});

app.get("/stats", async (request, reply) => {
  const query = z.object({
    days: z.coerce.number().optional(),
    exclude_restricted: z.coerce.boolean().default(true),
  }).parse(request.query);

  let dbQuery: any = supabase
    .from("thoughts")
    .select("metadata, created_at");

  if (query.exclude_restricted !== false) {
    dbQuery = dbQuery.not("metadata->>sensitivity_tier", "eq", "restricted");
  }

  if (query.days) {
    const since = new Date();
    since.setDate(since.getDate() - query.days);
    dbQuery = dbQuery.gte("created_at", since.toISOString());
  }

  const { data, error } = await dbQuery;
  if (error) return reply.code(500).send({ error: error.message });

  const rows = data ?? [];
  const types: Record<string, number> = {};
  const topicCounts: Record<string, number> = {};

  for (const row of rows) {
    const metadata = (row.metadata ?? {}) as Metadata;
    const type = String(metadata.type ?? "observation");
    types[type] = (types[type] ?? 0) + 1;

    const topics = Array.isArray(metadata.topics) ? metadata.topics : [];
    for (const topic of topics) {
      const key = String(topic);
      topicCounts[key] = (topicCounts[key] ?? 0) + 1;
    }
  }

  const topTopics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([topic, count]) => ({ topic, count }));

  return {
    total_thoughts: rows.length,
    window_days: query.days ?? "all",
    types,
    top_topics: topTopics,
  };
});

app.post("/capture", async (request, reply) => {
  const body = z.object({
    content: z.string().min(1),
  }).parse(request.body);

  const [embedding, extracted] = await Promise.all([
    getEmbedding(body.content),
    extractMetadata(body.content),
  ]);

  const metadata: Metadata = {
    ...extracted,
    source: "rest",
  };

  const { data, error } = await supabase
    .from("thoughts")
    .insert({
      content: body.content,
      embedding,
      metadata,
    })
    .select("id")
    .single();

  if (error || !data) return reply.code(500).send({ error: error?.message ?? "Insert failed" });

  return {
    thought_id: data.id,
    action: "captured",
    type: String(metadata.type ?? "observation"),
    sensitivity_tier: String(metadata.sensitivity_tier ?? "standard"),
    content_fingerprint: "",
    message: "Thought captured successfully.",
  };
});

app.get("/duplicates", async (request) => {
  const query = z.object({
    threshold: z.coerce.number().default(0.92),
    limit: z.coerce.number().int().positive().default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }).parse(request.query);

  return {
    pairs: [],
    threshold: query.threshold,
    limit: query.limit,
    offset: query.offset,
  };
});

app.get("/ingestion-jobs", async () => {
  return { jobs: [], count: 0 };
});

app.post("/ingest", async (request, reply) => {
  const body = z.object({
    text: z.string().min(1),
    dry_run: z.boolean().optional().default(false),
  }).parse(request.body);

  if (body.dry_run) {
    return {
      path: "single",
      status: "dry_run",
      extracted_count: 1,
      message: "Dry run complete. This text would be captured as a single thought.",
    };
  }

  const result = await app.inject({
    method: "POST",
    url: "/capture",
    headers: {
      "x-brain-key": env.MCP_ACCESS_KEY,
      "content-type": "application/json",
    },
    payload: JSON.stringify({ content: body.text }),
  });

  if (result.statusCode >= 400) {
    return reply.code(result.statusCode).send(result.json());
  }

  const parsed = result.json() as { thought_id: string; type: string; message: string };
  return {
    path: "single",
    thought_id: parsed.thought_id,
    type: parsed.type,
    status: "captured",
    message: parsed.message,
  };
});

app.get("/thought/:id/connections", async (request) => {
  z.object({ id: z.string().uuid() }).parse(request.params);
  return { connections: [] };
});

app.get("/thought/:id/reflection", async (request) => {
  z.object({ id: z.string().uuid() }).parse(request.params);
  return { reflections: [] };
});

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
