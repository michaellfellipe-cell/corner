/**
 * pages/api/bets.js — Registra resultado de apostas e retorna estatísticas
 *
 * GET  /api/bets?action=stats           → resumo de performance
 * GET  /api/bets?action=recent&limit=50 → últimas predições
 * POST /api/bets { id, result, notes }  → registra resultado (win/loss/skip)
 */

import { getPerfSummary, getPerfByLeague, getRecentPredictions, supabaseUpdate, supabaseQuery } from "../../lib/supabase.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!process.env.SUPABASE_URL) {
    return res.status(200).json({ error: "Supabase não configurado", configured: false });
  }

  // GET — busca dados
  if (req.method === "GET") {
    const { action = "recent", limit = "50" } = req.query;

    if (action === "stats") {
      const [summary, byLeague] = await Promise.all([getPerfSummary(), getPerfByLeague()]);
      return res.status(200).json({ summary, byLeague, configured: true });
    }

    if (action === "recent") {
      const data = await getRecentPredictions(parseInt(limit));
      return res.status(200).json({ predictions: data });
    }

    if (action === "pending") {
      const data = await supabaseQuery(
        `predictions?verified=eq.false&result=is.null&order=created_at.desc&limit=30&select=*`
      );
      return res.status(200).json({ predictions: data });
    }

    return res.status(400).json({ error: "action inválido" });
  }

  // POST — registra resultado
  if (req.method === "POST") {
    const { id, result, notes = "" } = req.body || {};

    if (!id || !result) {
      return res.status(400).json({ error: "id e result são obrigatórios" });
    }

    if (!["win", "loss", "skip"].includes(result)) {
      return res.status(400).json({ error: "result deve ser win | loss | skip" });
    }

    const updated = await supabaseUpdate("predictions", id, {
      result,
      verified:  true,
      result_at: new Date().toISOString(),
      notes,
    });
    if (!updated) {
      return res.status(500).json({ error: "Erro ao atualizar" });
    }

    return res.status(200).json({ success: true, updated });
  }

  return res.status(405).end();
}
