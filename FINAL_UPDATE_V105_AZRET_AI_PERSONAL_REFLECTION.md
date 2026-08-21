# YARIN V105 — Azret AI Identity + Personal Daily Reflection

## UI update
- Sidebar AI identity changed from the YARIN brand text to **AZRET AI / ASSISTANT**.
- Added subtle animated AI identity gradient with Classic/Premium and reduced-motion compatibility.
- The Azret AI orb remains the launcher; no AI backend or voice/chat behavior was removed.

## Daily Reflection update
- Replaced generic rotating quote text with a personalised financial attention point based on the signed-in user's recorded dashboard data.
- The reflection checks monthly income, expenses, family transfers, EMI/debt repayments, savings, outstanding debt and savings-goal progress.
- It prioritises one concise issue at a time: missing income data, cash-flow deficit, very high expenses, heavy EMI/debt burden, high total outflow, missing/low savings, thin savings buffer, or low goal progress.
- If there is not enough recorded data, it explicitly says so instead of guessing.
- Reflection automatically refreshes when dashboard data is refreshed or currency/theme re-renders the dashboard.

## Cache
- Service worker cache bumped to `yarin-cache-v105`.

## 10-pass QA
1. JavaScript syntax check
2. Python bytecode compile check
3. HTML parse + duplicate ID audit
4. CSS brace/structure balance
5. Flask route declaration AST audit
6. Template static-asset reference audit
7. Service worker cache/asset audit
8. Daily Reflection runtime logic edge-case tests
9. Requested sidebar/reflection DOM invariant audit
10. Final ZIP integrity test

Note: dependency-level Flask runtime import was not executed in the packaging container because Flask is not installed in that container; Python source compilation and route AST validation are included in the QA above. Production dependencies remain declared in `requirements.txt`.
