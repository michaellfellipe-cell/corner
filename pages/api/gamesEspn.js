/**
 * pages/api/gamesEspn.js — ESPN fallback (used when APIFOOTBALL_KEY not set)
 * Minimal stub that returns demo games
 */
import { generateDemoGame } from "../../lib/predictor.js";

export default async function handler(req, res) {
  const demos = Array.from({ length: 5 }, (_, i) => generateDemoGame(i));
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    games: demos, upcoming: [], liveCount: demos.length,
    upcomingCount: 0, demo: true,
    timestamp: new Date().toISOString(),
  });
}
