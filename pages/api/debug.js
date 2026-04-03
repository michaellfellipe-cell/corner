/**
 * /pages/api/debug.js
 * Mostra o que ESPN está retornando — use para diagnóstico
 * Acesse: /api/debug?league=bra.1
 */

export default async function handler(req, res) {
  const league = req.query.league || "bra.1";
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard`;

  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
    });

    const data = await r.json();
    const events = data.events || [];

    const summary = events.map(e => ({
      name: e.name,
      state: e?.status?.type?.state,
      stateDesc: e?.status?.type?.description,
      stateName: e?.status?.type?.name,
      clock: e?.status?.displayClock,
      period: e?.status?.period,
      rawClock: e?.status?.clock,
    }));

    res.status(200).json({
      league,
      url,
      httpStatus: r.status,
      totalEvents: events.length,
      events: summary,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, league, url });
  }
}
