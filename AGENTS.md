# Agent Guardrails (Maark Only)

- Operate only on the **maark** repository in this workspace.
- Allowed git origin: `https://github.com/nordicaseo/maark.git` (or equivalent SSH URL).
- Allowed Vercel project: `maark` (`prj_6JDgeFGHSTs42AjlaXOOXkLNquy4`) in org `team_12ttcviDMRgJSWVEGXTcFfjp`.
- Production domain mapping must resolve `maark.ai` and `www.maark.ai` to the current
  `maark-nordicaseo.vercel.app` production deployment.

## Hard Exclusions

- Do not modify files in `site-auditor`.
- Do not modify files in `serpmesh` / `serpmesh-review`.
- Do not run deployment commands for projects other than **maark**.

If any context indicates a different project, stop and ask for confirmation before proceeding.
