# Leela end-to-end test

Run 20261110-roj0 (push), 2026-11-10T08:50:08.020Z, 2.3 min. **4 passed, 0 failed, 0 skipped.**


| | Check | Result | Time | Notes |
|---|---|---|---|---|
| R1 | Reminders: turning them on saves this phone, and a test notification arrives through a real push service | pass | 12.0s | Etc/GMT-4; “Leela reminders are on: You’ll get a notification 15 minutes before each sweet spot.” |
| R2 | A reminder arrives before the sweet spot, sent by the every-minute schedule | pass | 0.0s | “Kai’s nap sweet spot is now. Sweet spot 12:45 – 1:15 PM.” |
| R4 | Only one reminder per sleep: the next runs of the schedule send nothing more | pass | 125.0s | one reminder |
| R3 | Turning reminders off on the phone stops them | pass | 0.2s |  |

No browser errors.