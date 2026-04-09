# Docker Integration Testing

This repository includes a lightweight mock backend for integration testing.

## Files

- `docker/mock-backend/Dockerfile`
- `docker/mock-backend/server.mjs`
- `docker-compose.integration.yml`

## Run locally

```bash
pnpm run docker:mock:up
```

Health endpoint:

```bash
curl http://localhost:4010/health
```

Stop and remove container:

```bash
pnpm run docker:mock:down
```

## API endpoints

- `GET /health`
- `GET /api/ping`
- `POST /api/echo`

## Integration tests

Run integration tests against the running mock backend:

```bash
pnpm run test:integration
```

Or start backend and run tests in one command:

```bash
pnpm run test:integration:docker
```

Note: `test:integration:docker` leaves containers running if tests fail.
Use `pnpm run docker:mock:down` afterwards to clean up.

Example:

```bash
curl -X POST http://localhost:4010/api/echo \
  -H "Content-Type: application/json" \
  -d '{"hello":"world"}'
```
