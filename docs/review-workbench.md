# Investigation review workbench

The signed-in chat exposes an owner-only **조사 요청 검토** panel. It is the
human gate between user feedback and learning data:

1. A user marks an answer as `조사 요청` and optionally writes a comment.
2. The API creates a queued investigation in the same workspace.
3. An owner inspects the feedback and the cited answer in the conversation.
4. The owner records a resolution as 승인 기록 or 반려 기록.
5. Only separately approved, evidence-backed cases can enter evaluation or
   local tuning exports.

The review API is workspace-scoped and owner-protected. It records the status,
resolution, timestamps, and audit event, but it does not change model weights.
Do not copy personal values into the resolution. Use a masked or structured
UI path for exact personal data and keep the investigation out of tuning.

The workbench is intentionally small for the local pilot. A production
profile should add pagination, evidence selection, optimistic-concurrency
tokens, and an explicit post-promotion model reload/rollback control.
