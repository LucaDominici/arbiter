---
title: 'Incidental-Capture Rule'
doc_version: '1.0.0'
status: active
last_review: '2026-09-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# Incidental-Capture Rule

For an out-of-scope finding, capture it and return to the task:

```bash
arbiter finding add "<finding>" --kind <dup|smell|risk|debt> --severity <low|med|high> --file <path> --line <n>
```

Do not fix, branch, or widen the current diff for that finding.
