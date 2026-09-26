# Outcome

A verified, CPU-idle tool child—or a child that exits while the tool stays pending—now fails its job instead of leaving RUNNING indefinitely. Hosted Pi/OMP and detached Pi/OMP use process identity checks before signaling; uncertain ownership raises an advisory without killing a process. Merged as `59cfb4e` with type and safety corrections in `fd267a5`; seven real-process synthetic-engine cases passed, including all four engine/mode combinations. Actual provider-side hung commands and the Linux `/proc` path were not exercised on this Mac seat.
