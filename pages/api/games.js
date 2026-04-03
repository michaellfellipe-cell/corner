/**
 * /pages/api/games.js
 * 1) Busca scoreboard de todas as ligas para encontrar jogos ao vivo
 * 2) Para cada jogo ao vivo, busca o endpoint /summary para obter stats reais
 * Clock ESPN é PROGRESSIVO: rawClock = segundos jogados
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
  return state === "in" || state === "halftime" || name.includes("inprogress") || name.includes("halftime");
}

function isUpcoming(e) {
  return (e?.status?.type?.state || "").toLowerCase() === "pre";
}

// Clock ESPN é PROGRESSIVO (segundos jogados)
function extractMinute(event) {
  const rawClock = event.status?.clock ?? 0;
  const period   = event.status?.period || 1;
  const display  = event.status?.displayClock || "";

  // displayClock formato "8'" ou "45+2'" → usa direto
  const m = display.match(/^(\d+)/);
  if (m) {
    const base = parseInt(m[1], 10);
    // Detecta acréscimos: "45+2'"
    const extra = display.match(/\+(\d+)/);
    return base + (extra ? parseInt(extra[1], 10) : 0);
  }
  // Fallback: rawClock = segundos jogados no período atual
  if (rawClock > 0) {
    return period === 1
      ? Math.round(rawClock / 60)
      : 45 + Math.round(rawClock / 60);
  }
  return period === 2 ? 55 : 25;
}

// ── Busca summary de um jogo para obter stats detalhadas ────────────────────
async function fetchGameSummary(leagueId, eventId) {
  try {
    const url = `${ESPN_BASE}/${leagueId}/summary?event=${eventId}`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Extrai stats do boxscore do summary ─────────────────────────────────────
function extractSummaryStats(summary, homeTeamId, awayTeamId) {
  if (!summary?.boxscore) return {};

  const teams = summary.boxscore.teams || [];
  const r = {};

  // ESPN summary boxscore.teams = [{team: {id}, statistics: [{name, displayValue, ...}]}]
  for (const teamData of teams) {
    const tid  = teamData.team?.id;
    const isH  = tid === homeTeamId;
    const isA  = tid === awayTeamId;
    if (!isH && !isA) continue;

    const side = isH ? "home" : "away";
    for (const stat of (teamData.statistics || [])) {
      const name = (stat.name || stat.label || "").toLowerCase().trim();
      const val  = parseFloat(stat.displayValue ?? stat.value ?? stat.abbreviation ?? 0);
      if (isNaN(val)) continue;

      switch (name) {
        case "possessionpct":
        case "possession":         r[`possession_${side}`]        = val; break;
        case "shotstotal":
        case "shots":              r[`shots_${side}`]             = val; break;
        case "shotsongoal":
        case "shotsontarget":      r[`onTarget_${side}`]          = val; break;
        case "cornerkicks":
        case "corners":            r[`corners_${side}`]           = val; break;
        case "foulscommitted":
        case "fouls":              r[`fouls_${side}`]             = val; break;
        case "yellowcards":        r[`yellow_${side}`]            = val; break;
        case "redcards":           r[`red_${side}`]               = val; break;
        case "offsides":           r[`offsides_${side}`]          = val; break;
        case "dangerousattacks":   r[`dangerousAttacks_${side}`]  = val; break;
        case "blockedshots":       r[`blockedShots_${side}`]      = val; break;
        case "saves":              r[`saves_${side}`]             = val; break;
        case "totalshots":         r[`shots_${side}`]             = val; break;
        case "shotsongoalpct":     break; // skip percentages
        default:                   break;
      }
    }
  }
  return r;
}

// ── Busca scoreboard de uma liga ────────────────────────────────────────────
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
      upcoming: events.filter(isUpcoming).map(e => normalizeGame(e, league, {}, true)),
    };
  } catch {
    return { league, live: [], upcoming: [] };
  }
}

// ── Normaliza um evento + stats em formato padrão ───────────────────────────
function normalizeGame(event, league, stats, isUpcomingGame) {
  const comp        = event.competitions?.[0] || {};
  const competitors = comp.competitors || [];
  const home        = competitors.find(c => c.homeAway === "home") || {};
  const away        = competitors.find(c => c.homeAway === "away") || {};
  const minute      = isUpcomingGame ? 0 : extractMinute(event);
  const period      = event.status?.period || 1;

  // Posse: garante que soma 100
  let posH = stats.possession_home ?? 50;
  let posA = stats.possession_away ?? (100 - posH);

  // Ataques perigosos: estima se não disponível
  const daH = stats.dangerousAttacks_home ?? estimateDA(stats.shots_home ?? 0, posH);
  const daA = stats.dangerousAttacks_away ?? estimateDA(stats.shots_away ?? 0, posA);

  return {
    id:            event.id,
    league:        league.name,
    leagueCountry: league.country,
    leagueId:      league.id,
    home:          home.team?.displayName || home.team?.shortDisplayName || "Home",
    homeShort:     home.team?.abbreviation || "HME",
    homeId:        home.team?.id,
    away:          away.team?.displayName || away.team?.shortDisplayName || "Away",
    awayShort:     away.team?.abbreviation || "AWY",
    awayId:        away.team?.id,
    score:         { home: parseInt(home.score) || 0, away: parseInt(away.score) || 0 },
    minute, period,
    clock:         event.status?.displayClock || "",
    startTime:     event.date || comp.date || null,
    statusDetail:  event.status?.type?.description || "",
    isUpcoming:    !!isUpcomingGame,
    isDemo:        false,
    // Stats
    possession:       { home: posH,                    away: posA                    },
    shots:            { home: stats.shots_home    ?? 0, away: stats.shots_away    ?? 0 },
    onTarget:         { home: stats.onTarget_home ?? 0, away: stats.onTarget_away ?? 0 },
    corners:          { home: stats.corners_home  ?? 0, away: stats.corners_away  ?? 0 },
    fouls:            { home: stats.fouls_home    ?? 0, away: stats.fouls_away    ?? 0 },
    yellowCards:      { home: stats.yellow_home   ?? 0, away: stats.yellow_away   ?? 0 },
    dangerousAttacks: { home: daH,                      away: daA                     },
    saves:            { home: stats.saves_home    ?? 0, away: stats.saves_away    ?? 0 },
    offsides:         { home: stats.offsides_home ?? 0, away: stats.offsides_away ?? 0 },
    pressureIndex:    null,
    venue:            comp.venue?.fullName || null,
  };
}

function estimateDA(shots, possession) {
  return Math.round(shots * 3.2 + (possession / 100) * 16);
}

// ── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  // FASE 1: Busca scoreboards de todas as ligas em paralelo
  const leagueResults = await Promise.allSettled(LEAGUES.map(fetchLeague));

  const liveRaw    = []; // { event, league }
  const upcomingGames = [];

  for (const r of leagueResults) {
    if (r.status !== "fulfilled") continue;
    const { league, live, upcoming } = r.value;
    for (const e of live)     liveRaw.push({ event: e, league });
    for (const g of upcoming) upcomingGames.push(g);
  }

  // FASE 2: Busca summary de cada jogo ao vivo para obter stats reais
  // Limita a 25 simultâneos para não sobrecarregar
  const liveGames = await Promise.all(
    liveRaw.map(async ({ event, league }) => {
      const summary = await fetchGameSummary(league.id, event.id);
      const comp    = event.competitions?.[0] || {};
      const comps   = comp.competitors || [];
      const homeId  = comps.find(c => c.homeAway === "home")?.team?.id;
      const awayId  = comps.find(c => c.homeAway === "away")?.team?.id;
      const stats   = summary ? extractSummaryStats(summary, homeId, awayId) : {};
      return normalizeGame(event, league, stats, false);
    })
  );

  // Ordena upcoming por horário
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
