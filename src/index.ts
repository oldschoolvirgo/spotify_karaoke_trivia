// Eligible for the Workers AI free allocation. Keep model choice server-side.
const MODEL = "@cf/openai/gpt-oss-20b" as const;

export default {
  async fetch(request, env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET") {
      return Response.json({ ok: true, model: MODEL });
    }
    if (path !== "/api/ai") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const corsHeaders = new Headers({
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    });
    if (request.headers.get("Origin") === "https://xpui.app.spotify.com") {
      corsHeaders.set("Access-Control-Allow-Origin", "https://xpui.app.spotify.com");
    }
    const json = (body: unknown, status = 200): Response =>
      Response.json(body, { status, headers: corsHeaders });
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== "POST") {
      corsHeaders.set("Allow", "POST, OPTIONS");
      return json({ error: "Use POST" }, 405);
    }
    // Allow 20,000 prompt characters even when JSON uses six-byte Unicode escapes.
    // Bound the body before parsing, including requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "JSON body required" }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 131072) {
        await reader.cancel();
        return json({ error: "Body too large" }, 413);
      }
      chunks.push(value);
    }
    let body: unknown;
    try {
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const prompt = body && typeof body === "object" && "prompt" in body ? body.prompt : undefined;
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 20000) {
      return json({ error: "prompt must be a nonempty string of at most 20000 characters" }, 400);
    }
    try {
      const result = await env.AI.run(MODEL, {
        messages: [{ role: "user", content: prompt.trim() }],
        max_tokens: 4000,
      }) as {
        choices?: Array<{ message?: { content?: string | null } | null }> | null;
        response?: string | null;
      };
      const generatedText =
        result.choices?.[0]?.message?.content ?? result.response ?? null;
      return json({ ...result, response: generatedText });
    } catch {
      return json({ error: "AI request failed. Check Cloudflare availability and your daily free allowance." }, 503);
    }
  },
} satisfies ExportedHandler<Env>;
