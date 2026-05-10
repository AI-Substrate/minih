```text
HOVR/2
m:{ts:"2026-05-07T00:08:19Z",plan:"/Users/jordanknight/substrate/minih/docs/plans/020-minih-harness-measurement",phase:"Research/Workshop",feat:"minih-harness-measurement",prog:"research+workshop complete",domain:"measurement"}

intent:{
  primary:"Continue MiniH measurement planning in the minih repo",
  quotes:["“we should be in /Users/jordanknight/substrate/minih”","“write a handover using handover skill”"],
  scope:["move plan artifacts","preserve Measuring-HVE source refs","no implementation yet"]
}

timeline:{
  just_completed:"moved plan 020 into minih docs/plans",
  current:"handover stored beside plan artifacts",
  last_actions:["created research-dossier.md","created literature traceability workshop","moved from Measuring-HVE to pi-mono","moved from pi-mono to minih"]
}

concepts:{keys:["Time to Validated Evidence [measurement]","Time to Verified Working Context [measurement]","proof levels L0-L6 [quality]","difficulty half-life [learning]","SPACE/DORA/Accelerate/ESSP mapping [literature]","companion-agent classification [interpretation]"]}

code:{
  files:["/Users/jordanknight/substrate/minih/docs/plans/020-minih-harness-measurement/research-dossier.md","/Users/jordanknight/substrate/minih/docs/plans/020-minih-harness-measurement/workshops/001-literature-traceability-matrix.md","/Users/jordanknight/substrate/minih/docs/plans/020-minih-harness-measurement/handover.md"],
  hot:["/Users/jordanknight/substrate/minih/docs/plans/020-minih-harness-measurement@new"],
  domain_dirs:{"measurement":"/Users/jordanknight/substrate/minih/docs/plans/020-minih-harness-measurement","source-literature":"/Users/jordanknight/repos/Measuring-HVE/docs/articles/sources/frameworks"}
}

decisions:{
  adrs:[],
  other:[["DEC-001","Use docs/plans/020-minih-harness-measurement in minih","plan location","user corrected repo"],["DEC-002","Keep Measuring-HVE source paths explicit","literature refs","sources live there"],["DEC-003","Treat MiniH metrics as local extensions unless direct literature","wording","prevents overclaiming"]]
}

tasks:{
  done:["research-dossier","literature-traceability-workshop","move-to-minih","handover"], ip:[], pend:["specify-feature","workshop-event-model","workshop-proof-levels"], blk:[],
  critdeps:[["specify-feature","research-dossier"],["workshop-event-model","literature-traceability-workshop"]]
}

tests:{unit:"?", integ:"?", cov:"?", notes:"Documentation/plan artifacts only"}

risks:[["stale external refs","keep absolute Measuring-HVE paths","missing source files","source-literature"],["DORA version drift","label source version","metric mismatch","measurement"],["Accelerate overcitation","add licensed reader notes","unsupported page claims","literature"],["wrong repo recurrence","check cwd before edits","misplaced plan files","workflow"]]

fails:[["created under Measuring-HVE","wrong target repo","move artifacts"],["moved to pi-mono","wrong target repo","final target is minih"]]

anchors:{
  immutable:["Plan number is 020","Final repo is /Users/jordanknight/substrate/minih","Framework sources remain in Measuring-HVE","No MiniH implementation changes made","DORA/SPACE/ESSP/Accelerate caveats captured"],
  user_verbatim:["“we should be in /Users/jordanknight/substrate/minih”","“give htem plan number 20”","“Literature Traceability Matrix”"]
}

next:{
  task:"specify-feature",
  tasks_file:"?",
  why:"turn research/workshop into MiniH feature spec",
  validate:["spec references plan 020","metrics trace to workshop","repo path is minih"],
  cmd:"/plan-1b-v2-specify --plan \"020-minih-harness-measurement\" \"MiniH harness effectiveness measurement\""
}

refs:{plan:"/Users/jordanknight/substrate/minih/docs/plans/020-minih-harness-measurement § ?", tasks_file:"?", log:"?", paths:["/Users/jordanknight/substrate/minih/docs/plans/020-minih-harness-measurement","/Users/jordanknight/repos/Measuring-HVE/docs/articles/sources/frameworks","/Users/jordanknight/repos/Measuring-HVE/.fs2/config.yaml"]}
```
