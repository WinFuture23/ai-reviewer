#!/bin/sh
# Usage: run_version.sh <version> [rewriter]  — humanize + measure every test text with prompts/humanize_<version>.md
SS=/tmp/claude-0/-home-user/0a9cc923-8822-574c-9a00-df14f3ae44c3/scratchpad
V=$1; RW=${2:-claude-opus-5-5}
P=$SS/prompts/humanize_$V.md
run() { python3 $SS/ss/ss_humanize.py $P $1 $SS/runs/$V --rewriter $RW --samples $2 --variants out_narrative,out_full > $SS/runs/${V}_$(basename $1 .txt).log 2>&1; }
# fiction (3 in-domain AI stories), staggered in two waves to bound concurrency
run $SS/texts/dev_gemini_10367.txt 1 &
run $SS/texts/dev_kimi_4582.txt 1 &
run $SS/texts/vw_161566_original.txt 2 &
wait
run $SS/texts/dev_deepseek_4557.txt 1 &
run $SS/texts/wf_161565_gates.txt 1 &
run $SS/news/ai/h_112000_2019__opus.txt 1 &
run $SS/news/ai/h_099000_2017__sonnet.txt 1 &
wait
echo "VERSION $V DONE"
