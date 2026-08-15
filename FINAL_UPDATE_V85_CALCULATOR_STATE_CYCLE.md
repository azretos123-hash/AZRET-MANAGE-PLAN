# YARIN V85 — Floating Calculator State + Cycle

- Floating calculator working data is preserved when the calculator window is closed and reopened.
- Switching with Next never clears Simple, Currency, Savings, or EMI inputs/results.
- Simple calculator expression is persisted; only the C button clears it.
- Currency amount/direction, Savings inputs, and EMI inputs are persisted locally.
- The Next button cycles continuously: Simple → Currency → Savings → EMI → Simple.
- Calculator data also survives a normal page refresh on the same browser/device.
- Cache version bumped to V85.
