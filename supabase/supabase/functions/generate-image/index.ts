// ═══ F2F Generate Image — Supabase Edge Function ═══
// Generates post images via Replicate (Flux Pro) using brand style presets
// Called by: content-publish (before sending to TG) or manually from dashboard
// Deploy: supabase functions deploy generate-image --no-verify-jwt

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
    const replicateKey = Deno.env.get("REPLICATE_API_KEY");
    if (!replicateKey) {
      return new Response(
        JSON.stringify({ error: "REPLICATE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    // Accepts: { post_id: "uuid", custom_prompt?: "..." } or { prompt: "...", category: "news" }
    const { post_id, prompt: directPrompt, category: directCategory, custom_prompt } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let imagePrompt = directPrompt || "";
    let category = directCategory || "news";
    let postId = post_id;

    // If post_id provided — get post data and determine category
    if (post_id) {
      const { data: post } = await supabase
        .from("content_queue")
        .select("*")
        .eq("id", post_id)
        .limit(1);

      if (post?.[0]) {
        const p = post[0];
        // Determine category from post rubric/tags
        category = mapPostToCategory(p.rubric || p.category || "", p.content_text || "");

        // Priority: custom_prompt > stored image_prompt > auto-generated
        if (custom_prompt) {
          imagePrompt = custom_prompt;
        } else if (p.image_prompt) {
          imagePrompt = p.image_prompt;
        } else {
          imagePrompt = extractImageContext(p.content_text || "", category);
        }
      }
    }

    // If custom_prompt provided without post_id
    if (custom_prompt && !post_id) {
      imagePrompt = custom_prompt;
    }

    // Get style preset for this category
    const { data: presets } = await supabase
      .from("image_style_presets")
      .select("*")
      .eq("category", category)
      .eq("is_active", true)
      .limit(1);

    const preset = presets?.[0];
    if (!preset) {
      return new Response(
        JSON.stringify({ error: `No style preset found for category: ${category}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ═══ ART DIRECTOR: load best reference prompts + uploaded references ═══
    let referenceHints = "";
    try {
      // 1. Best-rated generated images
      const { data: refs } = await supabase
        .from("image_references")
        .select("prompt_used, rating, style_description, is_reference")
        .eq("category", category)
        .not("rating", "is", null)
        .gte("rating", 4) // only 4-5 star rated images
        .order("rating", { ascending: false })
        .limit(3);

      // 2. Uploaded reference images (CEO's style examples)
      const { data: uploadedRefs } = await supabase
        .from("image_references")
        .select("style_description, tags, rating")
        .eq("category", category)
        .eq("is_reference", true)
        .not("style_description", "is", null)
        .order("rating", { ascending: false })
        .limit(3);

      const hints: string[] = [];
      if (refs && refs.length > 0) {
        hints.push("Style from best-rated images: " +
          refs.map(r => (r.style_description || r.prompt_used).slice(0, 150)).join(" | "));
      }
      if (uploadedRefs && uploadedRefs.length > 0) {
        hints.push("CEO reference style: " +
          uploadedRefs.map(r => r.style_description!.slice(0, 150)).join(" | "));
      }
      if (hints.length > 0) {
        referenceHints = " " + hints.join(". ");
      }
    } catch (_) { /* non-critical */ }

    // Build final prompt: base style + post-specific context + art director hints
    const finalPrompt = buildFinalPrompt(preset, imagePrompt + referenceHints);

    // Call Replicate API (Flux Pro)
    const prediction = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${replicateKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Flux Schnell is fast + cheap, Flux Pro for higher quality
        version: "black-forest-labs/flux-schnell",
        input: {
          prompt: finalPrompt,
          num_outputs: 1,
          aspect_ratio: preset.aspect_ratio || "21:9",
          output_format: "jpg",
          output_quality: 90,
        },
      }),
    });

    if (!prediction.ok) {
      const errText = await prediction.text();
      return new Response(
        JSON.stringify({ error: `Replicate API error: ${prediction.status}`, detail: errText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const predictionData = await prediction.json();

    // Replicate returns async — need to poll for result
    let imageUrl = "";
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max

    if (predictionData.output) {
      // Flux Schnell sometimes returns immediately
      imageUrl = Array.isArray(predictionData.output) ? predictionData.output[0] : predictionData.output;
    } else if (predictionData.urls?.get) {
      // Need to poll
      while (attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000));
        attempts++;

        const pollRes = await fetch(predictionData.urls.get, {
          headers: { "Authorization": `Bearer ${replicateKey}` },
        });
        const pollData = await pollRes.json();

        if (pollData.status === "succeeded" && pollData.output) {
          imageUrl = Array.isArray(pollData.output) ? pollData.output[0] : pollData.output;
          break;
        }
        if (pollData.status === "failed") {
          return new Response(
            JSON.stringify({ error: "Image generation failed", detail: pollData.error }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    if (!imageUrl) {
      return new Response(
        JSON.stringify({ error: "Image generation timed out" }),
        { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ═══ UPLOAD TO SUPABASE STORAGE (permanent URL) ═══
    let permanentUrl = imageUrl; // fallback to Replicate URL
    try {
      const imgRes = await fetch(imageUrl);
      if (imgRes.ok) {
        const imgBlob = await imgRes.arrayBuffer();
        const fileName = `post-images/${postId || crypto.randomUUID()}_${Date.now()}.jpg`;
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from("content")
          .upload(fileName, imgBlob, {
            contentType: "image/jpeg",
            upsert: true,
          });
        if (!uploadErr && uploadData) {
          const { data: publicUrl } = supabase.storage
            .from("content")
            .getPublicUrl(fileName);
          if (publicUrl?.publicUrl) {
            permanentUrl = publicUrl.publicUrl;
          }
        } else {
          console.warn("Storage upload failed, using Replicate URL:", uploadErr);
        }
      }
    } catch (storageErr) {
      console.warn("Failed to upload to Storage:", storageErr);
    }

    // Update post with PERMANENT image URL
    if (postId) {
      await supabase
        .from("content_queue")
        .update({
          image_url: permanentUrl,
          image_prompt: finalPrompt,
        })
        .eq("id", postId);
    }

    // ═══ SAVE TO IMAGE REFERENCES (style learning library) ═══
    try {
      await supabase.from("image_references").insert({
        post_id: postId || null,
        image_url: permanentUrl,
        prompt_used: finalPrompt,
        category,
        style_preset_id: preset?.id || null,
        rating: null, // CEO rates later
      });
    } catch (_) { /* non-critical */ }

    // Increment usage count
    if (preset) {
      await supabase
        .from("image_style_presets")
        .update({ usage_count: (preset.usage_count || 0) + 1 })
        .eq("id", preset.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        image_url: permanentUrl,
        category,
        style: preset.style_name,
        prompt_used: finalPrompt.slice(0, 300) + "...",
        post_id: postId || null,
        stored_permanently: permanentUrl !== imageUrl,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("generate-image error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ═══ Helper: map post rubric/category to style preset category ═══
function mapPostToCategory(rubric: string, content: string): string {
  const r = rubric.toLowerCase();
  const c = content.toLowerCase();

  if (r.includes("news") || r.includes("update") || r.includes("новост") || r.includes("обновлен") || r.includes("патч")) return "news";
  if (r.includes("tournament") || r.includes("турнир") || r.includes("cup") || r.includes("кубок") || r.includes("чемпионат")) return "tournament";
  if (r.includes("match") || r.includes("матч") || r.includes("vs") || r.includes("расписан")) return "match";
  if (r.includes("meme") || r.includes("мем") || r.includes("humor") || r.includes("юмор") || r.includes("прикол")) return "meme";
  if (r.includes("guide") || r.includes("гайд") || r.includes("tutorial") || r.includes("совет") || r.includes("тип")) return "educational";
  if (r.includes("promo") || r.includes("режим") || r.includes("mode") || r.includes("feature") || r.includes("функц")) return "promo";
  if (r.includes("fun") || r.includes("развлеч") || r.includes("entertain") || r.includes("community") || r.includes("комьюнити")) return "entertainment";

  // Fallback: check content
  if (c.includes("обновлен") || c.includes("патч") || c.includes("valve")) return "news";
  if (c.includes("турнир") || c.includes("призов") || c.includes("cup")) return "tournament";
  if (c.includes("vs") || c.includes("матч")) return "match";

  return "news"; // default
}

// ═══ Helper: extract image context from post text ═══
function extractImageContext(text: string, category: string): string {
  // Extract key visual elements from post text
  const keywords = extractKeywords(text);
  const subject = extractSubject(text);

  const categoryScenes: Record<string, string> = {
    news: "dramatic newsroom-style esports broadcast scene",
    tournament: "epic esports tournament arena with massive screens and crowd",
    match: "intense head-to-head gaming battle scene, split-screen rivalry",
    entertainment: "vibrant gaming community gathering, fun chaotic energy",
    educational: "clean strategic overview, tactical gaming HUD elements",
    promo: "cinematic product showcase with dynamic lighting",
    meme: "exaggerated comedic gaming moment, meme-worthy scene",
  };

  const scene = categoryScenes[category] || "professional esports atmosphere";

  // Build specific prompt from post content
  const parts = [scene];
  if (subject) parts.push(`featuring: ${subject}`);
  if (keywords.length > 0) parts.push(`key elements: ${keywords.join(", ")}`);

  return parts.join(". ");
}

// ═══ Helper: extract subject/topic from post text ═══
function extractSubject(text: string): string {
  const t = text.toLowerCase();
  // Detect specific topics for visual representation
  if (t.includes("rc cup") || t.includes("кубок")) return "tournament trophy with teams competing, bracket board";
  if (t.includes("akros") || t.includes("античит")) return "digital shield protecting gaming, security barrier, anti-cheat system";
  if (t.includes("awp") || t.includes("снайпер")) return "precision sniper scope view, AWP rifle, long-range shot";
  if (t.includes("rank") || t.includes("ранг") || t.includes("рейтинг")) return "ranking ladder climbing up, skill progression chart, ELO numbers";
  if (t.includes("toxik") || t.includes("токсик") || t.includes("тиммейт")) return "team communication scene, headsets and monitors, squad coordination";
  if (t.includes("mm") || t.includes("матчмейкинг") || t.includes("подбор")) return "matchmaking queue interface, players being matched, algorithm visualization";
  if (t.includes("ace") || t.includes("клатч") || t.includes("clutch")) return "clutch moment, last player standing, bomb site scenario";
  if (t.includes("тренировк") || t.includes("aim") || t.includes("скилл")) return "training range, aim practice targets, skill improvement";
  if (t.includes("стрим") || t.includes("stream")) return "live streaming setup with multiple screens and chat";
  if (t.includes("обновлен") || t.includes("патч") || t.includes("update")) return "software update visualization, changelog, new features emerging";
  if (t.includes("подписк") || t.includes("premium") || t.includes("pro")) return "premium membership card, VIP access, golden tier";
  return "";
}

// ═══ Helper: extract keywords for visual context ═══
function extractKeywords(text: string): string[] {
  const keywords: string[] = [];
  const t = text.toLowerCase();

  // Game-specific
  if (t.includes("cs2") || t.includes("counter-strike")) keywords.push("CS2 game");
  if (t.includes("dust") || t.includes("mirage") || t.includes("inferno") || t.includes("nuke")) keywords.push("iconic map");
  if (t.includes("5x5") || t.includes("5v5")) keywords.push("5v5 team battle");
  if (t.includes("1v1") || t.includes("1x1")) keywords.push("1v1 duel");
  if (t.includes("2v2") || t.includes("2x2")) keywords.push("2v2 arena");

  // Emotions
  if (t.includes("победа") || t.includes("win") || t.includes("выигр")) keywords.push("victory celebration");
  if (t.includes("проигр") || t.includes("lose") || t.includes("поражен")) keywords.push("defeat, determination to comeback");
  if (t.includes("злость") || t.includes("бесит") || t.includes("rage")) keywords.push("gaming rage moment");
  if (t.includes("смешно") || t.includes("лол") || t.includes("😂")) keywords.push("funny moment");

  // F2F specific
  if (t.includes("f2f") || t.includes("ф2ф")) keywords.push("F2F platform branding green neon");
  if (t.includes("dominion")) keywords.push("2v5 asymmetric mode");
  if (t.includes("arena")) keywords.push("arena combat");

  return keywords.slice(0, 4); // Max 4 keywords
}

// ═══ Helper: build final prompt from preset + context ═══
function buildFinalPrompt(preset: any, contextPrompt: string): string {
  // Check if user mentioned logo/лого in their custom prompt
  const wantsLogo = contextPrompt && (
    contextPrompt.toLowerCase().includes("logo") ||
    contextPrompt.toLowerCase().includes("лого") ||
    contextPrompt.toLowerCase().includes("f2f")
  );

  const parts = [
    preset.base_prompt,
    contextPrompt ? `Scene context: ${contextPrompt}` : "",
    preset.color_palette ? `Color palette: ${preset.color_palette}` : "",
    preset.mood ? `Mood: ${preset.mood}` : "",
    preset.negative_prompt ? `Avoid: ${preset.negative_prompt}` : "",
    wantsLogo
      ? "Include a sleek minimalist F2F logo mark — a stylized shield emblem with 'F2F' text, glowing green (#00e55f) on dark background, placed prominently in composition"
      : "No text, no words, no letters, no watermarks — pure visual background only",
    "High quality, 4K resolution, professional esports production value"
  ];

  return parts.filter(Boolean).join(". ");
}
