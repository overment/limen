# Team 1 · how the live snapshot builds a group tree

Read `src/picture/activity.ts`: how it reads `.limen/groups/<id>/run.json` and how it counts states per team and for the group.

- Worker 1: how a job is placed under its team coordinator (`group`, `team`, `spawned-by`).
- Worker 2: how state counts are built for a team and for the whole group.

Give each worker one of these two questions in its task.
