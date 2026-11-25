# Security

**English:** Please report vulnerabilities privately via **Security → Report a vulnerability** on this repository, not in public issues.

**Português:** Relate falhas de segurança em particular pelo botão **Security → Report a vulnerability** deste repositório, não em issues públicas.

**Español:** Reporta vulnerabilidades en privado con **Security → Report a vulnerability** de este repositorio, no en issues públicos.

## Design notes

- Local mode (macOS/Windows) listens only on `127.0.0.1` and rejects requests whose `Host` is not `localhost`/`127.0.0.1` (DNS rebinding) or whose `Origin` is another site (CSRF).
- Server mode requires `BOARD_PASSWORD`, an `HttpOnly; Secure; SameSite=Lax` cookie and the same Origin checks. Always put it behind HTTPS.
- Updates are downloaded from this repository's latest release and verified by sha256 before installing.
- The Board never stores your Claude password; login goes through the official Claude Code CLI.
