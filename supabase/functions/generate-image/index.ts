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

    // Build final prompt: base style + post-specific context
    const finalPrompt = buildFinalPrompt(preset, imagePrompt);

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

    // Update post with image URL if post_id was provided
    if (postId) {
      await supabase
        .from("content_queue")
        .update({
          image_url: imageUrl,
          image_prompt: finalPrompt,
        })
        .eq("id", postId);
    }

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
        image_url: imageUrl,
        category,
        style: preset.style_name,
        prompt_used: finalPrompt.slice(0, 300) + "...",
        post_id: postId || null,
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
  // Take first 100 chars of post as context for the image
  const shortText = text.slice(0, 150).replace(/[#@\n]/g, " ").trim();

  const categoryHints: Record<string, string> = {
    news: "breaking news about competitive gaming and CS2",
    tournament: "esports tournament championship atmosphere",
    match: "competitive match between two teams, rivalry energy",
    entertainment: "fun gaming culture moment, community vibes",
    educational: "clean tutorial interface, strategic gaming",
    promo: "exciting new game mode showcase, dynamic action",
    meme: "humorous gaming situation, internet culture",
  };

  return `${categoryHints[category] || "professional esports"}, context: ${shortText}`;
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
