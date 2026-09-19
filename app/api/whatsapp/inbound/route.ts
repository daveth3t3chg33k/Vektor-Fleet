import { NextResponse } from "next/server";
import { queueDepth } from "@/lib/engines/whatsapp";
import { handleInbound } from "@/lib/engines/whatsapp";
import { messagesFor } from "@/lib/store/runtime";

export const dynamic = "force-dynamic";

interface InboundBody {
  phone?: string;
  /** WhatsApp Cloud API shape, or the simplified `body` used by the simulator. */
  body?: string;
  mediaUrl?: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{ from?: string; text?: { body?: string } }>;
      };
    }>;
  }>;
}

/** Accepts either the WhatsApp Cloud API webhook envelope or a plain simulator payload. */
function normalizeInput(payload: InboundBody): { phone: string; body: string; mediaUrl?: string } | null {
  const fromCloud = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (fromCloud?.from) {
    return { phone: fromCloud.from, body: fromCloud.text?.body ?? "", mediaUrl: payload.mediaUrl };
  }
  if (payload.phone) {
    return { phone: payload.phone, body: payload.body ?? "", mediaUrl: payload.mediaUrl };
  }
  return null;
}

/** POST /api/whatsapp/inbound — the bot's single entry point. */
export async function POST(request: Request) {
  let payload: InboundBody;
  try {
    payload = (await request.json()) as InboundBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const input = normalizeInput(payload);
  if (!input) {
    return NextResponse.json(
      { error: "Provide { phone, body } or a WhatsApp Cloud API entry envelope" },
      { status: 400 },
    );
  }

  const turn = handleInbound(input.phone, input.body, input.mediaUrl);

  return NextResponse.json({
    data: {
      session: turn.session,
      replies: turn.replies,
      events: turn.events,
      thread: messagesFor(input.phone),
      queue: queueDepth(),
    },
  });
}
