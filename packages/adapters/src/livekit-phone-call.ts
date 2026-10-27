import type {
  AdapterContext,
  AdapterDescriptor,
  PhoneCallCapabilities,
  PhoneCallHandle,
  PhoneCallPlaceRequest,
  PhoneCallProvider,
  PhoneCallSnapshot,
  PhoneCallStatus,
} from "@savingroup/adapter-kit";
import { PhoneCallRequestRejected } from "@savingroup/adapter-kit";
import { AgentDispatchClient, RoomServiceClient, SipClient } from "livekit-server-sdk";

export const LIVEKIT_CALLEE_IDENTITY = "callee";
/** Seconds the callee's phone rings before the SIP leg gives up. */
export const LIVEKIT_RINGING_TIMEOUT_SEC = 45;

/** The slice of the LiveKit server API this adapter uses; tests inject fakes. */
export interface LiveKitRoomsClient {
  createRoom(options: {
    name: string;
    emptyTimeout?: number;
    maxParticipants?: number;
    metadata?: string;
  }): Promise<unknown>;
  listRooms(names?: string[]): Promise<Array<{ name: string }>>;
  listParticipants(room: string): Promise<LiveKitParticipant[]>;
  deleteRoom(room: string): Promise<void>;
}
export interface LiveKitParticipant {
  identity: string;
  attributes?: Record<string, string>;
}
export interface LiveKitDispatchesClient {
  createDispatch(
    roomName: string,
    agentName: string,
    options?: { metadata?: string },
  ): Promise<unknown>;
}
export interface LiveKitSipsClient {
  createSipParticipant(
    sipTrunkId: string,
    number: string,
    roomName: string,
    options?: {
      fromNumber?: string;
      participantIdentity?: string;
      participantName?: string;
      ringingTimeout?: number;
      maxCallDuration?: number;
      waitUntilAnswered?: boolean;
      playDialtone?: boolean;
      krispEnabled?: boolean;
    },
  ): Promise<unknown>;
}

export interface LiveKitPhoneCallOptions {
  url: string;
  apiKey: string;
  apiSecret: string;
  sipTrunkId: string;
  agentName: string;
  clients?: {
    rooms: LiveKitRoomsClient;
    dispatches: LiveKitDispatchesClient;
    sips: LiveKitSipsClient;
  };
}

/** What the voice agent receives with its job; the brief itself is fetched from the API. */
export interface LiveKitPhoneAgentMetadata {
  callId: string;
  apiUrl: string;
  token: string;
}

export function phoneCallRoomName(callId: string) {
  return `phone-${callId}`;
}

/**
 * Outbound calls through a self-hosted LiveKit server and its SIP bridge. One
 * room per call: the agent worker is dispatched into it, then the callee is
 * dialed as a SIP participant. LiveKit only carries audio; speech and the model
 * stay with Savingroup.
 */
export class LiveKitPhoneCallProvider implements PhoneCallProvider {
  private readonly rooms: LiveKitRoomsClient;
  private readonly dispatches: LiveKitDispatchesClient;
  private readonly sips: LiveKitSipsClient;

  constructor(private readonly options: LiveKitPhoneCallOptions) {
    const clients = options.clients ?? {
      rooms: new RoomServiceClient(options.url, options.apiKey, options.apiSecret),
      dispatches: new AgentDispatchClient(options.url, options.apiKey, options.apiSecret),
      sips: new SipClient(options.url, options.apiKey, options.apiSecret),
    };
    this.rooms = clients.rooms;
    this.dispatches = clients.dispatches;
    this.sips = clients.sips;
  }

  describe(): AdapterDescriptor<PhoneCallCapabilities> {
    return {
      id: "livekit",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { outbound: true, offline: false },
    };
  }

  async place(request: PhoneCallPlaceRequest, context: AdapterContext): Promise<PhoneCallHandle> {
    context.signal.throwIfAborted();
    const room = phoneCallRoomName(request.callId);
    // A retry after a crash must not dial the callee twice.
    const existing = await this.rooms.listRooms([room]);
    if (existing.some((entry) => entry.name === room)) return { id: room };
    await this.rooms.createRoom({
      name: room,
      emptyTimeout: 120,
      maxParticipants: 3,
      metadata: JSON.stringify({ callId: request.callId }),
    });
    const metadata: LiveKitPhoneAgentMetadata = {
      callId: request.callId,
      apiUrl: request.agent.apiUrl,
      token: request.agent.token,
    };
    await this.dispatches.createDispatch(room, this.options.agentName, {
      metadata: JSON.stringify(metadata),
    });
    try {
      await this.sips.createSipParticipant(this.options.sipTrunkId, request.to, room, {
        ...(request.from ? { fromNumber: request.from } : {}),
        participantIdentity: LIVEKIT_CALLEE_IDENTITY,
        participantName: request.to,
        ringingTimeout: LIVEKIT_RINGING_TIMEOUT_SEC,
        maxCallDuration: request.maxDurationSec,
        waitUntilAnswered: false,
        playDialtone: false,
        krispEnabled: true,
      });
    } catch (error) {
      await this.rooms.deleteRoom(room).catch(() => undefined);
      if (isRejectedDial(error)) throw new PhoneCallRequestRejected();
      throw error;
    }
    return { id: room };
  }

  async get(id: string, context: AdapterContext): Promise<PhoneCallSnapshot> {
    context.signal.throwIfAborted();
    const rooms = await this.rooms.listRooms([id]);
    if (!rooms.some((entry) => entry.name === id)) {
      return { id, status: "completed", endReason: "room_closed" };
    }
    const participants = await this.rooms.listParticipants(id);
    const callee = participants.find((p) => p.identity === LIVEKIT_CALLEE_IDENTITY);
    return { id, status: calleeStatus(callee) };
  }

  async hangup(id: string, context: AdapterContext): Promise<PhoneCallSnapshot> {
    context.signal.throwIfAborted();
    await this.rooms.deleteRoom(id).catch((error) => {
      if (!isNotFound(error)) throw error;
    });
    return { id, status: "cancelled", endReason: "hung_up" };
  }
}

/** LiveKit reports the SIP leg's state in the participant attribute `sip.callStatus`. */
function calleeStatus(callee: LiveKitParticipant | undefined): PhoneCallStatus {
  if (!callee) return "ringing";
  switch (callee.attributes?.["sip.callStatus"]) {
    case "active":
    case "automation":
      return "in_progress";
    case "hangup":
      return "completed";
    default:
      return "ringing";
  }
}

function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).toLowerCase();
}

function isRejectedDial(error: unknown) {
  const message = errorText(error);
  return (
    message.includes("invalid") ||
    message.includes("not found") ||
    message.includes("permission") ||
    message.includes("unauthenticated") ||
    message.includes("trunk")
  );
}

function isNotFound(error: unknown) {
  const message = errorText(error);
  return message.includes("not found") || message.includes("does not exist");
}
