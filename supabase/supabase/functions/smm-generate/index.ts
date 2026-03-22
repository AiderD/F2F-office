// ═══ F2F SMM Auto-Generate — Supabase Edge Function ═══
// Generates a batch of social media posts using Claude API
// Saves to content_queue for CEO approval
// Deploy: supabase functions deploy smm-generate --no-verify-jwt

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// F2F Platform Knowledge Base
const F2F_KNOWLEDGE = `
F2F.vin — действующая соревновательная CS2-платформа, 3+ года в продакшене.
Юрлицо: F2F PTE. LTD., Singapore. Приложение: app.f2f.vin, сайт: f2f.vin.

ТЕКУЩИЙ ПРОДУКТ:
- 7 игровых режимов: 5x5 Competitive, 2x2, 1x1, Deathmatch, Public, Arena, Aim AWP
- Турниры: RC Cup (64 команды, $2/игрок), Championship, Challenge Arena, Skill Lab (PVE-тренировки, $25-челленджи)
- Матчмейкинг: TrueSkill (НЕ ELO, НЕ AI) — оценивает ЭФФЕКТИВНОСТЬ игрока
- Античит: Akros (kernel-level)
- Монетизация: турнирные билеты с призовыми

ЧТО СТРОИТСЯ (ещё НЕ запущено):
- Battle Pass: 30 уровней, сезон 3 месяца
- Режим Dominion (2v5): 2 Босса с имплантами vs 5 Наёмников, 124+ предметов
- Подписки: Lite (за Gold), Believer ($3.99/мес), PRO ($9.99/мес)

КОНКУРЕНТЫ: FACEIT, ESEA, Valve MM, CyberShoke, Blast.tv
Позиционирование: F2F ДОПОЛНЯЕТ CS2 (как FACEIT), а не конкурирует.

ЧАСТЫЕ ОШИБКИ (НЕ ДОПУСКАТЬ):
- НЕТ AI-матчмейкинга — используется TrueSkill
- НЕТ ставок — отброшено в 2023
- НЕТ DOTA2 — пока только CS2
- Dominion/BP/подписки — ЕЩЁ НЕ ЗАПУЩЕНЫ
- Платформа РАБОТАЕТ 3+ года
`;

const SMM_SYSTEM_PROMPT = `Ты — SMM-менеджер F2F.vin. Создаёшь вирусный контент для Telegram и Twitter.

СТИЛЬ: дерзкий, остроумный, с двойными смыслами из мира gaming/esports (как Durex/Vizit, но про игры).
Тон: уверенный, чуть провокационный, но не токсичный. Юмор геймеров.

${F2F_KNOWLEDGE}

РУБРИКИ (чередуй):
1. 🎯 Факт дня — интересный факт из мира CS2/esports с привязкой к F2F
2. 😂 Мем/Подколка — шутка про типичные ситуации в CS2 (рандомы, читеры, ранг)
3. 🏆 Турнирная — анонс/результат RC Cup, привязка к esports-событиям
4. 💡 Фича — описание функции F2F (TrueSkill, Akros, Skill Lab, режимы)
5. 🔥 Провокация — дерзкое сравнение с конкурентами или Valve MM
6. 📊 Стат — интересная статистика из мира CS2
7. 🎮 Lifestyle — геймерская культура, мемы про жизнь игрока

ФОРМАТ ОТВЕТА — строго JSON массив:
[
  {
    "platform": "telegram",
    "text": "Полный текст поста с эмодзи и хештегами",
    "rubric": "Название рубрики"
  }
]

ПРАВИЛА:
- Каждый пост: 2-4 предложения, эмодзи, хештеги (#F2F #CS2 и т.д.)
- CTA в конце: ссылка на app.f2f.vin или призыв к действию
- Для Twitter: короче (до 280 символов), более панчевый стиль
- Генерируй РАЗНЫЕ рубрики, не повторяйся
- На русском языке
- НЕ упоминай то, что ещё не запущено (Dominion, BP, подписки), как будто это уже есть
`;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parse request — can specify count and platforms
    let count = 10; // Generate more posts — strict QA (8+) means ~20-30% pass, so 10 → ~2-3 approved
    let platforms = ["telegram"]; // Only telegram for now — no twitter publish mechanism

    let reworkMode = false;
    let reworkPostId = "";
    let reworkFeedback = "";
    let reworkOriginal = "";
    let reworkPlatform = "telegram";

    let reworkBatchMode = false;

    try {
      const body = await req.json();
      if (body.mode === "rework") {
        reworkMode = true;
        reworkPostId = body.post_id || "";
        reworkFeedback = body.feedback || "";
        reworkOriginal = body.original_text || "";
        reworkPlatform = body.platform || "telegram";
      } else if (body.mode === "rework_batch") {
        reworkBatchMode = true;
      } else {
        if (body.count) count = Math.min(body.count, 15);
        if (body.platforms) platforms = body.platforms;
      }
    } catch { /* empty body is ok, use defaults */ }

    // Get API key
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Init Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get recent posts to avoid duplicates
    const { data: recentPosts } = await supabase
      .from("content_queue")
      .select("content_text")
      .order("created_at", { ascending: false })
      .limit(20);

    const recentTexts = (recentPosts || []).map(p => p.content_text?.slice(0, 80)).join("\n");

    // Get SMM agent ID from DB
    const { data: smmAgent } = await supabase
      .from("agents")
      .select("id")
      .eq("slug", "smm")
      .single();

    // ═══ LOAD CEO DIRECTIVES ═══
    let directivesBlock = "";
    try {
      const { data: directives } = await supabase
        .from("directives")
        .select("key, value_json")
        .eq("active", true);

      if (directives && directives.length > 0) {
        directivesBlock = "\n\nДИРЕКТИВЫ CEO (учитывай при генерации):\n";
        for (const d of directives) {
          const val = typeof d.value_json === "string" ? JSON.parse(d.value_json) : d.value_json;
          if (d.key === "company_strategy") {
            directivesBlock += `Миссия: ${val.mission_vision || ""}\n`;
            if (val.kpi_content_monthly) directivesBlock += `Целевое кол-во контента: ${val.kpi_content_monthly}/мес\n`;
          } else if (d.key === "content") {
            directivesBlock += `Контент-стратегия: ${val.text || ""}\n`;
          } else {
            directivesBlock += `${d.key}: ${val.text || JSON.stringify(val)}\n`;
          }
        }
      }
    } catch (e) {
      console.warn("Failed to load directives:", e);
    }

    // ═══ LOAD AGENT KNOWLEDGE (learned patterns) ═══
    let knowledgeBlock = "";
    try {
      const { data: knowledge } = await supabase
        .from("agent_knowledge")
        .select("category, title, content")
        .or("agent_slug.eq.smm,agent_slug.eq._global")
        .eq("is_active", true)
        .order("priority", { ascending: false })
        .limit(15);
      if (knowledge && knowledge.length > 0) {
        knowledgeBlock = "\n\nНАКОПЛЕННЫЕ ЗНАНИЯ (ОБЯЗАТЕЛЬНО учитывай):\n" +
          knowledge.map(k => `• [${k.category}] ${k.content}`).join("\n") + "\n";
      }
    } catch (_) { /* non-critical */ }

    // ═══ LOAD BEST EXAMPLES (CEO-approved posts, score 8+) ═══
    let bestExamplesBlock = "";
    try {
      const { data: topScores } = await supabase
        .from("content_scores")
        .select("content_id, score, best_parts")
        .eq("content_type", "post")
        .gte("score", 8)
        .order("score", { ascending: false })
        .limit(3);

      if (topScores && topScores.length > 0) {
        const postIds = topScores.filter(s => s.content_id).map(s => s.content_id);
        if (postIds.length > 0) {
          const { data: bestPosts } = await supabase
            .from("content_queue")
            .select("content_text")
            .in("id", postIds)
            .limit(3);
          if (bestPosts && bestPosts.length > 0) {
            bestExamplesBlock = "\n\nЛУЧШИЕ ПОСТЫ (CEO оценил на 8+, БЕРИ ЗА ОБРАЗЕЦ):\n" +
              bestPosts.map((p, i) => `${i + 1}. ${p.content_text?.slice(0, 300)}`).join("\n\n") + "\n";
          }
        }
      }
    } catch (_) { /* non-critical */ }

    // ═══ LOAD THINGS TO AVOID (CEO scored 1-4) ═══
    let avoidBlock = "";
    try {
      const { data: badScores } = await supabase
        .from("content_scores")
        .select("improvements, feedback")
        .eq("content_type", "post")
        .lte("score", 4)
        .not("improvements", "is", null)
        .order("created_at", { ascending: false })
        .limit(3);
      if (badScores && badScores.length > 0) {
        avoidBlock = "\n\nЧЕГО ИЗБЕГАТЬ (CEO забраковал):\n" +
          badScores.map(s => `❌ ${s.improvements || s.feedback}`).join("\n") + "\n";
      }
    } catch (_) { /* non-critical */ }

    // ═══ REWORK MODE: Rewrite a single post based on CEO feedback ═══
    if (reworkMode) {
      const reworkPrompt = `Ты получил фидбэк от CEO на свой пост. Переработай пост с учётом замечаний.

ОРИГИНАЛЬНЫЙ ПОСТ:
${reworkOriginal}

ФИДБЭК CEO (ЧТО ПЕРЕДЕЛАТЬ):
${reworkFeedback}

Платформа: ${reworkPlatform}
${knowledgeBlock}${bestExamplesBlock}${avoidBlock}

ПРАВИЛА:
- Сохрани тему и платформу
- Учти ВСЕ замечания CEO
- Оставь стиль F2F (дерзкий, остроумный)
- Если CEO просит короче — сделай короче. Длиннее — длиннее.
- Добавь хештеги #F2F #CS2

Ответь ТОЛЬКО JSON:
{"text": "новый текст поста", "category": "рубрика", "hashtags": "#F2F #CS2 ..."}`;

      const reworkResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system: SMM_SYSTEM_PROMPT,
          messages: [{ role: "user", content: reworkPrompt }],
        }),
      });

      if (!reworkResponse.ok) {
        return new Response(
          JSON.stringify({ error: "Claude API error on rework", status: reworkResponse.status }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const reworkData = await reworkResponse.json();
      const reworkRaw = reworkData.content?.[0]?.text || "{}";
      try {
        const jsonMatch = reworkRaw.match(/\{[\s\S]*\}/);
        const result = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

        // Update the post in DB — reset qa_score so it gets re-reviewed
        if (reworkPostId && result.text) {
          await supabase
            .from("content_queue")
            .update({
              content_text: result.text,
              status: "pending_approval",
              qa_score: null,
              qa_verdict: null,
              hashtags: result.hashtags || "",
            })
            .eq("id", reworkPostId);
        }

        return new Response(
          JSON.stringify({ success: true, new_text: result.text, category: result.category, hashtags: result.hashtags }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ error: "Failed to parse rework response", raw: reworkRaw.slice(0, 500) }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ═══ REWORK BATCH MODE: Process all needs_rework posts ═══
    if (reworkBatchMode) {
      const { data: reworkPosts } = await supabase
        .from("content_queue")
        .select("id, content_text, platform, qa_verdict")
        .eq("status", "needs_rework")
        .limit(5); // max 5 per batch to stay within timeout

      if (!reworkPosts || reworkPosts.length === 0) {
        return new Response(
          JSON.stringify({ success: true, message: "No posts need rework", reworked: 0 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const reworkResults = [];
      for (const rp of reworkPosts) {
        try {
          const rpPrompt = `Ты получил фидбэк от QA на свой пост. Переработай пост с учётом замечаний.

ОРИГИНАЛЬНЫЙ ПОСТ:
${rp.content_text}

ФИДБЭК QA (ЧТО ПЕРЕДЕЛАТЬ):
${rp.qa_verdict || "Улучши качество: сделай более конкретным, остроумным и полезным для аудитории CS2."}

Платформа: ${rp.platform || "telegram"}
${knowledgeBlock}${bestExamplesBlock}${avoidBlock}

ПРАВИЛА:
- Сохрани тему и платформу
- Учти ВСЕ замечания QA
- Оставь стиль F2F (дерзкий, остроумный)
- Добавь хештеги #F2F #CS2

Ответь ТОЛЬКО JSON:
{"text": "новый текст поста", "category": "рубрика", "hashtags": "#F2F #CS2 ..."}`;

          const rpResponse = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": anthropicKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514",
              max_tokens: 1024,
              system: SMM_SYSTEM_PROMPT,
              messages: [{ role: "user", content: rpPrompt }],
            }),
          });

          if (!rpResponse.ok) {
            reworkResults.push({ id: rp.id, error: "Claude API error " + rpResponse.status });
            continue;
          }

          const rpData = await rpResponse.json();
          const rpRaw = rpData.content?.[0]?.text || "{}";
          const jsonMatch = rpRaw.match(/\{[\s\S]*\}/);
          const result = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

          if (result.text) {
            const { error: rpcErr } = await supabase.rpc("f2f_rework_post", {
              p_id: rp.id,
              p_text: result.text,
              p_hashtags: result.hashtags || "",
            });

            if (rpcErr) {
              console.error("Rework RPC error:", JSON.stringify(rpcErr));
              reworkResults.push({ id: rp.id, success: false, error: rpcErr.message || JSON.stringify(rpcErr) });
            } else {
              reworkResults.push({ id: rp.id, success: true, new_preview: result.text.slice(0, 60) });
            }
          } else {
            reworkResults.push({ id: rp.id, error: "No text in response" });
          }
        } catch (e) {
          reworkResults.push({ id: rp.id, error: String(e) });
        }
      }

      return new Response(
        JSON.stringify({ success: true, reworked: reworkResults.length, results: reworkResults }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build prompt
    const userMessage = `Сгенерируй ${count} постов для соцсетей F2F.vin.

Платформы: ${platforms.join(", ")}
Распредели примерно поровну между платформами.
${directivesBlock}${knowledgeBlock}${bestExamplesBlock}${avoidBlock}
${recentTexts ? `ПОСЛЕДНИЕ ПОСТЫ (НЕ ПОВТОРЯЙ похожие темы):\n${recentTexts}\n` : ""}

Ответь ТОЛЬКО валидным JSON массивом, без markdown, без \`\`\`, без пояснений.`;

    // Call Claude API
    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: SMM_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text();
      console.error("Claude API error:", claudeResponse.status, errText);
      return new Response(
        JSON.stringify({ error: "Claude API error", status: claudeResponse.status }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const claudeData = await claudeResponse.json();
    const rawText = claudeData.content?.[0]?.text || "[]";

    // Parse JSON from Claude response
    let posts: Array<{ platform: string; text: string; rubric?: string }> = [];
    try {
      // Try to extract JSON from response (handle possible markdown wrapping)
      const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        posts = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error("Failed to parse Claude response:", e, rawText);
      return new Response(
        JSON.stringify({ error: "Failed to parse generated posts", raw: rawText.slice(0, 500) }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Smart scheduling: spread posts across optimal time slots
    // Best times for gaming audience (Moscow UTC+3): 10:00, 13:00, 16:00, 19:00, 21:00
    const POSTING_SLOTS_UTC = [7, 10, 13, 16, 18]; // UTC hours (= MSK 10, 13, 16, 19, 21)

    // Find next available slots (check what's already scheduled)
    const { data: scheduledPosts } = await supabase
      .from("content_queue")
      .select("scheduled_at")
      .in("status", ["pending_approval", "approved"])
      .gte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true });

    const takenSlots = new Set(
      (scheduledPosts || []).map(p => p.scheduled_at?.slice(0, 13)) // "YYYY-MM-DDTHH" precision
    );

    // Generate available slots for next 7 days
    const availableSlots: Date[] = [];
    const now = new Date();
    for (let day = 0; day < 7 && availableSlots.length < posts.length; day++) {
      for (const hour of POSTING_SLOTS_UTC) {
        const slot = new Date(now);
        slot.setUTCDate(slot.getUTCDate() + day);
        slot.setUTCHours(hour, Math.floor(Math.random() * 30), 0, 0); // random minute 0-29 for naturalness
        if (slot <= now) continue; // skip past slots
        const slotKey = slot.toISOString().slice(0, 13);
        if (!takenSlots.has(slotKey)) {
          availableSlots.push(slot);
          takenSlots.add(slotKey);
        }
        if (availableSlots.length >= posts.length) break;
      }
    }

    const inserts = posts.map((post, i) => ({
      agent_id: smmAgent?.id || null,
      platform: post.platform || "telegram",
      content_text: post.text,
      status: "pending_approval",
      scheduled_at: (availableSlots[i] || new Date(Date.now() + (i + 1) * 3600000 * 4)).toISOString(),
    }));

    const { data: inserted, error: insertError } = await supabase
      .from("content_queue")
      .insert(inserts)
      .select("id, platform, status");

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to save posts", detail: insertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log event (try/catch instead of .catch() — Supabase v2 compat)
    try {
      await supabase.from("events").insert({
        type: "smm_generate",
        metadata_json: {
          count: posts.length,
          platforms,
          model: claudeData.model,
          usage: claudeData.usage,
        },
      });
    } catch (_) { /* non-critical logging */ }

    return new Response(
      JSON.stringify({
        success: true,
        generated: posts.length,
        posts: inserted,
        usage: claudeData.usage,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("smm-generate error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
