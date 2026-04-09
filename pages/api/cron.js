/**
 * pages/api/cron.js — v38 corrigido
 * Timeout fix: operações divididas, sem busca extra de stats na AF
 *
 * O cron NÃO busca stats separadas da AF — isso seria quota dupla.
 * Os snapshots com dados reais já são salvos pelo games.js quando o app está aberto.
 * O cron faz apenas:
 *   1. Detecta jogos FT do dia
 *   2. Para os que têm predições pendentes → busca snapshots do Supabase → verifica
 */

import { verifyPredictionsForFixture, supabaseQuery, supabaseInsert } from "../../lib/supabase.js";

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

// Busca jogos FT de hoje na AF (leve — só status, sem stats)
async function fetchTodayFinished() {
  if (!AF_KEY) return [];
  try {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(
      `https://v3.football.api-sports.io/fixtures?date=${today}&status=FT`,
      {
        headers: { "x-apisports-key": AF_KEY },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.response || []).filter(f => MAIN_LEAGUES.has(f.league?.id));
  } catch { return []; }
}

// Busca snapshots de um fixture do Supabase
async function getSnapshots(fixtureId) {
  return supabaseQuery(
    `snapshots?fixture_id=eq.${fixtureId}&order=minute.asc&select=minute,corners`
  );
}

export default async function handler(req, res) {
  // Autenticação
  const auth = req.headers["authorization"] || "";
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!process.env.SUPABASE_URL) {
    return res.status(200).json({ skipped: true, reason: "Supabase não configurado" });
  }

  const start  = Date.now();
  const report = { verified: 0, finished: 0, skipped: 0, errors: [] };

  try {
    // 1. Busca fixture_ids com predições pendentes no Supabase
    const pending = await supabaseQuery(
      `predictions?verified=eq.false&min_corners_needed=not.is.null&select=fixture_id`
    );
    if (!pending?.length) {
      return res.status(200).json({ ok: true, ...report, msg: "Sem predições pendentes" });
    }

    const pendingIds = [...new Set(pending.map(p => String(p.fixture_id)))];

    // 2. Busca jogos FT de hoje
    const finished = await fetchTodayFinished();
    const finishedIds = new Set(finished.map(f => String(f.fixture?.id)));

    // 3. Verifica apenas fixtures que: têm predições pendentes E encerraram hoje
    for (const fixtureId of pendingIds) {
      if (!finishedIds.has(fixtureId)) {
        report.skipped++;
        continue; // jogo ainda em andamento ou de outro dia
      }

      try {
        const snapshots = await getSnapshots(fixtureId);
        if (snapshots.length < 2) {
          report.skipped++;
          continue; // poucos snapshots para verificar
        }

        const count = await verifyPredictionsForFixture(fixtureId, snapshots);
        report.verified += count;
        report.finished++;
      } catch (e) {
        report.errors.push(`${fixtureId}: ${e.message}`);
      }
    }

  } catch (e) {
    report.errors.push(`global: ${e.message}`);
  }

  report.duration_ms = Date.now() - start;
  return res.status(200).json({ ok: true, ...report });
}
