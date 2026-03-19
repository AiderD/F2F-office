// ═══ F2F Office Character Engine v11 ═══
// Features: Walking animation, waypoint pathfinding, boss office, click cards
// Sprites: 32x32 sit (custom), 16x16 run/idle (LimeZu Modern Interiors)

const FRAME_W = 32, FRAME_H = 64;           // 32x32 sit sprites (32w × 64h frames)
const RUN_FW = 16, RUN_FH = 32, RUN_SC = 2; // 16x16 run/idle sprites, draw at 2×

// ─── SPRITE LOADER ───
const charImages = {};
function loadCharSprite(name) {
  if (charImages[name]) return charImages[name];
  const img = new Image();
  img.src = 'chars/' + name + '.png';
  charImages[name] = img;
  return img;
}

// Load sit sprites (32x32 custom Character Generator)
['coord_sit', 'morning_sit', 'analyst_sit', 'smm_sit', 'community_sit',
 'bizdev_sit', 'outreach_sit', 'leadfind_sit', 'followup_sit',
 'processor_sit', 'watchdog_sit', 'kpi_sit', 'outreach_idle'
].forEach(n => loadCharSprite(n + '_32x32'));

// Load run sprites (16x16 LimeZu) — 384×32, 24 frames = 4 dirs × 6
['Adam_run', 'Alex_run', 'Amelia_run', 'Bob_run'].forEach(n => loadCharSprite(n + '_16x16'));
// Load idle sprites (16x16) — 64×32, 4 frames = 4 dirs × 1
['Adam_idle', 'Alex_idle', 'Amelia_idle', 'Bob_idle'].forEach(n => loadCharSprite(n + '_16x16'));
// Load idle_anim sprites (16x16) — 384×32, 24 frames = 4 dirs × 6
['Adam_idle_anim', 'Alex_idle_anim', 'Amelia_idle_anim', 'Bob_idle_anim'].forEach(n => loadCharSprite(n + '_16x16'));

// Agent → base LimeZu character name
const AGENT_BASE = {
  coordinator:'Adam', briefing:'Amelia', market:'Alex', content:'Bob',
  social:'Amelia', leads:'Adam', outreach:'Alex', lead_finder:'Bob',
  followup:'Amelia', processor:'Adam', watchdog:'Alex', kpi_updater:'Bob'
};

// ─── DRAWING HELPERS ───

// Draw 32x32 sit sprite (native 32×64, anchor = center-bottom)
function drawSitFrame(ctx, spriteName, frameIdx, x, y) {
  const img = charImages[spriteName];
  if (!img || !img.complete || img.width === 0) return;
  const total = Math.floor(img.width / FRAME_W);
  const idx = Math.min(Math.max(0, frameIdx), total - 1);
  const sh = Math.min(FRAME_H, img.height);
  ctx.drawImage(img,
    idx * FRAME_W, 0, FRAME_W, sh,
    Math.round(x - FRAME_W / 2), Math.round(y - 48),
    FRAME_W, sh
  );
}

// Draw 16x16 run sprite at 2× (directions: 0=DOWN, 1=UP, 2=LEFT, 3=RIGHT, 6 frames each)
function drawRunFrame(ctx, charName, dir, frame, x, y) {
  const img = charImages[charName + '_run_16x16'];
  if (!img || !img.complete || img.width === 0) return;
  const fpd = 6; // frames per direction
  const srcIdx = Math.min(dir * fpd + (frame % fpd), Math.floor(img.width / RUN_FW) - 1);
  ctx.drawImage(img,
    srcIdx * RUN_FW, 0, RUN_FW, RUN_FH,
    Math.round(x - RUN_FW * RUN_SC / 2), Math.round(y - RUN_FH * RUN_SC + 8),
    RUN_FW * RUN_SC, RUN_FH * RUN_SC
  );
}

// Draw 16x16 idle_anim sprite at 2× (standing animated, same layout as run)
function drawIdleAnimFrame(ctx, charName, dir, frame, x, y) {
  const img = charImages[charName + '_idle_anim_16x16'];
  if (!img || !img.complete || img.width === 0) {
    // Fallback to static idle
    return drawIdleFrame(ctx, charName, dir, x, y);
  }
  const fpd = 6;
  const srcIdx = Math.min(dir * fpd + (frame % fpd), Math.floor(img.width / RUN_FW) - 1);
  ctx.drawImage(img,
    srcIdx * RUN_FW, 0, RUN_FW, RUN_FH,
    Math.round(x - RUN_FW * RUN_SC / 2), Math.round(y - RUN_FH * RUN_SC + 8),
    RUN_FW * RUN_SC, RUN_FH * RUN_SC
  );
}

// Draw 16x16 static idle (1 frame per direction)
function drawIdleFrame(ctx, charName, dir, x, y) {
  const img = charImages[charName + '_idle_16x16'];
  if (!img || !img.complete || img.width === 0) return;
  const srcIdx = Math.min(dir, Math.floor(img.width / RUN_FW) - 1);
  ctx.drawImage(img,
    srcIdx * RUN_FW, 0, RUN_FW, RUN_FH,
    Math.round(x - RUN_FW * RUN_SC / 2), Math.round(y - RUN_FH * RUN_SC + 8),
    RUN_FW * RUN_SC, RUN_FH * RUN_SC
  );
}

// ─── WAYPOINT GRAPH ───
// Pixel coordinates for key navigation points in the 512×544 office
const WP = {
  // ── Top corridor (between desk rows, y≈215) ──
  c0: {x:50, y:215},  c1: {x:100,y:215}, c2: {x:160,y:215}, c3: {x:200,y:215},
  c4: {x:260,y:215}, c5: {x:300,y:215}, c6: {x:365,y:215}, c7: {x:410,y:215},
  c8: {x:470,y:215},

  // ── Vertical passage to bottom floor ──
  pass_top: {x:175, y:280},
  pass_mid: {x:175, y:310},
  pass_bot: {x:175, y:345},

  // ── Bottom floor hallway ──
  hall_l: {x:80,  y:380},
  hall_cl:{x:175, y:380},
  hall_c: {x:260, y:380},
  hall_cr:{x:340, y:380},
  hall_r: {x:430, y:380},

  // ── Break spots ──
  cooler:  {x:240, y:405},   // water cooler
  coffee:  {x:215, y:445},   // coffee machine
  plants:  {x:285, y:435},   // lounge plant area
  sofa:    {x:340, y:440},   // sofa area
  vending: {x:430, y:420},   // right side

  // ── Boss office ──
  boss_entry: {x:80, y:380},
  boss_chair: {x:90, y:430},
};

// Edges (bidirectional)
const WP_EDGES = [
  // Top corridor chain
  ['c0','c1'],['c1','c2'],['c2','c3'],['c3','c4'],['c4','c5'],['c5','c6'],['c6','c7'],['c7','c8'],
  // Corridor → passage
  ['c2','pass_top'],['c3','pass_top'],
  ['pass_top','pass_mid'],['pass_mid','pass_bot'],
  // Passage → bottom hall
  ['pass_bot','hall_cl'],
  // Bottom hall chain
  ['hall_l','hall_cl'],['hall_cl','hall_c'],['hall_c','hall_cr'],['hall_cr','hall_r'],
  // Hall → break spots
  ['hall_c','cooler'],['cooler','coffee'],['cooler','plants'],
  ['hall_cr','sofa'],['hall_cr','plants'],
  ['hall_r','vending'],
  // Boss office
  ['hall_l','boss_entry'],['boss_entry','boss_chair'],
];

// Build adjacency list
const wpAdj = {};
Object.keys(WP).forEach(k => wpAdj[k] = []);
WP_EDGES.forEach(([a, b]) => { wpAdj[a].push(b); wpAdj[b].push(a); });

// BFS shortest path
function wpPath(from, to) {
  if (from === to) return [from];
  const visited = new Set([from]);
  const queue = [[from]];
  while (queue.length) {
    const path = queue.shift();
    const node = path[path.length - 1];
    for (const nb of (wpAdj[node] || [])) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      const np = [...path, nb];
      if (nb === to) return np;
      queue.push(np);
    }
  }
  return null;
}

// Find nearest corridor waypoint to an X position
function nearestCorridorWP(seatX) {
  let best = 'c3', bestD = Infinity;
  for (const k of Object.keys(WP)) {
    if (!k.startsWith('c') || k.includes('_') || k.length > 2) continue;
    const d = Math.abs(WP[k].x - seatX);
    if (d < bestD) { best = k; bestD = d; }
  }
  return best;
}

// ─── AGENT STATE MACHINE ───
const ST = { SIT:'sit', WALK:'walk', BREAK:'break' };
const BREAK_SPOTS = ['cooler','coffee','plants','sofa','vending'];

class OfficeAgent {
  constructor(id, name, color, sprite, x, y, frame, opts) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.sprite = sprite;
    this.seatX = x; this.seatY = y;
    this.seatFrame = frame;
    this.x = x; this.y = y;
    this.frame = frame;
    this.baseChar = AGENT_BASE[id] || 'Adam';

    // State
    this.state = ST.SIT;
    this.canBreak = !(opts && opts.noBreak); // coordinator & outreach don't break

    // Walk
    this.path = [];        // [{x,y}, ...] pixel waypoints
    this.pathIdx = 0;
    this.pathProg = 0;     // 0→1 along current segment
    this.walkDir = 0;      // 0=DOWN 1=UP 2=LEFT 3=RIGHT (for 16x16 sprites)
    this.walkFrame = 0;
    this.walkSpeed = 1.0 + Math.random() * 0.4;
    this._returning = false;
    this._breakWP = null;

    // Break timer
    this.nextBreak = Date.now() + 25000 + Math.random() * 55000;
    this.breakEnd = 0;
    this.idleFrame = 0;

    // Visual
    this.selected = false;
    this.hovered = false;
    this._glowPhase = Math.random() * Math.PI * 2;
  }

  // ── Start walking to break ──
  goBreak() {
    const corridorWP = nearestCorridorWP(this.seatX);
    const spot = BREAK_SPOTS[Math.floor(Math.random() * BREAK_SPOTS.length)];
    const route = wpPath(corridorWP, spot);
    if (!route || route.length < 2) return;

    this.path = [
      {x: this.seatX, y: this.seatY},
      WP[corridorWP],
      ...route.slice(1).map(k => WP[k])
    ];
    this.pathIdx = 0;
    this.pathProg = 0;
    this.walkFrame = 0;
    this.state = ST.WALK;
    this._returning = false;
    this._breakWP = spot;
  }

  // ── Return to seat ──
  goBack() {
    const spot = this._breakWP || 'cooler';
    const corridorWP = nearestCorridorWP(this.seatX);
    const route = wpPath(spot, corridorWP);
    if (!route || route.length < 2) {
      this.state = ST.SIT; this.x = this.seatX; this.y = this.seatY;
      return;
    }
    this.path = [
      WP[spot],
      ...route.slice(1).map(k => WP[k]),
      {x: this.seatX, y: this.seatY}
    ];
    this.pathIdx = 0;
    this.pathProg = 0;
    this.walkFrame = 0;
    this.state = ST.WALK;
    this._returning = true;
  }

  // ── Update tick (called every frame) ──
  update() {
    const now = Date.now();

    if (this.state === ST.SIT) {
      if (this.canBreak && now >= this.nextBreak) this.goBreak();
      return;
    }

    if (this.state === ST.BREAK) {
      this.idleFrame = (this.idleFrame + 0.06) % 6;
      if (now >= this.breakEnd) this.goBack();
      return;
    }

    // ST.WALK
    if (this.pathIdx >= this.path.length - 1) {
      // Arrived
      if (this._returning) {
        this.state = ST.SIT;
        this.x = this.seatX; this.y = this.seatY;
        this._returning = false;
        this.nextBreak = now + 30000 + Math.random() * 60000;
      } else {
        this.state = ST.BREAK;
        this.breakEnd = now + 5000 + Math.random() * 10000;
        this.idleFrame = 0;
      }
      return;
    }

    const from = this.path[this.pathIdx];
    const to = this.path[this.pathIdx + 1];
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) { this.pathIdx++; return; }

    this.pathProg += this.walkSpeed / len;
    if (this.pathProg >= 1) {
      this.pathProg = 0;
      this.pathIdx++;
      this.x = to.x; this.y = to.y;
    } else {
      this.x = from.x + dx * this.pathProg;
      this.y = from.y + dy * this.pathProg;
    }

    // Direction for sprite (16x16: 0=DOWN, 1=UP, 2=LEFT, 3=RIGHT)
    if (Math.abs(dx) > Math.abs(dy)) {
      this.walkDir = dx > 0 ? 3 : 2;
    } else {
      this.walkDir = dy > 0 ? 0 : 1;
    }
    this.walkFrame = (this.walkFrame + 0.18) % 6;
  }

  // ── Draw ──
  draw(ctx) {
    ctx.imageSmoothingEnabled = false;

    // Sprite
    if (this.state === ST.SIT) {
      drawSitFrame(ctx, this.sprite, this.frame, this.x, this.y);
    } else if (this.state === ST.WALK) {
      drawRunFrame(ctx, this.baseChar, this.walkDir, Math.floor(this.walkFrame), this.x, this.y);
    } else if (this.state === ST.BREAK) {
      drawIdleAnimFrame(ctx, this.baseChar, 0, Math.floor(this.idleFrame), this.x, this.y);
    }

    // Name label pill
    this._drawLabel(ctx);

    // Selection glow
    if (this.selected) {
      this._glowPhase += 0.04;
      const glow = 6 + Math.sin(this._glowPhase) * 3;
      ctx.save();
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 2;
      ctx.shadowColor = this.color;
      ctx.shadowBlur = glow;
      ctx.beginPath();
      ctx.ellipse(Math.round(this.x), Math.round(this.y - 20), 18, 30, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Hover ring
    if (this.hovered && !this.selected) {
      ctx.save();
      ctx.strokeStyle = '#ffffff55';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.ellipse(Math.round(this.x), Math.round(this.y - 20), 16, 26, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  _drawLabel(ctx) {
    const name = this.name;
    ctx.font = 'bold 7px system-ui';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(name).width;
    const lx = this.x, ly = this.y + 4;
    const px = Math.round(lx - tw / 2 - 3), py = Math.round(ly);
    const w = tw + 6, h = 11, r = 3;

    // Pill
    ctx.fillStyle = this.color + 'dd';
    ctx.beginPath();
    ctx.moveTo(px+r,py); ctx.lineTo(px+w-r,py);
    ctx.arcTo(px+w,py,px+w,py+r,r); ctx.lineTo(px+w,py+h-r);
    ctx.arcTo(px+w,py+h,px+w-r,py+h,r); ctx.lineTo(px+r,py+h);
    ctx.arcTo(px,py+h,px,py+h-r,r); ctx.lineTo(px,py+r);
    ctx.arcTo(px,py,px+r,py,r);
    ctx.fill();

    // Text
    ctx.fillStyle = '#000';
    ctx.fillText(name, Math.round(lx), Math.round(ly + 8));

    // Status dot
    const dc = this.state === ST.SIT ? '#00ff88' :
               this.state === ST.WALK ? '#ffb800' : '#00e5ff';
    ctx.beginPath();
    ctx.arc(Math.round(lx + tw/2 + 5), Math.round(ly + 5), 2, 0, Math.PI * 2);
    ctx.fillStyle = dc; ctx.fill();
  }

  // Hit test (click/hover detection)
  hitTest(px, py) {
    return Math.hypot(px - this.x, py - (this.y - 20)) < 28;
  }
}

// ─── CREATE AGENTS ───
// Positions matched to chairs in Office_Design_2.png (512×544)
const officeAgents = [
  // ═══ TOP ROW — face viewer (frame 6 = FRONT in 32x32 sprites) ═══
  new OfficeAgent('briefing',    'Morning',    '#ffb800', 'morning_sit_32x32',   100, 178, 6),
  new OfficeAgent('market',      'Analyst',    '#00e5ff', 'analyst_sit_32x32',   200, 178, 6),
  new OfficeAgent('content',     'SMM',        '#ff2d78', 'smm_sit_32x32',       300, 178, 6),
  new OfficeAgent('social',      'Community',  '#ff2d78', 'community_sit_32x32', 400, 178, 6),

  // ═══ BOTTOM CUBICLE ROW — back to viewer (frame 0 = BACK) ═══
  new OfficeAgent('leads',       'BizDev',     '#00ff88', 'bizdev_sit_32x32',    100, 268, 0),
  new OfficeAgent('lead_finder', 'LeadFind',   '#00ff88', 'leadfind_sit_32x32',  200, 268, 0),
  new OfficeAgent('followup',    'Follow-Up',  '#00ff88', 'followup_sit_32x32',  260, 276, 0),
  new OfficeAgent('processor',   'Processor',  '#a78bfa', 'processor_sit_32x32', 300, 276, 0),
  new OfficeAgent('watchdog',    'Watchdog',   '#a78bfa', 'watchdog_sit_32x32',  365, 276, 0),

  // ═══ KPI — right side view (frame 3) ═══
  new OfficeAgent('kpi_updater', 'KPI',        '#a78bfa', 'kpi_sit_32x32',       410, 276, 3),

  // ═══ OUTREACH — standing at printer (no breaks) ═══
  new OfficeAgent('outreach',    'Outreach',   '#00ff88', 'outreach_idle_32x32', 470, 170, 6, {noBreak:true}),

  // ═══ BOSS OFFICE — Coordinator (no breaks, stays in office) ═══
  new OfficeAgent('coordinator', 'Coordinator','#ffb800', 'coord_sit_32x32',     90, 430, 9, {noBreak:true}),
];

// ─── MAIN DRAW LOOP ───
function drawOfficeAgents(ctx) {
  ctx.imageSmoothingEnabled = false;
  // Y-sort for depth
  const sorted = [...officeAgents].sort((a, b) => a.y - b.y);
  sorted.forEach(a => { a.update(); a.draw(ctx); });
}

// ─── CLICK / HOVER API ───
let _selectedAgent = null;
let _hoveredAgent = null;

function officeHitTest(imgX, imgY) {
  let best = null, bestD = 28;
  officeAgents.forEach(a => {
    if (a.hitTest(imgX, imgY)) {
      const d = Math.hypot(imgX - a.x, imgY - (a.y - 20));
      if (d < bestD) { best = a; bestD = d; }
    }
  });
  return best;
}

function officeSelectAgent(agent) {
  if (_selectedAgent) _selectedAgent.selected = false;
  _selectedAgent = agent;
  if (agent) agent.selected = true;
}

function officeHoverUpdate(imgX, imgY) {
  if (_hoveredAgent) _hoveredAgent.hovered = false;
  _hoveredAgent = officeHitTest(imgX, imgY);
  if (_hoveredAgent) _hoveredAgent.hovered = true;
  return _hoveredAgent;
}

// ─── FLOATING CARD (positioned in screen space) ───
// Creates/shows a mini info card near the agent
function showAgentCard(agent, screenX, screenY, wrapRect) {
  let card = document.getElementById('agentFloatCard');
  if (!card) {
    card = document.createElement('div');
    card.id = 'agentFloatCard';
    card.style.cssText = 'position:absolute;z-index:50;pointer-events:auto;' +
      'background:linear-gradient(145deg,#0f1923,#0a1420);border:1px solid #1a2d3d;' +
      'border-radius:12px;padding:14px 16px;min-width:220px;max-width:280px;' +
      'box-shadow:0 8px 32px rgba(0,0,0,0.6);opacity:0;transition:opacity .2s,transform .2s;' +
      'transform:translateY(8px);font-family:system-ui,sans-serif';
    document.getElementById('officeCanvasWrap').appendChild(card);
  }

  // State info
  const stateLabel = agent.state === ST.SIT ? '💻 Работает' :
                     agent.state === ST.WALK ? '🚶 Идёт на перерыв' : '☕ На перерыве';
  const stateColor = agent.state === ST.SIT ? '#00ff88' :
                     agent.state === ST.WALK ? '#ffb800' : '#00e5ff';

  // Supabase live info
  let liveHtml = '';
  const sbSlug = window.DASH_TO_SB_SLUG ? window.DASH_TO_SB_SLUG[agent.id] : null;
  const sbMem = window._sbMemory ? window._sbMemory.find(m => m.slug === sbSlug || m.dashId === agent.id) : null;
  if (sbMem && window.SUPABASE_LIVE) {
    if (sbMem.last_output) {
      liveHtml += '<div style="font-size:11px;color:#cbd5e1;margin-top:8px;line-height:1.4">' +
        '<span style="color:#00e5ff">📡</span> ' + sbMem.last_output.slice(0, 100) +
        (sbMem.last_output.length > 100 ? '...' : '') + '</div>';
    }
    if (sbMem.next_action) {
      liveHtml += '<div style="font-size:10px;color:#64748b;margin-top:4px">' +
        '→ ' + sbMem.next_action.slice(0, 80) + '</div>';
    }
  }

  card.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
      '<div style="width:36px;height:36px;border-radius:50%;background:' + agent.color + '22;' +
        'border:2px solid ' + agent.color + ';display:flex;align-items:center;justify-content:center;font-size:18px">' +
        (window.AGENTS && window.AGENTS[agent.id] ? window.AGENTS[agent.id].emoji : '🤖') +
      '</div>' +
      '<div>' +
        '<div style="font-size:14px;font-weight:700;color:#e2e8f0">' + agent.name + '</div>' +
        '<div style="font-size:10px;color:' + stateColor + ';font-weight:600">' + stateLabel + '</div>' +
      '</div>' +
      '<div style="margin-left:auto">' +
        '<div style="width:8px;height:8px;border-radius:50%;background:' + stateColor +
          ';box-shadow:0 0 6px ' + stateColor + '"></div>' +
      '</div>' +
    '</div>' +
    liveHtml +
    '<div style="display:flex;gap:6px;margin-top:10px">' +
      '<button onclick="if(typeof showAgentDetail===\'function\')showAgentDetail(\'' + agent.id + '\')" ' +
        'style="flex:1;padding:6px;border-radius:6px;border:1px solid #1a2d3d;background:#0a111899;' +
        'color:#00e5ff;font-size:11px;cursor:pointer;font-weight:600;transition:all .15s"' +
        ' onmouseover="this.style.borderColor=\'#00e5ff\';this.style.background=\'#00e5ff11\'"' +
        ' onmouseout="this.style.borderColor=\'#1a2d3d\';this.style.background=\'#0a111899\'">' +
        '📋 Подробнее</button>' +
      '<button onclick="if(typeof agentQuickAction===\'function\')agentQuickAction(\'' + agent.id + '\',\'status\')" ' +
        'style="flex:1;padding:6px;border-radius:6px;border:1px solid #1a2d3d;background:#0a111899;' +
        'color:#00ff88;font-size:11px;cursor:pointer;font-weight:600;transition:all .15s"' +
        ' onmouseover="this.style.borderColor=\'#00ff88\';this.style.background=\'#00ff8811\'"' +
        ' onmouseout="this.style.borderColor=\'#1a2d3d\';this.style.background=\'#0a111899\'">' +
        '💬 Статус</button>' +
    '</div>';

  // Border color matches agent
  card.style.borderColor = agent.color + '66';
  card.style.borderTopColor = agent.color;

  // Position card near agent (in wrap-relative coords)
  // screenX/screenY are relative to the wrap div
  const cw = 260;
  let cx = screenX - cw / 2;
  let cy = screenY - 180; // above the agent
  // Clamp to wrap bounds
  if (wrapRect) {
    if (cx < 8) cx = 8;
    if (cx + cw > wrapRect.width - 8) cx = wrapRect.width - cw - 8;
    if (cy < 8) cy = screenY + 40; // flip below if no room above
  }
  card.style.left = cx + 'px';
  card.style.top = cy + 'px';

  // Animate in
  requestAnimationFrame(() => {
    card.style.opacity = '1';
    card.style.transform = 'translateY(0)';
  });
}

function hideAgentCard() {
  const card = document.getElementById('agentFloatCard');
  if (card) {
    card.style.opacity = '0';
    card.style.transform = 'translateY(8px)';
  }
}

// ─── EXPORTS ───
window.officeAgents = officeAgents;
window.drawOfficeAgents = drawOfficeAgents;
window.officeHitTest = officeHitTest;
window.officeSelectAgent = officeSelectAgent;
window.officeHoverUpdate = officeHoverUpdate;
window.showAgentCard = showAgentCard;
window.hideAgentCard = hideAgentCard;

console.log('Office Chars v11: Walking + Boss Office + Click Cards — ' + officeAgents.length + ' agents loaded');
