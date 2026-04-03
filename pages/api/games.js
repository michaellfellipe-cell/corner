/**
 * /pages/api/games.js — ESPN API com stats corretas do summary endpoint
 * Nomes reais das stats ESPN (descobertos via debug):
 *   wonCorners, possessionPct, totalShots, shotsOnTarget,
 *   foulsCommitted, yellowCards, redCards, saves, offsides,
 *   blockedShots, totalPasses, accuratePasses, totalCrosses
 */

const LEAGUES = [
  { id: "eng.1",              name: "Premier League",       country: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "esp.1",              name: "La Liga",              country: "🇪🇸" },
  { id: "ger.1",              name: "Bundesliga",           country: "🇩🇪" },
  { id: "ita.1",              name: "Serie A",              country: "🇮🇹" },
  { id: "fra.1",              name: "Ligue 1",              country: "🇫🇷" },
  { id: "eng.2",              name: "Championship",         country: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "eng.3",              name: "League One",           country: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "esp.2",              name: "La Liga 2",            country: "🇪🇸" },
  { id: "ger.2",              name: "2. Bundesliga",        country: "🇩🇪" },
  { id: "ita.2",              name: "Serie B",              country: "🇮🇹" },
  { id: "fra.2",              name: "Ligue 2",              country: "🇫🇷" },
  { id: "por.1",              name: "Primeira Liga",        country: "🇵🇹" },
  { id: "ned.1",              name: "Eredivisie",           country: "🇳🇱" },
  { id: "bel.1",              name: "Pro League",           country: "🇧🇪" },
  { id: "tur.1",              name: "Süper Lig",            country: "🇹🇷" },
  { id: "sco.1",              name: "Scottish Prem",        country: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" },
  { id: "gre.1",              name: "Super League GR",      country: "🇬🇷" },
  { id: "aut.1",              name: "Bundesliga AT",        country: "🇦🇹" },
  { id: "sui.1",              name: "Super League CH",      country: "🇨🇭" },
  { id: "den.1",              name: "Superliga DK",         country: "🇩🇰" },
  { id: "swe.1",              name: "Allsvenskan",          country: "🇸🇪" },
  { id: "nor.1",              name: "Eliteserien",          country: "🇳🇴" },
  { id: "pol.1",              name: "Ekstraklasa",          country: "🇵🇱" },
  { id: "rou.1",              name: "Liga I",               country: "🇷🇴" },
  { id: "rus.1",              name: "Premier League RU",    country: "🇷🇺" },
  { id: "srb.1",              name: "SuperLiga RS",         country: "🇷🇸" },
  { id: "hrv.1",              name: "HNL Croatia",          country: "🇭🇷" },
  { id: "cze.1",              name: "Fortuna Liga",         country: "🇨🇿" },
  { id: "isr.1",              name: "Ligat Ha'Al",          country: "🇮🇱" },
  { id: "uefa.champions",     name: "Champions League",     country: "⭐" },
  { id: "uefa.europa",        name: "Europa League",        country: "🟠" },
  { id: "uefa.europa.conf",   name: "Conference League",    country: "🟢" },
  { id: "fifa.worldq.conmebol", name: "Eliminatórias SUL",  country: "🌎" },
  { id: "bra.1",              name: "Brasileirão Série A",  country: "🇧🇷" },
  { id: "bra.2",              name: "Brasileirão Série B",  country: "🇧🇷" },
  { id: "bra.3",              name: "Brasileirão Série C",  country: "🇧🇷" },
  { id: "bra.copa_brasil",    name: "Copa do Brasil",       country: "🇧🇷" },
  { id: "arg.1",              name: "Liga Profesional AR",  country: "🇦🇷" },
  { id: "mex.1",              name: "Liga MX",              country: "🇲🇽" },
  { id: "usa.1",              name: "MLS",                  country: "🇺🇸" },
  { id: "col.1",              name: "Liga BetPlay CO",      country: "🇨🇴" },
  { id: "chi.1",              name: "Primera CL",           country: "🇨🇱" },
  { id: "ecu.1",              name: "LigaPro Ecuador",      country: "🇪🇨" },
  { id: "per.1",              name: "Liga 1 Perú",          country: "🇵🇪" },
  { id: "uru.1",              name: "Primera UY",           country: "🇺🇾" },
  { id: "ven.1",              name: "Liga FUTVE",           country: "🇻🇪" },
  { id: "bol.1",              name: "Div. Profesional BO",  country: "🇧🇴" },
  { id: "conmebol.libertadores", name: "Libertadores",      country: "🏆" },
  { id: "conmebol.sudamericana", name: "Sul-Americana",     country: "🏆" },
  { id: "concacaf.champions", name: "CONCACAF CL",          country: "🌎" },
  { id: "jpn.1",              name: "J1 League",            country: "🇯🇵" },
  { id: "kor.1",              name: "K League 1",           country: "🇰🇷" },
  { id: "sau.1",              name: "Saudi Pro League",     country: "🇸🇦" },
  { id: "aus.1",              name: "A-League",             country: "🇦🇺" },
];

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const HEADERS = {
  "Accept": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};

function isLive(e) {
  const state = (e?.status?.type?.state || "").toLowerCase();
  const name  = (e?.status?.type?.name  || "").toLowerCase();
  return state === "in" || state === "halftime" ||
         name.includes("inprogress") || name.includes("halftime");
}

function isUpcoming(e) {
  return (e?.status?.type?.state || "").toLowerCase() === "pre";
}

// Clock ESPN é PROGRESSIVO (rawClock = segundos jogados no período atual)
function extractMinute(event) {
  const display  = event.status?.displayClock || "";
  const rawClock = event.status?.clock ?? 0;
  const period   = event.status?.period || 1;

  // displayClock = "27'" ou "45+2'" → usa direto
  const base  = display.match(/^(\d+)/)?.[1];
  const extra = display.match(/\+(\d+)/)?.[1];
  if (base) return parseInt(base) + (extra ? parseInt(extra) : 0);

  // Fallback: rawClock em segundos jogados
  if (rawClock > 0) return period === 1
    ? Math.round(rawClock / 60)
    : 45 + Math.round(rawClock / 60);

  return period === 2 ? 55 : 25;
}

// ── Extrai stats do boxscore.teams[] usando homeAway como chave ──────────────
// Nomes REAIS das stats ESPN (verificados via debug):
// wonCorners, possessionPct, totalShots, shotsOnTarget,
// foulsCommitted, yellowCards, redCards, saves, offsides, blockedShots
// dangerousAttacks (nem sempre presente), totalCrosses, totalPasses
function parseSummaryStats(summary) {
  const teams = summary?.boxscore?.teams || [];
  const result = { home: {}, away: {} };

  for (const teamData of teams) {
    const side = teamData.homeAway === "home" ? "home" : "away";
    for (const s of (teamData.statistics || [])) {
      const key = s.name || "";
      const val = parseFloat(s.displayValue ?? s.value ?? "0");
      if (isNaN(val)) continue;
      result[side][key] = val;
    }
  }
  return result;
}

function getStat(parsed, side, ...keys) {
  for (const k of keys) {
    if (parsed[side][k] !== undefined) return parsed[side][k];
  }
  return undefined;
}

async function fetchGameSummary(leagueId, eventId) {
  try {
    const res = await fetch(
      `${ESPN_BASE}/${leagueId}/summary?event=${eventId}`,
      { headers: HEADERS, signal: AbortSignal.timeout(7000) }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchLeague(league) {
  try {
    const res = await fetch(`${ESPN_BASE}/${league.id}/scoreboard`, {
      headers: HEADERS, signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { league, live: [], upcoming: [] };

    const data   = await res.json();
    const events = data.events || [];

    return {
      league,
      live:     events.filter(isLive),
      upcoming: events.filter(isUpcoming).map(e => normalizeGame(e, league, {home:{}, away:{}}, true)),
    };
  } catch { return { league, live: [], upcoming: [] }; }
}

function normalizeGame(event, league, parsed, isUpcomingGame) {
  const comp        = event.competitions?.[0] || {};
  const competitors = comp.competitors || [];
  const home        = competitors.find(c => c.homeAway === "home") || {};
  const away        = competitors.find(c => c.homeAway === "away") || {};
  const minute      = isUpcomingGame ? 0 : extractMinute(event);
  const period      = event.status?.period || 1;

  // Posse
  const posH = getStat(parsed, "home", "possessionPct", "possession") ?? 50;
  const posA = getStat(parsed, "away", "possessionPct", "possession") ?? (100 - posH);

  // Chutes
  const shotsH    = getStat(parsed, "home", "totalShots", "shots") ?? 0;
  const shotsA    = getStat(parsed, "away", "totalShots", "shots") ?? 0;
  const onTgtH    = getStat(parsed, "home", "shotsOnTarget", "shotsOnGoal") ?? 0;
  const onTgtA    = getStat(parsed, "away", "shotsOnTarget", "shotsOnGoal") ?? 0;

  // Escanteios — ESPN usa "wonCorners" no summary
  const cornH     = getStat(parsed, "home", "wonCorners", "cornerKicks", "corners") ?? 0;
  const cornA     = getStat(parsed, "away", "wonCorners", "cornerKicks", "corners") ?? 0;

  // Ataques perigosos (nem sempre presente → estima)
  const daH = getStat(parsed, "home", "dangerousAttacks") ?? estimateDA(shotsH, posH);
  const daA = getStat(parsed, "away", "dangerousAttacks") ?? estimateDA(shotsA, posA);

  // Extras
  const foulsH    = getStat(parsed, "home", "foulsCommitted", "fouls") ?? 0;
  const foulsA    = getStat(parsed, "away", "foulsCommitted", "fouls") ?? 0;
  const yellowH   = getStat(parsed, "home", "yellowCards") ?? 0;
  const yellowA   = getStat(parsed, "away", "yellowCards") ?? 0;
  const savesH    = getStat(parsed, "home", "saves") ?? 0;
  const savesA    = getStat(parsed, "away", "saves") ?? 0;
  const offH      = getStat(parsed, "home", "offsides") ?? 0;
  const offA      = getStat(parsed, "away", "offsides") ?? 0;
  const crossH    = getStat(parsed, "home", "totalCrosses") ?? 0;
  const crossA    = getStat(parsed, "away", "totalCrosses") ?? 0;
  const passH     = getStat(parsed, "home", "totalPasses") ?? 0;
  const passA     = getStat(parsed, "away", "totalPasses") ?? 0;
  const accPassH  = getStat(parsed, "home", "accuratePasses") ?? 0;
  const accPassA  = getStat(parsed, "away", "accuratePasses") ?? 0;
  const longH     = getStat(parsed, "home", "totalLongBalls") ?? 0;
  const longA     = getStat(parsed, "away", "totalLongBalls") ?? 0;

  return {
    id:            event.id,
    league:        league.name,
    leagueCountry: league.country,
    leagueId:      league.id,
    home:          home.team?.displayName || home.team?.shortDisplayName || "Home",
    homeShort:     home.team?.abbreviation || "HME",
    away:          away.team?.displayName  || away.team?.shortDisplayName  || "Away",
    awayShort:     away.team?.abbreviation || "AWY",
    score:         { home: parseInt(home.score) || 0, away: parseInt(away.score) || 0 },
    minute, period,
    clock:         event.status?.displayClock || "",
    startTime:     event.date || comp.date || null,
    statusDetail:  event.status?.type?.description || "",
    isUpcoming:    !!isUpcomingGame,
    isDemo:        false,
    // Stats principais
    possession:       { home: posH,   away: posA   },
    shots:            { home: shotsH, away: shotsA },
    onTarget:         { home: onTgtH, away: onTgtA },
    corners:          { home: cornH,  away: cornA  },
    fouls:            { home: foulsH, away: foulsA },
    yellowCards:      { home: yellowH,away: yellowA},
    dangerousAttacks: { home: daH,    away: daA    },
    saves:            { home: savesH, away: savesA },
    offsides:         { home: offH,   away: offA   },
    // Stats extras (para algoritmo e exibição)
    crosses:          { home: crossH, away: crossA },
    passes:           { home: passH,  away: passA  },
    accuratePasses:   { home: accPassH, away: accPassA },
    longBalls:        { home: longH,  away: longA  },
    pressureIndex:    null,
    venue:            comp.venue?.fullName || null,
  };
}

function estimateDA(shots, possession) {
  return Math.round(shots * 3.2 + (possession / 100) * 16);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  // FASE 1 — Scoreboards de todas as ligas em paralelo
  const leagueResults = await Promise.allSettled(LEAGUES.map(fetchLeague));

  const liveRaw       = [];
  const upcomingGames = [];

  for (const r of leagueResults) {
    if (r.status !== "fulfilled") continue;
    const { league, live, upcoming } = r.value;
    for (const e of live)     liveRaw.push({ event: e, league });
    for (const g of upcoming) upcomingGames.push(g);
  }

  // FASE 2 — Summary de cada jogo ao vivo (stats reais)
  const liveGames = await Promise.all(
    liveRaw.map(async ({ event, league }) => {
      const summary = await fetchGameSummary(league.id, event.id);
      const parsed  = parseSummaryStats(summary);
      return normalizeGame(event, league, parsed, false);
    })
  );

  upcomingGames.sort((a, b) =>
    a.startTime && b.startTime ? new Date(a.startTime) - new Date(b.startTime) : 0
  );

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    games:          liveGames,
    upcoming:       upcomingGames.slice(0, 30),
    liveCount:      liveGames.length,
    upcomingCount:  upcomingGames.length,
    leaguesQueried: LEAGUES.length,
    demo:           false,
    timestamp:      new Date().toISOString(),
  });
}
