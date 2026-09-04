# My Money V9 — Analytics + Firebase Sync

## Firebase permission error
If the app shows **permission denied**, Firebase Authentication is working but Firestore rejected the read/write because the current Firestore Rules are not published.

### Fastest fix in Firebase Console
1. Open Firebase Console for project `my-money-3d05e`.
2. Open **Firestore Database → Rules**.
3. Replace the rules with the included `firestore.rules`.
4. Click **Publish**.
5. Return to My Money and refresh the page.

The included rules allow a signed-in Google user to read/write only their own `users/{uid}` document.

### Local development
Use `http://127.0.0.1:5500/` or `http://localhost:5500/` and keep that host in Firebase Authentication → Settings → Authorized domains.

## V9 changes
- Removed Cash Flow date filtering from Dashboard.
- Added a dedicated Analytics date-range workspace.
- Presets: 7 days, 30 days, 3 months, 6 months, 1 year, Custom.
- Analytics now shows money in, money out, net cash flow, average daily spend, cash-flow trend, expense breakdown, ranked categories, account cash flow, upcoming EMI amount, goal money remaining and largest spending category.
- Existing Firebase data model is preserved.
- LocalStorage remains available if Firestore is temporarily unavailable.


## V13 fixes
- Built from the last V12 Transactions/EMI/Goals version.
- Preserves localStorage key `my-money-data-v2` so existing browser data remains usable.
- Firebase AI is now lazy-loaded only when the AI button is pressed, so an AI/API configuration problem cannot blank the app.
- AI model changed to `gemini-2.5-flash`.
- Added safer runtime error handling.
- Added the professional dashboard header/profile treatment from the supplied design.
- Preserves EMI Paid and Goal Contribution transaction options, including selecting the exact EMI/goal.

## Goal-account linking
Each goal now has a required linked account. Goal contributions can only come from that linked account. The contribution reduces that account's balance, increases the goal's saved amount, and is recorded as a goal transaction (not an expense). Existing goals without an account are preserved but must be linked before adding money.


## V15 updates
- Added a checkbox when creating a goal for money already saved in the linked account.
- Initial goal deposits reserve existing money without moving the account balance or creating a transaction.
- New transactions store stable account IDs for safer reversals.
- Deleting income, expense, goal contribution, transfer, or EMI payment reverses the affected balance; EMI state is restored when possible.
- Analytics cash-flow trend shows numeric values directly on chart points and uses monthly periods for long ranges.

## V16 Analytics + Icons
- Updated analytics cash-flow card styling toward the supplied dark navy reference.
- Added Lucide SVG icon support. Use `icon("wallet")`, `icon("trending-up")`, `icon("bar-chart-3")`, `icon("target")`, `icon("credit-card")`, etc.
- Lucide icons are loaded from jsDelivr; no image files are required.
- `refreshIcons()` runs after DOM changes so icons work with dynamically rendered sections.

## V17 Analytics redesign
- Replaced the previous cash-flow SVG layout with a new responsive financial chart.
- Added gradient area fills, glowing lines, clear Income/Expense colors, point value badges, axis labels, and summary totals.
- Monthly ranges over 90 days remain grouped by month (e.g. Jan 2026, Feb 2026).
- Analytics headings use Lucide SVG icons.

## V18 stability fix
Removed the recursive MutationObserver used for Lucide icons. The observer was watching DOM changes caused by createIcons(), which could repeatedly trigger itself and freeze Analytics. Icons are now refreshed once after each render instead.

## V19 Edit controls
- Goals now have Edit + Delete.
- EMIs/Loans now have Edit + Mark Paid + Delete.
- Transactions now have Edit + Delete.
- Editing a normal income/expense/transfer updates the related account balance by the amount difference.
- Editing a goal contribution also updates goal saved amount while preserving the linked account.
- EMI payment transactions retain the previous EMI state for safe reversal on deletion.

## V20 Design + Auto Logos
- Unified professional dark UI across Dashboard, Accounts, Transactions, Analytics, Goals, Budgets, Recurring, EMIs & Loans and Settings.
- Accounts support optional Logo URL; if omitted, My Money automatically shows an emoji/icon based on account name/type.
- Accounts now have Edit controls.
- Existing Firebase sync and data model are preserved.

## V22 Analytics KPI colors
- Money Comes In KPI uses green at 20% opacity.
- Money Goes Out KPI uses red at 20% opacity.
- Text and icons remain high contrast on the dark analytics theme.

## V23 Loans & Money Owed redesign
- Separate green To Receive and red To Give sections.
- EMI/loan liabilities have a dedicated purple section with table-style details.
- All existing Edit/Delete/Mark Paid actions remain.
- Loans and EMIs remain excluded from Total Money.


## V26 AI model update
Firebase AI Logic now uses `gemini-3.6-flash` instead of the retired/deprecated `gemini-2.5-flash` model.
