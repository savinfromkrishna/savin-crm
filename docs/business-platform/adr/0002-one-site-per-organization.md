# ADR 0002: one Frappe site per organization, shared by its spaces

Status: accepted, 2026-10-18.

## Context

Savingroup organizations contain spaces (workspaces) and teams. Business records are
confidential per legal entity, and ERPNext models one or more companies inside one site.

## Decision

`BusinessEnvironment` maps one organization to one site. Every space of the organization
resolves to the same environment; the gateway resolves the environment from the space's
organization on the server, never from tool arguments or request bodies.

Tenant boundaries:

- Separate site per organization: separate database, files, users and API keys.
- The gateway authenticates as a per-site gateway user with standard ERPNext and Frappe
  CRM roles plus the bridge role, never Administrator.
- Credentials are sealed with the deployment secret store and opened only to build a
  client for a request.
- Event deliveries are addressed to the environment id and signed with a per-environment
  secret; delivery ids are unique per environment.

Multiple legal companies inside one organization are a later step: ERPNext supports
several companies per site, and the environment row already records the company the
gateway acts for. A dedicated enterprise deployment is the same model with its own
compose stack.

## Alternatives considered

- **One site per space or per bot.** Rejected: duplicates masters and accounting, and
  bots are actors, not tenants.
- **Shared multi-company site for all organizations.** Rejected: no database-level
  isolation, one credential set, shared backups and logs.

## Consequences

- Provisioning is per organization and is what the bootstrap script and the later
  control plane create.
- Savingroup-side settings that are per space (approval policy) stay per space; the bridge
  receives them with every call.
