# Leela end-to-end test

Run 20261116-xxj9 (full), 2026-11-16T06:46:08.686Z, 8 min. **91 passed, 0 failed, 0 skipped.**

Live sync between phones: median 783 ms (fastest 282, slowest 786).

| | Check | Result | Time | Notes |
|---|---|---|---|---|
| W1 | The published app is up at its public address | pass | 0.2s | https://shiven-goel.github.io/leela/ |
| A1 | Mom creates an account, no email confirmation needed | pass | 4.6s |  |
| A2 | Mom starts a family, adds the baby and gets a family code | pass | 2.0s |  |
| A3 | Dad creates an account | pass | 3.6s |  |
| A4 | A wrong family code is refused | pass | 0.8s | That code doesn’t match a family. Check it with whoever shared it. 4 tries left this hour. |
| A5 | Dad joins with the code typed in lower case, after seeing who is in the family | pass | 3.1s |  |
| A6 | A wrong password is refused with a clear message | pass | 1.1s |  |
| A7 | Signing up twice with the same email says to sign in instead | pass | 1.3s |  |
| L1 | A diaper logged in two taps appears on the other phone | pass | 1.8s | 784 ms |
| T1 | A sleep that began 70 minutes ago and ended 50 minutes ago is saved at exactly those times, both picked on the clock | pass | 8.3s | 10:58–11:18 |
| L26 | Tapping Sleep by mistake starts nothing: the timer needs its own Start button | pass | 3.9s |  |
| L2 | A sleep timer started on one phone runs on the other | pass | 1.7s | 783 ms |
| L3 | Stopping it on the other phone ends it everywhere and saves the sleep | pass | 1.8s | 285 ms |
| L4 | Both parents pressing Sleep at the same moment leaves exactly one timer | pass | 10.0s |  |
| L27 | Ending a sleep by mistake can be undone, and the other phone follows | pass | 8.3s |  |
| L5 | Breastfeeding timer: switch sides, pause and resume, all seen live by Dad | pass | 10.1s |  |
| T2 | A breastfeed timer started 20 minutes ago, stopped from Edit details at 10 minutes ago: side time after that doesn’t count | pass | 7.3s | 11:49–11:59, left 600s, right 0s |
| L6 | A bottle with its amount and formula shows on the other phone | pass | 1.8s | 786 ms |
| L7 | Editing an entry updates the other phone | pass | 1.3s | 282 ms |
| L8 | Delete, then Undo: the other phone follows both | pass | 2.4s |  |
| L9 | Two people editing the same entry: the second save is caught, not silently lost | pass | 5.8s |  |
| T3 | A past breastfeed with its start, end and sides; sides adding up to more than the feed are refused | pass | 2.8s | 11:24–11:44 |
| T4 | A bottle with an end time picked on the clock: its length shows on the other phone | pass | 2.7s |  |
| L10 | Solids with a food, seen on the other phone | pass | 2.3s |  |
| L11 | Growth: weight, length and head, seen on the other phone | pass | 2.3s |  |
| L12 | A temperature high enough to warn about, seen on the other phone | pass | 2.1s |  |
| L13 | A medicine with its dose, seen on the other phone | pass | 2.3s |  |
| L14 | Symptoms, seen on the other phone | pass | 2.2s |  |
| L15 | A doctor visit, seen on the other phone | pass | 2.2s |  |
| L16 | A vaccine, seen on the other phone | pass | 2.2s |  |
| L18 | Potty, for toddlers, seen on the other phone | pass | 2.2s |  |
| L19 | Pumping is logged for the person who pumped | pass | 2.6s |  |
| L17 | A bath with its start and end picked on the clock; an end before the start is refused | pass | 3.2s |  |
| T5 | Changing an entry’s end time from History updates the other phone | pass | 4.3s | now 20m |
| L20 | A first with a photo: the photo uploads and shows on the other phone | pass | 5.4s |  |
| L21 | The fever warning shows on Today | pass | 0.0s |  |
| L22 | Contraction timer | pass | 5.7s |  |
| L23 | An activity timer runs on both phones | pass | 3.0s |  |
| L24 | A diaper with colour and rash | pass | 1.8s |  |
| L25 | A past nap with the times picked on the clock lands on yesterday | pass | 2.7s |  |
| T6 | A night sleep from 11:40 PM to 2:15 AM is 2h 35m, and shows on the morning it ended | pass | 3.1s |  |
| O1 | Offline: three diapers wait on the phone, then sync once, with no duplicates | pass | 14.7s | 1 → 4 |
| O2 | The app opens with no connection, from the copy on the phone | pass | 0.4s |  |
| H1 | A forgotten bottle added to two days ago lands on that day, for both parents | pass | 5.1s |  |
| H2 | Ten days of logging: an entry on each of the last ten days | pass | 31.5s |  |
| H3 | Day 11 on a brand-new phone: all ten days are still there | pass | 11.4s | 10 of 10 days |
| H4 | A log from 380 days ago, over a year back, is saved and shown on its day | pass | 5.6s |  |
| N1 | A very long note with two photos saves, and Leela offers to log what it mentions | pass | 3.3s | 12,707 characters |
| N2 | Dad sees the note with its full text and photos, and what it logged | pass | 2.4s |  |
| N3 | An unsaved note survives the app closing | pass | 3.4s |  |
| N4 | Shorthand Leela doesn’t know: it asks once, learns it, and the other parent benefits | pass | 4.6s |  |
| N5 | Searching notes; plain notes don’t ask anything | pass | 3.7s |  |
| I1 | Import a Word document (a Google Doc saved as .docx) | pass | 3.4s | 4 entries |
| I2 | Import a PDF | pass | 3.4s | 4 entries |
| I3 | Import an Excel sheet | pass | 2.2s | 3 entries |
| I4 | Import a tracking-app CSV export | pass | 2.1s | 3 entries |
| I5 | Import a WhatsApp chat export | pass | 3.3s | 3 entries |
| I6 | Importing the same file again skips everything already there | pass | 1.3s |  |
| I7 | An import can be undone, and both phones drop it | pass | 3.5s |  |
| B1 | The diary groups notes, firsts and photos by month of life | pass | 0.4s |  |
| B2 | The diary book prints to a PDF with the months, notes and photos | pass | 1.1s | 21 pages, 4 images, 166 KB |
| F1 | A second baby keeps separate logs | pass | 6.2s |  |
| F2 | A new name shows on the partner’s phone, on old entries too | pass | 2.8s |  |
| F3 | Units are per person: °F and inches for Mom, °C and cm for Dad | pass | 1.5s |  |
| F4 | Night hours changed by one parent reach the other | pass | 1.4s |  |
| F5 | Night theme | pass | 0.1s |  |
| F6 | The owner resets the code: the old one stops working, the new one works | pass | 8.2s |  |
| F7 | Removing a member cuts their access straight away | pass | 2.3s |  |
| F8 | Ownership can be handed to the other parent | pass | 2.1s |  |
| F9 | Editing a baby’s details reaches the other phone | pass | 2.5s |  |
| P1 | Sweet spot predicts the next nap, the rest of the day and bedtime from the baby’s own week | pass | 3.0s | next nap 12:25 – 12:55 PM, nap 3 ~4:10 PM, bed ~7:20 PM |
| P2 | Sweet spot settings are shared: 2 naps a day set on one phone shows on the other | pass | 6.7s |  |
| V1 | History › Week draws the last seven days as a chart, and tapping a day opens it | pass | 0.5s | 6 sleeps, 7 feeds and 14 diapers drawn; opened Mon16 |
| V2 | History › Trends has a chart for each kind of entry, each with a table of its numbers | pass | 0.8s | 11 charts, growth 3rd percentile |
| S1 | A stranger with a family of their own sees none of ours | pass | 4.7s |  |
| S2 | A stranger can’t read, add, change, join or listen in through the API | pass | 10.9s |  |
| S3 | Guessing codes is stopped after 5 wrong tries an hour | pass | 1.5s |  |
| S4 | The last person to leave a family closes it | pass | 2.1s |  |
| D1 | The activity log records who did what | pass | 2.5s | 154 items read |
| D2 | Download everything: a full backup with every entry and every change | pass | 2.6s | 105 entries (102 active), 165 changes, 3 babies, 6 imports |
| D3 | The database agrees with the phones | pass | 0.6s | 105 entries (diaper 24, sleep 44, nursing 5, bottle 7, solids 1, growth 1, temperature 1, medicine 3, symptom 3, potty 1, pump 1, activity 3, milestone 3, contraction 1, note 4), 165 activity records |
| D4 | Nothing can be permanently erased, not even by the family through the API | pass | 1.0s |  |
| D5 | Signing out and back in brings everything back | pass | 1.2s |  |
| D6 | The app can be installed: manifest and offline worker | pass | 0.0s |  |
| X1 | A parent can leave; the family carries on for the other | pass | 2.3s |  |
| X2 | The test family is closed at the end, so its code stops working | pass | 2.1s |  |
| R1 | Reminders: turning them on saves this phone, and a test notification arrives through a real push service | pass | 8.5s | Etc/GMT-6; “Leela reminders are on: You’ll get a notification 15 minutes before each sweet spot.” |
| R2 | A reminder arrives before the sweet spot, sent by the every-minute schedule | pass | 19.0s | “Kai’s nap sweet spot is now. Sweet spot 12:40 – 1:10 PM.” |
| R4 | Only one reminder per sleep: the next runs of the schedule send nothing more | pass | 125.0s | one reminder |
| R3 | Turning reminders off on the phone stops them | pass | 0.8s |  |
| C1 | Long-running family: every entry from earlier runs is still there, unchanged | pass | 1.1s | 23 entries from 23 earlier runs over 15 days, all intact; 26 activity records |

No browser errors.