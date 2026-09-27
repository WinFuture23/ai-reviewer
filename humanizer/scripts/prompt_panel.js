export const meta = {
  name: 'humanizer-prompt-panel',
  description: 'Three independent editors propose targeted improvements to the humanization prompt from measured diagnostics; one synthesizer merges them',
  phases: [{ title: 'Propose', detail: '3 independent proposals' }, { title: 'Synthesize', detail: 'merge into one v-next prompt' }],
}
const { prompt_path, diag_path, out_path, examples_path } = args
const SCHEMA = { type: 'object', properties: { changes: { type: 'array', items: { type: 'object', properties: { section: { type: 'string' }, problem: { type: 'string' }, instruction_text: { type: 'string' }, evidence: { type: 'string' } }, required: ['section', 'problem', 'instruction_text', 'evidence'] } }, keep_as_is: { type: 'array', items: { type: 'string' } } }, required: ['changes', 'keep_as_is'] }
const LENS = [
  'You are a newsroom chief editor who has rewritten thousands of agency texts; you care about what a human reporter actually does differently.',
  'You are a narratologist who knows the StoryScope feature definitions; you translate measured feature gaps into concrete, checkable writing instructions.',
  'You are a prompt engineer who has seen LLM rewriters ignore vague instructions; you propose only instructions that a model can verify against its own output before answering.',
]
phase('Propose')
const props = await Promise.all(LENS.map((lens, i) => agent(`${lens}

Read these files completely:
1. ${prompt_path} — the current humanization prompt (German).
2. ${diag_path} — measured diagnostics: for each test text, the classifier's P(human) before/after rewriting, fact-check findings, and the per-feature gaps that still point to "AI" after the rewrite (feature id, name, question, the rewrite's value, and the human vs AI reference values).
3. ${examples_path} — the rewritten texts themselves (read them; the diagnostics only make sense next to the text).

Task: propose the smallest set of changes to the prompt that would move the *still-AI-leaning* features toward the human reference WITHOUT breaking the hard rules (no invented facts, no lost facts, same language/genre/length band). Each change must (a) name the prompt section it modifies or adds, (b) state the measured problem it addresses, (c) give the exact German instruction text to insert (imperative, checkable), (d) cite the evidence (which feature/text). Do not propose stylistic word-level rules (the paper's point is that structure, not wording, carries the signal). Also list which parts of the prompt must stay as they are. Return via structured output.`, { label: `proposer-${i + 1}`, phase: 'Propose', schema: SCHEMA, effort: 'high' })))
const ok = props.filter(Boolean)
log(`${ok.length}/3 proposals`)
phase('Synthesize')
const merged = await agent(`You are the editor who owns the humanization prompt. Read ${prompt_path} (current prompt) and ${diag_path} (diagnostics). Below are ${ok.length} independent improvement proposals as JSON. Merge them into ONE revised prompt:
- keep the structure and the hard rules of the current prompt; integrate the tightened fact rule exactly as given in ${prompt_path.replace(/humanize_v\d+\.md$/, 'v2_fact_rules_fragment.md')} if that file exists (read it);
- add or sharpen only instructions backed by evidence in the diagnostics; drop duplicates; keep every instruction checkable by the model against its own output;
- keep the prompt in German, total length at most 1.6x the current prompt;
- end with the self-check list updated for the new instructions and the unchanged output rule.
Write the complete revised prompt to ${out_path} (overwrite). Return a short changelog (bullet list, German) as your final text.

PROPOSALS:
${JSON.stringify(ok, null, 1)}`, { label: 'synthesizer', phase: 'Synthesize', effort: 'high' })
return { proposals: ok, changelog: merged }
