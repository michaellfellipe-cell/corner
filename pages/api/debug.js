/**
 * /pages/api/debug.js
 * ?league=eng.2           → resumo dos eventos
 * ?league=eng.2&stats=1   → stats brutas do 1º jogo ao vivo via summary endpoint
 * ?eventid=XXX&league=eng.2 → summary completo de um evento específico
 */
export default async function handler(req, res) {
  const league    = req.query.league   || "eng.2";
  const showStats = req.query.stats    === "1";
  const eventId   = req.query.eventid;
  const headers   = { "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept":"application/json" };

  try {
    if (eventId) {
      // Busca summary completo de um jogo específico
      const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/summary?event=${eventId}`;
      const r = await fetch(url, { headers });
      const data = await r.json();
      return res.status(200).json({
        eventId,
        boxscore_groups: data.boxscore?.teams || null,
        statistics_raw: data.boxscore?.teams?.[0]?.statistics || null,
        header: data.header || null,
        gamepackage_boxscore: data.boxscore || null,
      });
    }

    const scoreUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard`;
    const r = await fetch(scoreUrl, { headers });
    const data = await r.json();
    const events = data.events || [];

    if (showStats) {
      const liveEvent = events.find(e => e?.status?.type?.state === "in");
      if (!liveEvent) return res.status(200).json({ message: "Nenhum jogo ao vivo", league });

      // Busca summary do jogo ao vivo para ver as stats reais
      const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/summary?event=${liveEvent.id}`;
      const sr = await fetch(summaryUrl, { headers });
      const summary = await sr.json();

      return res.status(200).json({
        eventName: liveEvent.name,
        eventId: liveEvent.id,
        clock: liveEvent.status?.displayClock,
        rawClock: liveEvent.status?.clock,
        period: liveEvent.status?.period,
        summaryUrl,
        // Mostra estrutura completa de stats do summary
        boxscore: summary.boxscore || null,
        header_competitions_stats: summary.header?.competitions?.[0]?.competitors || null,
        // Stats no scoreboard direto
        scoreboard_statistics: liveEvent.competitions?.[0]?.statistics || [],
        scoreboard_situation: liveEvent.competitions?.[0]?.situation || null,
      });
    }

    res.status(200).json({
      league, httpStatus: r.status, totalEvents: events.length,
      events: events.map(e => ({
        id: e.id,
        name: e.name,
        state: e?.status?.type?.state,
        stateDesc: e?.status?.type?.description,
        clock: e?.status?.displayClock,
        period: e?.status?.period,
        rawClock: e?.status?.clock,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
}
