# Outcome

Hosted start retries once when `agent start` fails with the exact pane-shell error (`agent target pane … is not an available shell`), after another `waitForShell`. A second failure, or any other error, keeps today's path: locate a recovered agent, else finalize `failed` with the herdr message. Both attempts are logged.

Landed `fe510dd`. Review PASS. Three targeted hosted-start tests passed on `main`.
