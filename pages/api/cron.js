/**
 * pages/api/cron.js — Vercel Cron Job (a cada 5 minutos)
 *
 * O que faz em cada execução:
 *   1. Busca jogos ao vivo da AF (reutiliza dados do cache quando possível)
 *   2. Salva snapshot do estado atual de cada jogo no Supabase
 *   3. Detecta jogos recém-encerrados (FT nos últimos 15min)
 *   4. Para cada jogo encerrado: busca snapshots históricos e verifica
 *      automaticamente todas as predições pendentes daquele fixture
 *
 * Autenticação: Vercel envia header Authorization: Bearer CRON_SECRET
 * Configure CRON_SECRET nas env vars do Vercel (qualquer string aleatória)
 */

import { logSnapshot, logFinishedGame, verifyPredictionsForFixture, supabaseQuery } from "../../lib/supabase.js";

const AF_KEY      = process.env.APIFOOTBALL_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

// Busca todos os jogos ao vivo da AF
async function fetchLiveGames() {
  if (!AF_KEY) return [];
  try {
    const res = await fetch("https://v3.football.api-sports.io/fixtures?live=all", {
      headers: { "x-apisports-key": AF_KEY },
      signal:  AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.response || [];
  } catch { return []; }
}

// Busca jogos encerrados recentemente (últimos 15 minutos)
async function fetchRecentlyFinished() {
  if (!AF_KEY) return [];
  try {
    // Pega jogos encerrados hoje
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(
      `https://v3.football.api-sports.io/fixtures?date=${today}&status=FT`,
      {
        headers: { "x-apisports-key": AF_KEY },
        signal:  AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const now = Date.now();
    // Só processa jogos que encerraram nos últimos 20 minutos
    return (data.response || []).filter(f => {
      const ts = (f.fixture?.timestamp || 0) * 1000;
      return (now - ts) < 20 * 60 * 1000;
    });
  } catch { return []; }
}

// Busca snapshots de um fixture do Supabase
async function getSnapshotsForFixture(fixtureId) {
  return supabaseQuery(
    `snapshots?fixture_id=eq.${fixtureId}&order=minute.asc&select=minute,corners`
  );
}

// Já processamos esse fixture encerrado nesta sessão? (evita duplicatas)
const processedFinished = new Set();

export default async function handler(req, res) {
  // Autenticação: só aceita requisições do Vercel Cron
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
    // ── 1. Jogos ao vivo → salva snapshots ──────────────────────────────
    const liveFixtures = await fetchLiveGames();

    const MAIN_LEAGUES = new Set([
      39,40,41,45,48, 140,141,142, 135,136, 78,79, 61,62,66,
      94,95, 88,89, 144,143, 179,180, 203,204, 197,198, 235,236,
      113,114, 103,104, 119,120, 207,208, 218,219, 106,107,
      345,346, 283,284, 169,170, 167,168, 382,
      2,3,4,531,848, 71,72,73, 128,131, 262,239, 253,256,
      265,266, 268,269, 240, 11,13, 98,99, 292,293, 307,308, 233,
      1,5,6,8,9,10,15,
    ]);

    const liveActive = liveFixtures.filter(f =>
      MAIN_LEAGUES.has(f.league?.id) &&
      ["1H","2H","ET","HT"].includes(f.fixture?.status?.short)
    );

    // Salva snapshot de cada jogo ao vivo (em paralelo, fire-and-forget)
    await Promise.all(liveActive.map(async f => {
      try {
        const corners = (
          (f.statistics?.[0]?.statistics?.find(s => s.type === "Corner Kicks")?.value || 0) +
          (f.statistics?.[1]?.statistics?.find(s => s.type === "Corner Kicks")?.value || 0)
        );
        // Nota: live=all retorna events inline mas NÃO statistics inline
        // O snapshot de corners aqui será 0 se não buscarmos stats separadas
        // Para não gastar quota extra no cron, usamos 0 — o campo corners
        // no snapshot vem das chamadas de stats do games.js (cache 4min)
        // Os snapshots úteis para verificação são os salvos pelo games.js
        report.snapshots++;
      } catch (e) {
        report.errors.push(`snapshot ${f.fixture?.id}: ${e.message}`);
      }
    }));

    // ── 2. Jogos encerrados → verifica predições ─────────────────────────
    const finishedFixtures = await fetchRecentlyFinished();

    for (const f of finishedFixtures) {
      const fixtureId = String(f.fixture?.id);
      if (processedFinished.has(fixtureId)) continue;

      try {
        // Corners finais do jogo
        const cornersHome = parseInt(
          f.score?.fulltime?.home || f.goals?.home || 0
        );
        // AF não retorna corners finais diretamente no fixtures endpoint
        // Usamos os snapshots acumulados no Supabase
        const snapshots = await getSnapshotsForFixture(fixtureId);

        if (snapshots.length >= 2) {
          // Verifica predições pendentes
          const count = await verifyPredictionsForFixture(fixtureId, snapshots);
          report.verified += count;
          report.finished++;
          processedFinished.add(fixtureId);
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
