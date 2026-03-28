# Open Brain on Railway with Telegram

This is the practical build order.

## 1. Memory stays in Supabase

Keep Supabase as the source of truth:

- `thoughts` table
- embeddings
- metadata
- `match_thoughts` RPC
- your existing MCP endpoint

This part is already working.

## 2. Put the web API on Railway

Deploy [services/open-brain-rest](C:/Users/onyei/OneDrive/Apps/OPEN%20BRAIN%20APP/OB1-open-brain/services/open-brain-rest) to Railway first.

Why first:

- the web app needs plain HTTP endpoints
- Telegram can write through the same shared service logic
- you avoid duplicating business logic in multiple places

Set these Railway environment variables:

- `PORT`
- `MCP_ACCESS_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENROUTER_API_KEY`

## 3. Build the web app against that REST service

The community Next.js dashboard is a good starting point:

[dashboards/open-brain-dashboard-next](C:/Users/onyei/OneDrive/Apps/OPEN%20BRAIN%20APP/OB1-open-brain/dashboards/open-brain-dashboard-next)

Important:

Your current `thoughts` table uses UUID primary keys. The dashboard assumes numeric IDs. Before this becomes a clean drop-in, patch the dashboard to use UUID string IDs throughout.

## 4. Match the DoctorsWhoCode.blog aesthetic

Do not ship the stock dashboard look.

Use these design cues:

- dark cinematic background
- cyan accent `#22d3ee`
- `Space Grotesk` headings
- short declarative copy
- editorial tone, not generic admin-panel language
- sharp contrast and minimal chrome

The visual goal is a founder console. It should feel closer to DoctorsWhoCode.blog than to a standard SaaS dashboard.

## 5. Create the Telegram bot with BotFather

In Telegram:

1. Open `@BotFather`
2. Run `/newbot`
3. Choose a bot name
4. Choose a bot username
5. Copy the bot token

Store the token in Railway as `TELEGRAM_BOT_TOKEN`.

## 6. Deploy a Telegram capture service on Railway

Create a second Railway service such as `open-brain-telegram-bot`.

Environment:

- `PORT`
- `TELEGRAM_BOT_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENROUTER_API_KEY`

The webhook route should:

1. receive Telegram message updates
2. ignore non-text payloads at first
3. generate embeddings
4. extract metadata
5. insert into `thoughts`
6. reply with a short confirmation

Recommended metadata:

- `source: "telegram"`
- `telegram_chat_id`
- `telegram_username`
- `telegram_message_id`

## 7. Register the Telegram webhook

After Railway gives you a public URL, register it with Telegram:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://your-railway-service.up.railway.app/telegram/webhook"
```

## 8. Recommended order from here

1. Deploy `open-brain-rest`
2. Patch the Next.js dashboard for UUID-based thoughts
3. Restyle it toward DoctorsWhoCode.blog
4. Deploy the Telegram bot
5. Add deeper features like duplicates, reflections, and ingestion jobs

## 9. What to build next in this repo

The next concrete code steps are:

- patch the Next.js dashboard to use UUID string IDs
- scaffold `services/open-brain-telegram-bot`
- create a shared `lib/open-brain-core` package later if you want the REST API and Telegram bot to reuse the same capture logic
