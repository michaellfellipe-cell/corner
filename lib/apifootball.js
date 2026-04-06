/**
 * lib/apifootball.js — Cliente API-Football v3
 * Cache in-memory (persiste entre requests na mesma instância Vercel)
 *
 * Variável necessária: APIFOOTBALL_KEY no Vercel Environment Variables
 */

const AF_BASE = "https://v3.football.api-sports.io";
const _cache  = new Map();

function cacheGet(k) {
  const v = _cache.get(k);
  if (!v || Date.now() > v.exp) { _cache.delete(k); return null; }
  return v.data;
}
function cacheSet(k, data, ttl) {
  _cache.set(k, { data, exp: Date.now() + ttl });
}

async function afFetch(path, cacheKey, ttlMs = 60000) {
  const apiKey = process.env.APIFOOTBALL_KEY;
  if (!apiKey) return null;

  const ck = cacheKey || path;
  const hit = cacheGet(ck);
  if (hit !== null) return hit;

  try {
    const res = await fetch(`${AF_BASE}${path}`, {
      headers: { "x-apisports-key": apiKey, "Accept": "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.errors && Object.keys(data.errors).length > 0) return null;
    const result = data.response ?? null;
    if (result !== null) cacheSet(ck, result, ttlMs);
    return result;
  } catch {
    return null;
  }
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

/** Todos os jogos ao vivo (atualiza a cada 15s na AF) */
export async function getLiveFixtures() {
  return afFetch("/fixtures?live=all", "af_live_all", 30_000);
}

/** Stats do jogo: shots inside box, DA real, corners, etc */
export async function getFixtureStats(fixtureId) {
  return afFetch(`/fixtures/statistics?fixture=${fixtureId}`, `af_stats_${fixtureId}`, 60_000);
}

/** Eventos: gols, cartões, substituições */
export async function getFixtureEvents(fixtureId) {
  return afFetch(`/fixtures/events?fixture=${fixtureId}`, `af_events_${fixtureId}`, 30_000);
}

/** Escalações (disponível ~30min antes) */
export async function getLineups(fixtureId) {
  return afFetch(`/fixtures/lineups?fixture=${fixtureId}`, `af_lineups_${fixtureId}`, 1_800_000);
}

/** Stats históricas do time: média de corners */
/** Stats históricas do time (médias de gols, forma, etc.) */
export async function getTeamStats(teamId, leagueId, season) {
  return afFetch(
    `/teams/statistics?team=${teamId}&league=${leagueId}&season=${season}`,
    `af_ts_${teamId}_${leagueId}_${season}`,
    3_600_000,
  );
}

/**
 * Busca últimos N jogos finalizados do time e extrai médias REAIS de corners.
 * Estratégia de 2 passos:
 *   1. GET /fixtures?team=X&last=N&status=FT   → IDs dos últimos jogos
 *   2. GET /fixtures/statistics?fixture=ID      → corners de cada jogo (paralelo)
 * Cache 1h para não repetir por jogo.
 */
export async function getTeamCornerHistory(teamId, last = 8) {
  const cacheKey = `af_corner_hist_${teamId}_${last}`;
  const hit = cacheGet(cacheKey);
  if (hit !== null) return hit;

  const apiKey = process.env.APIFOOTBALL_KEY;
  if (!apiKey) return null;

  try {
    // Passo 1 — lista dos últimos jogos finalizados
    const fixturesRes = await afFetch(
      `/fixtures?team=${teamId}&last=${last}&status=FT`,
      null,   // não cacheia individualmente — o resultado final já vai ser cacheado
      0,
    );

    if (!Array.isArray(fixturesRes) || !fixturesRes.length) return null;

    // Passo 2 — stats de cada jogo em paralelo (limitado aos últimos 8 para poupar quota)
    const fixtureIds = fixturesRes.map(f => f.fixture?.id).filter(Boolean).slice(0, last);

    const statsArr = await Promise.all(
      fixtureIds.map(id =>
        afFetch(`/fixtures/statistics?fixture=${id}`, `af_fstats_${id}`, 86_400_000)
          .catch(() => null)
      )
    );

    // Passo 3 — extrai corners de cada jogo para o time especificado
    const cornerTotals = [];
    for (let i = 0; i < fixtureIds.length; i++) {
      const stats = statsArr[i];
      const fixture = fixturesRes[i];
      if (!stats || !Array.isArray(stats)) continue;

      // Descobre se o time era home ou away neste jogo
      const isHome = fixture.teams?.home?.id === teamId;
      const teamStats = stats[isHome ? 0 : 1];
      if (!teamStats?.statistics) continue;

      const cornersEntry = teamStats.statistics.find(s => s.type === "Corner Kicks");
      const corners = parseInt(cornersEntry?.value ?? "0") || 0;
      cornerTotals.push(corners);
    }

    if (!cornerTotals.length) {
      cacheSet(cacheKey, null, 3_600_000);
      return null;
    }

    const avg = cornerTotals.reduce((s, v) => s + v, 0) / cornerTotals.length;
    const result = {
      teamId,
      avg:    +avg.toFixed(2),
      games:  cornerTotals.length,
      totals: cornerTotals,
      min:    Math.min(...cornerTotals),
      max:    Math.max(...cornerTotals),
      // Variância baixa = mais previsível
      variance: +(cornerTotals.reduce((s,v) => s + Math.pow(v - avg, 2), 0) / cornerTotals.length).toFixed(2),
    };

    cacheSet(cacheKey, result, 3_600_000);
    return result;
  } catch {
    return null;
  }
}

/** Busca team ID por nome */
export async function searchTeam(name) {
  const encoded = encodeURIComponent(name.slice(0, 30));
  return afFetch(`/teams?search=${encoded}`, `af_team_${encoded}`, 86_400_000);
}

/** H2H últimos 10 jogos */
export async function getH2H(t1Id, t2Id) {
  const key = [t1Id, t2Id].sort().join("-");
  return afFetch(
    `/fixtures/headtohead?h2h=${t1Id}-${t2Id}&last=10`,
    `af_h2h_${key}`,
    3_600_000,
  );
}

/** Odds ao vivo (corners) */
export async function getLiveOdds(fixtureId) {
  return afFetch(`/odds/live?fixture=${fixtureId}`, `af_odds_${fixtureId}`, 30_000);
}

/** Lesões do jogo */
export async function getInjuries(fixtureId) {
  return afFetch(`/injuries?fixture=${fixtureId}`, `af_inj_${fixtureId}`, 3_600_000);
}

// ── Parsers ───────────────────────────────────────────────────────────────────

/** Normaliza nome de time para matching */
export function normName(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|cf|sc|ac|afc|bfc|sfc|rc|rcd|sd|ud|cd|if|sk|bk|fk|atletico|athletic|sporting)\b/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tenta casar um jogo ESPN com um fixture da AF */
export function matchAFFixture(afFixtures, espnHome, espnAway) {
  if (!afFixtures?.length) return null;
  const nh = normName(espnHome), na = normName(espnAway);

  let best = null, bScore = 0;
  for (const fix of afFixtures) {
    const fh = normName(fix.teams?.home?.name);
    const fa = normName(fix.teams?.away?.name);

    const scoreH = fh === nh || fh.includes(nh) || nh.includes(fh) ? 1
      : nh.split(" ").filter(w => w.length > 3 && fh.includes(w)).length / (nh.split(" ").length || 1);
    const scoreA = fa === na || fa.includes(na) || na.includes(fa) ? 1
      : na.split(" ").filter(w => w.length > 3 && fa.includes(w)).length / (na.split(" ").length || 1);

    const score = (scoreH + scoreA) / 2;
    if (score > bScore && score >= 0.45) { bScore = score; best = fix; }
  }
  return best;
}

/** Converte response de statistics → objeto com campos nomeados */
export function parseStats(statsRes) {
  if (!Array.isArray(statsRes) || !statsRes.length) return { home: {}, away: {} };
  const out = { home: {}, away: {} };

  statsRes.forEach((teamData, idx) => {
    const side = idx === 0 ? "home" : "away";
    for (const s of (teamData.statistics || [])) {
      const v = s.value;
      if (v === null || v === undefined) continue;
      const n = parseInt(v) || 0;
      switch (s.type) {
        case "Shots on Goal":     out[side].shotsOnTarget    = n; break;
        case "Total Shots":       out[side].totalShots       = n; break;
        case "Blocked Shots":     out[side].blockedShots     = n; break;
        case "Shots insidebox":   out[side].shotsInsideBox   = n; break;
        case "Shots outsidebox":  out[side].shotsOutsideBox  = n; break;
        case "Corner Kicks":      out[side].corners          = n; break;
        case "Ball Possession":   out[side].possession       = parseInt(v) || 50; break;
        case "Dangerous Attacks": out[side].dangerousAttacks = n; break;
        case "Attacks":           out[side].attacks          = n; break;
        case "Fouls":             out[side].fouls            = n; break;
        case "Yellow Cards":      out[side].yellowCards      = n; break;
        case "Red Cards":         out[side].redCards         = n; break;
        case "Saves":             out[side].saves            = n; break;
        case "Total passes":      out[side].passes           = n; break;
        case "Passes accurate":   out[side].accuratePasses   = n; break;
        case "Offsides":          out[side].offsides         = n; break;
      }
    }
  });
  return out;
}

/** Extrai substituições dos eventos */
export function parseSubstitutions(eventsRes) {
  if (!Array.isArray(eventsRes)) return [];
  return eventsRes
    .filter(e => e.type === "subst")
    .map(e => ({
      minute:    e.time?.elapsed || 0,
      extra:     e.time?.extra   || 0,
      teamName:  e.team?.name    || "",
      teamId:    e.team?.id      || 0,
      playerIn:  e.player?.name  || "",
      playerOut: e.assist?.name  || "",
    }));
}

/**
 * Parseia o resultado de getTeamCornerHistory para o formato esperado pelo games.js
 * Retorna médias separadas home/away estimando que 55% dos corners são em casa
 */
export function parseCornersAvg(cornerHistResult, isHomeTeam = true) {
  if (!cornerHistResult?.avg) return null;

  const avg = cornerHistResult.avg;
  // Empiricamente: times marcam ~10-15% mais corners em casa
  const homeBonus = 0.12;

  return {
    forHome:     isHomeTeam ? +(avg * (1 + homeBonus)).toFixed(2) : +(avg * (1 - homeBonus * 0.5)).toFixed(2),
    forAway:     isHomeTeam ? +(avg * (1 - homeBonus * 0.5)).toFixed(2) : +(avg * (1 + homeBonus)).toFixed(2),
    againstHome: 0,
    againstAway: 0,
    form:        "",
    teamId:      cornerHistResult.teamId,
    avg:         avg,
    games:       cornerHistResult.games,
    variance:    cornerHistResult.variance,
    min:         cornerHistResult.min,
    max:         cornerHistResult.max,
  };
}

/** Extrai média de corners dos últimos 10 jogos H2H */
export function parseH2HCorners(h2hRes) {
  if (!Array.isArray(h2hRes) || !h2hRes.length) return null;
  // H2H retorna fixtures. Corners ficam em statistics, não no objeto base.
  // Usamos o total de gols como proxy para "jogo aberto" = +corners
  const valid = h2hRes.slice(0, 10);
  const avgGoals = valid.reduce((s, f) =>
    s + (f.goals?.home || 0) + (f.goals?.away || 0), 0
  ) / valid.length;
  // Empiricamente: ~4.8 corners por gol em jogos de médio/alto nível
  return {
    avgGoals:    +avgGoals.toFixed(2),
    estimatedCorners: +(avgGoals * 4.8).toFixed(1),
    games:       valid.length,
  };
}

/** Extrai formação das escalações */
export function parseFormations(lineupsRes) {
  if (!Array.isArray(lineupsRes) || !lineupsRes.length) return null;
  const out = {};
  lineupsRes.forEach((t, i) => {
    out[i === 0 ? "home" : "away"] = {
      formation: t.formation || null,
      teamId:    t.team?.id  || null,
      teamName:  t.team?.name || "",
    };
  });
  return out;
}

/** Extrai odds de corners ao vivo */
export function parseLiveCornerOdds(oddsRes) {
  if (!Array.isArray(oddsRes) || !oddsRes.length) return null;
  for (const fix of oddsRes) {
    for (const bk of (fix.bookmakers || [])) {
      for (const bet of (bk.bets || [])) {
        const bn = (bet.name || "").toLowerCase();
        if (bn.includes("corner") && (bn.includes("0.5") || bn.includes("over/under"))) {
          const over = (bet.values || []).find(v => (v.value || "").toLowerCase().includes("over"));
          if (over) return { betName: bet.name, overOdd: parseFloat(over.odd), bookmaker: bk.name };
        }
      }
    }
  }
  return null;
}

/** Classifica ofensividade de uma formação — considera meias ofensivos */
export function formationAttackScore(formation) {
  if (!formation) return 0;
  const parts = formation.split("-").map(Number);
  if (parts.length < 3) return 0;

  // Último bloco = atacantes declarados
  const strikers = parts[parts.length - 1];
  // Penúltimo bloco = meias (pode incluir meias ofensivos / extremos)
  const mids     = parts[parts.length - 2];
  // Antepenúltimo = volantes/zagueiros centrais
  const defense  = parts[0];

  // Formações claramente ofensivas:
  // 4-3-3, 3-4-3 → 3 atacantes
  if (strikers >= 3)              return 2;
  // 4-2-3-1, 4-1-4-1, 3-4-2-1 → 3 meias ofensivos + 1 atacante
  if (strikers === 1 && mids >= 3) return 1;
  // 4-4-2, 3-5-2 → 2 atacantes equilibrado
  if (strikers === 2)              return 1;
  // 5-4-1, 4-5-1 → defensivo (só 1 atacante, linha de 4-5 na defesa)
  if (strikers === 1 && (mids >= 4 || defense >= 5)) return -1;
  return 0;
}

/** Detecta substituições ofensivas recentes */
export function detectOffensiveSubs(substitutions, game, currentMinute) {
  if (!substitutions?.length) return { home: 0, away: 0 };
  const diff = game.score.home - game.score.away;
  const result = { home: 0, away: 0 };

  for (const sub of substitutions) {
    if (sub.minute < 55 || sub.minute > currentMinute) continue;

    // Identifica o lado pelo nome do time
    const hn = normName(game.home);
    const an = normName(game.away);
    const sn = normName(sub.teamName);

    let side = null;
    if (sn === hn || hn.includes(sn) || sn.includes(hn)) side = "home";
    else if (sn === an || an.includes(sn) || sn.includes(an)) side = "away";
    if (!side) continue;

    // Time está perdendo OU empate após 70' → sub = ofensiva
    const isLosing = (side === "home" && diff < 0) || (side === "away" && diff > 0);
    const lateTie  = diff === 0 && currentMinute >= 65;
    if (isLosing || lateTie) result[side]++;
  }
  return result;
}
