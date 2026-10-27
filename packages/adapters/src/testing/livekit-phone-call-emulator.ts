import type {
  LiveKitDispatchesClient,
  LiveKitParticipant,
  LiveKitRoomsClient,
  LiveKitSipsClient,
} from "../livekit-phone-call.js";

/**
 * In-memory stand-in for the three LiveKit server clients the phone adapter
 * uses, so the adapter's own translation runs offline in conformance tests.
 */
export class LiveKitPhoneCallEmulator {
  readonly rooms = new Map<string, { participants: LiveKitParticipant[] }>();
  readonly dispatches: Array<{ room: string; agentName: string; metadata?: string }> = [];
  readonly dials: Array<{ trunkId: string; number: string; room: string; options?: unknown }> = [];

  readonly clients: {
    rooms: LiveKitRoomsClient;
    dispatches: LiveKitDispatchesClient;
    sips: LiveKitSipsClient;
  } = {
    rooms: {
      createRoom: async ({ name }) => {
        if (!this.rooms.has(name)) this.rooms.set(name, { participants: [] });
        return { name };
      },
      listRooms: async (names) =>
        [...this.rooms.keys()]
          .filter((name) => !names || names.includes(name))
          .map((name) => ({ name })),
      listParticipants: async (room) => this.rooms.get(room)?.participants ?? [],
      deleteRoom: async (room) => {
        if (!this.rooms.delete(room)) {
          throw new Error("twirp error not_found: room does not exist");
        }
      },
    },
    dispatches: {
      createDispatch: async (room, agentName, options) => {
        this.dispatches.push({ room, agentName, metadata: options?.metadata });
        return {};
      },
    },
    sips: {
      createSipParticipant: async (trunkId, number, room, options) => {
        if (number.endsWith("0000")) {
          throw new Error("twirp error invalid_argument: invalid number");
        }
        this.dials.push({ trunkId, number, room, options });
        this.setCallee(room, "dialing");
        return { participantIdentity: "callee" };
      },
    },
  };

  /** Drive the SIP leg: dialing, ringing, active, hangup. */
  setCallee(room: string, callStatus: string) {
    const entry = this.rooms.get(room);
    if (!entry) return;
    entry.participants = [{ identity: "callee", attributes: { "sip.callStatus": callStatus } }];
  }

  closeRoom(room: string) {
    this.rooms.delete(room);
  }
}
