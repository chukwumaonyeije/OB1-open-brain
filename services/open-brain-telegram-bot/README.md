# Open Brain Telegram Bot

A Railway-ready Telegram webhook service for Open Brain.

## What it does

When someone sends a text message to your bot:

1. the bot receives the webhook from Telegram
2. it generates an embedding
3. it extracts metadata
4. it stores the thought in Supabase
5. it replies with a short confirmation

## Environment

Use the values in [.env.example](C:/Users/onyei/OneDrive/Apps/OPEN%20BRAIN%20APP/OB1-open-brain/services/open-brain-telegram-bot/.env.example):

- `PORT`
- `TELEGRAM_BOT_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENROUTER_API_KEY`

## Railway deploy

1. Create a new Railway service from this folder
2. Set the root directory to `services/open-brain-telegram-bot`
3. Add the environment variables
4. Use:

```text
Build command: npm install && npm run build
Start command: npm run start
```

## BotFather

1. Open Telegram
2. Message `@BotFather`
3. Run `/newbot`
4. Choose the bot name and username
5. Copy the bot token
6. Save it in Railway as `TELEGRAM_BOT_TOKEN`

## Register the webhook

After Railway gives you a public URL, register the webhook:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://your-railway-service.up.railway.app/telegram/webhook"
```

## Metadata written to Open Brain

Each Telegram capture adds metadata like:

- `source: "telegram"`
- `telegram_chat_id`
- `telegram_username`
- `telegram_message_id`

## Important note

This service is a write path into your Open Brain. It does not replace the MCP endpoint or the REST API. It complements them.
