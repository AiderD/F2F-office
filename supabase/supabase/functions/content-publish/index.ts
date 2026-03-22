// ═══ F2F Content Publish — Supabase Edge Function ═══
// Publishes ONE approved post per call, only if scheduled_at has arrived
// Minimum 3 hours between publications to avoid spam
// Deploy: supabase functions deploy content-publish --no-verify-jwt

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Minimum hours between posts in the same channel
const MIN_HOURS_BETWEEN_POSTS = 3;
// Maximum posts per day per platform
const MAX_POSTS_PER_DAY = 4;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const chatId = Deno.env.get("TELEGRAM_CHANNEL_ID");

    if (!botToken || !chatId) {
      return new Response(
        JSON.stringify({ error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Init Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Optional: force-publish specific post by ID (from dashboard button)
    let forcePostId: string | null = null;
    try {
      const body = await req.json();
      if (body.post_id) forcePostId = body.post_id;
    } catch { /* empty body = auto-publish mode */ }

    const now = new Date();

    // ── Anti-spam check: when was the last published post? ──
    if (!forcePostId) {
      const { data: lastPublished } = await supabase
        .from("content_queue")
        .select("published_at")
        .eq("status", "published")
        .eq("platform", "telegram")
        .not("published_at", "is", null)
        .order("published_at", { ascending: false })
        .limit(1);

      if (lastPublished && lastPublished.length > 0) {
        const lastTime = new Date(lastPublished[0].published_at);
        const hoursSince = (now.getTime() - lastTime.getTime()) / (1000 * 60 * 60);
        if (hoursSince < MIN_HOURS_BETWEEN_POSTS) {
          return new Response(
            JSON.stringify({
              success: true,
              published: 0,
              message: `Too soon — last post was ${hoursSince.toFixed(1)}h ago (min ${MIN_HOURS_BETWEEN_POSTS}h). Next publish in ~${(MIN_HOURS_BETWEEN_POSTS - hoursSince).toFixed(1)}h.`,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // ── Daily limit check ──
      const todayStart = new Date(now);
      todayStart.setUTCHours(0, 0, 0, 0);
      const { count: todayCount } = await supabase
        .from("content_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "published")
        .eq("platform", "telegram")
        .gte("published_at", todayStart.toISOString());

      if ((todayCount || 0) >= MAX_POSTS_PER_DAY) {
        return new Response(
          JSON.stringify({
            success: true,
            published: 0,
            message: `Daily limit reached (${todayCount}/${MAX_POSTS_PER_DAY} posts today). Resuming tomorrow.`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── Get ONE post to publish ──
    let query;
    if (forcePostId) {
      // Force publish specific post (from dashboard)
      query = supabase
        .from("content_queue")
        .select("*")
        .eq("id", forcePostId)
        .eq("status", "approved")
        .limit(1);
    } else {
      // Auto-publish: only posts whose scheduled_at has arrived
      query = supabase
        .from("content_queue")
        .select("*")
        .eq("status", "approved")
        .eq("platform", "telegram")
        .is("published_at", null)
        .lte("scheduled_at", now.toISOString()) // scheduled time has passed
        .order("scheduled_at", { ascending: true })
        .limit(1); // ONE post at a time
    }

    const { data: posts, error: fetchError } = await query;

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch posts", detail: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!posts || posts.length === 0) {
      return new Response(
        JSON.stringify({ success: true, published: 0, message: "No posts ready to publish right now" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const post = posts[0];

    // ── Generate image if not already present ──
    let imageUrl = post.image_url || "";
    const replicateKey = Deno.env.get("REPLICATE_API_KEY");

    if (!imageUrl && replicateKey) {
      try {
        // Call generate-image Edge Function internally
        const supabaseFnUrl = Deno.env.get("SUPABASE_URL")!;
        const imgRes = await fetch(`${supabaseFnUrl}/functions/v1/generate-image`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ post_id: post.id }),
        });
        if (imgRes.ok) {
          const imgData = await imgRes.json();
          if (imgData.image_url) imageUrl = imgData.image_url;
        }
      } catch (imgErr) {
        console.error("Image generation failed, sending text only:", imgErr);
      }
    }

    // ── Send to Telegram (photo+caption if image exists, otherwise text) ──
    let tgResponse;
    let tgData;

    // Try photo first if image exists
    if (imageUrl) {
      tgResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          photo: imageUrl,
          caption: post.content_text?.slice(0, 1024) || "",
          parse_mode: "HTML",
        }),
      });
      tgData = await tgResponse.json();

      // Fallback to text if photo fails (broken URL, etc.)
      if (!tgData.ok) {
        console.warn("Photo send failed, falling back to text:", tgData.description);
        imageUrl = ""; // reset so we send text
      }
    }

    // Send text-only (or as fallback from failed photo)
    if (!imageUrl) {
      tgResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: post.content_text,
          parse_mode: "HTML",
          disable_web_page_preview: false,
        }),
      });
      tgData = await tgResponse.json();
    }

    if (!tgData.ok) {
      // If even text fails, try without parse_mode (HTML formatting errors)
      tgResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: post.content_text,
          disable_web_page_preview: false,
        }),
      });
      tgData = await tgResponse.json();
    }

    if (!tgData.ok) {
      console.error("Telegram error:", tgData);
      return new Response(
        JSON.stringify({ error: "Telegram API error", detail: tgData.description }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark as published
    await supabase
      .from("content_queue")
      .update({
        status: "published",
        published_at: now.toISOString(),
      })
      .eq("id", post.id);

    // Log event (try/catch instead of .catch() — Supabase v2 compat)
    try {
      await supabase.from("events").insert({
        type: "content_published",
        metadata_json: {
          post_id: post.id,
          platform: post.platform,
          telegram_message_id: tgData.result?.message_id,
        },
      });
    } catch (_) { /* non-critical logging */ }

    // Check how many posts are queued for later
    const { count: queuedCount } = await supabase
      .from("content_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved")
      .eq("platform", "telegram")
      .is("published_at", null);

    return new Response(
      JSON.stringify({
        success: true,
        published: 1,
        post_id: post.id,
        telegram_message_id: tgData.result?.message_id,
        queued_remaining: queuedCount || 0,
        message: `Published 1 post. ${queuedCount || 0} more in queue.`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("content-publish error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
