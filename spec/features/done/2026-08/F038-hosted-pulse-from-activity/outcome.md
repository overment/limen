# Outcome

`limen jobs` and the coordinator footer both call `derivePulse`. A hosted job with `activity=think` and Herdr `idle` reads `think`, not `wait`. Handshake without `pid` reads `starting`.

Landed at `54e678c`. Suite: `hosted jobs pulse follows activity, not Herdr unseen-idle`; structure test `pulse law is one function`.
