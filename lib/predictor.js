/**
 * lib/predictor.js
 * Algoritmo de predição de escanteios baseado em múltiplos fatores
 * Pontuação máxima teórica: ~120 pts → normalizado para 0-98%
 */

export function predictCorners(game) {
  let score = 0;
  const factors = [];

  const addFactor = (label, value, weight) => {
    score += weight;
    factors.push({ label, value, weight });
  };

  // ── 1. Pressão na zona de ataque ──────────────────────────────
  if (game.pressureIndex !== undefined) {
    if (game.pressureIndex > 75) addFactor("Pressão extrema na área", `${game.pressureIndex}%`, 25);
    else if (game.pressureIndex > 55) addFactor("Alta pressão final terceiro", `${game.pressureIndex}%`, 14);
    else if (game.pressureIndex > 40) addFactor("Pressão moderada", `${game.pressureIndex}%`, 7);
  }

  // ── 2. Domínio em ataques perigosos ──────────────────────────
  const totalDA = game.dangerousAttacks.home + game.dangerousAttacks.away;
  if (totalDA > 0) {
    const homeDA = game.dangerousAttacks.home / totalDA;
    if (homeDA > 0.65) addFactor("Ataques perigosos: domínio casa", `${Math.round(homeDA * 100)}%`, 20);
    else if (homeDA < 0.35) addFactor("Ataques perigosos: domínio visitante", `${Math.round((1 - homeDA) * 100)}%`, 16);
    else if (totalDA > 60) addFactor("Volume alto ataques perigosos", totalDA, 10);
  }

  // ── 3. Chutes a gol sem conversão (pressão sem gol) ──────────
  const totalShots = game.shots.home + game.shots.away;
  const totalGoals = game.score.home + game.score.away;
  if (totalShots >= 6 && totalGoals === 0) addFactor("Muitos chutes, zero gols — pressão crescente", totalShots, 15);
  else if (totalShots >= 10) addFactor("Volume alto de chutes no geral", totalShots, 8);

  // ── 4. Chutes no alvo sem gol ────────────────────────────────
  const totalOnTarget = game.onTarget.home + game.onTarget.away;
  if (totalOnTarget >= 5 && totalGoals <= 1) addFactor("Chutes no alvo sem gol", totalOnTarget, 12);
  else if (totalOnTarget >= 3) addFactor("Presença de chutes no alvo", totalOnTarget, 6);

  // ── 5. Escanteios recentes (ritmo) ───────────────────────────
  const totalCorners = game.corners.home + game.corners.away;
  const cornersPerMin = game.minute > 0 ? totalCorners / game.minute : 0;
  if (cornersPerMin > 0.18) addFactor("Ritmo alto de escanteios", `${cornersPerMin.toFixed(2)}/min`, 14);
  else if (cornersPerMin > 0.12) addFactor("Ritmo médio de escanteios", `${cornersPerMin.toFixed(2)}/min`, 8);

  // ── 6. Desequilíbrio no placar → pressão para empatar ────────
  const scoreDiff = Math.abs(game.score.home - game.score.away);
  if (scoreDiff >= 1 && game.minute >= 65) {
    addFactor("Time perdendo aumenta pressão (escanteios)", `${game.minute}'`, 14);
  }

  // ── 7. Fase final do jogo ────────────────────────────────────
  if (game.minute >= 80) addFactor("Últimos 10 minutos — pressão máxima", `${game.minute}'`, 15);
  else if (game.minute >= 70) addFactor("Fase final — jogo aberto", `${game.minute}'`, 9);
  else if (game.minute >= 60) addFactor("Segundo tempo avançado", `${game.minute}'`, 5);

  // ── 8. Posse + chutes no alvo combinados ─────────────────────
  if (game.possession.home > 58 && game.onTarget.home >= 4) {
    addFactor("Posse dominante + finalizações precisas", `${game.possession.home}% / ${game.onTarget.home}`, 12);
  } else if (game.possession.away > 58 && game.onTarget.away >= 4) {
    addFactor("Visitante domina posse + finaliza", `${game.possession.away}% / ${game.onTarget.away}`, 10);
  }

  // ── Normaliza score ──────────────────────────────────────────
  const confidence = Math.min(97, Math.round((score / 115) * 100));
  const signal = confidence >= 68 ? "STRONG" : confidence >= 48 ? "MODERATE" : "WEAK";
  const recommendation =
    confidence >= 68 ? "✅ ENTRAR AGORA" :
    confidence >= 48 ? "⏳ AGUARDAR" :
    "❌ EVITAR";

  return {
    confidence,
    signal,
    recommendation,
    factors,
    score,
    predictedWindow: "próximos 10 minutos",
  };
}

/** Gera dados de simulação quando ESPN não tem jogos ao vivo */
export function generateDemoGame(id) {
  const TEAMS = [
    { home: "Manchester City", away: "Arsenal",     league: "Premier League",  leagueCountry: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
    { home: "Real Madrid",     away: "Barcelona",   league: "La Liga",         leagueCountry: "🇪🇸" },
    { home: "Bayern München",  away: "B. Dortmund", league: "Bundesliga",      leagueCountry: "🇩🇪" },
    { home: "Inter Milan",     away: "AC Milan",    league: "Serie A",         leagueCountry: "🇮🇹" },
    { home: "PSG",             away: "Lyon",        league: "Ligue 1",         leagueCountry: "🇫🇷" },
  ];
  const t = TEAMS[id % TEAMS.length];
  const minute = 25 + Math.floor(Math.random() * 60);
  const possession = 35 + Math.floor(Math.random() * 30);
  return {
    id: `demo-${id}`,
    ...t,
    score: { home: Math.floor(Math.random() * 3), away: Math.floor(Math.random() * 3) },
    minute,
    period: minute > 45 ? 2 : 1,
    clock: `${minute}:00`,
    possession: { home: possession, away: 100 - possession },
    shots:     { home: 2 + Math.floor(Math.random() * 9), away: 1 + Math.floor(Math.random() * 8) },
    onTarget:  { home: 1 + Math.floor(Math.random() * 5), away: 0 + Math.floor(Math.random() * 4) },
    corners:   { home: Math.floor(Math.random() * 8), away: Math.floor(Math.random() * 7) },
    fouls:     { home: 3 + Math.floor(Math.random() * 8), away: 2 + Math.floor(Math.random() * 7) },
    dangerousAttacks: {
      home: 20 + Math.floor(Math.random() * 50),
      away: 15 + Math.floor(Math.random() * 45),
    },
    pressureIndex: Math.floor(Math.random() * 100),
    isDemo: true,
  };
}
