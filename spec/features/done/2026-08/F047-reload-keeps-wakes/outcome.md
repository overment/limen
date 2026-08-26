# Outcome

Spawn and continue record the coordinator Herdr tab. On session start, a running job whose `origin-tab` is this tab gets this session as a subscriber, even after a new Pi session id. A different tab still sees those jobs as unwatched.

Landed `a70cf2a`. Tests: reloaded tab resubscribes; foreign tab stays unwatched.
