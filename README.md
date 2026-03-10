# Maark Content Writer

Repository: `https://github.com/nordicaseo/maark.git`

## Local development

```bash
npm ci
npm run dev
```

## Deployment guardrails

This repository enforces production deployment guardrails for the **maark** Vercel project.

- Required Vercel project name: `maark`
- Required Vercel project ID: `prj_6JDgeFGHSTs42AjlaXOOXkLNquy4`
- Required Vercel org ID: `team_12ttcviDMRgJSWVEGXTcFfjp`
- Required project production alias: `maark-nordicaseo.vercel.app`
- Required domains resolving to the current production deployment: `maark.ai`, `www.maark.ai`
- Blocked workspaces/projects: `site-auditor`, `serpmesh`, `serp-mesh`

Run the guardrails locally:

```bash
npm run guard:project
npm run guard:vercel-production
```

Release checks:

```bash
npm run ci:release-guard
npm run release:guard
```

`npm run ship:vercel` deploys to production and re-validates the aliases.

## Modal Agent Runtime (Optional)

Maark can be prepared to hand off agent execution to Modal without changing
default behavior. Local runtime remains default unless you explicitly enable
Modal.

Environment variables:

- `AGENT_COMPUTE_RUNTIME=modal`
- `AGENT_MODAL_URL=https://<workspace>--<app>.modal.run`
- `AGENT_MODAL_SHARED_SECRET=<shared secret>`
- `AGENT_MODAL_CALLBACK_SECRET=<optional callback secret>` (falls back to shared secret)
- `AGENT_MODAL_CALLBACK_PATH=/api/agent/runtime/callback` (optional, default shown)

Operational endpoints:

- `GET /api/admin/agents/modal/health` (admin-only runtime health check)
- `POST /api/agent/runtime/callback` (Modal callback endpoint, secret required)
