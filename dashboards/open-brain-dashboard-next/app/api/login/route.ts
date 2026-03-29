import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";

  if (!apiKey) {
    return NextResponse.json({ error: "API key is required" }, { status: 400 });
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) {
    return NextResponse.json(
      { error: "API URL is not configured on the server" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(`${apiUrl}/health`, {
      headers: { "x-brain-key": apiKey },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Invalid API key or service unavailable" },
        { status: 401 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Could not reach API. Check your connection." },
      { status: 503 }
    );
  }

  const session = await getSession();
  session.apiKey = apiKey;
  session.loggedIn = true;
  session.restrictedUnlocked = false;
  await session.save();

  return NextResponse.json({ ok: true });
}
