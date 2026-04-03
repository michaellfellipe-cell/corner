/**
 * /pages/api/analyze.js
 * Chama a API da Anthropic server-side com a chave secreta
 */

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada no ambiente." });

  const { game, prediction } = req.body;
  if (!game || !prediction) return res.status(400).json({ error: "Payload inválido" });

  const prompt = `Você é um analista profissional de apostas esportivas especializado no mercado de escanteios (corners). Analise este jogo ao vivo e dê uma recomendação clara e objetiva (máx 100 palavras):

JOGO: ${game.home} ${game.score.home}–${game.score.away} ${game.away}
LIGA: ${game.league} | MINUTO: ${game.minute}'
POSSE DE BOLA: ${game.possession.home}% vs ${game.possession.away}%
CHUTES: ${game.shots.home} (${game.onTarget.home} no alvo) × ${game.shots.away} (${game.onTarget.away} no alvo)
ATAQUES PERIGOSOS: ${game.dangerousAttacks.home} vs ${game.dangerousAttacks.away}
ESCANTEIOS ATÉ AGORA: ${game.corners.home}–${game.corners.away}
CONFIANÇA DO ALGORITMO: ${prediction.confidence}%
SINAL: ${prediction.signal}
FATORES ATIVOS: ${prediction.factors.map(f => f.label).join(", ")}

Responda em português brasileiro. Seja direto: vale entrar em mais escanteios nos próximos 10 minutos? Justifique brevemente com os dados acima.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "Análise indisponível.";
    return res.status(200).json({ analysis: text });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
