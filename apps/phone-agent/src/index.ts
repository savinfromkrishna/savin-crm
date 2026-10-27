import { fileURLToPath } from "node:url";
import type { JobContext, JobProcess } from "@livekit/agents";
import { cli, defineAgent, ServerOptions, stt, tts, voice } from "@livekit/agents";
import * as silero from "@livekit/agents-plugin-silero";
import { type RemoteParticipant, RoomEvent } from "@livekit/rtc-node";
import { loadRootEnv } from "@savingroup/core/node/load-root-env";
import { getLogger, installLogger, SERVICE_NAMES } from "@savingroup/logging";
import { createRootLogger } from "@savingroup/logging/axiom";
import { MPEGDecoder } from "mpg123-decoder";
import { PhoneCallApi, type PhoneCallOutcome } from "./api-client.js";
import type { Mp3Decoder } from "./audio.js";
import { SavingroupLlm, SavingroupStt, SavingroupTts } from "./bridges.js";
import { parsePhoneAgentMetadata } from "./metadata.js";

loadRootEnv();
installLogger(createRootLogger(SERVICE_NAMES.phoneAgent));

/** Must match the identity the API's LiveKit adapter dials the callee under. */
const CALLEE_IDENTITY = "callee";
/** The SIP leg rings for 45 s; give the status attribute a little longer to settle. */
const ANSWER_TIMEOUT_MS = 60_000;
const ANSWER_POLL_MS = 250;

function mp3Decoder(): Mp3Decoder {
  let instance: MPEGDecoder | undefined;
  return {
    async decode(bytes) {
      instance ??= new MPEGDecoder();
      await instance.ready;
      const decoded = instance.decode(bytes);
      instance.reset();
      return { channelData: decoded.channelData, sampleRate: decoded.sampleRate };
    },
  };
}

/** Resolves true once the SIP participant is talking, false if it left or never answered. */
async function waitForAnswer(callee: RemoteParticipant, room: JobContext["room"]) {
  const deadline = Date.now() + ANSWER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = callee.attributes["sip.callStatus"];
    if (status === "active" || status === "automation") return true;
    if (status === "hangup") return false;
    if (!room.remoteParticipants.has(callee.identity)) return false;
    await new Promise((resolve) => setTimeout(resolve, ANSWER_POLL_MS));
  }
  return false;
}

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx: JobContext) => {
    const log = getLogger();
    const metadata = parsePhoneAgentMetadata(ctx.job.metadata);
    if (!metadata) {
      log.warn("phone agent dispatched without call metadata");
      ctx.shutdown("no call metadata");
      return;
    }
    const api = new PhoneCallApi(metadata);
    const brief = await api.brief().catch(() => null);
    if (!brief) {
      log.warn("phone agent could not load its call", { callId: metadata.callId });
      ctx.shutdown("call unavailable");
      return;
    }

    let ended = false;
    const end = async (outcome: PhoneCallOutcome) => {
      if (ended) return;
      ended = true;
      await api.ended(outcome).catch(() => undefined);
      ctx.shutdown(outcome.endReason ?? "ended");
    };
    let endRequested = false;
    const vad = ctx.proc.userData.vad as silero.VAD;
    const session = new voice.AgentSession({
      vad,
      stt: new stt.StreamAdapter(new SavingroupStt(api, brief.language ?? undefined), vad),
      tts: new tts.StreamAdapter(new SavingroupTts(api, mp3Decoder())),
      llm: new SavingroupLlm(api, () => {
        endRequested = true;
      }),
    });
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (event) => {
      // The goodbye has been spoken once the agent stops speaking again.
      if (endRequested && event.newState === "listening") {
        void end({ status: "completed", endReason: "bot_hung_up" });
      }
    });
    session.on(voice.AgentSessionEventTypes.Close, () => {
      void end({ status: "completed", endReason: "session_closed" });
    });
    ctx.room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      if (participant.identity === CALLEE_IDENTITY) {
        void end({ status: "completed", endReason: "callee_hung_up" });
      }
    });

    await session.start({
      agent: new voice.Agent({ instructions: "You are on a phone call." }),
      room: ctx.room,
      inputOptions: { participantIdentity: CALLEE_IDENTITY, closeOnDisconnect: true },
    });
    await ctx.connect();

    const callee = await ctx.waitForParticipant(CALLEE_IDENTITY);
    if (!(await waitForAnswer(callee, ctx.room))) {
      await end({ status: "no_answer", endReason: "not_answered" });
      return;
    }
    await api.answered().catch(() => undefined);
    setTimeout(
      () => void end({ status: "completed", endReason: "max_duration" }),
      brief.maxDurationSec * 1000,
    ).unref();
    session.say(brief.greeting);
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: process.env.LIVEKIT_AGENT_NAME?.trim() || "savingroup-phone",
  }),
);
