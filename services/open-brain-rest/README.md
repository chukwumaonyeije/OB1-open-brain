# Open Brain REST

A Railway-ready REST API for Open Brain. This sits between your Supabase-backed memory and a custom web UI.

## Why this service exists

Your current Open Brain deployment exposes MCP tools. That is perfect for Codex, ChatGPT, and Claude. A web app needs ordinary HTTP endpoints instead.

This service gives you those endpoints:

- `GET /health`
- `GET /thoughts`
- `GET /thought/:id`
- `PUT /thought/:id`
- `DELETE /thought/:id`
- `POST /search`
- `GET /stats`
- `POST /capture`
- `GET /thought/:id/reflection`

## Environment

Use the variables in [.env.example](C:/Users/onyei/OneDrive/Apps/OPEN%20BRAIN%20APP/OB1-open-brain/services/open-brain-rest/.env.example):

- `PORT`
- `MCP_ACCESS_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENROUTER_API_KEY`

## Local run

```bash
npm install
npm run dev
```

## Railway deploy

1. Create a new Railway service from this folder.
2. Set the root directory to `services/open-brain-rest`.
3. Add the environment variables above.
4. Railway can use:

```text
Build command: npm install && npm run build
Start command: npm run start
```

## Important note

This service is UUID-first because your `thoughts` table uses UUID primary keys. The existing community dashboard under `dashboards/open-brain-dashboard-next` assumes numeric IDs and would need a small UUID compatibility patch before it becomes a drop-in match.

That is still the right dashboard to style toward DoctorsWhoCode.blog. This REST service is the backend foundation.

## Telegram next

After this service is live, the next clean piece is `open-brain-telegram-bot` on Railway:

1. Create a bot with BotFather.
2. Save the Telegram bot token in Railway.
3. Expose a `/telegram/webhook` route.
4. On each incoming message, call the same embedding and metadata logic used in `/capture`.
5. Insert the thought into Supabase with metadata like `source=telegram`, `chat_id`, `username`, and `message_id`.

This keeps the web app and the bot writing into the same memory store.
