#!/bin/sh
SS=/tmp/claude-0/-home-user/0a9cc923-8822-574c-9a00-df14f3ae44c3/scratchpad
P=$SS/prompts/humanize_v3.md; RW=claude-opus-5-5
run() { python3 $SS/ss/ss_humanize.py $P $1 $SS/runs/v3 --rewriter $RW --samples $2 --annot-runs $3 --variants out_narrative,out_full > $SS/runs/v3_$(basename $1 .txt).log 2>&1; }
run $SS/texts/dev_gemini_10367.txt 1 3 &
run $SS/texts/dev_kimi_4582.txt 1 3 &
run $SS/texts/dev_deepseek_4557.txt 1 3 &
wait
run $SS/texts/vw_161566_original.txt 2 1 &
run $SS/texts/wf_161565_gates.txt 1 1 &
wait
echo "VERSION v3 DONE"
