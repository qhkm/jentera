# Live computer setup progress

Bootstrap writes fixed `JENTERA_SETUP_STAGE:<name>` stdout markers. The HTTP exec
reader consumes the response incrementally, bounds retained diagnostic output and
checks the final exit frame as before. An allowlisted, monotonic marker parser
persists only stage names/timestamps to the leased lifecycle task's result. Writes
are bound to its lease token so an old attempt cannot update a replacement attempt.
Reporting failure does not fail setup; readiness still requires the authenticated
probe and normal finalization. No raw logs or infrastructure names enter this UI.

The runtime overview returns the active lifecycle task's stage. Existing polling
updates the setup page and computer-status card. Percentages represent completed
stages, not elapsed time or measured work. Initial ETA ranges are deliberately rough
stage-based heuristics, not historical predictions. They do not count down or move
the percentage on a timer. A stage exceeding its range shows a delayed message.
Older bundles without markers remain at the last confirmed stage until readiness.

Release requires the standard runtime bundle release (`ship-runtime.sh`) plus the
frontend deploy. No database migration. Do not claim live stage reporting works on
old runtime bundles before the fleet upgrade has completed.
