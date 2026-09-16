# Outcome

Empty failed and stopped jobs no longer send automatic finish webhooks. Operators still see the skip in the job files and detail view; failed work with a written result still notifies, and a done job still sends even with an empty result. Landed in merge `e9b29fe`. The automatic claim records that skip so a later result cannot re-arm the same job. Same-tip duplicate pings on a commit that already notified the owner remain a follow-up.
