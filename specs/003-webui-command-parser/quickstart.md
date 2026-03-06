# Quickstart: Web UI Command Parser

## Goal

Validate alias parsing, client-side target checks, inline guidance, help modal behavior, and retry handling.

## Prerequisites

```bash
cd /Users/dinohughes/Projects/my2/w1
npm install
```

## Automated Checks

```bash
npm -w web run test:unit
npm -w web run check
npm -w web run test:e2e
```

## Manual Verification

1. Start the app: `npm run dev`
2. Start any game from `/`
3. Alias parsing:
   - Enter `travel to garden` and confirm movement executes
   - Enter `speak with <character in scene>` and confirm talk starts
4. Missing/invalid target validation:
   - Enter `go` and confirm inline movement suggestions
   - Enter `go to zyx` and confirm inline destination error + suggestions
   - Enter `talk to` and confirm character suggestions
5. List commands:
   - Enter `locations` and confirm locations with characters are shown
   - Enter `characters` and confirm current-scene characters are shown
6. Unrecognized guidance + help split:
   - Enter `jump over fence` and confirm concise inline commands hint
   - Enter `help` and confirm detailed modal opens with alias coverage
7. Retry behavior:
   - Simulate transient backend failure and confirm retry progress messages appear
   - Confirm command succeeds when backend recovers before attempt 3
   - Simulate persistent 5xx and confirm manual retry button appears after 3 attempts
   - Simulate 4xx and confirm no automatic retry occurs
