# Pull request previews

Floe Note uses Cloudflare Worker Previews for pull request validation.

Each pull request gets two Previews with the same name:

- `floe-note`: the Web client
- `floe-note-coordinator`: the coordinator and its Durable Objects

The Preview name is `pr-<pull-request-number>`.

The coordinator is deployed first. The Web client is then built with
`VITE_COORDINATOR_URL` set to that coordinator Preview URL and deployed as its
own Preview. This keeps the Web and coordinator for one pull request paired.

Cloudflare automatically isolates Durable Object namespaces and storage between
Previews. The coordinator Wrangler configuration repeats the Durable Object
bindings under `previews` so they are available through `env` in Preview
deployments.

Production releases are unchanged. They continue to use the release workflows
documented in `docs/releases.md`; this Preview workflow never runs
`wrangler deploy`.

## One-time GitHub setup

Create a GitHub Environment named `preview`.

Add these Environment secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Use a Cloudflare API token that can edit the existing `floe-note` and
`floe-note-coordinator` Workers. Prefer a dedicated CI token scoped only to
the Workers required by previews.

Do not reuse the `production` GitHub Environment for pull request previews.

The workflow intentionally skips pull requests whose head repository differs
from this repository, because GitHub does not expose deployment secrets safely
to forked pull requests.

## One-time Cloudflare setup

Worker Preview URLs must be enabled for both existing Workers:

- `floe-note`
- `floe-note-coordinator`

The Wrangler files declare `"preview_urls": true` as the desired setting.
For an existing Worker where Preview URLs are currently disabled, enable
**Worker URL > Preview** once in the Cloudflare dashboard before the first
Preview deployment. A later production `wrangler deploy` will also apply the
Wrangler setting.

Workers.dev Preview URLs are public by default. Cloudflare adds
`X-Robots-Tag: noindex` to these URLs, but this is not access control. Use
Cloudflare Access if previews should be restricted to authenticated users.

## Local verification

Install dependencies first:

```sh
pnpm install
```

If Wrangler is not authenticated locally, authenticate once:

```sh
pnpm --filter @floe-note/coordinator exec wrangler login
```

Create or update a paired Preview:

```sh
pnpm preview -- --name preview-test
```

The command prints the Web and coordinator Preview URLs. Open the Web URL and
verify the normal Floe Note flow, including coordinator-backed operations.

Delete the test Preview when finished:

```sh
pnpm preview:delete -- --name preview-test
```

## Pull request behavior

For same-repository pull requests targeting `main`, the Preview workflow:

1. installs the workspace dependencies
2. creates or updates the coordinator Preview
3. builds the Web client against that coordinator Preview URL
4. creates or updates the Web Preview
5. probes the Web root and coordinator `/health`
6. creates or updates one pull request comment containing both URLs

Subsequent pushes to the pull request update the same `pr-<number>` Preview.

When the pull request is closed, the workflow deletes both Previews. Deleting
the coordinator Preview also deletes the Durable Object state that Cloudflare
created for that Preview.

## TURN

Ordinary pull request coordinator Previews set `TURN_ENABLED=false` and do not
receive production TURN secrets. Direct WebRTC and local editing continue to
work. Controlled TURN-enabled staging needs its own coordinator deployment and
Cloudflare TURN key; it must not reuse the production key. Previews do not
deploy the legacy `apps/turn` Worker.
