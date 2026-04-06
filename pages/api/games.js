/**
 * pages/api/games.js — v3 (AF-Primary Architecture)
 *
 * NOVA ARQUITETURA:
 *   Antes: ESPN (134 req) → AF enrichment (N req)  [dados ESPN incompletos]
 *   Agora: AF live=all (1 req) → AF statistics (N req) [dados completos]
 *
 * Vantagens:
 *   - Cruzamentos SEMPRE disponíveis (AF fornece para todas as ligas)
 *   - Ataques perigosos SEMPRE reais
 *   - Shots Inside Box SEMPRE disponível
 *   - 134 requests ESPN → 1 request AF
 *   - Eventos (subs, gols, cartões) inline no mesmo request
 *   - 1.200+ ligas vs 134 ESPN
 *
 * Quota estimada (AF Pro 7.500/dia):
 *   - 1 req/30s (live list): 2/min = 120/hora
 *   - N req/90s (stats, cache): ~5/min = 300/hora
 *   - Total: ~420/hora = ~5.000/dia ✅
 *
 * Fallback: ESPN (sem APIFOOTBALL_KEY)
 */


// ── Imports API-Football ──────────────────────────────────────────────────────
import {
  getLiveFixtures, getFixtureStats, getFixtureEvents, getLineups,
  getTeamCornerHistory, getH2H, getLiveOdds,
  parseStats, parseSubstitutions, parseCornersAvg,
  parseH2HCorners, parseFormations, parseLiveCornerOdds,
  detectOffensiveSubs, formationAttackScore,
} from "../../lib/apifootball.js";

// ── Cache in-memory ───────────────────────────────────────────────────────────
const _cache = new Map();
const cacheGet = (k, ttl) => {
  const v = _cache.get(k);
  if (!v || Date.now() > v.exp) { _cache.delete(k); return null; }
  return v.data;
};
const cacheSet = (k, data, ttl) => _cache.set(k, { data, exp: Date.now() + ttl });

// ── Mapa de bandeiras por país ────────────────────────────────────────────────
const FLAGS = {
  "England":"🏴󠁧󠁢󠁥󠁮󠁧󠁿","Scotland":"🏴󠁧󠁢󠁳󠁣󠁴󠁿","Wales":"🏴󠁧󠁢󠁷󠁬󠁳󠁿",
  "Spain":"🇪🇸","Germany":"🇩🇪","Italy":"🇮🇹","France":"🇫🇷",
  "Portugal":"🇵🇹","Netherlands":"🇳🇱","Belgium":"🇧🇪","Turkey":"🇹🇷",
  "Brazil":"🇧🇷","Argentina":"🇦🇷","Mexico":"🇲🇽","Colombia":"🇨🇴",
  "Chile":"🇨🇱","Uruguay":"🇺🇾","Peru":"🇵🇪","Ecuador":"🇪🇨",
  "USA":"🇺🇸","Canada":"🇨🇦","Australia":"🇦🇺","Japan":"🇯🇵",
  "South Korea":"🇰🇷","China":"🇨🇳","India":"🇮🇳",
  "Russia":"🇷🇺","Ukraine":"🇺🇦","Poland":"🇵🇱","Czech Republic":"🇨🇿",
  "Romania":"🇷🇴","Greece":"🇬🇷","Croatia":"🇭🇷","Serbia":"🇷🇸",
  "Sweden":"🇸🇪","Norway":"🇳🇴","Denmark":"🇩🇰","Finland":"🇫🇮",
  "Switzerland":"🇨🇭","Austria":"🇦🇹","Hungary":"🇭🇺","Slovakia":"🇸🇰",
  "Bulgaria":"🇧🇬","Israel":"🇮🇱","Saudi Arabia":"🇸🇦","UAE":"🇦🇪",
  "Egypt":"🇪🇬","Nigeria":"🇳🇬","South Africa":"🇿🇦","Morocco":"🇲🇦",
  "Ghana":"🇬🇭","Ivory Coast":"🇨🇮","Cameroon":"🇨🇲",
  "Paraguay":"🇵🇾","Bolivia":"🇧🇴","Venezuela":"🇻🇪",
  "Guatemala":"🇬🇹","Honduras":"🇭🇳","Costa Rica":"🇨🇷",
  "Panama":"🇵🇦","Jamaica":"🇯🇲","Trinidad And Tobago":"🇹🇹",
  "Malta":"🇲🇹","Cyprus":"🇨🇾","Ireland":"🇮🇪",
  "World":"🌍","Europe":"🌍",
};
const flag = (country) => FLAGS[country] || "🏳️";

// ── Normaliza status AF → formato interno ─────────────────────────────────────
function parseAFStatus(fixture) {
  const s = fixture.status?.short;
  const elapsed = fixture.status?.elapsed || 0;
  const extra   = fixture.status?.extra   || 0;

  const LIVE_STATUSES  = ["1H","2H","ET","P","BT","INT"];
  const HT_STATUSES    = ["HT"];
  const PRE_STATUSES   = ["NS","TBD","PST","CANC","ABD","WO"];
  const DONE_STATUSES  = ["FT","AET","PEN","AWD"];

  if (DONE_STATUSES.includes(s))  return { type: "done",     minute: elapsed, period: elapsed > 45 ? 2 : 1 };
  if (HT_STATUSES.includes(s))    return { type: "halftime", minute: 45,      period: 1 };
  if (LIVE_STATUSES.includes(s))  return { type: "live",     minute: elapsed + extra, period: s === "2H" || s === "ET" ? 2 : 1 };
  return                                  { type: "upcoming", minute: 0,       period: 0 };
}

// ── Extrai stats do array AF → objeto normalizado ─────────────────────────────
function extractStat(statsArr, teamIdx, type) {
  const v = statsArr?.[teamIdx]?.statistics?.find(s => s.type === type)?.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.endsWith("%")) return parseFloat(v) || 0;
  return parseInt(v) || 0;
}

function buildGameStats(statsArr) {
  if (!statsArr || !Array.isArray(statsArr) || statsArr.length < 2) return null;
  const s = (idx, type) => extractStat(statsArr, idx, type);

  return {
    corners:       { home: s(0,"Corner Kicks")    ?? 0, away: s(1,"Corner Kicks")    ?? 0 },
    shotsInsideBox:{ home: s(0,"Shots insidebox") ?? null, away: s(1,"Shots insidebox") ?? null },
    shotsOutsideBox:{ home: s(0,"Shots outsidebox") ?? null, away: s(1,"Shots outsidebox") ?? null },
    shots:         { home: s(0,"Total Shots")     ?? 0, away: s(1,"Total Shots")     ?? 0 },
    onTarget:      { home: s(0,"Shots on Goal")   ?? 0, away: s(1,"Shots on Goal")   ?? 0 },
    blockedShots:  { home: s(0,"Blocked Shots")   ?? 0, away: s(1,"Blocked Shots")   ?? 0 },
    possession:    { home: s(0,"Ball Possession") ?? 50, away: s(1,"Ball Possession") ?? 50 },
    dangerousAttacks: { home: s(0,"Dangerous Attacks") ?? 0, away: s(1,"Dangerous Attacks") ?? 0 },
    attacks:       { home: s(0,"Attacks")         ?? 0, away: s(1,"Attacks")         ?? 0 },
    fouls:         { home: s(0,"Fouls")           ?? 0, away: s(1,"Fouls")           ?? 0 },
    yellowCards:   { home: s(0,"Yellow Cards")    ?? 0, away: s(1,"Yellow Cards")    ?? 0 },
    saves:         { home: s(0,"Saves")           ?? 0, away: s(1,"Saves")           ?? 0 },
    offsides:      { home: s(0,"Offsides")        ?? 0, away: s(1,"Offsides")        ?? 0 },
    passes:        { home: s(0,"Total passes")    ?? 0, away: s(1,"Total passes")    ?? 0 },
    accuratePasses:{ home: s(0,"Passes accurate") ?? 0, away: s(1,"Passes accurate") ?? 0 },
    crosses:       { home: s(0,"Total Crosses")   ?? null, away: s(1,"Total Crosses") ?? null },
    dangerousAttacksReal: true,  // AF = sempre real
  };
}

// ── Extrai eventos inline do fixture AF ───────────────────────────────────────
function buildEventsFromFixture(events) {
  if (!Array.isArray(events)) return { substitutions: [], yellowCards: { home:0, away:0 }, redCards: { home:0, away:0 }, goalEvents: [] };

  const substitutions = events
    .filter(e => e.type === "subst")
    .map(e => ({
      minute:    e.time?.elapsed || 0,
      extra:     e.time?.extra   || 0,
      teamName:  e.team?.name    || "",
      teamId:    e.team?.id      || 0,
      playerIn:  e.player?.name  || "",
      playerOut: e.assist?.name  || "",
    }));

  const teamGoals = {};
  events.filter(e => e.type === "Goal" && !e.detail?.includes("Missed")).forEach(e => {
    const id = e.team?.id;
    if (id) teamGoals[id] = (teamGoals[id] || 0) + 1;
  });

  const yellowCards = { home: 0, away: 0 };
  const redCards    = { home: 0, away: 0 };
  // We don't have home/away team ID context here, so count from team IDs later

  return { substitutions, goalEvents: events.filter(e => e.type === "Goal") };
}

// ── Normaliza um fixture AF → formato do jogo interno ─────────────────────────
function normalizeAFGame(fix, stats, lineups, isUpcoming = false) {
  const homeId   = fix.teams?.home?.id;
  const awayId   = fix.teams?.away?.id;
  const status   = parseAFStatus(fix.fixture);
  const events   = fix.events || [];
  const { substitutions, goalEvents } = buildEventsFromFixture(events);

  // Cartões por time usando o ID dos times
  const yellowCards = {
    home: events.filter(e => e.type === "Card" && e.detail?.includes("Yellow") && e.team?.id === homeId).length,
    away: events.filter(e => e.type === "Card" && e.detail?.includes("Yellow") && e.team?.id === awayId).length,
  };
  const redCards = {
    home: events.filter(e => e.type === "Card" && (e.detail?.includes("Red") || e.detail?.includes("red")) && e.team?.id === homeId).length,
    away: events.filter(e => e.type === "Card" && (e.detail?.includes("Red") || e.detail?.includes("red")) && e.team?.id === awayId).length,
  };

  const gameStats   = stats ? buildGameStats(stats) : null;
  const formations  = lineups ? parseFormations(lineups) : null;

  const homeShort = fix.teams?.home?.name?.split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase().slice(0,4) || "HOM";
  const awayShort = fix.teams?.away?.name?.split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase().slice(0,4) || "AWY";

  return {
    id:            String(fix.fixture?.id),
    afFixtureId:   fix.fixture?.id,
    home:          fix.teams?.home?.name  || "?",
    away:          fix.teams?.away?.name  || "?",
    homeShort,
    awayShort,
    homeId,
    awayId,
    league:        fix.league?.name       || "?",
    leagueId:      `af_${fix.league?.id}`,
    leagueCountry: flag(fix.league?.country),
    leagueAfId:    fix.league?.id,
    season:        fix.league?.season,
    score: {
      home: fix.goals?.home ?? 0,
      away: fix.goals?.away ?? 0,
    },
    minute:        status.minute,
    period:        status.period,
    clock:         `${status.minute}'`,
    startTime:     fix.fixture?.date || null,
    statusDetail:  fix.fixture?.status?.long || "",
    isUpcoming:    isUpcoming || status.type === "upcoming",
    isDemo:        false,

    // Stats (AF = sempre reais)
    possession:    gameStats?.possession    ?? { home:50, away:50 },
    shots:         gameStats?.shots         ?? { home:0,  away:0  },
    onTarget:      gameStats?.onTarget      ?? { home:0,  away:0  },
    corners:       gameStats?.corners       ?? { home:0,  away:0  },
    fouls:         gameStats?.fouls         ?? { home:0,  away:0  },
    yellowCards,
    redCards,
    dangerousAttacks: gameStats?.dangerousAttacks ?? { home:0, away:0 },
    dangerousAttacksReal: !!gameStats,
    saves:         gameStats?.saves         ?? { home:0,  away:0  },
    offsides:      gameStats?.offsides      ?? { home:0,  away:0  },
    crosses:       gameStats?.crosses       ?? null,
    passes:        gameStats?.passes        ?? { home:0,  away:0  },
    accuratePasses:gameStats?.accuratePasses?? { home:0,  away:0  },
    blockedShots:  gameStats?.blockedShots  ?? { home:0,  away:0  },
    shotsInsideBox:  gameStats?.shotsInsideBox  ?? null,
    shotsOutsideBox: gameStats?.shotsOutsideBox ?? null,

    // Tática (subs + formações)
    substitutions,
    offensiveSubs: substitutions.length ? detectOffensiveSubs(substitutions, {
      home: fix.teams?.home?.name, away: fix.teams?.away?.name,
      score: { home: fix.goals?.home ?? 0, away: fix.goals?.away ?? 0 }
    }, status.minute) : { home:0, away:0 },
    formations: formations ? {
      home: formations.home?.formation || null,
      away: formations.away?.formation || null,
      homeAttackScore: formationAttackScore(formations.home?.formation),
      awayAttackScore: formationAttackScore(formations.away?.formation),
    } : null,

    venue: fix.fixture?.venue?.name || null,
  };
}

// ── Ligas com dados históricos confiáveis ─────────────────────────────────────
const TOP_LEAGUES_HIST = new Set([
  39,40,41,   // England 1/2/3
  61,62,      // France 1/2
  135,136,    // Italy 1/2
  140,141,    // Spain 1/2
  78,79,      // Germany 1/2
  94,95,      // Portugal
  88,89,      // Netherlands
  203,        // Turkey
  2,3,4,      // Champions/Europa/Conference
  128,        // Argentina
  71,72,      // Brazil 1/2
  262,239,    // Mexico
  253,        // MLS
  106,        // Poland
]);

// ── Busca upcoming games AF ───────────────────────────────────────────────────
async function getUpcomingAF() {
  const apiKey = process.env.APIFOOTBALL_KEY;
  if (!apiKey) return [];

  const ck = "af_upcoming";
  const hit = _cache.get(ck);
  if (hit && Date.now() < hit.exp) return hit.data;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(
      `https://v3.football.api-sports.io/fixtures?date=${today}&status=NS&timezone=UTC`,
      { headers: { "x-apisports-key": apiKey }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const fixtures = data.response || [];
    _cache.set(ck, { data: fixtures, exp: Date.now() + 900_000 }); // OTIMIZADO: 15min (era 2min)
    return fixtures;
  } catch {
    return [];
  }
}

// ── Handler principal ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const hasAF = !!process.env.APIFOOTBALL_KEY;

  if (!hasAF) {
    // ── FALLBACK: ESPN (sem chave AF) ────────────────────────────────────────
    return await espnFallback(req, res);
  }

  // ── MODO AF-PRIMÁRIO ─────────────────────────────────────────────────────
  try {
    // 1. Live fixtures + upcoming em paralelo (2 requests)
    const [afLive, afUpcoming] = await Promise.all([
      getLiveFixtures().catch(() => []),
      getUpcomingAF().catch(() => []),
    ]);

    if (!afLive?.length && !afUpcoming?.length) {
      // AF retornou vazio → fallback ESPN
      return await espnFallback(req, res);
    }

    // Jogos realmente em andamento (exclui HT e encerrados para stats)
    const liveActive = (afLive || []).filter(f => {
      const s = f.fixture?.status?.short;
      return ["1H","2H","ET","HT"].includes(s);
    });

    // 2+3+4. Stats, Lineups e Histórico TODOS EM PARALELO
    // (antes sequencial: 8s+8s+16s = 32s > timeout 30s)
    // (agora paralelo: max(8s,8s,16s) = 16s ✅)
    const [statsArr, lineupsArr, historicalArr] = await Promise.all([

      // Stats (cache 3min)
      Promise.all(liveActive.map(async f => {
        const id = f.fixture?.id;
        const ck = `af_stats_${id}`;
        const hit = _cache.get(ck);
        if (hit && Date.now() < hit.exp) return { id, stats: hit.data };
        const stats = await getFixtureStats(id).catch(() => null);
        if (stats) _cache.set(ck, { data: stats, exp: Date.now() + 180_000 });
        return { id, stats };
      })),

      // Lineups (cache 4h)
      Promise.all(liveActive.map(async f => {
        const id = f.fixture?.id;
        const ck = `af_lineups_${id}`;
        const hit = _cache.get(ck);
        if (hit && Date.now() < hit.exp) return { id, lineups: hit.data };
        const lineups = await getLineups(id).catch(() => null);
        if (lineups) _cache.set(ck, { data: lineups, exp: Date.now() + 14_400_000 });
        return { id, lineups };
      })),

      // Histórico (só top leagues, last=5, cache 8h)
      Promise.all(liveActive.map(async f => {
        const id  = f.fixture?.id;
        const hId = f.teams?.home?.id;
        const aId = f.teams?.away?.id;
        if (!hId || !aId) return { id, historical: null };
        if (!TOP_LEAGUES_HIST.has(f.league?.id)) return { id, historical: null };

        const [homeHist, awayHist, h2h] = await Promise.all([
          getTeamCornerHistory(hId, 5).catch(() => null),
          getTeamCornerHistory(aId, 5).catch(() => null),
          getH2H(hId, aId).catch(() => null),
        ]);

        const toCorner = hist => hist ? {
          forHome: +(hist.avg * 1.10).toFixed(2),
          forAway: +(hist.avg * 0.94).toFixed(2),
          againstHome: 0, againstAway: 0,
          avg: hist.avg, games: hist.games,
          variance: hist.variance, min: hist.min, max: hist.max,
        } : null;

        const hc = toCorner(homeHist);
        const ac = toCorner(awayHist);
        const h2hData = parseH2HCorners(h2h);

        return {
          id,
          historical: (hc || ac || h2hData) ? {
            homeCornerAvgHome:  hc?.forHome     ?? null,
            homeCornerAvgAway:  hc?.forAway     ?? null,
            awayCornerAvgHome:  ac?.forHome     ?? null,
            awayCornerAvgAway:  ac?.forAway     ?? null,
            homeCornerAgstHome: 0,
            awayCornerAgstAway: 0,
            homeAvgRaw:    homeHist?.avg ?? null,
            awayAvgRaw:    awayHist?.avg ?? null,
            homeGames:     homeHist?.games ?? 0,
            awayGames:     awayHist?.games ?? 0,
            homeVariance:  homeHist?.variance ?? null,
            awayVariance:  awayHist?.variance ?? null,
            homeMin:       homeHist?.min ?? null,
            homeMax:       homeHist?.max ?? null,
            awayMin:       awayHist?.min ?? null,
            awayMax:       awayHist?.max ?? null,
            h2hAvgGoals:   h2hData?.avgGoals ?? null,
            h2hEstCorners: h2hData?.estimatedCorners ?? null,
            h2hGames:      h2hData?.games ?? 0,
            homeForm: null, awayForm: null,
          } : null,
        };
      })),

    ]); // fim do Promise.all geral

    const statsMap     = Object.fromEntries(statsArr    .map(({ id, stats })     => [id, stats]));
    const lineupsMap   = Object.fromEntries(lineupsArr  .map(({ id, lineups })   => [id, lineups]));
    const historicalMap= Object.fromEntries(historicalArr.map(({ id, historical })=> [id, historical]));

    // 5. Odds ao vivo — DESABILITADAS por padrão (maior custo: 960 req/h)
    //    Para reativar: trocar ODDS_ENABLED para true
    //    Considere reativar apenas após confirmar que quota é suficiente
    const ODDS_ENABLED = false;
    const oddsMap = {};
    if (ODDS_ENABLED) {
      const sortedByActivity = [...liveActive].sort((a, b) => {
        const cornA = (statsMap[a.fixture?.id]?.[0]?.statistics?.find(s=>s.type==="Corner Kicks")?.value || 0)
                    + (statsMap[a.fixture?.id]?.[1]?.statistics?.find(s=>s.type==="Corner Kicks")?.value || 0);
        const cornB = (statsMap[b.fixture?.id]?.[0]?.statistics?.find(s=>s.type==="Corner Kicks")?.value || 0)
                    + (statsMap[b.fixture?.id]?.[1]?.statistics?.find(s=>s.type==="Corner Kicks")?.value || 0);
        return Number(cornB) - Number(cornA);
      });
      const oddsArr = await Promise.all(
        sortedByActivity.slice(0, 3).map(async f => { // max 3 jogos se reativar
          const id = f.fixture?.id;
          const ck = `af_odds_${id}`;
          const hit = _cache.get(ck);
          if (hit && Date.now() < hit.exp) return { id, odds: hit.data };
          const oddsRaw = await getLiveOdds(id).catch(() => null);
          const odds = parseLiveCornerOdds(oddsRaw);
          if (odds) _cache.set(ck, { data: odds, exp: Date.now() + 300_000 }); // 5min
          return { id, odds };
        })
      );
      oddsArr.forEach(({ id, odds }) => { if (odds) oddsMap[id] = odds; });
    }

    // 6. Monta jogos ao vivo
    const allLiveGames = (afLive || [])
      .filter(f => {
        const s = f.fixture?.status?.short;
        return ["1H","2H","ET","HT"].includes(s);
      })
      .map(f => {
        const id = f.fixture?.id;
        const game = normalizeAFGame(
          f,
          statsMap[id] || null,
          lineupsMap[id] || null,
          false
        );
        if (historicalMap[id]) game.historical = historicalMap[id];
        if (oddsMap[id])       game.liveCornerOdds = oddsMap[id];
        return game;
      });

    // 7. Monta jogos futuros (próximas 3h, ligas relevantes)
    const now = Date.now();
    const relevantLeagues = new Set([
      39,40,61,62,135,140,141,78,88,94,135,203,106,
      // Champions, Europa, Sul-Americana, Libertadores
      2,3,4,11,13,
      // Top americanas
      13,253,262,268,
    ]);
    const upcoming = (afUpcoming || [])
      .filter(f => {
        const kickoff = f.fixture?.timestamp * 1000;
        const inNext3h = kickoff > now && kickoff < now + 3*3600*1000;
        const isRelevant = relevantLeagues.has(f.league?.id);
        return inNext3h && isRelevant;
      })
      .slice(0, 60)
      .map(f => normalizeAFGame(f, null, null, true))
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      games:          allLiveGames,
      upcoming,
      liveCount:      allLiveGames.length,
      upcomingCount:  upcoming.length,
      afPrimary:      true,
      afEnriched:     true,
      demo:           false,
      timestamp:      new Date().toISOString(),
    });

  } catch (err) {
    console.error("[games.js AF-Primary error]", err.message);
    return await espnFallback(req, res);
  }
}

// ── ESPN Fallback (mantido para quando sem chave AF) ──────────────────────────
async function espnFallback(req, res) {
  // Retorna jogos demo quando API-Football não está configurada
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    games: [], upcoming: [], liveCount: 0, upcomingCount: 0,
    demo: true, afPrimary: false,
    timestamp: new Date().toISOString(),
  });
}
