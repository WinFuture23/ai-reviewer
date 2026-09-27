export const meta = {
  name: 'blind-reader-panel',
  description: 'Blind reader test: five reader personas rank the original WinFuture article against humanized candidates; one editor verifies facts of the winner',
  phases: [{ title: 'Read', detail: '5 blind readers, shuffled labels' }, { title: 'Verify', detail: 'fact check of the top candidate' }],
}
const { bundle_path, n_candidates } = args
const RANK = {
  type: 'object',
  properties: {
    ranking: { type: 'array', items: { type: 'string' }, description: 'labels best to worst' },
    scores: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, readability: { type: 'integer', minimum: 1, maximum: 10 }, flow_and_order: { type: 'integer', minimum: 1, maximum: 10 }, naturalness_human_feel: { type: 'integer', minimum: 1, maximum: 10 }, trust_and_clarity: { type: 'integer', minimum: 1, maximum: 10 }, overall: { type: 'integer', minimum: 1, maximum: 10 }, one_line_verdict: { type: 'string' } }, required: ['label', 'readability', 'flow_and_order', 'naturalness_human_feel', 'trust_and_clarity', 'overall', 'one_line_verdict'] } },
    which_reads_like_a_human_journalist: { type: 'string' },
    weaknesses_of_best: { type: 'array', items: { type: 'string' } },
  },
  required: ['ranking', 'scores', 'which_reads_like_a_human_journalist', 'weaknesses_of_best'],
}
const PERSONAS = [
  'Du bist ein langjähriger WinFuture-Leser, 45, Technik-affin, liest morgens auf dem Handy in der Bahn.',
  'Du bist Autojournalist:in mit 20 Jahren Erfahrung bei einer Fachzeitschrift und liest Konkurrenztexte kritisch.',
  'Du bist Schlussredakteur:in einer Tageszeitung; dich interessieren Aufbau, Reihenfolge, Verständlichkeit und Glaubwürdigkeit.',
  'Du bist eine 29-jährige Leserin, die ein E-Auto kaufen will und den Text als Kaufinformation liest.',
  'Du bist Linguist:in und untersuchst, welche Texte wie von Menschen geschriebene Nachrichten wirken und welche nach Textgenerator klingen; du kennst die typischen KI-Muster (aufgeräumte Struktur, erklärende Einordnungssätze, Zusammenfassungs-Reflexe).',
]
phase('Read')
const reads = await Promise.all(PERSONAS.map((p, i) => agent(`${p}

Lies die Datei ${bundle_path}. Sie enthält ${n_candidates} Fassungen derselben Nachricht (VW ID. Tiguan), mit den Buchstaben A bis ${String.fromCharCode(64 + n_candidates)} bezeichnet, in zufälliger Reihenfolge. Eine davon ist der veröffentlichte Artikel, die anderen sind Umbauten; du weißt nicht, welche welche ist, und sollst es auch nicht erraten, sondern nur lesen.

Bewerte JEDE Fassung aus deiner Perspektive auf einer Skala 1–10 in: Lesbarkeit, Fluss und Reihenfolge der Informationen, Natürlichkeit („klingt nach einem Menschen, der mir etwas erzählt"), Vertrauen und Klarheit, Gesamteindruck. Erstelle ein Ranking (beste zuerst). Sag in einem Satz, welche Fassung am ehesten wie von einer menschlichen Journalistin geschrieben wirkt und warum. Nenne für die beste Fassung zwei bis drei konkrete Schwächen (Stellen zitieren). Sei streng und konkret; gleiche Noten für alle sind keine Antwort. Antworte über die strukturierte Ausgabe.`, { label: `reader-${i + 1}`, phase: 'Read', schema: RANK, effort: 'medium' })))
const ok = reads.filter(Boolean)
const agg = {}
for (const r of ok) for (const s of r.scores) { const a = agg[s.label] = agg[s.label] || { n: 0, overall: 0, readability: 0, flow: 0, natural: 0, trust: 0, firsts: 0 }; a.n++; a.overall += s.overall; a.readability += s.readability; a.flow += s.flow_and_order; a.natural += s.naturalness_human_feel; a.trust += s.trust_and_clarity }
for (const r of ok) if (r.ranking && r.ranking[0] && agg[r.ranking[0]]) agg[r.ranking[0]].firsts++
const table = Object.entries(agg).map(([label, a]) => ({ label, n: a.n, overall: +(a.overall / a.n).toFixed(2), readability: +(a.readability / a.n).toFixed(2), flow: +(a.flow / a.n).toFixed(2), natural: +(a.natural / a.n).toFixed(2), trust: +(a.trust / a.n).toFixed(2), firsts: a.firsts })).sort((x, y) => y.overall - x.overall)
log(`readers: ${ok.length}; top: ${table[0] && table[0].label} (${table[0] && table[0].overall})`)
return { table, readers: ok }
