#!/usr/bin/env node
// ═══ F2F Market Analyst — Full Opus Pipeline ═══
// Search → Plan → Execute → Verify → Save → Telegram
// Runs via GitHub Actions (no timeout limits)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY;
const AHREFS_TOKEN = process.env.AHREFS_API_TOKEN;
const TG_BOT = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

if (!SUPABASE_URL || !SUPABASE_KEY || !ANTHROPIC_KEY) {
  console.error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY");
  process.exit(1);
}

// ═══ Helpers ═══
async function sbQuery(table, method, params = {}) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: method === "POST" ? "return=representation" : "return=minimal",
  };

  if (method === "GET") {
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    if (qs) url += `?${qs}`;
  }

  const opts = { method, headers };
  if (method !== "GET") opts.body = JSON.stringify(params.body || params);

  const res = await fetch(url, opts);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase ${method} ${table}: ${res.status} — ${txt.slice(0, 200)}`);
  }
  if (method === "GET" || (method === "POST" && headers.Prefer.includes("return=representation"))) {
    return res.json();
  }
  return null;
}

async function sbInsert(table, data) {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Insert ${table}: ${res.status} — ${txt.slice(0, 200)}`);
  }
  return res.json();
}

async function sbUpdate(table, match, data) {
  const qs = Object.entries(match).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join("&");
  const url = `${SUPABASE_URL}/rest/v1/${table}?${qs}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Update ${table}: ${res.status} — ${txt.slice(0, 200)}`);
  }
}

// ═══ Claude Opus ═══
async function callOpus(system, user, maxTokens) {
  console.log(`  [opus] Calling (max_tokens=${maxTokens})...`);
  const start = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-6",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const e = await res.text();
    throw new Error(`Opus ${res.status}: ${e.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || "";
  console.log(`  [opus] Done: ${((Date.now() - start) / 1000).toFixed(1)}s, ${text.length} chars`);
  return text;
}

// ═══ JSON parser with repair ═══
function parseJSON(raw) {
  let s = raw.trim();
  // Strip markdown fences anywhere
  s = s.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(s); } catch (_) {}

  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch (_) {}
  }

  // Repair truncated JSON — progressive trimming approach
  if (start !== -1) {
    let fragment = s.slice(start);

    // Close open string if needed
    let inStr = false, escaped = false;
    for (const c of fragment) {
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if (c === '"') inStr = !inStr;
    }
    if (inStr) fragment += '"';

    // Try progressively trimming from the end to find valid JSON
    // Find last valid boundary: after ", }, ], number, true, false, null
    for (let attempts = 0; attempts < 20; attempts++) {
      // Count open braces/brackets
      let braces = 0, brackets = 0;
      inStr = false; escaped = false;
      for (const c of fragment) {
        if (escaped) { escaped = false; continue; }
        if (c === "\\") { escaped = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === "{") braces++; else if (c === "}") braces--;
        else if (c === "[") brackets++; else if (c === "]") brackets--;
      }

      let closed = fragment;
      // Clean trailing partial content
      closed = closed.replace(/,\s*$/, "");
      // Close brackets/braces
      closed += "]".repeat(Math.max(0, brackets)) + "}".repeat(Math.max(0, braces));
      // Fix trailing commas before closers
      closed = closed.replace(/,(\s*[\]}])/g, "$1");

      try {
        const result = JSON.parse(closed);
        console.log(`  [parseJSON] Repaired (attempt ${attempts + 1}): ${closed.length} chars`);
        return result;
      } catch (_) {}

      // Trim: remove last line or last key-value pair
      // Find last comma outside strings and trim there
      let lastComma = -1;
      inStr = false; escaped = false;
      for (let i = 0; i < fragment.length; i++) {
        const c = fragment[i];
        if (escaped) { escaped = false; continue; }
        if (c === "\\") { escaped = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (!inStr && c === ",") lastComma = i;
      }
      if (lastComma > 0) {
        fragment = fragment.slice(0, lastComma);
      } else {
        break; // No more commas to trim
      }
    }

    console.log(`  [parseJSON] All repair attempts failed`);
  }
  throw new Error(`No JSON found. Raw (first 500):\n${raw.slice(0, 500)}`);
}

// ═══ Competitors ═══
const COMPETITORS = [
  { name: "FACEIT", domain: "faceit.com", keywords: ["faceit cs2 update", "faceit tournament 2026"] },
  { name: "ESEA", domain: "play.esea.net", keywords: ["esea cs2 league 2026"] },
  { name: "CyberShoke", domain: "cybershoke.net", keywords: ["cybershoke cs2 кибершок"] },
  { name: "FastCup", domain: "fastcup.net", keywords: ["fastcup cs2 фасткап 2026"] },
  { name: "Challengermode", domain: "challengermode.com", keywords: ["challengermode esports 2026"] },
  { name: "Esplay", domain: "esplay.com", keywords: ["esplay gaming platform"] },
  { name: "Leetify", domain: "leetify.com", keywords: ["leetify cs2 analytics"] },
  { name: "Scope.gg", domain: "scope.gg", keywords: ["scope.gg cs2"] },
  { name: "5Play", domain: "5play.org", keywords: ["5play cs2"] },
];

// ═══ Focus rotation ═══
function getAnalystFocus() {
  const hour = new Date().getUTCHours();
  if (hour < 9) return "competitors";
  if (hour < 16) return "opportunities";
  return "threats_strategy";
}

const FOCUS_QUERIES = {
  competitors: [
    "FACEIT 2026 updates new features pricing",
    "ESEA platform changes cs2 matchmaking 2026",
    "CyberShoke cs2 tournament platform updates",
    "FastCup cs2 latest news updates 2026",
    "Challengermode esports platform funding growth",
    "Leetify cs2 analytics platform changes",
    "esports matchmaking platform comparison review 2026",
  ],
  opportunities: [
    "esports platform subscription model revenue SaaS 2026",
    "cs2 community tournament platform underserved market",
    "esports team management software gap opportunity",
    "gaming tournament organizer platform white space",
    "esports B2B partnership sponsor platform 2026",
    "competitive gaming grassroots community platform",
    "esports platform monetization strategy case study",
  ],
  threats_strategy: [
    "Valve cs2 official matchmaking changes 2026",
    "esports industry decline risk regulation 2026",
    "gaming platform market consolidation acquisition",
    "esports platform user churn retention analysis",
    "cs2 player base growth decline statistics 2026",
    "esports regulation legislation impact platforms",
    "competitive gaming market saturation analysis",
  ],
};

// ═══ STEP 1: Search ═══
async function searchMarketData(focus) {
  console.log("\n📡 STEP 1: Search...");
  let webData = "", competitorData = "", ahrefsData = "";
  const promises = [];

  console.log(`  BRAVE_KEY: ${BRAVE_KEY ? BRAVE_KEY.slice(0, 8) + "..." : "MISSING!"}`);
  console.log(`  AHREFS_TOKEN: ${AHREFS_TOKEN ? "set" : "not set"}`);
  if (BRAVE_KEY) {
    // Market queries
    let braveOk = 0, braveFail = 0;
    for (const q of FOCUS_QUERIES[focus]) {
      promises.push((async () => {
        try {
          const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=8&freshness=pw`, {
            headers: { Accept: "application/json", "X-Subscription-Token": BRAVE_KEY },
          });
          if (res.ok) {
            braveOk++;
            const data = await res.json();
            for (const r of (data.web?.results || []).slice(0, 5)) {
              webData += `\n[${q}] ${r.title || "?"} — ${r.url || "?"}\n  ${(r.description || "").slice(0, 250)}\n`;
            }
          } else {
            braveFail++;
            const errText = await res.text().catch(() => "");
            console.log(`  Brave ${res.status} for "${q.slice(0,40)}": ${errText.slice(0, 150)}`);
          }
        } catch (e) { console.log(`  Brave err: ${String(e).slice(0, 100)}`); }
      })());
    }

    // Competitor keywords
    const targets = focus === "competitors" ? COMPETITORS : COMPETITORS.slice(0, 4);
    for (const comp of targets) {
      for (const kw of comp.keywords) {
        promises.push((async () => {
          try {
            const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(kw + " news")}&count=5&freshness=pm`, {
              headers: { Accept: "application/json", "X-Subscription-Token": BRAVE_KEY },
            });
            if (res.ok) {
              const data = await res.json();
              for (const r of (data.web?.results || []).slice(0, 4)) {
                competitorData += `\n[${comp.name}] ${r.title || "?"} — ${r.url || "?"}\n  ${(r.description || "").slice(0, 250)}\n`;
              }
            } else {
              const errText = await res.text().catch(() => "");
              console.log(`  Brave comp ${res.status} for ${comp.name}: ${errText.slice(0, 150)}`);
            }
          } catch (e) { console.log(`  Brave comp err: ${String(e).slice(0, 100)}`); }
        })());
      }
    }
  } else {
    console.log("  ⚠️ BRAVE_KEY is empty — no search will happen!");
  }

  // Ahrefs
  if (AHREFS_TOKEN) {
    const today = new Date().toISOString().split("T")[0];
    for (const comp of COMPETITORS.slice(0, 5)) {
      promises.push((async () => {
        try {
          const [drRes, mRes] = await Promise.all([
            fetch(`https://api.ahrefs.com/v3/site-explorer/domain-rating?target=${comp.domain}&date=${today}&output=json`, {
              headers: { Authorization: `Bearer ${AHREFS_TOKEN}`, Accept: "application/json" },
            }),
            fetch(`https://api.ahrefs.com/v3/site-explorer/metrics?target=${comp.domain}&date=${today}&output=json`, {
              headers: { Authorization: `Bearer ${AHREFS_TOKEN}`, Accept: "application/json" },
            }),
          ]);
          if (drRes.ok) { const d = await drRes.json(); ahrefsData += `\n[${comp.name}] DR: ${d.domain_rating || "?"}\n`; }
          if (mRes.ok) { const m = await mRes.json(); ahrefsData += `[${comp.name}] Traffic: ${m.organic?.traffic || "?"}, Refdomains: ${m.backlinks?.referring_domains || "?"}\n`; }
        } catch (e) { console.log(`  Ahrefs ${comp.name}: ${String(e).slice(0, 60)}`); }
      })());
    }
  }

  await Promise.allSettled(promises);
  const totalChars = webData.length + competitorData.length + ahrefsData.length;
  console.log(`  Search done: web=${webData.length}, comp=${competitorData.length}, ahrefs=${ahrefsData.length}, total=${totalChars}`);
  return { webData, competitorData, ahrefsData, totalChars };
}

// ═══ STEP 2: Build context ═══
async function buildContext(focus, searchData) {
  console.log("\n📋 STEP 2: Build context...");
  const [agentRes, kbRes, dirRes, memRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/agents?slug=eq.analyst&select=id,system_prompt`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    }).then(r => r.json()),
    fetch(`${SUPABASE_URL}/rest/v1/knowledge_base?status=eq.active&order=is_pinned.desc&limit=15&select=category,title,content`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    }).then(r => r.json()).catch(() => []),
    fetch(`${SUPABASE_URL}/rest/v1/directives?active=eq.true&select=key,value_json`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    }).then(r => r.json()).catch(() => []),
    fetch(`${SUPABASE_URL}/rest/v1/agent_memory?order=created_at.desc&limit=1&select=state,insights,next_action`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    }).then(r => r.json()).catch(() => []),
  ]);

  const agentPrompt = agentRes?.[0]?.system_prompt || "You are a market analyst for F2F.vin.";
  const kbText = kbRes?.length ? kbRes.map(a => `[${a.category}] ${a.title}\n${a.content}`).join("\n---\n") : "";
  const stratText = dirRes?.length ? dirRes.map(d => `${d.key}: ${JSON.stringify(d.value_json)}`).join("\n") : "";
  const memText = memRes?.[0] ? [memRes[0].state, memRes[0].insights, memRes[0].next_action].filter(Boolean).join("\n") : "";

  const focusLabels = {
    competitors: "🎯 ГЛУБОКИЙ АНАЛИЗ КОНКУРЕНТОВ — каждый конкурент отдельно, что нового, цены, сильные/слабые vs F2F",
    opportunities: "🎯 РЫНОЧНЫЕ ВОЗМОЖНОСТИ — незанятые ниши, модели монетизации, партнёрства для F2F",
    threats_strategy: "🎯 УГРОЗЫ + СТРАТЕГИЯ — регуляторные риски, Valve, консолидация, конкретные рекомендации CEO",
  };

  const context = [
    `=== AGENT ===\n${agentPrompt}`, focusLabels[focus],
    kbText ? `=== БАЗА ЗНАНИЙ ===\n${kbText}` : "",
    stratText ? `=== СТРАТЕГИЯ CEO ===\n${stratText}` : "",
    memText ? `=== ПАМЯТЬ ===\n${memText}` : "",
    searchData.webData ? `=== WEB (${focus}) ===\n${searchData.webData}` : "",
    searchData.competitorData ? `=== COMPETITORS ===\n${searchData.competitorData}` : "",
    searchData.ahrefsData ? `=== AHREFS ===\n${searchData.ahrefsData}` : "",
  ].filter(Boolean).join("\n\n");

  console.log(`  Context: ${context.length} chars`);
  return context;
}

// ═══ STEP 3: Opus PLAN ═══
async function opusPlan(focus, context, searchChars) {
  console.log("\n🧠 STEP 3: Opus PLAN...");
  const system = `Ты — стратегический планировщик для аналитика F2F.vin (Claude Opus).
Создай детальный план анализа рыночных данных. План будет выполнен тем же Opus в следующем шаге с доступом ко всем данным.

КРИТИЧЕСКИ ВАЖНО: Ответ ТОЛЬКО валидный JSON. Начни с { закончи }. Без markdown.`;

  const user = `Фокус: ${focus}
Данные (${searchChars} символов):
${context.slice(0, 25000)}

Составь план (5-10 шагов). Верни ТОЛЬКО JSON:
{"plan":"цель анализа","steps":["шаг 1: задача","шаг 2: задача"],"expected_output":"что в отчёте","key_data_points":["находка 1","находка 2"],"constraints":["ограничение"]}`;

  const raw = await callOpus(system, user, 2000);
  return parseJSON(raw);
}

// ═══ STEP 4: Opus EXECUTE ═══
async function opusExecute(focus, plan, context) {
  console.log("\n⚡ STEP 4: Opus EXECUTE...");
  const system = `Ты — старший аналитик рынка F2F.vin (CS2 esports). Модель: Claude Opus.
Выполни план анализа строго по шагам. Будь тщательным и глубоким.

ПРАВИЛА:
1. ТОЛЬКО факты из данных. Нет данных — "не найдено", не выдумывай
2. Каждый факт с источником (URL или название)
3. Рекомендации конкретные: "сделать X потому что Y"
4. НЕ ВЫДУМЫВАЙ метрики F2F (MAU, DAU, revenue)
5. Пиши на русском
6. Верни ТОЛЬКО валидный JSON — начни с { и закончи }. БЕЗ markdown, БЕЗ \`\`\`json блоков.
7. Будь лаконичным — каждый пункт max 2-3 предложения`;

  const user = `ПЛАН:
${JSON.stringify(plan, null, 2)}

ДАННЫЕ:
${context.slice(0, 50000)}

Выполни план. Верни JSON:
{
  "report_type": "${focus}",
  "executive_summary": "3-5 предложений: главный вывод",
  "market_trends": [{"title": "...", "description": "...", "source": "url", "impact_on_f2f": "..."}],
  "competitor_updates": [{"competitor": "name", "update": "...", "source": "url"}],
  "opportunities": [{"title": "...", "description": "...", "evidence": "...", "recommended_action": "..."}],
  "threats": [{"title": "...", "severity": "high|medium|low", "description": "...", "mitigation": "..."}],
  "recommendations": [{"priority": 1, "action": "...", "reasoning": "...", "timeline": "..."}],
  "data_quality": "оценка качества данных"
}`;

  const raw = await callOpus(system, user, 8000);
  return parseJSON(raw);
}

// ═══ STEP 5: Opus VERIFY ═══
async function opusVerify(plan, execOutput) {
  console.log("\n🔍 STEP 5: Opus VERIFY...");
  const system = `Ты — QA рецензент для аналитика F2F. Оцени качество анализа.
Оценка 1-10 по: точность данных, наличие источников, конкретность рекомендаций, полнота.
Если можешь улучшить — верни improved_output.
Верни ТОЛЬКО JSON.`;

  const user = `ПЛАН: ${JSON.stringify(plan, null, 2)}

РЕЗУЛЬТАТ: ${JSON.stringify(execOutput, null, 2)}

Оцени. Верни JSON:
{"quality_score": 8, "issues": ["проблема 1"], "improved_output": null, "verdict": "pass|retry|fail", "feedback": "краткая оценка"}`;

  try {
    const raw = await callOpus(system, user, 1500);
    return parseJSON(raw);
  } catch (e) {
    console.log(`  Verify failed (non-critical): ${String(e).slice(0, 80)}`);
    return { quality_score: 6, issues: [`Verify error: ${String(e).slice(0, 60)}`], verdict: "pass", feedback: "Verify failed, using raw output" };
  }
}

// ═══ STEP 6: Save + Telegram ═══
async function saveAndNotify(focus, plan, execOutput, verifyOutput, searchChars, sessionId) {
  console.log("\n💾 STEP 6: Save + Telegram...");
  const finalOutput = verifyOutput.improved_output || execOutput;
  const qualityScore = verifyOutput.quality_score || 7;
  finalOutput.quality_self_check = verifyOutput.feedback;
  finalOutput._verify = { score: qualityScore, verdict: verifyOutput.verdict, issues: verifyOutput.issues };

  const trendCount = (finalOutput.market_trends || []).length;
  const compCount = (finalOutput.competitor_updates || []).length;
  const oppCount = (finalOutput.opportunities || []).length;
  const threatCount = (finalOutput.threats || []).length;
  const summary = finalOutput.executive_summary || `${trendCount} трендов, ${compCount} конкурентов, ${oppCount} возможностей`;

  // Save to all tables in parallel
  await Promise.allSettled([
    sbUpdate("analyst_sessions", { id: sessionId }, {
      phase: "completed", execution_output: finalOutput, verify_output: verifyOutput,
      quality_score: qualityScore, updated_at: new Date().toISOString(),
    }),

    sbInsert("market_intelligence", {
      report_type: focus, market_trends: finalOutput.market_trends || [],
      competitor_updates: finalOutput.competitor_updates || [],
      opportunities: finalOutput.opportunities || [], threats: finalOutput.threats || [],
      recommendations: finalOutput.recommendations || [], summary,
      metadata_json: { session_id: sessionId, model: "claude-opus-4-6", focus, quality: qualityScore, verdict: verifyOutput.verdict, search_chars: searchChars, source: "github-actions" },
      created_at: new Date().toISOString(),
    }),

    sbInsert("reports", {
      agent_id: "analyst", type_ab: "market_intelligence",
      summary: summary.slice(0, 2000),
      metrics_json: { trends: trendCount, competitors: compCount, opportunities: oppCount, threats: threatCount, quality: qualityScore },
      created_at: new Date().toISOString(),
    }),

    sbInsert("cycle_runs", {
      agent_slug: "analyst", cycle_number: 1,
      plan_output: plan, execution_output: finalOutput, verify_output: verifyOutput,
      quality_score: qualityScore, status: "completed", model_used: "claude-opus-4-6",
      created_at: new Date().toISOString(),
    }),

    sbInsert("events", {
      type: "analyst_report", agent_name: "analyst",
      metadata_json: { focus, quality: qualityScore, verdict: verifyOutput.verdict, trends: trendCount, competitors: compCount, opportunities: oppCount, threats: threatCount, source: "github-actions" },
      created_at: new Date().toISOString(),
    }),
  ]);

  // Update agent_memory
  try {
    const agents = await fetch(`${SUPABASE_URL}/rest/v1/agents?slug=eq.analyst&select=id`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    }).then(r => r.json());
    if (agents?.[0]) {
      const url = `${SUPABASE_URL}/rest/v1/agent_memory?agent_id=eq.${agents[0].id}`;
      await fetch(url, {
        method: "PATCH",
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({
          state: "completed", last_output: JSON.stringify(finalOutput).slice(0, 5000),
          insights: summary, next_action: `Next: ${focus === "competitors" ? "opportunities" : focus === "opportunities" ? "threats_strategy" : "competitors"}`,
          cycle_number: 1,
        }),
      });
    }
  } catch (e) { console.log(`  agent_memory: ${String(e).slice(0, 60)}`); }

  // Telegram
  if (TG_BOT && TG_CHAT) {
    const labels = { competitors: "🔍 Конкуренты", opportunities: "💡 Возможности", threats_strategy: "⚠️ Угрозы + Стратегия" };
    const p = [`📊 *ANALYST — ${labels[focus] || focus}*\n_Opus Plan→Execute→Verify | GitHub Actions | ${new Date().toISOString().split("T")[0]}_\n`];

    if (finalOutput.executive_summary) p.push(`📋 ${finalOutput.executive_summary}\n`);
    if (finalOutput.market_trends?.length) {
      p.push("*🔥 Тренды:*");
      for (const t of finalOutput.market_trends.slice(0, 5)) { p.push(`• ${t.title || t}`); if (t.impact_on_f2f) p.push(`  → _${t.impact_on_f2f}_`); }
    }
    if (finalOutput.competitor_updates?.length) {
      p.push("\n*🏢 Конкуренты:*");
      for (const c of finalOutput.competitor_updates.slice(0, 5)) p.push(`• *${c.competitor || "?"}*: ${c.update || c}`);
    }
    if (finalOutput.opportunities?.length) {
      p.push("\n*💡 Возможности:*");
      for (const o of finalOutput.opportunities.slice(0, 3)) { p.push(`• ${o.title || o}`); if (o.recommended_action) p.push(`  → _${o.recommended_action}_`); }
    }
    if (finalOutput.threats?.length) {
      p.push("\n*⚠️ Угрозы:*");
      for (const t of finalOutput.threats.slice(0, 3)) p.push(`• ${t.title || t}${t.severity ? ` [${t.severity}]` : ""}`);
    }
    if (finalOutput.recommendations?.length) {
      p.push("\n*🎯 Рекомендации:*");
      for (const r of finalOutput.recommendations.slice(0, 5)) p.push(`${r.priority ? `P${r.priority}.` : "•"} ${r.action || r}`);
    }
    if (verifyOutput.feedback) p.push(`\n_🔍 QA (${qualityScore}/10): ${verifyOutput.feedback}_`);

    try {
      await fetch(`https://api.telegram.org/bot${TG_BOT}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: TG_CHAT, text: p.join("\n").slice(0, 4000), parse_mode: "Markdown", disable_web_page_preview: true }),
      });
      console.log("  Telegram: sent ✅");
    } catch (e) { console.log(`  Telegram: ${String(e).slice(0, 60)}`); }
  }

  return { qualityScore, trendCount, compCount, oppCount, threatCount, summary };
}

// ═══ MAIN ═══
async function main() {
  const startTime = Date.now();
  const focus = getAnalystFocus();
  console.log(`\n════════════════════════════════════════`);
  console.log(`  F2F ANALYST PIPELINE — ${focus.toUpperCase()}`);
  console.log(`  ${new Date().toISOString()}`);
  console.log(`════════════════════════════════════════\n`);

  // 1. Search
  const searchData = await searchMarketData(focus);
  if (searchData.totalChars < 100) {
    console.log("❌ Not enough search data. Aborting.");
    process.exit(0);
  }

  // 2. Context
  const context = await buildContext(focus, searchData);

  // 3. Create session
  const [session] = await sbInsert("analyst_sessions", {
    focus, phase: "research",
    search_data: { web: searchData.webData.slice(0, 30000), comp: searchData.competitorData.slice(0, 20000), ahrefs: searchData.ahrefsData.slice(0, 5000) },
    context_snapshot: context.slice(0, 60000),
    search_chars: searchData.totalChars, model_used: "claude-opus-4-6",
  });
  const sessionId = session.id;
  console.log(`  Session: ${sessionId}`);

  // 4. Plan
  const plan = await opusPlan(focus, context, searchData.totalChars);
  console.log(`  Plan: ${plan.steps?.length || 0} steps`);

  await sbUpdate("analyst_sessions", { id: sessionId }, {
    plan_output: plan, phase: "synthesize", updated_at: new Date().toISOString(),
  });

  // 5. Execute
  const execOutput = await opusExecute(focus, plan, context);
  console.log(`  Execute: trends=${(execOutput.market_trends||[]).length}, comp=${(execOutput.competitor_updates||[]).length}, opp=${(execOutput.opportunities||[]).length}`);

  // 6. Verify
  const verifyOutput = await opusVerify(plan, execOutput);
  console.log(`  Verify: score=${verifyOutput.quality_score}, verdict=${verifyOutput.verdict}`);

  // 7. Save + Telegram
  const result = await saveAndNotify(focus, plan, execOutput, verifyOutput, searchData.totalChars, sessionId);

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n════════════════════════════════════════`);
  console.log(`  ✅ DONE in ${totalSec}s`);
  console.log(`  Focus: ${focus} | Score: ${result.qualityScore}/10`);
  console.log(`  Trends: ${result.trendCount} | Comp: ${result.compCount} | Opp: ${result.oppCount} | Threats: ${result.threatCount}`);
  console.log(`════════════════════════════════════════\n`);
}

main().catch(err => {
  console.error("❌ FATAL:", err);
  process.exit(1);
});
