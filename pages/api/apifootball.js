/**
 * /pages/api/apifootball.js
 * Proxy para API-Football v3
 * 
 * Adicione no Vercel: Settings → Environment Variables
 * Nome: APIFOOTBALL_KEY
 * Valor: sua_chave_aqui
 * 
 * Endpoints disponíveis via query param:
 *   ?type=teamstats&team=33&league=39&season=2025
 *   ?type=h2h&h2h=33-42
 *   ?type=fixtures&live=all
 *   ?type=events&fixture=12345
 *   ?type=statistics&fixture=12345
 *   ?type=lineups&fixture=12345
 *   ?type=odds&fixture=12345
 */

const API_BASE = "https://v3.football.api-sports.io";

const ENDPOINTS = {
  teamstats:  (p) => `/teams/statistics?team=${p.team}&league=${p.league}&season=${p.season}`,
  h2h:        (p) => `/fixtures/headtohead?h2h=${p.h2h}&last=10`,
  fixtures:   (p) => p.live ? `/fixtures?live=${p.live}` : `/fixtures?${new URLSearchParams(p)}`,
  events:     (p) => `/fixtures/events?fixture=${p.fixture}`,
  statistics: (p) => `/fixtures/statistics?fixture=${p.fixture}`,
  lineups:    (p) => `/fixtures/lineups?fixture=${p.fixture}`,
  odds:       (p) => `/odds/live?fixture=${p.fixture}`,
  standings:  (p) => `/standings?league=${p.league}&season=${p.season}`,
};

export default async function handler(req, res) {
  const key = process.env.APIFOOTBALL_KEY;

  if (!key) {
    return res.status(503).json({
      error: "API-Football não configurada",
      message: "Adicione APIFOOTBALL_KEY nas variáveis de ambiente do Vercel",
      configured: false,
    });
  }

  const { type, ...params } = req.query;

  if (!type || !ENDPOINTS[type]) {
    return res.status(400).json({ error: "type inválido. Use: " + Object.keys(ENDPOINTS).join(", ") });
  }

  const path = ENDPOINTS[type](params);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        "x-apisports-key": key,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `API-Football erro: ${response.status}` });
    }

    const data = await response.json();

    // Passa os rate limit headers para o cliente poder monitorar
    const remaining = response.headers.get("x-ratelimit-requests-remaining");
    if (remaining) res.setHeader("x-apisports-remaining", remaining);

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: "Erro ao chamar API-Football", detail: err.message });
  }
}
