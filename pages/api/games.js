/**
 * /pages/api/games.js — ESPN API, cobertura máxima de ligas e copas
 * Fase 1: scoreboard de todas as competições em paralelo
 * Fase 2: summary de cada jogo ao vivo para stats detalhadas
 */

const LEAGUES = [
  // ── INGLATERRA ────────────────────────────────────────────────────────────
  { id: "eng.1",            name: "Premier League",        country: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "eng.2",            name: "Championship",          country: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "eng.3",            name: "League One",            country: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "eng.4",            name: "League Two",            country: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "eng.fa",           name: "FA Cup",                country: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "eng.league_cup",   name: "EFL Cup",               country: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },

  // ── ESPANHA ───────────────────────────────────────────────────────────────
  { id: "esp.1",            name: "La Liga",               country: "🇪🇸" },
  { id: "esp.2",            name: "La Liga 2",             country: "🇪🇸" },
  { id: "esp.copa_del_rey", name: "Copa del Rey",          country: "🇪🇸" },

  // ── ALEMANHA ──────────────────────────────────────────────────────────────
  { id: "ger.1",            name: "Bundesliga",            country: "🇩🇪" },
  { id: "ger.2",            name: "2. Bundesliga",         country: "🇩🇪" },
  { id: "ger.3",            name: "3. Liga",               country: "🇩🇪" },
  { id: "ger.dfb_pokal",    name: "DFB Pokal",             country: "🇩🇪" },

  // ── ITÁLIA ────────────────────────────────────────────────────────────────
  { id: "ita.1",            name: "Serie A",               country: "🇮🇹" },
  { id: "ita.2",            name: "Serie B",               country: "🇮🇹" },
  { id: "ita.coppa_italia", name: "Coppa Italia",          country: "🇮🇹" },

  // ── FRANÇA ────────────────────────────────────────────────────────────────
  { id: "fra.1",            name: "Ligue 1",               country: "🇫🇷" },
  { id: "fra.2",            name: "Ligue 2",               country: "🇫🇷" },
  { id: "fra.coupe_de_france", name: "Coupe de France",   country: "🇫🇷" },

  // ── PORTUGAL ─────────────────────────────────────────────────────────────
  { id: "por.1",            name: "Primeira Liga",         country: "🇵🇹" },
  { id: "por.2",            name: "Liga Portugal 2",       country: "🇵🇹" },
  { id: "por.cup",          name: "Taça de Portugal",      country: "🇵🇹" },

  // ── HOLANDA ───────────────────────────────────────────────────────────────
  { id: "ned.1",            name: "Eredivisie",            country: "🇳🇱" },
  { id: "ned.2",            name: "Eerste Divisie",        country: "🇳🇱" },
  { id: "ned.cup",          name: "KNVB Beker",            country: "🇳🇱" },

  // ── BÉLGICA ───────────────────────────────────────────────────────────────
  { id: "bel.1",            name: "Pro League",            country: "🇧🇪" },
  { id: "bel.cup",          name: "Belgian Cup",           country: "🇧🇪" },

  // ── TURQUIA ───────────────────────────────────────────────────────────────
  { id: "tur.1",            name: "Süper Lig",             country: "🇹🇷" },
  { id: "tur.2",            name: "TFF First League",      country: "🇹🇷" },

  // ── ESCÓCIA ───────────────────────────────────────────────────────────────
  { id: "sco.1",            name: "Scottish Prem",         country: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" },
  { id: "sco.2",            name: "Scottish Championship", country: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" },
  { id: "sco.fa",           name: "Scottish FA Cup",       country: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" },

  // ── GRÉCIA ────────────────────────────────────────────────────────────────
  { id: "gre.1",            name: "Super League GR",       country: "🇬🇷" },
  { id: "gre.cup",          name: "Greek Cup",             country: "🇬🇷" },

  // ── ÁUSTRIA ───────────────────────────────────────────────────────────────
  { id: "aut.1",            name: "Bundesliga AT",         country: "🇦🇹" },
  { id: "aut.cup",          name: "Austrian Cup",          country: "🇦🇹" },

  // ── SUÍÇA ─────────────────────────────────────────────────────────────────
  { id: "sui.1",            name: "Super League CH",       country: "🇨🇭" },

  // ── ESCANDINÁVIA ──────────────────────────────────────────────────────────
  { id: "den.1",            name: "Superliga DK",          country: "🇩🇰" },
  { id: "swe.1",            name: "Allsvenskan",           country: "🇸🇪" },
  { id: "nor.1",            name: "Eliteserien",           country: "🇳🇴" },
  { id: "fin.1",            name: "Veikkausliiga",         country: "🇫🇮" },

  // ── LESTE EUROPEU ─────────────────────────────────────────────────────────
  { id: "pol.1",            name: "Ekstraklasa",           country: "🇵🇱" },
  { id: "rou.1",            name: "Liga I",                country: "🇷🇴" },
  { id: "rus.1",            name: "Premier League RU",     country: "🇷🇺" },
  { id: "ukr.1",            name: "Premier League UA",     country: "🇺🇦" },
  { id: "cze.1",            name: "Fortuna Liga",          country: "🇨🇿" },
  { id: "svk.1",            name: "Slovak Super Liga",     country: "🇸🇰" },
  { id: "hun.1",            name: "OTP Bank Liga",         country: "🇭🇺" },
  { id: "bul.1",            name: "Parva Liga",            country: "🇧🇬" },
  { id: "srb.1",            name: "SuperLiga RS",          country: "🇷🇸" },
  { id: "hrv.1",            name: "HNL Croatia",           country: "🇭🇷" },
  { id: "svn.1",            name: "PrvaLiga SLO",          country: "🇸🇮" },
  { id: "blr.1",            name: "Vysheyshaya Liga",      country: "🇧🇾" },
  { id: "kaz.1",            name: "Premier League KZ",     country: "🇰🇿" },

  // ── BALCÃS/MEDITERRÂNEO ───────────────────────────────────────────────────
  { id: "isr.1",            name: "Ligat Ha'Al",           country: "🇮🇱" },
  { id: "cyp.1",            name: "Cyprus First Div",      country: "🇨🇾" },

  // ── UEFA / FIFA ───────────────────────────────────────────────────────────
  { id: "uefa.champions",      name: "Champions League",   country: "⭐" },
  { id: "uefa.europa",         name: "Europa League",      country: "🟠" },
  { id: "uefa.europa.conf",    name: "Conference League",  country: "🟢" },
  { id: "uefa.nations",        name: "Nations League",     country: "🌍" },
  { id: "fifa.worldq.conmebol",name: "Eliminatórias SUL",  country: "🌎" },
  { id: "fifa.worldq.uefa",    name: "Eliminatórias UEFA", country: "🌍" },
  { id: "fifa.worldq.concacaf",name: "Eliminatórias CONC", country: "🌎" },
  { id: "fifa.worldq.afc",     name: "Eliminatórias AFC",  country: "🌏" },
  { id: "fifa.worldq.caf",     name: "Eliminatórias CAF",  country: "🌍" },

  // ── BRASIL ────────────────────────────────────────────────────────────────
  { id: "bra.1",            name: "Brasileirão Série A",   country: "🇧🇷" },
  { id: "bra.2",            name: "Brasileirão Série B",   country: "🇧🇷" },
  { id: "bra.3",            name: "Brasileirão Série C",   country: "🇧🇷" },
  { id: "bra.4",            name: "Brasileirão Série D",   country: "🇧🇷" },
  { id: "bra.copa_brasil",  name: "Copa do Brasil",        country: "🇧🇷" },
  { id: "bra.paulista",     name: "Paulistão",             country: "🇧🇷" },
  { id: "bra.carioca",      name: "Carioca",               country: "🇧🇷" },
  { id: "bra.gaucho",       name: "Gauchão",               country: "🇧🇷" },
  { id: "bra.mineiro",      name: "Mineiro",               country: "🇧🇷" },
  { id: "bra.baiano",       name: "Baiano",                country: "🇧🇷" },
  { id: "bra.cearense",     name: "Cearense",              country: "🇧🇷" },
  { id: "bra.nordeste",     name: "Copa do Nordeste",      country: "🇧🇷" },
  { id: "bra.verde_amarela",name: "Copa Verde",            country: "🇧🇷" },

  // ── ARGENTINA ─────────────────────────────────────────────────────────────
  { id: "arg.1",            name: "Liga Profesional AR",   country: "🇦🇷" },
  { id: "arg.2",            name: "Primera Nacional AR",   country: "🇦🇷" },
  { id: "arg.copa",         name: "Copa Argentina",        country: "🇦🇷" },

  // ── MÉXICO ────────────────────────────────────────────────────────────────
  { id: "mex.1",            name: "Liga MX",               country: "🇲🇽" },
  { id: "mex.2",            name: "Expansión MX",          country: "🇲🇽" },
  { id: "mex.copa",         name: "Copa MX",               country: "🇲🇽" },

  // ── EUA ───────────────────────────────────────────────────────────────────
  { id: "usa.1",            name: "MLS",                   country: "🇺🇸" },
  { id: "usa.2",            name: "USL Championship",      country: "🇺🇸" },
  { id: "usa.open",         name: "US Open Cup",           country: "🇺🇸" },

  // ── DEMAIS AMÉRICAS ───────────────────────────────────────────────────────
  { id: "col.1",            name: "Liga BetPlay CO",       country: "🇨🇴" },
  { id: "col.2",            name: "Torneo Betplay CO",     country: "🇨🇴" },
  { id: "chi.1",            name: "Primera División CL",   country: "🇨🇱" },
  { id: "ecu.1",            name: "LigaPro Ecuador",       country: "🇪🇨" },
  { id: "per.1",            name: "Liga 1 Perú",           country: "🇵🇪" },
  { id: "uru.1",            name: "Primera División UY",   country: "🇺🇾" },
  { id: "ven.1",            name: "Liga FUTVE",            country: "🇻🇪" },
  { id: "bol.1",            name: "División Prof. BO",     country: "🇧🇴" },
  { id: "par.1",            name: "División Prof. PY",     country: "🇵🇾" },
  { id: "crc.1",            name: "Primera CR",            country: "🇨🇷" },
  { id: "gua.1",            name: "Liga Nacional GT",      country: "🇬🇹" },
  { id: "hon.1",            name: "Liga Nacional HN",      country: "🇭🇳" },
  { id: "slv.1",            name: "Liga Mayor SV",         country: "🇸🇻" },
  { id: "can.1",            name: "Canadian Premier",      country: "🇨🇦" },

  // ── SUL-AMERICANA / CONCACAF ──────────────────────────────────────────────
  { id: "conmebol.libertadores",  name: "Libertadores",    country: "🏆" },
  { id: "conmebol.sudamericana",  name: "Sul-Americana",   country: "🏆" },
  { id: "conmebol.recopa",        name: "Recopa Sudamer.", country: "🏆" },
  { id: "concacaf.champions",     name: "CONCACAF CL",     country: "🌎" },
  { id: "concacaf.league",        name: "CONCACAF League", country: "🌎" },

  // ── ÁSIA ─────────────────────────────────────────────────────────────────
  { id: "afc.champions",    name: "AFC Champions",         country: "🌏" },
  { id: "jpn.1",            name: "J1 League",             country: "🇯🇵" },
  { id: "jpn.2",            name: "J2 League",             country: "🇯🇵" },
  { id: "jpn.emperor_cup",  name: "Emperor's Cup",         country: "🇯🇵" },
  { id: "kor.1",            name: "K League 1",            country: "🇰🇷" },
  { id: "kor.2",            name: "K League 2",            country: "🇰🇷" },
  { id: "kor.fa",           name: "Korean FA Cup",         country: "🇰🇷" },
  { id: "chn.1",            name: "Chinese Super League",  country: "🇨🇳" },
  { id: "chn.2",            name: "Chinese League One",    country: "🇨🇳" },
  { id: "sau.1",            name: "Saudi Pro League",      country: "🇸🇦" },
  { id: "uae.pro",          name: "UAE Pro League",        country: "🇦🇪" },
  { id: "qat.1",            name: "Qatar Stars League",    country: "🇶🇦" },
  { id: "irn.1",            name: "Iran Pro League",       country: "🇮🇷" },
  { id: "ind.1",            name: "Indian Super League",   country: "🇮🇳" },
  { id: "thi.1",            name: "Thai League 1",         country: "🇹🇭" },
  { id: "mly.1",            name: "Malaysia Super League", country: "🇲🇾" },
  { id: "idn.1",            name: "Liga 1 Indonesia",      country: "🇮🇩" },
  { id: "vnm.1",            name: "Vietnam League 1",      country: "🇻🇳" },
  { id: "aus.1",            name: "A-League",              country: "🇦🇺" },

  // ── ÁFRICA ────────────────────────────────────────────────────────────────
  { id: "caf.champions",    name: "CAF Champions League",  country: "🌍" },
  { id: "caf.confederation",name: "CAF Confed. Cup",       country: "🌍" },
  { id: "egy.1",            name: "Egyptian Premier",      country: "🇪🇬" },
  { id: "mor.1",            name: "Botola Pro (Marrocos)", country: "🇲🇦" },
  { id: "tun.1",            name: "Ligue 1 Tunísia",      country: "🇹🇳" },
  { id: "alg.1",            name: "Ligue 1 Argélia",      country: "🇩🇿" },
  { id: "rsa.1",            name: "South African PSL",     country: "🇿🇦" },
  { id: "nig.1",            name: "Nigerian Pro League",   country: "🇳🇬" },
  { id: "gha.1",            name: "Ghana Premier League",  country: "🇬🇭" },
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

function extractMinute(event) {
  const display  = event.status?.displayClock || "";
  const rawClock = event.status?.clock ?? 0;
  const period   = event.status?.period || 1;
  const base  = display.match(/^(\d+)/)?.[1];
  const extra = display.match(/\+(\d+)/)?.[1];
  if (base) return parseInt(base) + (extra ? parseInt(extra) : 0);
  if (rawClock > 0) return period === 1
    ? Math.round(rawClock / 60)
    : 45 + Math.round(rawClock / 60);
  return period === 2 ? 55 : 25;
}

async function fetchGameSummary(leagueId, eventId) {
  try {
    const res = await fetch(
      `${ESPN_BASE}/${leagueId}/summary?event=${eventId}`,
      { headers: HEADERS, signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function parseSummaryStats(summary) {
  const teams = summary?.boxscore?.teams || [];
  const result = { home: {}, away: {} };
  for (const teamData of teams) {
    const side = teamData.homeAway === "home" ? "home" : "away";
    for (const s of (teamData.statistics || [])) {
      const key = s.name || "";
      const val = parseFloat(s.displayValue ?? s.value ?? "0");
      if (!isNaN(val)) result[side][key] = val;
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

async function fetchLeague(league) {
  try {
    const res = await fetch(`${ESPN_BASE}/${league.id}/scoreboard`, {
      headers: HEADERS, signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { league, live: [], upcoming: [] };
    const data   = await res.json();
    const events = data.events || [];
    return {
      league,
      live:     events.filter(isLive),
      upcoming: events.filter(isUpcoming).map(e => normalizeGame(e, league, {home:{},away:{}}, true)),
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

  const posH = getStat(parsed, "home", "possessionPct") ?? 50;
  const posA = getStat(parsed, "away", "possessionPct") ?? (100 - posH);
  const shotsH  = getStat(parsed, "home", "totalShots")    ?? 0;
  const shotsA  = getStat(parsed, "away", "totalShots")    ?? 0;
  const onTgtH  = getStat(parsed, "home", "shotsOnTarget") ?? 0;
  const onTgtA  = getStat(parsed, "away", "shotsOnTarget") ?? 0;
  const cornH   = getStat(parsed, "home", "wonCorners")    ?? 0;
  const cornA   = getStat(parsed, "away", "wonCorners")    ?? 0;
  const foulsH  = getStat(parsed, "home", "foulsCommitted")   ?? 0;
  const foulsA  = getStat(parsed, "away", "foulsCommitted")   ?? 0;
  const yellowH = getStat(parsed, "home", "yellowCards")   ?? 0;
  const yellowA = getStat(parsed, "away", "yellowCards")   ?? 0;
  const savesH  = getStat(parsed, "home", "saves")         ?? 0;
  const savesA  = getStat(parsed, "away", "saves")         ?? 0;
  const offH    = getStat(parsed, "home", "offsides")      ?? 0;
  const offA    = getStat(parsed, "away", "offsides")      ?? 0;
  const crossH  = getStat(parsed, "home", "totalCrosses")  ?? 0;
  const crossA  = getStat(parsed, "away", "totalCrosses")  ?? 0;
  const passH   = getStat(parsed, "home", "totalPasses")   ?? 0;
  const passA   = getStat(parsed, "away", "totalPasses")   ?? 0;
  const accPH   = getStat(parsed, "home", "accuratePasses")  ?? 0;
  const accPA   = getStat(parsed, "away", "accuratePasses")  ?? 0;
  const longH   = getStat(parsed, "home", "totalLongBalls")  ?? 0;
  const longA   = getStat(parsed, "away", "totalLongBalls")  ?? 0;
  const blkH    = getStat(parsed, "home", "blockedShots")    ?? 0;
  const blkA    = getStat(parsed, "away", "blockedShots")    ?? 0;
  const clrH    = getStat(parsed, "home", "effectiveClearance","totalClearance") ?? 0;
  const clrA    = getStat(parsed, "away", "effectiveClearance","totalClearance") ?? 0;
  const daH     = getStat(parsed, "home", "dangerousAttacks") ?? Math.round(shotsH * 3.2 + (posH / 100) * 16);
  const daA     = getStat(parsed, "away", "dangerousAttacks") ?? Math.round(shotsA * 3.2 + (posA / 100) * 16);

  return {
    id: event.id,
    league: league.name, leagueCountry: league.country, leagueId: league.id,
    home: home.team?.displayName || home.team?.shortDisplayName || "Home",
    homeShort: home.team?.abbreviation || "HME",
    away: away.team?.displayName  || away.team?.shortDisplayName  || "Away",
    awayShort: away.team?.abbreviation || "AWY",
    score:   { home: parseInt(home.score) || 0, away: parseInt(away.score) || 0 },
    minute, period,
    clock:        event.status?.displayClock || "",
    startTime:    event.date || comp.date || null,
    statusDetail: event.status?.type?.description || "",
    isUpcoming: !!isUpcomingGame, isDemo: false,
    possession:       { home: posH,  away: posA  },
    shots:            { home: shotsH,away: shotsA },
    onTarget:         { home: onTgtH,away: onTgtA },
    corners:          { home: cornH, away: cornA  },
    fouls:            { home: foulsH,away: foulsA },
    yellowCards:      { home: yellowH, away: yellowA },
    dangerousAttacks: { home: daH,   away: daA   },
    saves:            { home: savesH,away: savesA },
    offsides:         { home: offH,  away: offA  },
    crosses:          { home: crossH,away: crossA },
    passes:           { home: passH, away: passA  },
    accuratePasses:   { home: accPH, away: accPA  },
    longBalls:        { home: longH, away: longA  },
    blockedShots:     { home: blkH,  away: blkA  },
    clearances:       { home: clrH,  away: clrA  },
    pressureIndex: null,
    venue: comp.venue?.fullName || null,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  // Fase 1 — TODOS os scoreboards em paralelo com timeout individual de 5s
  // Paralelo total = tempo do request mais lento (~2s), NÃO soma de todos
  // Batches sequenciais com 110 ligas → 20s+ → estoura o limite do Vercel
  const allResults = await Promise.allSettled(LEAGUES.map(fetchLeague));

  const liveRaw  = [];
  const upcoming = [];

  for (const r of allResults) {
    if (r.status !== "fulfilled") continue;
    liveRaw.push(...r.value.live.map(e => ({ event: e, league: r.value.league })));
    upcoming.push(...r.value.upcoming);
  }

  // Fase 2 — summary de cada jogo ao vivo para stats detalhadas (todos em paralelo)
  const liveGames = await Promise.all(
    liveRaw.map(async ({ event, league }) => {
      const summary = await fetchGameSummary(league.id, event.id);
      const parsed  = parseSummaryStats(summary);
      return normalizeGame(event, league, parsed, false);
    })
  );

  upcoming.sort((a, b) =>
    a.startTime && b.startTime ? new Date(a.startTime) - new Date(b.startTime) : 0
  );

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    games:          liveGames,
    upcoming:       upcoming.slice(0, 50),
    liveCount:      liveGames.length,
    upcomingCount:  upcoming.length,
    leaguesQueried: LEAGUES.length,
    demo:           false,
    timestamp:      new Date().toISOString(),
  });
}
