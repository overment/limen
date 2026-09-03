# Outcome

A stop now suppresses the caller’s completion wake only after the job has reached a terminal state. If a hosted agent remains running and stop throws, no delivered marker is written, so its eventual completion can still wake that coordinator.

Landed `08e63c5`. Review PASS of `50d0b07`. Focused stop tests passed 3/3 after merge.
