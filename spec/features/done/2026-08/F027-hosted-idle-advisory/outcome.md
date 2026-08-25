# Outcome

A hosted worker that stalls writes one advisory while the session stays open. That file is the vehicle F030 uses for the stall wake. The job stays `running`; nothing auto-closes.

Merged `24ea294`. Live-proven with F030.
