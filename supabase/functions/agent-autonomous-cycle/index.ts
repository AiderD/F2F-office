// ═══ F2F Agent Autonomous Cycle — Supabase Edge Function ═══
// Runs an autonomous work cycle for a specific agent (or all active agents)
// Each agent: reads context → thinks → produces actions/reports → saves results
// Called by pg_cron every N hours per agent's cycle_hours setting
// Deploy: supabase functions deploy agent-autonomous-cycle --no-verify-jwt

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ═══ F2F Knowledge Base (shared) ═══
const F2F_KNOWLEDGE_BASE = `
F2F.vin — действующая CS2-платформа, 3+ года в продакшене.
Юрлицо: F2F PTE. LTD., Singapore. Приложение: app.f2f.vin.
CEO: Айдер Джанбаев (Moonlike).

ПРОДУКТ: 7 режимов (5x5 Competitive, 2x2, 1x1, DM, Public, Arena, AWP), TrueSkill матчмейкинг, Akros античит.
Турниры: RC Cup (64 команды, $2/игрок), Championship, Challenge Arena, Skill Lab.
СТРОИТСЯ (не запущено): Battle Pass, Dominion (2v5), подписки (Lite/Believer/PRO).

KPI ЦЕЛИ: Регистрации 500/мес | CAC < $1 | Retention D7 > 40% | 3 партнёрства | 20 постов/нед
КОНКУРЕНТЫ: FACEIT, ESEA, Valve MM, CyberShoke, Blast.tv, FastCup, ChallengerMode

ВАЖНО: НЕТ AI-матчмейкинга (TrueSkill), НЕТ ставок, только CS2, CyberShoke=конкурент, Dominion/BP/подписки НЕ запущены.
`;

// ═══ Agent-specific cycle instructions ═══
const CYCLE_INSTRUCTIONS: Record<string, string> = {
  analyst: `Ты — Аналитик рынка F2F. Твой автономный цикл:
1. Проанализируй последние тренды на рынке CS2/esports-платформ
2. Проверь что нового у конкурентов (FACEIT, ESEA, CyberShoke, FastCup)
3. Оцени текущие KPI F2F и предложи улучшения
4. Сформулируй 2-3 ключевых инсайта для CEO

ФОРМАТ ОТВЕТА — строго JSON:
{
  "summary": "Краткое резюме (2-3 предложения)",
  "insights": ["инсайт 1", "инсайт 2", "инсайт 3"],
  "competitor_updates": [{"name": "FACEIT", "update": "что нового"}],
  "recommendations": ["рекомендация 1", "рекомендация 2"],
  "kpi_assessment": "Оценка текущих KPI и тренды"
}`,

  bizdev: `Ты — BizDev менеджер F2F. Твой автономный цикл:
1. Просмотри текущий pipeline партнёров и определи приоритеты
2. Предложи новых потенциальных партнёров для outreach
3. Подготовь follow-up рекомендации для активных лидов
4. Оцени конверсию pipeline и предложи улучшения

ФОРМАТ ОТВЕТА — строго JSON:
{
  "summary": "Краткое резюме (2-3 предложения)",
  "pipeline_review": "Оценка текущего пайплайна",
  "new_leads_suggested": [{"company": "название", "segment": "сегмент", "reason": "почему подходят"}],
  "followup_actions": [{"partner": "название", "action": "что сделать", "priority": "high/medium/low"}],
  "recommendations": ["рекомендация 1", "рекомендация 2"]
}`,

  community: `Ты — Community Manager F2F. Твой автономный цикл:
1. Оцени текущее здоровье сообщества (Telegram, Discord, Reddit)
2. Предложи темы для обсуждения и engagement-активности
3. Определи потенциальных инфлюенсеров для сотрудничества
4. Составь план community-активностей на ближайшие дни

ФОРМАТ ОТВЕТА — строго JSON:
{
  "summary": "Краткое резюме (2-3 предложения)",
  "community_health": "Оценка состояния сообщества",
  "engagement_ideas": ["идея 1", "идея 2", "идея 3"],
  "influencer_suggestions": [{"name": "ник", "platform": "платформа", "reason": "почему"}],
  "action_plan": ["действие 1", "действие 2"]
}`,

  outreach: `Ты — Outreach менеджер F2F. Твой автономный цикл:
1. Просмотри очередь email-outreach и предложи улучшения
2. Проанализируй шаблоны cold email и предложи новые подходы
3. Определи лидов, которым нужен follow-up
4. Подготовь 2-3 шаблона персонализированных писем

ФОРМАТ ОТВЕТА — строго JSON:
{
  "summary": "Краткое резюме (2-3 предложения)",
  "followup_needed": [{"partner": "название", "days_since_last": 0, "suggested_message": "текст"}],
  "email_templates": [{"subject": "тема", "body": "текст", "target_segment": "сегмент"}],
  "recommendations": ["рекомендация 1", "рекомендация 2"]
}`,

  lead_finder: `Ты — Lead Finder агент F2F. Твой автономный цикл:

ИСТОЧНИКИ ДАННЫХ:
- Тебе предоставлены РЕАЛЬНЫЕ данные из Apollo API (контакты и компании) и Google/Ahrefs (SERP результаты)
- Если данные есть — используй ИХ как основу, фильтруй и приоритизируй
- Если внешних API нет — используй свои знания, но ПОМЕЧАЙ source: "ai_knowledge"
- НЕ выдумывай email-адреса! Если email неизвестен — оставь пустым ""

ЗАДАЧИ:
1. Проанализируй данные из Apollo/Google/Ahrefs (они в контексте ниже)
2. Отфильтруй 5-8 лучших лидов для партнёрства с F2F.vin
3. Для каждого лида: компания, имя, должность, email (только реальный!), сегмент, website
4. Приоритизируй: high = ЛПР (CEO/Head of Partnerships/BD) в esports, medium = маркетинг/продукт, low = остальные
5. НЕ дублируй лидов из текущего pipeline (смотри контекст)

ICP (Ideal Customer Profile):
- Esports teams: NAVI, Virtus.pro, Cloud9, FaZe, Team Spirit, G2, Astralis, и новые
- Tournament organizers: WePlay, PGL, BLAST, ESL, DreamHack
- Gaming platforms & startups: матчмейкинг, античит, скриммеры
- Esports media & streaming
- Betting/fantasy platforms (для интеграций API, НЕ ставки)

ФОРМАТ ОТВЕТА — строго JSON:
{
  "summary": "Краткое резюме (2-3 предложения)",
  "new_leads": [
    {
      "company_name": "название компании",
      "contact_name": "Имя Фамилия",
      "contact_email": "email@example.com или пустая строка",
      "segment": "esports_team/tournament_organizer/streaming/game_studio/media/betting",
      "pitch_text": "Почему F2F интересен этой компании (1-2 предложения)",
      "priority": "high/medium/low",
      "website": "https://...",
      "source": "apollo/google/ahrefs/ai_knowledge"
    }
  ],
  "search_strategy": "Какие API использованы, что найдено",
  "api_stats": {"apollo_results": 0, "google_results": 0, "ahrefs_results": 0},
  "recommendations": ["рекомендация 1", "рекомендация 2"]
}`,

  followup: `Ты — Follow-Up агент F2F. Твой автономный цикл:
1. Просмотри pipeline партнёров и найди лидов со статусом "contacted", которым не было follow-up 3+ дней
2. Для каждого подготовь персонализированное follow-up письмо с другим углом подхода
3. Оцени, кого стоит перевести в "negotiating" или "closed_lost"

ФОРМАТ ОТВЕТА — строго JSON:
{
  "summary": "Краткое резюме (2-3 предложения)",
  "followup_emails": [
    {
      "partner": "название компании",
      "contact_name": "Имя",
      "contact_email": "email",
      "subject": "Тема письма",
      "body": "Текст follow-up письма",
      "days_since_contact": 0
    }
  ],
  "stage_changes": [
    {"partner": "название", "from_stage": "contacted", "to_stage": "negotiating", "reason": "почему"}
  ],
  "recommendations": ["рекомендация 1"]
}`,

  smm: `Ты — SMM-менеджер F2F. Твой автономный цикл:
1. Проанализируй контент-календарь: сколько постов в очереди, какие рубрики представлены
2. Определи пробелы в контент-плане (непредставленные рубрики, пустые дни)
3. Предложи темы для следующей генерации
4. Оцени распределение по платформам

ФОРМАТ ОТВЕТА — строго JSON:
{
  "summary": "Краткое резюме (2-3 предложения)",
  "content_audit": {"pending": 0, "approved": 0, "published_today": 0, "queued_days": 0},
  "gaps": ["пробел 1", "пробел 2"],
  "suggested_topics": ["тема 1", "тема 2", "тема 3"],
  "platform_balance": "Оценка баланса между платформами"
}`,
};

// ═══ External API Search (Apollo + Ahrefs) ═══
async function searchExternalAPIs(supabase: any): Promise<string> {
  let externalData = "";

  // ── 1. Apollo: People Search — find decision-makers in esports/gaming ──
  const apolloKey = Deno.env.get("APOLLO_API_KEY");
  if (apolloKey) {
    try {
      const apolloRes = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apolloKey,
          person_titles: [
            "Head of Partnerships", "Head of Esports", "Business Development",
            "CEO", "COO", "CMO", "Head of Marketing", "Partnership Manager",
            "Head of Commercial", "VP of Business Development"
          ],
          q_organization_keyword_tags: ["esports", "gaming", "tournament", "competitive gaming"],
          organization_num_employees_ranges: ["11,50", "51,200", "201,1000", "1001,5000"],
          per_page: 10,
          page: 1,
        }),
      });

      if (apolloRes.ok) {
        const apolloData = await apolloRes.json();
        const people = apolloData.people || [];
        if (people.length > 0) {
          externalData += "\n=== APOLLO: РЕАЛЬНЫЕ КОНТАКТЫ В ESPORTS/GAMING ===\n";
          for (const p of people) {
            externalData += `• ${p.name || "?"} — ${p.title || "?"} @ ${p.organization?.name || "?"}\n`;
            externalData += `  Email: ${p.email || "не найден"} | LinkedIn: ${p.linkedin_url || "нет"}\n`;
            externalData += `  Компания: ${p.organization?.estimated_num_employees || "?"} сотр., ${p.organization?.industry || "?"}\n`;
            if (p.organization?.website_url) externalData += `  Сайт: ${p.organization.website_url}\n`;
          }
        }
      } else {
        externalData += `\n[Apollo API: ${apolloRes.status} — используй свои знания для поиска]\n`;
      }
    } catch (e) {
      externalData += `\n[Apollo API ошибка: ${String(e).slice(0, 100)} — используй свои знания]\n`;
    }
  }

  // ── 2. Apollo: Organization Search — find companies by keywords ──
  if (apolloKey) {
    try {
      const orgRes = await fetch("https://api.apollo.io/api/v1/mixed_companies/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apolloKey,
          q_organization_keyword_tags: ["esports platform", "gaming tournament", "matchmaking", "competitive gaming"],
          organization_num_employees_ranges: ["11,50", "51,200", "201,1000"],
          per_page: 10,
          page: 1,
        }),
      });

      if (orgRes.ok) {
        const orgData = await orgRes.json();
        const orgs = orgData.organizations || orgData.accounts || [];
        if (orgs.length > 0) {
          externalData += "\n=== APOLLO: КОМПАНИИ В НИШЕ ===\n";
          for (const o of orgs) {
            externalData += `• ${o.name || "?"} — ${o.industry || "?"}, ${o.estimated_num_employees || "?"} сотр.\n`;
            if (o.website_url) externalData += `  Сайт: ${o.website_url}\n`;
            if (o.linkedin_url) externalData += `  LinkedIn: ${o.linkedin_url}\n`;
            if (o.short_description) externalData += `  Описание: ${o.short_description.slice(0, 150)}\n`;
          }
        }
      }
    } catch (_e) { /* silent */ }
  }

  // ── 3. Ahrefs: find sites ranking for esports keywords ──
  const ahrefsToken = Deno.env.get("AHREFS_API_TOKEN");
  if (ahrefsToken) {
    const keywords = ["esports matchmaking platform", "cs2 tournament platform", "gaming league platform"];
    for (const kw of keywords) {
      try {
        const ahrefsRes = await fetch(
          `https://api.ahrefs.com/v3/serp-overview?keyword=${encodeURIComponent(kw)}&country=us&limit=5`,
          { headers: { "Authorization": `Bearer ${ahrefsToken}` } }
        );
        if (ahrefsRes.ok) {
          const ahrefsData = await ahrefsRes.json();
          const positions = ahrefsData.positions || ahrefsData.serps || [];
          if (positions.length > 0) {
            externalData += `\n=== AHREFS SERP: "${kw}" ===\n`;
            for (const pos of positions.slice(0, 5)) {
              externalData += `• #${pos.position || "?"}: ${pos.title || pos.url || "?"} (${pos.domain || "?"})\n`;
            }
          }
        }
      } catch (_e) { /* silent */ }
    }
  }

  // ── 4. Web Search via Brave Search API — fresh results ──
  const braveKey = Deno.env.get("BRAVE_SEARCH_API_KEY");
  if (braveKey) {
    const queries = [
      "esports partnership opportunities 2025 2026",
      "gaming tournament platform startup funding",
      "cs2 esports new platform launch"
    ];
    for (const q of queries) {
      try {
        const braveRes = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=5`, {
          headers: { "Accept": "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": braveKey },
        });
        if (braveRes.ok) {
          const braveData = await braveRes.json();
          const results = braveData.web?.results || [];
          if (results.length > 0) {
            externalData += `\n=== WEB SEARCH: "${q}" ===\n`;
            for (const r of results.slice(0, 5)) {
              externalData += `• ${r.title || "?"} — ${r.url || "?"}\n  ${(r.description || "").slice(0, 150)}\n`;
            }
          }
        }
      } catch (_e) { /* silent */ }
    }
  }

  // ── 5. Hunter.io — verify/find emails by domain ──
  // (called later per-lead, not in bulk search)

  if (!externalData) {
    externalData = "\n[Внешние API не настроены — используй свои знания для генерации лидов. CEO может добавить ключи: APOLLO_API_KEY, AHREFS_API_TOKEN, BRAVE_SEARCH_API_KEY]\n";
  }

  return externalData;
}

// ═══ Hunter.io email verification ═══
async function verifyEmailWithHunter(domain: string): Promise<any[]> {
  const hunterKey = Deno.env.get("HUNTER_API_KEY");
  if (!hunterKey || !domain) return [];
  try {
    const res = await fetch(
      `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${hunterKey}&limit=5`
    );
    if (res.ok) {
      const data = await res.json();
      return data.data?.emails || [];
    }
  } catch (_e) { /* silent */ }
  return [];
}

// ═══ Context builders per agent ═══
async function buildAgentContext(
  supabase: any,
  agentSlug: string,
  agentId: string
): Promise<string> {
  let context = "";

  // Load CEO directives
  const { data: directives } = await supabase
    .from("directives")
    .select("key, value_json")
    .eq("active", true);

  if (directives?.length) {
    context += "\n=== ДИРЕКТИВЫ CEO ===\n";
    for (const d of directives) {
      const val = typeof d.value_json === "string" ? JSON.parse(d.value_json) : d.value_json;
      if (d.key === "company_strategy") {
        context += `Миссия: ${val.mission_vision || ""}\n`;
      } else {
        context += `${d.key}: ${val.text || JSON.stringify(val)}\n`;
      }
    }
  }

  // Load current metrics
  const { data: metrics } = await supabase
    .from("metrics")
    .select("name, value, unit")
    .order("recorded_at", { ascending: false });

  if (metrics?.length) {
    const seen = new Set<string>();
    context += "\n=== ТЕКУЩИЕ МЕТРИКИ ===\n";
    for (const m of metrics) {
      if (!seen.has(m.name)) {
        seen.add(m.name);
        context += `${m.name}: ${m.value} ${m.unit || ""}\n`;
      }
    }
  }

  // Load agent's last memory state
  const { data: lastMemory } = await supabase
    .from("agent_memory")
    .select("state, last_output, insights, next_action, cycle_number")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (lastMemory?.[0]) {
    const mem = lastMemory[0];
    context += `\n=== ТВОЁ ПОСЛЕДНЕЕ СОСТОЯНИЕ (цикл #${mem.cycle_number || 0}) ===\n`;
    if (mem.last_output) context += `Последний результат: ${mem.last_output.slice(0, 500)}\n`;
    if (mem.insights) context += `Инсайты: ${mem.insights.slice(0, 500)}\n`;
    if (mem.next_action) context += `Запланированное действие: ${mem.next_action}\n`;
  }

  // Load recent CEO chat messages that affect next cycle
  const { data: recentChats } = await supabase
    .from("chat_history")
    .select("sender, message, created_at")
    .eq("agent_id", agentId)
    .eq("affects_next_cycle", true)
    .order("created_at", { ascending: false })
    .limit(5);

  if (recentChats?.length) {
    context += "\n=== ПОСЛЕДНИЕ УКАЗАНИЯ CEO ===\n";
    for (const c of recentChats) {
      context += `[${c.sender}]: ${c.message.slice(0, 300)}\n`;
    }
  }

  // Lead Finder: fetch real data from external APIs
  if (agentSlug === "lead_finder") {
    const externalSearch = await searchExternalAPIs(supabase);
    context += externalSearch;
  }

  // Agent-specific context
  if (agentSlug === "lead_finder" || agentSlug === "followup" || agentSlug === "bizdev" || agentSlug === "outreach") {
    const { data: partners } = await supabase
      .from("partner_pipeline")
      .select("company_name, segment, stage, contact_name, notes, updated_at")
      .neq("stage", "closed_lost")
      .order("updated_at", { ascending: false })
      .limit(20);

    if (partners?.length) {
      context += `\n=== PIPELINE ПАРТНЁРОВ (${partners.length} активных) ===\n`;
      for (const p of partners) {
        context += `• ${p.company_name} [${p.stage}] ${p.segment || ""} — ${p.contact_name || "нет контакта"}\n`;
      }
    }
  }

  if (agentSlug === "smm") {
    const { data: contentStats } = await supabase
      .from("content_queue")
      .select("status, platform")
      .order("created_at", { ascending: false })
      .limit(50);

    if (contentStats?.length) {
      const byStatus: Record<string, number> = {};
      const byPlatform: Record<string, number> = {};
      for (const c of contentStats) {
        byStatus[c.status] = (byStatus[c.status] || 0) + 1;
        byPlatform[c.platform] = (byPlatform[c.platform] || 0) + 1;
      }
      context += `\n=== СТАТИСТИКА КОНТЕНТА ===\n`;
      context += `По статусу: ${JSON.stringify(byStatus)}\n`;
      context += `По платформе: ${JSON.stringify(byPlatform)}\n`;
    }
  }

  if (agentSlug === "analyst") {
    const { data: competitors } = await supabase
      .from("competitor_data")
      .select("competitor_name, data_type, data_json")
      .order("recorded_at", { ascending: false })
      .limit(10);

    if (competitors?.length) {
      context += `\n=== ПОСЛЕДНИЕ ДАННЫЕ КОНКУРЕНТОВ ===\n`;
      for (const c of competitors) {
        context += `• ${c.competitor_name} [${c.data_type}]: ${JSON.stringify(c.data_json).slice(0, 200)}\n`;
      }
    }
  }

  return context;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parse request — can specify single agent or run all
    let targetSlug: string | null = null;
    try {
      const body = await req.json();
      if (body.agent_slug) targetSlug = body.agent_slug;
    } catch { /* empty body = run all agents */ }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get agents to run
    let agentsQuery = supabase
      .from("agents")
      .select("id, slug, name, role, system_prompt, cycle_hours, model")
      .eq("status", "active");

    if (targetSlug) {
      agentsQuery = agentsQuery.eq("slug", targetSlug);
    } else {
      // Only run agents whose cycle is due (exclude coordinator — has own briefing function)
      agentsQuery = agentsQuery.neq("slug", "coordinator");
    }

    const { data: agents, error: agentsErr } = await agentsQuery;
    if (agentsErr || !agents?.length) {
      return new Response(
        JSON.stringify({ error: "No agents found", detail: agentsErr?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: Array<{
      agent: string;
      success: boolean;
      summary?: string;
      error?: string;
    }> = [];

    // Process each agent
    for (const agent of agents) {
      try {
        // Check if cycle is due (compare last cycle_run event)
        if (!targetSlug) {
          const { data: lastRun } = await supabase
            .from("events")
            .select("created_at")
            .eq("agent_id", agent.id)
            .eq("type", "cycle_run")
            .order("created_at", { ascending: false })
            .limit(1);

          if (lastRun?.[0]) {
            const hoursSince =
              (Date.now() - new Date(lastRun[0].created_at).getTime()) / (1000 * 60 * 60);
            if (hoursSince < (agent.cycle_hours || 2)) {
              results.push({
                agent: agent.slug,
                success: true,
                summary: `Skipped — last run ${hoursSince.toFixed(1)}h ago (cycle: ${agent.cycle_hours}h)`,
              });
              continue;
            }
          }
        }

        // Build context for this agent
        const agentContext = await buildAgentContext(supabase, agent.slug, agent.id);

        // Get cycle instructions
        const cyclePrompt = CYCLE_INSTRUCTIONS[agent.slug];
        if (!cyclePrompt) {
          results.push({
            agent: agent.slug,
            success: false,
            error: "No cycle instructions defined",
          });
          continue;
        }

        // Build system prompt
        const systemPrompt = `${F2F_KNOWLEDGE_BASE}\n\n${cyclePrompt}\n\n${agentContext}`;

        // Get agent's last cycle number
        const { data: lastMem } = await supabase
          .from("agent_memory")
          .select("cycle_number")
          .eq("agent_id", agent.id)
          .order("created_at", { ascending: false })
          .limit(1);

        const cycleNumber = ((lastMem?.[0]?.cycle_number) || 0) + 1;

        // Call Claude API
        const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: agent.model || "claude-sonnet-4-20250514",
            max_tokens: 2048,
            system: systemPrompt,
            messages: [
              {
                role: "user",
                content: `Выполни автономный рабочий цикл #${cycleNumber}. Сейчас ${new Date().toISOString()}. Ответь строго в JSON формате.`,
              },
            ],
          }),
        });

        if (!claudeResponse.ok) {
          const errText = await claudeResponse.text();
          results.push({
            agent: agent.slug,
            success: false,
            error: `Claude API ${claudeResponse.status}: ${errText.slice(0, 200)}`,
          });
          continue;
        }

        const claudeData = await claudeResponse.json();
        const rawText = claudeData.content?.[0]?.text || "{}";

        // Parse JSON response
        let cycleResult: any = {};
        try {
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            cycleResult = JSON.parse(jsonMatch[0]);
          }
        } catch {
          cycleResult = { summary: rawText.slice(0, 500), parse_error: true };
        }

        // ═══ SAVE RESULTS ═══

        // 1. Save to agent_memory (append-only state)
        await supabase.from("agent_memory").insert({
          agent_id: agent.id,
          state: "working",
          last_output: cycleResult.summary || rawText.slice(0, 1000),
          insights: JSON.stringify(cycleResult.insights || cycleResult.recommendations || []),
          next_action: Array.isArray(cycleResult.action_plan)
            ? cycleResult.action_plan[0]
            : cycleResult.followup_actions?.[0]?.action || null,
          tasks_done: (cycleResult.insights?.length || 0) + (cycleResult.recommendations?.length || 0),
          cycle_number: cycleNumber,
          context_json: cycleResult,
        });

        // 2. Save to reports
        await supabase.from("reports").insert({
          agent_id: agent.id,
          type_ab: "daily",
          summary: cycleResult.summary || "Автономный цикл выполнен",
          results: JSON.stringify(cycleResult),
          metrics_json: {
            cycle_number: cycleNumber,
            model: claudeData.model,
            usage: claudeData.usage,
          },
        });

        // 3. Save agent-specific actions
        if (agent.slug === "bizdev" && cycleResult.new_leads_suggested?.length) {
          for (const lead of cycleResult.new_leads_suggested) {
            await supabase.from("actions").insert({
              agent_id: agent.id,
              type: "lead_suggested",
              payload_json: {
                company: lead.company,
                segment: lead.segment,
                reason: lead.reason,
                status: "pending",
                source: "autonomous_cycle",
                cycle: cycleNumber,
              },
            });
          }
        }

        // Lead Finder: insert found leads into partner_pipeline
        if (agent.slug === "lead_finder" && cycleResult.new_leads?.length) {
          for (const lead of cycleResult.new_leads) {
            // Check for duplicate by company_name
            const { data: existing } = await supabase
              .from("partner_pipeline")
              .select("id")
              .ilike("company_name", lead.company_name || "")
              .limit(1);

            if (!existing?.length) {
              // Try to verify/find email via Hunter.io if we have a website
              let verifiedEmail = lead.contact_email || "";
              if (!verifiedEmail && lead.website) {
                try {
                  const domain = new URL(lead.website).hostname.replace("www.", "");
                  const hunterEmails = await verifyEmailWithHunter(domain);
                  if (hunterEmails.length > 0) {
                    // Find best match by name or take first
                    const nameMatch = hunterEmails.find((e: any) =>
                      lead.contact_name && (
                        (e.first_name || "").toLowerCase().includes(lead.contact_name.split(" ")[0]?.toLowerCase() || "") ||
                        (e.last_name || "").toLowerCase().includes(lead.contact_name.split(" ").pop()?.toLowerCase() || "")
                      )
                    );
                    verifiedEmail = nameMatch?.value || hunterEmails[0]?.value || "";
                  }
                } catch (_e) { /* URL parse error, skip */ }
              }

              await supabase.from("partner_pipeline").insert({
                company_name: lead.company_name,
                contact_name: lead.contact_name,
                contact_email: verifiedEmail,
                segment: lead.segment,
                pitch_text: lead.pitch_text,
                stage: "identified",
                notes: `AI Lead Finder | Priority: ${lead.priority || "medium"} | Source: ${lead.source || "ai"} | Cycle #${cycleNumber}${lead.website ? " | " + lead.website : ""}`,
              });
            }
          }
        }

        // Follow-Up: save email templates as actions, update stages
        if (agent.slug === "followup") {
          if (cycleResult.followup_emails?.length) {
            for (const email of cycleResult.followup_emails) {
              await supabase.from("actions").insert({
                agent_id: agent.id,
                type: "followup_email",
                payload_json: {
                  partner: email.partner,
                  contact_name: email.contact_name,
                  contact_email: email.contact_email,
                  subject: email.subject,
                  body: email.body,
                  days_since_contact: email.days_since_contact,
                  status: "pending",
                  source: "autonomous_cycle",
                  cycle: cycleNumber,
                },
              });
            }
          }
          if (cycleResult.stage_changes?.length) {
            for (const sc of cycleResult.stage_changes) {
              await supabase
                .from("partner_pipeline")
                .update({ stage: sc.to_stage })
                .ilike("company_name", sc.partner || "");
            }
          }
        }

        if (agent.slug === "analyst" && cycleResult.competitor_updates?.length) {
          for (const cu of cycleResult.competitor_updates) {
            await supabase.from("competitor_data").insert({
              competitor_name: cu.name,
              data_type: "news",
              data_json: { update: cu.update, source: "autonomous_cycle", cycle: cycleNumber },
              source: "ai_analyst",
            });
          }
        }

        if (agent.slug === "outreach" && cycleResult.email_templates?.length) {
          for (const tpl of cycleResult.email_templates) {
            await supabase.from("actions").insert({
              agent_id: agent.id,
              type: "email_template_created",
              payload_json: {
                subject: tpl.subject,
                body: tpl.body,
                target_segment: tpl.target_segment,
                status: "pending",
                source: "autonomous_cycle",
                cycle: cycleNumber,
              },
            });
          }
        }

        // 4. Log cycle_run event
        await supabase.from("events").insert({
          agent_id: agent.id,
          type: "cycle_run",
          metadata_json: {
            cycle_number: cycleNumber,
            model: claudeData.model,
            usage: claudeData.usage,
            summary: (cycleResult.summary || "").slice(0, 300),
          },
        });

        // 5. Track AI credits
        await supabase.from("ai_credits").insert({
          agent_id: agent.id,
          tokens_input: claudeData.usage?.input_tokens || 0,
          tokens_output: claudeData.usage?.output_tokens || 0,
          cost_usd:
            ((claudeData.usage?.input_tokens || 0) * 0.003 +
              (claudeData.usage?.output_tokens || 0) * 0.015) /
            1000,
          model: claudeData.model,
          task_type: "cycle_run",
        });

        results.push({
          agent: agent.slug,
          success: true,
          summary: (cycleResult.summary || "Цикл выполнен").slice(0, 200),
        });
      } catch (agentErr) {
        results.push({
          agent: agent.slug,
          success: false,
          error: String(agentErr).slice(0, 200),
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        agents_processed: results.length,
        results,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("agent-autonomous-cycle error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
