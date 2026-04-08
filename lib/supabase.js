/**
 * lib/supabase.js — v38
 * - Ciclo T1/T2: registra par de janelas, verifica como ciclo completo
 * - Deduplicação: fixture_id + bet_window únicos por predição
 * - Performance views atualizadas para ciclo
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

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

// ── Mapa de janelas adjacentes para ciclo T1/T2 ────────────────────────────
// T1 (janela atual) → T2 (janela de recuperação)
// Regra: só existe T2 se a faixa seguinte for Over 0.5 (não 80-FIM que é Over 1.5)
const T2_WINDOW = {
  "40-49min": { label: "50-59min", start: 50, end: 59 },
  "50-59min": { label: "60-69min", start: 60, end: 69 },
  "60-69min": { label: "70-79min", start: 70, end: 79 },
  // 70-79 → 80-FIM é Over 1.5, mercado diferente → sem T2
  // 80-FIM → sem T2
};

// ── Log de predição com ciclo T1/T2 e deduplicação ────────────────────────
export async function logPrediction(game, prediction) {
  if (!isConfigured() || !prediction || prediction.signal === "WEAK") return null;

  const fixtureId  = String(game.afFixtureId || game.id || "");
  const windowObj  = prediction.targetBetWindow;
  const betWindow  = windowObj?.label || null;

  // ── DEDUPLICAÇÃO: só salva se não existe predição recente para este
  // fixture + janela (evita múltiplos registros do mesmo sinal)
  if (fixtureId && betWindow) {
    const existing = await supabaseQuery(
      `predictions?fixture_id=eq.${fixtureId}&bet_window=eq.${encodeURIComponent(betWindow)}&verified=eq.false&select=id&limit=1`
    );
    if (existing?.length > 0) return null; // já existe, não duplica
  }

  // Mercado: extrai mínimo de corners necessários
  const marketText = prediction.market?.betRange || "";
  const minCorners = marketText.startsWith("3+") ? 3
                   : marketText.startsWith("2+") ? 2
                   : marketText.startsWith("1+") ? 1
                   : null;

  // ── CICLO T1/T2: calcula janela de recuperação
  const t2 = betWindow ? T2_WINDOW[betWindow] : null;

  return supabaseInsert("predictions", {
    fixture_id:         fixtureId,
    league_id:          game.leagueAfId   || null,
    league_name:        game.league       || null,
    home_team:          game.home         || null,
    away_team:          game.away         || null,
    minute:             game.minute,
    period:             game.period,
    score_home:         game.score?.home  ?? 0,
    score_away:         game.score?.away  ?? 0,
    phase:              prediction.phase,
    sub_phase:          prediction.subPhase,
    confidence:         prediction.confidence,
    signal:             prediction.signal,
    projected10:        prediction.projected10,
    pressure_mult:      prediction.pressureMult,
    market:             marketText || null,
    min_corners_needed: minCorners,

    // Janela T1 (entrada principal)
    bet_window:         betWindow,
    window_start:       windowObj?.start ?? null,
    window_end:         windowObj?.end   ?? null,

    // Janela T2 (recuperação) — null se não houver
    t2_window:          t2?.label  ?? null,
    t2_start:           t2?.start  ?? null,
    t2_end:             t2?.end    ?? null,
    has_t2:             !!t2,

    is_final_window:    prediction.isFinalWindow || false,
    corners_at_log:     prediction.totalCorners,
    has_hist_data:      prediction.hasHistoricalData || false,
    af_enriched:        prediction.afEnriched || false,

    // Resultado ciclo — preenchido automaticamente pelo cron
    result:             null,   // 't1_win' | 't2_win' | 'cycle_loss' | 'no_t2_loss'
    t1_result:          null,   // 'win' | 'loss'
    t2_result:          null,   // 'win' | 'loss' | null (se não teve T2)
    verified:           false,
    corners_in_window:  null,
    corners_in_t2:      null,
  });
}

// ── Log de snapshot temporal ───────────────────────────────────────────────
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

// ── Verificação automática — ciclo T1/T2 ──────────────────────────────────
// Lógica de resultado:
//   T1 ganhou → result = 't1_win'     (lucro na primeira tentativa)
//   T1 perdeu, T2 ganhou → 't2_win'  (recuperação + lucro)
//   T1 perdeu, T2 perdeu → 'cycle_loss' (perda total)
//   T1 perdeu, sem T2 → 'no_t2_loss' (faixa 70-79 ou 80-FIM)
export async function verifyPredictionsForFixture(fixtureId, allSnapshots) {
  if (!isConfigured()) return 0;

  const pending = await supabaseQuery(
    `predictions?fixture_id=eq.${fixtureId}&verified=eq.false&min_corners_needed=not.is.null&select=*`
  );
  if (!pending?.length) return 0;

  let verified = 0;

  for (const pred of pending) {
    const t1Start  = pred.window_start;
    const t1End    = pred.window_end;
    const needed   = pred.min_corners_needed;

    if (t1Start === null || t1End === null || needed === null) {
      await supabaseUpdate("predictions", pred.id, {
        verified: true, result: "skip", notes: "Janela indefinida",
      });
      continue;
    }

    // Snapshots da janela T1
    const snapT1Start = closestSnapshot(allSnapshots, t1Start);
    const snapT1End   = closestSnapshot(allSnapshots, t1End + 2);

    if (!snapT1Start || !snapT1End) continue; // dados insuficientes

    const cornersT1  = Math.max(0, snapT1End.corners - snapT1Start.corners);
    const t1Win      = cornersT1 >= needed;

    if (t1Win) {
      // T1 ganhou — ciclo encerrado com lucro
      await supabaseUpdate("predictions", pred.id, {
        verified: true, result: "t1_win", t1_result: "win",
        result_at: new Date().toISOString(),
        corners_in_window: cornersT1,
        notes: `T1 WIN: ${cornersT1} corners em ${t1Start}-${t1End}. Precisava ${needed}.`,
      });
      verified++;
      continue;
    }

    // T1 perdeu — verifica T2 se disponível
    if (!pred.has_t2 || pred.t2_start === null) {
      // Sem T2 (faixa 70-79 ou 80-FIM) — perda sem recuperação
      await supabaseUpdate("predictions", pred.id, {
        verified: true, result: "no_t2_loss", t1_result: "loss",
        result_at: new Date().toISOString(),
        corners_in_window: cornersT1,
        notes: `T1 LOSS (sem T2): ${cornersT1} corners em ${t1Start}-${t1End}. Precisava ${needed}.`,
      });
      verified++;
      continue;
    }

    // Verifica T2
    const snapT2Start = closestSnapshot(allSnapshots, pred.t2_start);
    const snapT2End   = closestSnapshot(allSnapshots, pred.t2_end + 2);

    if (!snapT2Start || !snapT2End) {
      // Dados de T2 não disponíveis ainda — aguarda próxima verificação
      continue;
    }

    const cornersT2 = Math.max(0, snapT2End.corners - snapT2Start.corners);
    const t2Win     = cornersT2 >= needed;

    await supabaseUpdate("predictions", pred.id, {
      verified:          true,
      result:            t2Win ? "t2_win" : "cycle_loss",
      t1_result:         "loss",
      t2_result:         t2Win ? "win" : "loss",
      result_at:         new Date().toISOString(),
      corners_in_window: cornersT1,
      corners_in_t2:     cornersT2,
      notes: t2Win
        ? `T1 LOSS → T2 WIN: ${cornersT2} corners em ${pred.t2_start}-${pred.t2_end}. Recuperado.`
        : `CYCLE LOSS: T1=${cornersT1} T2=${cornersT2}. Precisava ${needed} em cada.`,
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

// ── Dashboard ──────────────────────────────────────────────────────────────
export async function getRecentPredictions(limit = 50) {
  return supabaseQuery(`predictions?order=created_at.desc&limit=${limit}&select=*`);
}

export async function getPerfSummary() {
  return supabaseQuery(`performance_summary?select=*`);
}

export async function getPerfByLeague() {
  return supabaseQuery(`performance_by_league?select=*`);
}
