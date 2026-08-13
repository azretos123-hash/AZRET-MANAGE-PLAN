# YARIN V39 — Email OTP Password Reset

Added a secure Forgot Password flow:
1. Enter registered email.
2. Receive a 6-digit OTP by Brevo transactional email.
3. Verify OTP (10-minute expiry, max-attempt protection).
4. Enter and confirm a new password.
5. Return to Sign In.

Security details:
- OTP is never stored in plaintext; only a server-secret SHA-256 digest is persisted.
- Older unused codes are invalidated when a new code is issued.
- OTP expires after 10 minutes and is one-time-use.
- Verification attempts and public request rates are limited.
- Unknown email addresses receive a generic success message to reduce account enumeration.
- Password reset authorization is stored server-side in the signed Flask session and expires after 10 minutes.
- Brevo API key remains server-side only.

Render environment variables required:
- BREVO_API_KEY
- BREVO_SENDER_EMAIL (must be a sender verified in Brevo)
- BREVO_SENDER_NAME=YARIN (optional)
