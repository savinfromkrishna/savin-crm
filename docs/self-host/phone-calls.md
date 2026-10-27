# Phone calls

A bot can place a phone call on the user's behalf, hold the conversation by voice, and come back with the transcript. Calls use the bot's configured model and the Space's voice provider for speech; the telephony leg runs through a self-hosted [LiveKit](https://github.com/livekit/livekit) server and its [SIP bridge](https://github.com/livekit/sip), both Apache-2.0. A SIP trunk from any carrier supplies the phone number.

The default is `TELEPHONY_PROVIDER=none`. Core workflows do not require LiveKit or a carrier.

## How a call works

1. The bot calls `phone_call_place` with a number, a purpose, and optional guidance. The tool requires the user's approval like other consequential actions.
2. The worker creates a LiveKit room, dispatches the voice agent into it with a credential that is valid for this call only, and dials the callee through the SIP trunk.
3. The voice agent transcribes the callee through the Space's voice provider, asks the API for the bot's next line, and speaks it with the bot's voice. The API holds the brief, the transcript and the model credential; the agent never sees deployment secrets.
4. When the call ends, the card in the chat shows the outcome and the bot is woken with the call id. It reads the transcript with `phone_call_status` and continues its task.

Callee speech is treated as untrusted data throughout: it is quoted to the model as a transcript, never as instructions.

## Enable LiveKit

Configure the API, the worker, and the voice agent with the same values:

```dotenv
TELEPHONY_PROVIDER=livekit
LIVEKIT_URL=http://livekit:7880
LIVEKIT_API_KEY=replace-with-your-key
LIVEKIT_API_SECRET=replace-with-a-32-plus-character-secret
LIVEKIT_SIP_TRUNK_ID=ST_replace
PHONE_CALL_FROM_NUMBER=+14155550123
```

`LIVEKIT_SIP_TRUNK_ID` is the outbound trunk created in LiveKit for your carrier. With the `lk` CLI:

```bash
lk sip outbound create --name carrier --address sip.example-carrier.com \
  --numbers +14155550123 --auth-user user --auth-pass pass
```

The Space also needs a voice provider connected in Voice settings that supports transcription, and a bot needs a model connection. Without either, a call fails before dialing.

## Compose

The `phone` profile adds a LiveKit server, the SIP bridge, their Redis, and the voice agent:

```bash
docker compose --env-file .env -f infra/compose/docker-compose.yml --profile phone up -d --build
```

The SIP bridge listens on UDP 5060 and the RTP range 10000-10100; expose those to your carrier. Set `LIVEKIT_SIP_EXTERNAL_IP` to the public address when the host sits behind NAT. The voice agent reaches the API at `PHONE_CALL_AGENT_API_URL`, which defaults to `API_URL`; inside Compose it is `http://api:3100`.

Speech providers that return MP3 or 16-bit WAV are supported. Open-source speech works through the OpenAI-compatible voice connection pointed at a local server such as speaches.

## Limits and recovery

Calls hang up after `maxMinutes` (default 10, at most 30). The database row is the outbox: the worker and reconciler recover queue failures and interrupted placements, and a retried placement never dials the callee twice because the room name is derived from the call id. The user can hang up from the card at any time.
