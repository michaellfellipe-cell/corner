/**
 * lib/supabase.js — Cliente Supabase completo
 * Sem dependências externas — usa fetch nativo via REST API
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // service_role key

const headers = () => ({
  "Content-Type":  "application/json",
  "apikey":        SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
});

const isConfigured = () => !!(SUPABASE_URL && SUPABASE_KEY);

// ── Primitivas ─────────────────────────────────────────────────────────────

export async function supabaseInsert(table, data) {
  if (!isConfigured()) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method:  "POST",
      headers: { ...headers(), "Prefer": "return=representation" },
      body:    JSON.stringify(data),
      signal:  AbortSignal.timeout(6000),
    });
    if (!res.ok) { console.error(`[sb] INSERT ${table}:`, await res.text()); return null; }
    return await res.json();
  } catch (e) { console.error(`[sb] INSERT ${table}:`, e.message); return null; }
}

export async function supabaseUpdate(table, id, data) {
  if (!isConfigured()) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method:  "PATCH",
      headers: { ...headers(), "Prefer": "return=representation" },
      body:    JSON.stringify(data),
      signal:  AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { console.error(`[sb] UPDATE ${table}:`, e.message); return null; }
}

export async function supabaseQuery(path) {
  if (!isConfigured()) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: headers(),
      signal:  AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

// ── Log de predição ────────────────────────────────────────────────────────
// Só loga STRONG e MODERATE. Guarda janela_start/end para verificação
// automática posterior.
export async function logPrediction(game, prediction) {
  if (!isConfigured() || !prediction || prediction.signal === "WEAK") return null;

  // Extrai janela de aposta em minutos para facilitar verificação
  const window = prediction.targetBetWindow;
  const windowStart = window?.start ?? null;
  const windowEnd   = window?.end   ?? null;

  // Qual mercado: extrai mínimo de corners necessários
  // "3+ corners" → 3, "2+ corners" → 2, "1+ corner" → 1
  const marketText = prediction.market?.betRange || "";
  const minCorners = marketText.startsWith("3+") ? 3
                   : marketText.startsWith("2+") ? 2
                   : marketText.startsWith("1+") ? 1
                   : null; // sem mercado claro = não verificável

  return supabaseInsert("predictions", {
    fixture_id:      String(game.afFixtureId || game.id || ""),
    league_id:       game.leagueAfId   || null,
    league_name:     game.league       || null,
    home_team:       game.home         || null,
    away_team:       game.away         || null,
    minute:          game.minute,
    period:          game.period,
    score_home:      game.score?.home  ?? 0,
    score_away:      game.score?.away  ?? 0,
    phase:           prediction.phase,
    sub_phase:       prediction.subPhase,
    confidence:      prediction.confidence,
    signal:          prediction.signal,
    projected10:     prediction.projected10,
    pressure_mult:   prediction.pressureMult,
    market:          marketText || null,
    min_corners_needed: minCorners,
    bet_window:      window?.label     || null,
    window_start:    windowStart,
    window_end:      windowEnd,
    is_final_window: prediction.isFinalWindow || false,
    corners_at_log:  prediction.totalCorners,
    has_hist_data:   prediction.hasHistoricalData || false,
    af_enriched:     prediction.afEnriched || false,
    result:          null,  // preenchido automaticamente pelo cron
    verified:        false,
  });
}

// ── Log de snapshot temporal ───────────────────────────────────────────────
// Chamado pelo cron a cada 5 min. Guarda corners acumulados por minuto.
export async function logSnapshot(game) {
  if (!isConfigured() || !game.afFixtureId || !game.hasStats) return null;

  return supabaseInsert("snapshots", {
    fixture_id: String(game.afFixtureId),
    minute:     game.minute,
    corners:    (game.corners?.home  || 0) + (game.corners?.away  || 0),
    crosses:    (game.crosses?.home  || 0) + (game.crosses?.away  || 0),
    blocked:    (game.blockedShots?.home || 0) + (game.blockedShots?.away || 0),
    shots:      (game.shots?.home    || 0) + (game.shots?.away    || 0),
    da_home:    game.dangerousAttacks?.home || 0,
    da_away:    game.dangerousAttacks?.away || 0,
    score_home: game.score?.home || 0,
    score_away: game.score?.away || 0,
    is_live:    true,
  });
}

// ── Log de jogo encerrado ──────────────────────────────────────────────────
// Chamado pelo cron quando detecta status FT. Guarda placar e corners finais.
export async function logFinishedGame(game, finalCorners) {
  if (!isConfigured()) return null;
  return supabaseInsert("finished_games", {
    fixture_id:     String(game.afFixtureId),
    league_id:      game.leagueAfId || null,
    league_name:    game.league || null,
    home_team:      game.home,
    away_team:      game.away,
    score_home:     game.score?.home || 0,
    score_away:     game.score?.away || 0,
    final_corners:  finalCorners,
    finished_at:    new Date().toISOString(),
  });
}

// ── Verificação automática de predições ───────────────────────────────────
// Para cada predição pendente de um jogo encerrado:
// Busca snapshots do início e fim da janela → calcula corners na janela
// → compara com min_corners_needed → win ou loss
export async function verifyPredictionsForFixture(fixtureId, allSnapshots) {
  if (!isConfigured()) return 0;

  // Busca predições pendentes deste fixture
  const pending = await supabaseQuery(
    `predictions?fixture_id=eq.${fixtureId}&verified=eq.false&min_corners_needed=not.is.null&select=*`
  );
  if (!pending?.length) return 0;

  let verified = 0;

  for (const pred of pending) {
    const windowStart = pred.window_start;
    const windowEnd   = pred.window_end;
    const needed      = pred.min_corners_needed;

    if (windowStart === null || windowEnd === null || needed === null) {
      // Predição sem janela definida — marca como não verificável
      await supabaseUpdate("predictions", pred.id, { verified: true, result: "skip", notes: "Janela indefinida" });
      continue;
    }

    // Encontra snapshot mais próximo do início da janela
    const snapStart = closestSnapshot(allSnapshots, windowStart);
    // Encontra snapshot mais próximo do fim da janela (ou FT)
    const snapEnd   = closestSnapshot(allSnapshots, windowEnd + 2); // +2 para pegar após virada

    if (!snapStart || !snapEnd) {
      // Sem dados suficientes — pula esta predição
      continue;
    }

    const cornersInWindow = Math.max(0, snapEnd.corners - snapStart.corners);

    const result = cornersInWindow >= needed ? "win" : "loss";

    await supabaseUpdate("predictions", pred.id, {
      verified:           true,
      result,
      result_at:          new Date().toISOString(),
      corners_in_window:  cornersInWindow,
      notes:              `Auto: ${cornersInWindow} corners na janela ${windowStart}-${windowEnd}. Precisava ${needed}.`,
    });

    verified++;
  }

  return verified;
}

// Helper: snapshot com minuto mais próximo do alvo
function closestSnapshot(snapshots, targetMinute) {
  if (!snapshots?.length) return null;
  return snapshots.reduce((best, s) => {
    if (!best) return s;
    return Math.abs(s.minute - targetMinute) < Math.abs(best.minute - targetMinute) ? s : best;
  }, null);
}

// ── Busca para o dashboard ─────────────────────────────────────────────────
export async function getRecentPredictions(limit = 50) {
  return supabaseQuery(`predictions?order=created_at.desc&limit=${limit}&select=*`);
}

export async function getPerfSummary() {
  return supabaseQuery(`performance_summary?select=*`);
}

export async function getPerfByLeague() {
  return supabaseQuery(`performance_by_league?select=*`);
}
