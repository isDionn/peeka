# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the repository's **Security** tab and click **Report a vulnerability** ([direct link](https://github.com/isDionn/peeka/security/advisories/new)). Do not open a public issue.

Include the Peeka version, your Windows version and steps to reproduce. You will get a reply on the advisory; please give us a reasonable time to ship a fix before disclosing.

Only the latest release is supported.

## Scope

Peeka is designed to be local-only: its own code makes no outbound network requests. The areas where a bug matters most:

- **Plugin pipe.** Plugins talk JSON-RPC 2.0 over a per-user named pipe, with scoped permissions the user approves. Anything that lets another user, an unapproved plugin, or a plugin outside its granted scopes reach Peeka is in scope, as is a plugin unlocking a locked Peeka.
- **Clipboard.** The clipboard history and its DPAPI-encrypted vault. Leaks of password-like items (to plugins, to the page before hover, or while locked) are in scope.
- **Local alert API.** The optional `127.0.0.1` endpoint (off by default, per-install key).
- **Lock and presentation mode.** Any content shown instead of generic labels.
- **Release artifacts.** Compare downloads against `SHA256SUMS.txt` on the release page.
