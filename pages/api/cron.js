/**
 * pages/api/cron.js — Executado pelo GitHub Actions a cada 5 minutos
 *
 * Responsabilidades:
 *   1. Busca jogos ao vivo da AF + stats → salva snapshots no Supabase
 *   2. Detecta jogos encerrados hoje (FT)
 *   3. Para cada encerrado: busca snapshots salvos → verifica predições pendentes
 *      → atualiza result = 'win' | 'loss' automaticamente
 *
 * Autenticação: header Authorization: Bearer CRON_SECRET
 */

import { logSnapshot, verifyPredictionsForFixture, supabaseQuery } from "../../lib/supabase.js";

const AF_KEY      = process.env.APIFOOTBALL_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const MAIN_LEAGUES = new Set([
  39,40,41,45,48, 140,141,142, 135,136, 78,79, 61,62,66,
  94,95, 88,89, 144,143, 179,180, 203,204, 197,198, 235,236,
  113,114, 103,104, 119,120, 207,208, 218,219, 106,107,
  345,346, 283,284, 169,170, 167,168, 382,
  2,3,4,531,848, 71,72,73, 128,131, 262,239, 253,256,
  265,266, 268,269, 240, 11,13, 98,99, 292,293, 307,308, 233,
  1,5,6,8,9,10,15,
]);

// ── AF helpers ──────────────────────────────────────────────────────────────
async function afGet(path) {
  if (!AF_KEY) return null;
  try {
    const res = await fetch(`https://v3.football.api-sports.io${path}`, {
      headers: { "x-apisports-key": AF_KEY },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.errors && Object.keys(data.errors).length) return null;
    return data.response || null;
  } catch { return null; }
}

// Extrai stat do array de statistics da AF
function getStat(statsArr, teamIdx, type) {
  const v = statsArr?.[teamIdx]?.statistics?.find(s => s.type === type)?.value;
  if (v === null || v === undefined) return 0;
  return parseInt(v) || 0;
}

// ── Busca jogos ao vivo com stats ───────────────────────────────────────────
async function fetchLiveWithStats() {
  const fixtures = await afGet("/fixtures?live=all");
  if (!fixtures?.length) return [];

  const active = fixtures.filter(f =>
    MAIN_LEAGUES.has(f.league?.id) &&
    ["1H","2H","ET","HT"].includes(f.fixture?.status?.short)
  );
  if (!active.length) return [];

  // Busca stats em lotes de 5 para não explodir quota
  const results = [];
  for (let i = 0; i < active.length; i += 5) {
    const batch = active.slice(i, i + 5);
    const statsArr = await Promise.all(
      batch.map(f =>
        afGet(`/fixtures/statistics?fixture=${f.fixture?.id}`).catch(() => null)
      )
    );
    batch.forEach((f, idx) => {
      results.push({ fixture: f, stats: statsArr[idx] });
    });
  }
  return results;
}

// ── Busca todos os jogos FT de hoje ────────────────────────────────────────
async function fetchTodayFinished() {
  const today = new Date().toISOString().slice(0, 10);
  const fixtures = await afGet(`/fixtures?date=${today}&status=FT`);
  if (!fixtures?.length) return [];
  // Filtra apenas MAIN_LEAGUES
  return fixtures.filter(f => MAIN_LEAGUES.has(f.league?.id));
}

// ── Busca snapshots de um fixture do Supabase ───────────────────────────────
async function getSnapshotsForFixture(fixtureId) {
  return supabaseQuery(
    `snapshots?fixture_id=eq.${fixtureId}&order=minute.asc&select=minute,corners`
  );
}

// ── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Autenticação
  const auth = req.headers["authorization"] || "";
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!process.env.SUPABASE_URL) {
    return res.status(200).json({ skipped: true, reason: "Supabase não configurado" });
  }

  const startTime = Date.now();
  const report = { snapshots: 0, verified: 0, finished: 0, errors: [] };

  try {
    // ── PARTE 1: Salva snapshots dos jogos ao vivo ──────────────────────────
    const liveWithStats = await fetchLiveWithStats();

    for (const { fixture: f, stats } of liveWithStats) {
      try {
        const corners = getStat(stats, 0, "Corner Kicks") + getStat(stats, 1, "Corner Kicks");
        const crosses = getStat(stats, 0, "Total Crosses") + getStat(stats, 1, "Total Crosses");
        const blocked = getStat(stats, 0, "Blocked Shots") + getStat(stats, 1, "Blocked Shots");
        const shots   = getStat(stats, 0, "Total Shots")   + getStat(stats, 1, "Total Shots");

        // Só salva se tiver pelo menos algum dado real (evita snapshots zeros inúteis)
        if (corners > 0 || shots > 0) {
          await logSnapshot({
            afFixtureId:     f.fixture?.id,
            hasStats:        true,
            minute:          f.fixture?.status?.elapsed || 0,
            corners:         { home: getStat(stats, 0, "Corner Kicks"),  away: getStat(stats, 1, "Corner Kicks")  },
            crosses:         { home: getStat(stats, 0, "Total Crosses"), away: getStat(stats, 1, "Total Crosses") },
            blockedShots:    { home: getStat(stats, 0, "Blocked Shots"), away: getStat(stats, 1, "Blocked Shots") },
            shots:           { home: getStat(stats, 0, "Total Shots"),   away: getStat(stats, 1, "Total Shots")   },
            dangerousAttacks:{ home: getStat(stats, 0, "Dangerous Attacks"), away: getStat(stats, 1, "Dangerous Attacks") },
            score:           { home: f.goals?.home || 0, away: f.goals?.away || 0 },
          });
          report.snapshots++;
        }
      } catch (e) {
        report.errors.push(`snap ${f.fixture?.id}: ${e.message}`);
      }
    }

    // ── PARTE 2: Verifica predições de jogos encerrados ─────────────────────
    const finishedFixtures = await fetchTodayFinished();

    // Busca fixture_ids que têm predições pendentes no Supabase
    const pendingIds = await supabaseQuery(
      `predictions?verified=eq.false&min_corners_needed=not.is.null&select=fixture_id`
    );
    const pendingSet = new Set((pendingIds || []).map(p => String(p.fixture_id)));

    for (const f of finishedFixtures) {
      const fixtureId = String(f.fixture?.id);
      if (!pendingSet.has(fixtureId)) continue; // sem predições pendentes, pula

      try {
        const snapshots = await getSnapshotsForFixture(fixtureId);

        if (snapshots.length < 2) continue; // dados insuficientes para verificar

        const count = await verifyPredictionsForFixture(fixtureId, snapshots);
        if (count > 0) {
          report.verified += count;
          report.finished++;
        }
      } catch (e) {
        report.errors.push(`verify ${fixtureId}: ${e.message}`);
      }
    }

  } catch (e) {
    report.errors.push(`global: ${e.message}`);
  }

  report.duration_ms = Date.now() - startTime;
  return res.status(200).json({ ok: true, ...report });
}
