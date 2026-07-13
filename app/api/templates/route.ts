import { NextResponse } from "next/server";
import { errMsg } from "@/lib/server/http";
import { getActiveWorkspace } from "@/lib/server/workspace";
import { generateJSON } from "@/lib/ai/openai";
import { TEMPLATE_SYSTEM_PROMPT } from "@/lib/ai/template-prompt";
import {
  listTemplates,
  deleteTemplate,
  publishTemplate,
  getTemplateDraft,
  type TemplateDraft,
} from "@/lib/suprsend-mgmt";
import { generatedToDraft, type GeneratedTemplate } from "@/lib/templates/draft";

const toDraft = generatedToDraft;

// An AI edit must never silently DROP a channel. Start from the existing template
// and overlay only the channels the AI returned — any channel the AI omitted is
// preserved from the original. (So "add Slack" keeps Email + Inbox intact.)
const CHANNEL_KEYS = ["email", "inbox", "sms", "whatsapp", "slack", "androidpush", "iospush", "webpush"] as const;
function mergeChannels(original: TemplateDraft, edited: TemplateDraft): TemplateDraft {
  const out = { ...edited };
  for (const ch of CHANNEL_KEYS) {
    if (!out[ch] && original[ch]) out[ch] = original[ch] as never;
  }
  return out;
}

export async function GET(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const slug = new URL(req.url).searchParams.get("slug");
    if (slug) {
      const template = await getTemplateDraft(ws.slug, slug);
      if (!template) return NextResponse.json({ ok: false, error: "Template not found." }, { status: 404 });
      return NextResponse.json({ ok: true, template });
    }
    const templates = await listTemplates(ws.slug);
    return NextResponse.json({ ok: true, templates });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const { mode, description, template, instruction, channels } = await req.json();

    if (mode === "generate") {
      if (typeof description !== "string" || !description.trim()) {
        return NextResponse.json({ ok: false, error: "Describe the template you want." }, { status: 400 });
      }
      const wanted = Array.isArray(channels) && channels.length ? channels : ["email", "inbox"];
      const userMsg = `${description.trim()}\n\nInclude ONLY these channels: ${wanted.join(", ")}.`;
      const generated = await generateJSON<GeneratedTemplate>(TEMPLATE_SYSTEM_PROMPT, userMsg);
      if (!generated.slug || !/^[a-z0-9-]+$/.test(generated.slug)) {
        return NextResponse.json({ ok: false, error: "AI returned an invalid slug." }, { status: 422 });
      }
      return NextResponse.json({ ok: true, template: toDraft(generated) });
    }

    if (mode === "edit") {
      if (!template?.slug) {
        return NextResponse.json({ ok: false, error: "No template to edit." }, { status: 400 });
      }
      if (typeof instruction !== "string" || !instruction.trim()) {
        return NextResponse.json({ ok: false, error: "Describe the change you want." }, { status: 400 });
      }
      const userMsg = `EXISTING TEMPLATE:\n${JSON.stringify(template)}\n\nCHANGE REQUEST:\n${instruction.trim()}\n\nReturn the FULL updated template JSON. Keep the same slug. INCLUDE EVERY existing channel (email, inbox, slack, …) — only add or modify channels per the request; never drop a channel that already exists. Only change what the request asks for.`;
      const edited = await generateJSON<GeneratedTemplate>(TEMPLATE_SYSTEM_PROMPT, userMsg);
      edited.slug = template.slug; // never let an edit change the slug
      // Safety net: preserve any channel the AI dropped despite the instruction.
      const merged = mergeChannels(template as TemplateDraft, toDraft(edited));
      return NextResponse.json({ ok: true, template: merged });
    }

    if (mode === "publish") {
      if (!template?.slug) {
        return NextResponse.json({ ok: false, error: "No template to publish." }, { status: 400 });
      }
      const result = await publishTemplate(ws.slug, toDraft(template as GeneratedTemplate));
      return NextResponse.json({ ok: result.ok, status: result.status, body: result.body });
    }

    return NextResponse.json({ ok: false, error: "mode must be 'generate' or 'publish'." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const ws = await getActiveWorkspace();
    const slug = new URL(req.url).searchParams.get("slug");
    if (!slug) return NextResponse.json({ ok: false, error: "slug required" }, { status: 400 });
    const result = await deleteTemplate(ws.slug, slug);
    return NextResponse.json({ ok: result.ok, status: result.status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}

