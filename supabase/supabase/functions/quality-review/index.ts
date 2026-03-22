// ═══ F2F Quality Review — Supabase Edge Function ═══
// QA-агент проверяет контент перед публикацией
// Оценивает, находит проблемы, предлагает улучшения
// Автоматически извлекает знания из оценок CEO
// Deploy: supabase functions deploy quality-review --no-verify-jwt

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    // Modes:
    // 1. Review single post: { post_id: "uuid" }
    // 2. Review batch: { batch: true } — reviews all pending_approval posts
    // 3. Review text: { text: "...", type: "post"|"email" }
    // 4. Score from CEO: { post_id: "uuid", ceo_score: 8, feedback: "..." }
    // 5. Extract learnings: { extract_learnings: true } — auto-extract from recent scores
    const { post_id, batch, text, type, ceo_score, feedback, extract_learnings } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ═══ MODE: CEO Score (saves score + auto-extracts learning) ═══
    if (ceo_score !== undefined && post_id) {
      return await handleCeoScore(supabase, anthropicKey, post_id, ceo_score, feedback || "");
    }

    // ═══ MODE: Extract learnings from recent scores ═══
    if (extract_learnings) {
      return await handleExtractLearnings(supabase, anthropicKey);
    }

    // ═══ Load QA system prompt from agents table ═══
    const { data: qaAgent } = await supabase
      .from("agents")
      .select("system_prompt")
      .eq("slug", "quality_controller")
      .single();

    const qaSystemPrompt = qaAgent?.system_prompt || "Ты QA-контролёр. Оцени контент по 10-балльной шкале.";

    // ═══ Load best-rated examples for comparison ═══
    let bestExamples = "";
    try {
      const { data: topPosts } = await supabase
        .from("content_scores")
        .select("content_id, score, best_parts, feedback")
        .eq("content_type", "post")
        .gte("score", 8)
        .order("score", { ascending: false })
        .limit(3);

      if (topPosts && topPosts.length > 0) {
        const postIds = topPosts.filter(p => p.content_id).map(p => p.content_id);
        if (postIds.length > 0) {
          const { data: bestPosts } = await supabase
            .from("content_queue")
            .select("content_text")
            .in("id", postIds)
            .limit(3);
          if (bestPosts && bestPosts.length > 0) {
            bestExamples = "\n\nЛУЧШИЕ ОБРАЗЦЫ (оценка 8+, ориентируйся на них):\n" +
              bestPosts.map((p, i) => `${i + 1}. ${p.content_text?.slice(0, 200)}`).join("\n");
          }
        }
      }
    } catch (_) { /* non-critical */ }

    // ═══ Load agent knowledge for QA context ═══
    let knowledgeHints = "";
    try {
      const { data: knowledge } = await supabase
        .from("agent_knowledge")
        .select("content")
        .or("agent_slug.eq.quality_controller,agent_slug.eq._global,agent_slug.eq.smm")
        .eq("is_active", true)
        .order("priority", { ascending: false })
        .limit(15);
      if (knowledge && knowledge.length > 0) {
        knowledgeHints = "\n\nНАКОПЛЕННЫЕ ЗНАНИЯ (учитывай):\n" +
          knowledge.map(k => `• ${k.content}`).join("\n");
      }
    } catch (_) { /* non-critical */ }

    const fullSystemPrompt = qaSystemPrompt + bestExamples + knowledgeHints;

    // ═══ MODE: Batch review ═══
    if (batch) {
      const { data: pendingPosts } = await supabase
        .from("content_queue")
        .select("id, content_text, platform, status")
        .eq("status", "pending_approval")
        .is("qa_score", null)
        .order("created_at", { ascending: true })
        .limit(25);

      if (!pendingPosts || pendingPosts.length === 0) {
        return jsonResponse({ success: true, message: "Нет постов для проверки", reviewed: 0 });
      }

      const results = [];
      for (const post of pendingPosts) {
        const review = await reviewContent(anthropicKey, fullSystemPrompt, post.content_text, "post");
        if (review) {
          // Save QA review
          await supabase.from("qa_reviews").insert({
            content_type: "post",
            content_id: post.id,
            qa_score: review.score,
            qa_verdict: review.verdict,
            issues: review.issues,
            suggestions: review.suggestions,
            improved_text: review.improved_text || null,
          });

          // Update content_queue
          await supabase.from("content_queue")
            .update({ qa_score: review.score, qa_verdict: review.verdict })
            .eq("id", post.id);

          // If score >= 8, auto-approve (quality bar stays high — volume solves throughput)
          if (review.score >= 8 && post.status === "pending_approval") {
            await supabase.from("content_queue")
              .update({ status: "approved" })
              .eq("id", post.id);
          }

          // If score 5-7, mark for rework — separate cron will process them
          if (review.score >= 5 && review.score <= 7 && post.status === "pending_approval") {
            const reworkFeedback = [
              review.verdict || "",
              ...(review.issues || []),
              ...(review.suggestions || []),
            ].filter(Boolean).join(". ");

            await supabase.from("content_queue")
              .update({
                status: "needs_rework",
                qa_verdict: reworkFeedback || "Улучши качество: сделай более конкретным, остроумным и полезным для аудитории CS2.",
              })
              .eq("id", post.id);
          }

          // If score < 5, mark as rejected (too low quality to rework)
          if (review.score < 5 && post.status === "pending_approval") {
            await supabase.from("content_queue")
              .update({ status: "rejected" })
              .eq("id", post.id);
          }

          results.push({ id: post.id, score: review.score, verdict: review.verdict });
        }
      }

      return jsonResponse({ success: true, reviewed: results.length, results });
    }

    // ═══ MODE: Single post review ═══
    if (post_id) {
      const { data: post } = await supabase
        .from("content_queue")
        .select("id, content_text, platform, status")
        .eq("id", post_id)
        .single();

      if (!post) {
        return jsonResponse({ error: "Post not found" }, 404);
      }

      const review = await reviewContent(anthropicKey, fullSystemPrompt, post.content_text, "post");
      if (review) {
        await supabase.from("qa_reviews").insert({
          content_type: "post",
          content_id: post.id,
          qa_score: review.score,
          qa_verdict: review.verdict,
          issues: review.issues,
          suggestions: review.suggestions,
          improved_text: review.improved_text || null,
        });

        await supabase.from("content_queue")
          .update({ qa_score: review.score, qa_verdict: review.verdict })
          .eq("id", post.id);

        return jsonResponse({ success: true, ...review, post_id });
      }
    }

    // ═══ MODE: Review arbitrary text ═══
    if (text) {
      const review = await reviewContent(anthropicKey, fullSystemPrompt, text, type || "post");
      return jsonResponse({ success: true, ...review });
    }

    return jsonResponse({ error: "Provide post_id, batch:true, or text" }, 400);

  } catch (err) {
    console.error("quality-review error:", err);
    return jsonResponse({ error: String(err) }, 500);
  }
});

// ═══ Review content via Claude ═══
async function reviewContent(
  apiKey: string,
  systemPrompt: string,
  contentText: string,
  contentType: string
): Promise<any> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `Оцени следующий ${contentType === "email" ? "email" : "пост"}:\n\n${contentText}\n\nОтветь ТОЛЬКО JSON.`,
      }],
    }),
  });

  if (!response.ok) return null;

  const data = await response.json();
  const rawText = data.content?.[0]?.text || "{}";

  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (_) { /* parse error */ }

  return null;
}

// ═══ Handle CEO score + auto-extract learning ═══
async function handleCeoScore(
  supabase: any,
  apiKey: string,
  postId: string,
  score: number,
  feedback: string
) {
  // Get post text
  const { data: post } = await supabase
    .from("content_queue")
    .select("content_text, platform")
    .eq("id", postId)
    .single();

  if (!post) return jsonResponse({ error: "Post not found" }, 404);

  // Save score
  await supabase.from("content_scores").insert({
    content_type: "post",
    content_id: postId,
    score,
    reviewer: "ceo",
    feedback,
  });

  // Update content_queue
  await supabase.from("content_queue")
    .update({ ceo_score: score })
    .eq("id", postId);

  // ═══ AUTO-EXTRACT LEARNING from high/low scores ═══
  if (score >= 8 && feedback) {
    // Great post — extract what made it good
    const learning = await extractLearning(apiKey, post.content_text, score, feedback, "good");
    if (learning) {
      await supabase.from("agent_knowledge").insert({
        agent_slug: "smm",
        category: "style",
        title: `Хороший пост (${score}/10): ${learning.title}`,
        content: learning.content,
        source: "auto_learn",
        priority: Math.min(score, 9),
      });

      // Also save best_parts
      await supabase.from("content_scores")
        .update({ best_parts: learning.content })
        .eq("content_id", postId)
        .eq("reviewer", "ceo");
    }
  }

  if (score <= 4 && feedback) {
    // Bad post — extract what to avoid
    const learning = await extractLearning(apiKey, post.content_text, score, feedback, "bad");
    if (learning) {
      await supabase.from("agent_knowledge").insert({
        agent_slug: "smm",
        category: "style",
        title: `Избегать (${score}/10): ${learning.title}`,
        content: learning.content,
        source: "auto_learn",
        priority: 7,
      });

      await supabase.from("content_scores")
        .update({ improvements: learning.content })
        .eq("content_id", postId)
        .eq("reviewer", "ceo");
    }
  }

  return jsonResponse({
    success: true,
    score,
    feedback,
    auto_learned: (score >= 8 || score <= 4) && feedback ? true : false,
  });
}

// ═══ Extract learning from scored content ═══
async function extractLearning(
  apiKey: string,
  text: string,
  score: number,
  feedback: string,
  type: "good" | "bad"
): Promise<{ title: string; content: string } | null> {
  const prompt = type === "good"
    ? `CEO оценил этот пост на ${score}/10 с комментарием: "${feedback}"\n\nТекст поста: ${text}\n\nИзвлеки КОНКРЕТНОЕ правило/паттерн, который сделал пост хорошим. Ответь JSON: {"title": "краткое название правила (до 50 символов)", "content": "подробное описание: что именно хорошо и как повторить (до 200 символов)"}`
    : `CEO оценил этот пост на ${score}/10 с комментарием: "${feedback}"\n\nТекст поста: ${text}\n\nИзвлеки КОНКРЕТНОЕ правило, ЧТО ИМЕННО ПЛОХО и как избежать. Ответь JSON: {"title": "краткое название ошибки (до 50 символов)", "content": "описание: чего избегать и как сделать лучше (до 200 символов)"}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) return null;

  const data = await response.json();
  try {
    const raw = data.content?.[0]?.text || "{}";
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (_) { /* parse error */ }
  return null;
}

// ═══ Batch extract learnings from recent unprocessed scores ═══
async function handleExtractLearnings(supabase: any, apiKey: string) {
  // Find recent scores without extracted learnings
  const { data: unprocessed } = await supabase
    .from("content_scores")
    .select("id, content_id, score, feedback, content_type")
    .is("best_parts", null)
    .is("improvements", null)
    .not("feedback", "is", null)
    .or("score.gte.8,score.lte.4")
    .order("created_at", { ascending: false })
    .limit(10);

  if (!unprocessed || unprocessed.length === 0) {
    return jsonResponse({ success: true, message: "Нет необработанных оценок", extracted: 0 });
  }

  let extracted = 0;
  for (const s of unprocessed) {
    const { data: post } = await supabase
      .from("content_queue")
      .select("content_text")
      .eq("id", s.content_id)
      .single();

    if (!post?.content_text) continue;

    const type = s.score >= 8 ? "good" : "bad";
    const learning = await extractLearning(apiKey, post.content_text, s.score, s.feedback, type);
    if (learning) {
      await supabase.from("agent_knowledge").insert({
        agent_slug: s.content_type === "email" ? "outreach" : "smm",
        category: "style",
        title: `${type === "good" ? "Хороший" : "Плохой"} ${s.content_type} (${s.score}/10): ${learning.title}`,
        content: learning.content,
        source: "auto_learn",
        priority: type === "good" ? Math.min(s.score, 9) : 7,
      });

      const updateField = type === "good" ? "best_parts" : "improvements";
      await supabase.from("content_scores")
        .update({ [updateField]: learning.content })
        .eq("id", s.id);

      extracted++;
    }
  }

  return jsonResponse({ success: true, extracted });
}

// Helper
function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
