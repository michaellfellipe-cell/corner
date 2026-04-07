/**
 * pages/api/games.js — v31 (Hybrid: ESPN lista + AF enriquece)
 *
 * ARQUITETURA HÍBRIDA:
 *   ESPN Scoreboard  → descoberta gratuita (20-50 jogos ao vivo, sem quota AF)
 *   AF /fixtures?live=all → fixture IDs + eventos inline (1 req, cache 30s)
 *   AF /fixtures/statistics → stats reais por jogo matched (cache 4min)
 *   AF /fixtures/lineups   → formações (cache 4h)
 *   AF histórico           → apenas top leagues (cache 8h)
 *
 * Quota estimada (AF Pro 7.500/dia):
 *   ESPN: GRÁTIS, zero impacto na quota AF
 *   AF live=all (cache 30s):           120/h
 *   AF stats  (30 jogos, cache 4min):  450/h pico
 *   AF lineups (cache 4h):              ~1/h
 *   AF upcoming (cache 15min):           4/h
 *   AF histórico (cache 8h):             ~2/h
 *   Total pico estimado:               ~577/h = ~5.500/dia abaixo de 7.500
 */

import {
  getLiveFixtures, getFixtureStats, getLineups,
  getTeamCornerHistory, getH2H,
  matchAFFixture,
  parseFormations, parseH2HCorners,
  detectOffensiveSubs, formationAttackScore,
} from "../../lib/apifootball.js";

// ── Cache in-memory ─────────────────────────────────────────────────────────
const _cache = new Map();
const cacheGet = (k) => {
  const v = _cache.get(k);
  if (!v || Date.now() > v.exp) { _cache.delete(k); return null; }
  return v.data;
};
const cacheSet = (k, data, ttl) => _cache.set(k, { data, exp: Date.now() + ttl });

// ── Bandeiras ───────────────────────────────────────────────────────────────
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

// ── Normaliza string para matching fuzzy ────────────────────────────────────
function normName(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|cf|sc|ac|afc|bfc|sfc|rc|rcd|sd|ud|cd|if|sk|bk|fk|atletico|athletic|sporting)\b/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Status AF → formato interno ─────────────────────────────────────────────
function parseAFStatus(fixture) {
  const s       = fixture.status?.short;
  const elapsed = fixture.status?.elapsed || 0;
  const extra   = fixture.status?.extra   || 0;
  if (["FT","AET","PEN","AWD"].includes(s)) return { type:"done",     minute:elapsed, period:elapsed>45?2:1 };
  if (["HT"].includes(s))                   return { type:"halftime", minute:45,      period:1 };
  if (["1H","2H","ET","P","BT","INT"].includes(s))
    return { type:"live", minute:elapsed+extra, period:s==="2H"||s==="ET"?2:1 };
  return { type:"upcoming", minute:0, period:0 };
}

// ── Stats AF ────────────────────────────────────────────────────────────────
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
    corners:          { home: s(0,"Corner Kicks")     ?? 0,    away: s(1,"Corner Kicks")     ?? 0    },
    shotsInsideBox:   { home: s(0,"Shots insidebox")  ?? null, away: s(1,"Shots insidebox")  ?? null },
    shotsOutsideBox:  { home: s(0,"Shots outsidebox") ?? null, away: s(1,"Shots outsidebox") ?? null },
    shots:            { home: s(0,"Total Shots")      ?? 0,    away: s(1,"Total Shots")      ?? 0    },
    onTarget:         { home: s(0,"Shots on Goal")    ?? 0,    away: s(1,"Shots on Goal")    ?? 0    },
    blockedShots:     { home: s(0,"Blocked Shots")    ?? 0,    away: s(1,"Blocked Shots")    ?? 0    },
    possession:       { home: s(0,"Ball Possession")  ?? 50,   away: s(1,"Ball Possession")  ?? 50   },
    dangerousAttacks: { home: s(0,"Dangerous Attacks")?? 0,    away: s(1,"Dangerous Attacks")?? 0    },
    attacks:          { home: s(0,"Attacks")          ?? 0,    away: s(1,"Attacks")          ?? 0    },
    fouls:            { home: s(0,"Fouls")            ?? 0,    away: s(1,"Fouls")            ?? 0    },
    yellowCards:      { home: s(0,"Yellow Cards")     ?? 0,    away: s(1,"Yellow Cards")     ?? 0    },
    saves:            { home: s(0,"Saves")            ?? 0,    away: s(1,"Saves")            ?? 0    },
    offsides:         { home: s(0,"Offsides")         ?? 0,    away: s(1,"Offsides")         ?? 0    },
    passes:           { home: s(0,"Total passes")     ?? 0,    away: s(1,"Total passes")     ?? 0    },
    accuratePasses:   { home: s(0,"Passes accurate")  ?? 0,    away: s(1,"Passes accurate")  ?? 0    },
    crosses:          { home: s(0,"Total Crosses")    ?? null, away: s(1,"Total Crosses")    ?? null },
    dangerousAttacksReal: true,
  };
}

// ── Eventos inline AF ───────────────────────────────────────────────────────
function buildEventsFromFixture(events) {
  if (!Array.isArray(events))
    return { substitutions:[], goalEvents:[] };
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
  return { substitutions, goalEvents: events.filter(e => e.type === "Goal") };
}

// ── Normaliza fixture AF → objeto canônico ──────────────────────────────────
function normalizeAFGame(fix, stats, lineups, isUpcoming = false) {
  const homeId = fix.teams?.home?.id;
  const awayId = fix.teams?.away?.id;
  const status = parseAFStatus(fix.fixture);
  const events = fix.events || [];
  const { substitutions } = buildEventsFromFixture(events);

  const yellowCards = {
    home: events.filter(e => e.type==="Card" && e.detail?.includes("Yellow") && e.team?.id===homeId).length,
    away: events.filter(e => e.type==="Card" && e.detail?.includes("Yellow") && e.team?.id===awayId).length,
  };
  const redCards = {
    home: events.filter(e => e.type==="Card" && (e.detail?.includes("Red")||e.detail?.includes("red")) && e.team?.id===homeId).length,
    away: events.filter(e => e.type==="Card" && (e.detail?.includes("Red")||e.detail?.includes("red")) && e.team?.id===awayId).length,
  };

  const gameStats  = stats   ? buildGameStats(stats)   : null;
  const formations = lineups ? parseFormations(lineups) : null;

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
    score:         { home: fix.goals?.home ?? 0, away: fix.goals?.away ?? 0 },
    minute:        status.minute,
    period:        status.period,
    clock:         `${status.minute}'`,
    startTime:     fix.fixture?.date || null,
    statusDetail:  fix.fixture?.status?.long || "",
    isUpcoming:    isUpcoming || status.type === "upcoming",
    isDemo:        false,

    possession:    gameStats?.possession    ?? { home:50, away:50 },
    shots:         gameStats?.shots         ?? { home:0,  away:0  },
    onTarget:      gameStats?.onTarget      ?? { home:0,  away:0  },
    corners:       gameStats?.corners       ?? { home:0,  away:0  },
    fouls:         gameStats?.fouls         ?? { home:0,  away:0  },
    yellowCards,
    redCards,
    dangerousAttacks:     gameStats?.dangerousAttacks    ?? { home:0, away:0 },
    dangerousAttacksReal: !!gameStats,
    saves:         gameStats?.saves         ?? { home:0,  away:0  },
    offsides:      gameStats?.offsides      ?? { home:0,  away:0  },
    crosses:       gameStats?.crosses       ?? null,
    passes:        gameStats?.passes        ?? { home:0,  away:0  },
    accuratePasses:gameStats?.accuratePasses?? { home:0,  away:0  },
    blockedShots:  gameStats?.blockedShots  ?? { home:0,  away:0  },
    shotsInsideBox:  gameStats?.shotsInsideBox  ?? null,
    shotsOutsideBox: gameStats?.shotsOutsideBox ?? null,

    substitutions,
    offensiveSubs: substitutions.length ? detectOffensiveSubs(substitutions, {
      home:  fix.teams?.home?.name, away: fix.teams?.away?.name,
      score: { home: fix.goals?.home ?? 0, away: fix.goals?.away ?? 0 },
    }, status.minute) : { home:0, away:0 },
    formations: formations ? {
      home: formations.home?.formation || null,
      away: formations.away?.formation || null,
      homeAttackScore: formationAttackScore(formations.home?.formation),
      awayAttackScore: formationAttackScore(formations.away?.formation),
    } : null,

    venue:      fix.fixture?.venue?.name || null,
    dataSource: "af",
  };
}

// ── Normaliza jogo ESPN sem match AF → dados básicos sem stats ──────────────
function normalizeEspnOnlyGame(eg) {
  const homeShort = (eg.homeName||"?").split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase().slice(0,4)||"HOM";
  const awayShort = (eg.awayName||"?").split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase().slice(0,4)||"AWY";
  return {
    id:            `espn_${eg.id}`,
    afFixtureId:   null,
    home:          eg.homeName || "?",
    away:          eg.awayName || "?",
    homeShort,
    awayShort,
    homeId:        null,
    awayId:        null,
    league:        eg.leagueName || "?",
    leagueId:      `espn_${eg.leagueSlug || "?"}`,
    leagueCountry: "🏳️",
    leagueAfId:    null,
    season:        null,
    score:         { home: eg.homeScore ?? 0, away: eg.awayScore ?? 0 },
    minute:        eg.minute  ?? 0,
    period:        eg.period  ?? 1,
    clock:         eg.minute  ? `${eg.minute}'` : "?",
    startTime:     eg.startTime || null,
    statusDetail:  eg.statusDetail || "",
    isUpcoming:    false,
    isDemo:        false,
    // Stats nulas — liga não coberta pelo AF no momento
    possession:    { home:50, away:50 },
    shots:         { home:0, away:0 }, onTarget: { home:0, away:0 },
    corners:       { home:0, away:0 }, fouls:    { home:0, away:0 },
    yellowCards:   { home:0, away:0 }, redCards: { home:0, away:0 },
    dangerousAttacks:     { home:0, away:0 },
    dangerousAttacksReal: false,
    saves:         { home:0, away:0 }, offsides: { home:0, away:0 },
    crosses:       null, passes: { home:0, away:0 },
    accuratePasses:{ home:0, away:0 }, blockedShots: { home:0, away:0 },
    shotsInsideBox: null, shotsOutsideBox: null,
    substitutions: [], offensiveSubs: { home:0, away:0 },
    formations:    null,
    venue:         null,
    dataSource:    "espn-only",
  };
}

// ── Ligas top para histórico AF ─────────────────────────────────────────────
const TOP_LEAGUES_HIST = new Set([
  39,40,41, 61,62, 135,136, 140,141, 78,79,
  94,95, 88,89, 203, 2,3,4,
  128, 71,72, 262,239, 253, 106,
]);

// ── ESPN Scoreboard — jogos ao vivo + próximos (uma só req, cache 30s) ──────
async function fetchEspnScoreboard() {
  const ck  = "espn_scoreboard";
  const hit = cacheGet(ck);
  if (hit) return hit;

  try {
    const res = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?limit=200",
      { signal: AbortSignal.timeout(7000) }
    );
    if (!res.ok) return { live:[], upcoming:[] };
    const json   = await res.json();
    const events = json.events || [];

    const live     = [];
    const upcoming = [];

    for (const ev of events) {
      const comp   = ev.competitions?.[0];
      const state  = comp?.status?.type?.state;
      if (state !== "in" && state !== "pre") continue;

      const home = comp?.competitors?.find(c => c.homeAway === "home");
      const away = comp?.competitors?.find(c => c.homeAway === "away");
      if (!home || !away) continue;

      // Minuto: parse de displayClock "88:00" → 88
      let minute = 0;
      let period = comp?.status?.period ?? 1;
      const clockStr = comp?.status?.displayClock || "";
      if (state === "in") {
        const m = clockStr.match(/^(\d+)/);
        if (m) {
          minute = parseInt(m[1]);
        } else if (/HT|halftime/i.test(clockStr)) {
          minute = 45; period = 1;
        }
        // Período 2 com minuto baixo → adiciona base 45
        if (period === 2 && minute > 0 && minute < 46) minute = 45 + minute;
      }

      const parsed = {
        id:           ev.id,
        homeName:     home.team?.displayName || "?",
        awayName:     away.team?.displayName || "?",
        homeScore:    parseInt(home.score || "0"),
        awayScore:    parseInt(away.score || "0"),
        leagueName:   ev.league?.name || ev.league?.abbreviation || "?",
        leagueSlug:   ev.league?.slug || "",
        minute,
        period,
        statusDetail: comp?.status?.type?.description || "",
        startTime:    ev.date || null,
      };

      if (state === "in")  live.push(parsed);
      if (state === "pre") upcoming.push(parsed);
    }

    const result = { live, upcoming };
    cacheSet(ck, result, 30_000); // 30s
    return result;
  } catch {
    return { live:[], upcoming:[] };
  }
}

// ── AF Upcoming (cache 15min) ───────────────────────────────────────────────
async function getUpcomingAF() {
  const apiKey = process.env.APIFOOTBALL_KEY;
  if (!apiKey) return [];

  const ck  = "af_upcoming";
  const hit = cacheGet(ck);
  if (hit) return hit;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(
      `https://v3.football.api-sports.io/fixtures?date=${today}&status=NS&timezone=UTC`,
      { headers: { "x-apisports-key": apiKey }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const data     = await res.json();
    const fixtures = data.response || [];
    cacheSet(ck, fixtures, 900_000); // 15min
    return fixtures;
  } catch {
    return [];
  }
}

// ── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  res.setHeader("Cache-Control", "no-store");

  const hasAF = !!process.env.APIFOOTBALL_KEY;
  if (!hasAF) return sendFallback(res);

  try {
    // PASSO 1 — ESPN (grátis) + AF live + AF upcoming em paralelo
    const [espnBoard, afLiveRaw, afUpcomingArr] = await Promise.all([
      fetchEspnScoreboard().catch(() => ({ live:[], upcoming:[] })),
      getLiveFixtures().catch(() => []),
      getUpcomingAF().catch(() => []),
    ]);

    const espnLive     = espnBoard.live     || [];
    const espnUpcoming = espnBoard.upcoming || [];
    const afLiveArr    = afLiveRaw          || [];

    // PASSO 2 — Match ESPN ao vivo ↔ AF fixture
    const espnWithAF = espnLive.map(eg => ({
      espnGame:  eg,
      afFixture: matchAFFixture(afLiveArr, eg.homeName, eg.awayName) || null,
    }));

    const matched   = espnWithAF.filter(x => x.afFixture !== null);
    const espnOnly  = espnWithAF.filter(x => x.afFixture === null);

    // Jogos AF que o ESPN não descobriu (ligas que ESPN não cobre)
    const matchedAfIds = new Set(matched.map(x => x.afFixture?.fixture?.id));
    const afExclusive  = afLiveArr.filter(f => {
      const s = f.fixture?.status?.short;
      return ["1H","2H","ET","HT"].includes(s) && !matchedAfIds.has(f.fixture?.id);
    });

    // Lista de fixtures AF que precisam de stats
    const liveActive = [
      ...matched.map(x => x.afFixture),
      ...afExclusive,
    ].filter(f => ["1H","2H","ET","HT"].includes(f.fixture?.status?.short));

    // PASSO 3 — Stats + Lineups + Histórico em paralelo (só fixtures AF)
    const [statsArr, lineupsArr, historicalArr] = await Promise.all([

      // Stats (cache 4min — aumentado de 3min para poupar quota)
      Promise.all(liveActive.map(async f => {
        const id  = f.fixture?.id;
        const ck  = `af_stats_${id}`;
        const hit = cacheGet(ck);
        if (hit) return { id, stats: hit };
        const stats = await getFixtureStats(id).catch(() => null);
        if (stats) cacheSet(ck, stats, 240_000); // 4min
        return { id, stats };
      })),

      // Lineups (cache 4h)
      Promise.all(liveActive.map(async f => {
        const id  = f.fixture?.id;
        const ck  = `af_lineups_${id}`;
        const hit = cacheGet(ck);
        if (hit) return { id, lineups: hit };
        const lineups = await getLineups(id).catch(() => null);
        if (lineups) cacheSet(ck, lineups, 14_400_000);
        return { id, lineups };
      })),

      // Histórico: só top leagues, last=5, cache 8h
      Promise.all(liveActive.map(async f => {
        const id  = f.fixture?.id;
        const hId = f.teams?.home?.id;
        const aId = f.teams?.away?.id;
        if (!hId || !aId || !TOP_LEAGUES_HIST.has(f.league?.id)) return { id, historical: null };

        const [homeHist, awayHist, h2h] = await Promise.all([
          (async () => {
            const ck = `af_corner_hist_${hId}_5`;
            const hit = cacheGet(ck); if (hit) return hit;
            return getTeamCornerHistory(hId, 5).catch(() => null);
          })(),
          (async () => {
            const ck = `af_corner_hist_${aId}_5`;
            const hit = cacheGet(ck); if (hit) return hit;
            return getTeamCornerHistory(aId, 5).catch(() => null);
          })(),
          getH2H(hId, aId).catch(() => null),
        ]);

        const toCorner = hist => hist ? {
          forHome:     +(hist.avg * 1.10).toFixed(2),
          forAway:     +(hist.avg * 0.94).toFixed(2),
          againstHome: 0, againstAway: 0,
          avg: hist.avg, games: hist.games,
          variance: hist.variance, min: hist.min, max: hist.max,
        } : null;

        const hc      = toCorner(homeHist);
        const ac      = toCorner(awayHist);
        const h2hData = parseH2HCorners(h2h);

        return {
          id,
          historical: (hc || ac || h2hData) ? {
            homeCornerAvgHome:  hc?.forHome  ?? null,
            homeCornerAvgAway:  hc?.forAway  ?? null,
            awayCornerAvgHome:  ac?.forHome  ?? null,
            awayCornerAvgAway:  ac?.forAway  ?? null,
            homeCornerAgstHome: 0, awayCornerAgstAway: 0,
            homeAvgRaw:   homeHist?.avg      ?? null,
            awayAvgRaw:   awayHist?.avg      ?? null,
            homeGames:    homeHist?.games    ?? 0,
            awayGames:    awayHist?.games    ?? 0,
            homeVariance: homeHist?.variance ?? null,
            awayVariance: awayHist?.variance ?? null,
            homeMin:      homeHist?.min      ?? null,
            homeMax:      homeHist?.max      ?? null,
            awayMin:      awayHist?.min      ?? null,
            awayMax:      awayHist?.max      ?? null,
            h2hAvgGoals:   h2hData?.avgGoals        ?? null,
            h2hEstCorners: h2hData?.estimatedCorners ?? null,
            h2hGames:      h2hData?.games            ?? 0,
            homeForm: null, awayForm: null,
          } : null,
        };
      })),

    ]); // fim Promise.all geral

    const statsMap      = Object.fromEntries(statsArr    .map(({id,stats})     => [id, stats]));
    const lineupsMap    = Object.fromEntries(lineupsArr  .map(({id,lineups})   => [id, lineups]));
    const historicalMap = Object.fromEntries(historicalArr.map(({id,historical})=> [id, historical]));

    // PASSO 4 — Monta jogos ao vivo

    // 4a. Matched ESPN + AF (dados completos com stats)
    const gamesMatched = matched.map(({ afFixture }) => {
      const id   = afFixture.fixture?.id;
      const game = normalizeAFGame(afFixture, statsMap[id]||null, lineupsMap[id]||null, false);
      if (historicalMap[id]) game.historical = historicalMap[id];
      return game;
    });

    // 4b. Só ESPN (sem match AF) — mostra jogo, sem análise de stats
    const gamesEspnOnly = espnOnly.map(({ espnGame }) => normalizeEspnOnlyGame(espnGame));

    // 4c. Só AF (ligas que ESPN não cobre)
    const gamesAfOnly = afExclusive.map(f => {
      const id   = f.fixture?.id;
      const game = normalizeAFGame(f, statsMap[id]||null, lineupsMap[id]||null, false);
      if (historicalMap[id]) game.historical = historicalMap[id];
      return game;
    });

    // Ordem de prioridade: matched (completos) → AF exclusivos → ESPN-only (básicos)
    const allLiveGames = [...gamesMatched, ...gamesAfOnly, ...gamesEspnOnly];

    // PASSO 5 — Upcoming
    const now = Date.now();

    // 5a. ESPN upcoming: próximas 6h, SEM filtro de liga
    const upcomingEspnNorm = new Set();
    const upcomingEspnFull = espnUpcoming
      .filter(eg => {
        if (!eg.startTime) return false;
        const kick = new Date(eg.startTime).getTime();
        return kick > now && kick < now + 6 * 3_600_000;
      })
      .map(eg => {
        const key = `${normName(eg.homeName)}_${normName(eg.awayName)}`;
        upcomingEspnNorm.add(key);
        const hShort = (eg.homeName||"?").split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase().slice(0,4)||"HOM";
        const aShort = (eg.awayName||"?").split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase().slice(0,4)||"AWY";

        // Tenta enriquecer com dados AF upcoming
        const afFix = matchAFFixture(afUpcomingArr, eg.homeName, eg.awayName);
        return {
          id:            afFix ? String(afFix.fixture?.id) : `espn_${eg.id}`,
          afFixtureId:   afFix?.fixture?.id || null,
          home:          afFix?.teams?.home?.name || eg.homeName,
          away:          afFix?.teams?.away?.name || eg.awayName,
          homeShort:     hShort,
          awayShort:     aShort,
          homeId:        afFix?.teams?.home?.id  || null,
          awayId:        afFix?.teams?.away?.id  || null,
          league:        afFix?.league?.name || eg.leagueName,
          leagueId:      afFix ? `af_${afFix.league?.id}` : `espn_${eg.leagueSlug}`,
          leagueCountry: afFix ? flag(afFix.league?.country) : "🏳️",
          leagueAfId:    afFix?.league?.id || null,
          season:        afFix?.league?.season || null,
          score:         { home:0, away:0 },
          minute:0, period:0, clock:"",
          startTime:     afFix?.fixture?.date || eg.startTime,
          statusDetail:  "",
          isUpcoming:    true,
          isDemo:        false,
          dataSource:    afFix ? "hybrid" : "espn",
          possession:{home:50,away:50}, shots:{home:0,away:0}, onTarget:{home:0,away:0},
          corners:{home:0,away:0}, fouls:{home:0,away:0},
          yellowCards:{home:0,away:0}, redCards:{home:0,away:0},
          dangerousAttacks:{home:0,away:0}, dangerousAttacksReal:false,
          saves:{home:0,away:0}, offsides:{home:0,away:0},
          crosses:null, passes:{home:0,away:0}, accuratePasses:{home:0,away:0},
          blockedShots:{home:0,away:0}, shotsInsideBox:null, shotsOutsideBox:null,
          substitutions:[], offensiveSubs:{home:0,away:0}, formations:null, venue:null,
        };
      });

    // 5b. AF upcoming exclusivos (ligas que ESPN não mostra)
    const afExclusiveUpcoming = afUpcomingArr
      .filter(f => {
        const kick = (f.fixture?.timestamp || 0) * 1000;
        if (kick <= now || kick > now + 6 * 3_600_000) return false;
        const hn = f.teams?.home?.name || "";
        const an = f.teams?.away?.name || "";
        const key = normName(hn) + "_" + normName(an);
        return !upcomingEspnNorm.has(key);
      })
      .map(f => normalizeAFGame(f, null, null, true));

    const upcoming = [...upcomingEspnFull, ...afExclusiveUpcoming]
      .sort((a, b) => new Date(a.startTime||0) - new Date(b.startTime||0))
      .slice(0, 80);

    // PASSO 6 — Resposta
    return res.status(200).json({
      games:         allLiveGames,
      upcoming,
      liveCount:     allLiveGames.length,
      upcomingCount: upcoming.length,
      afPrimary:     true,
      afEnriched:    true,
      hybrid:        true,
      demo:          false,
      timestamp:     new Date().toISOString(),
      meta: {
        espnLive:    espnLive.length,
        afLive:      afLiveArr.length,
        matched:     matched.length,
        espnOnly:    espnOnly.length,
        afExclusive: afExclusive.length,
      },
    });

  } catch (err) {
    console.error("[games.js v31 error]", err.message);
    return sendFallback(res);
  }
}

// ── Fallback sem AF ──────────────────────────────────────────────────────────
function sendFallback(res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    games:[], upcoming:[], liveCount:0, upcomingCount:0,
    demo:true, afPrimary:false, hybrid:false,
    timestamp: new Date().toISOString(),
  });
}
