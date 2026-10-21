import type { JsonValue, MessageAction, Room } from 'trystero';
import { hostOf, parseCfg, parseGo, parseHello, parseSnap, type Go, type Hello, type NetSnap, type RoomCfg } from './protocol';

/** Señalización por relays públicos de nostr: no hay servidor propio. Los datos van directo entre navegadores. */
const APP_ID = 'consola-de-carrera-v1';

export interface Member { id: string; name: string; since: number; me: boolean }

export interface RoomEvents {
  /** Cambió la lista de jugadores o quién es el anfitrión. */
  change(): void;
  cfg(c: RoomCfg): void;
  go(g: Go): void;
  snap(id: string, s: NetSnap): void;
  /** Se presentó alguien nuevo. */
  joined(id: string): void;
  leave(id: string): void;
  error(msg: string): void;
}

/** Sala privada. Cada uno simula su auto: por acá solo pasan presentaciones, ajustes, largadas y posiciones. */
export class NetRoom {
  readonly members = new Map<string, Member>();
  private room: Room | null = null;
  private hi: MessageAction<JsonValue> | null = null;
  private cfgA: MessageAction<JsonValue> | null = null;
  private goA: MessageAction<JsonValue> | null = null;
  private st: MessageAction<JsonValue> | null = null;
  private selfId = '';
  private closed = false;

  private constructor(readonly code: string, private readonly me: Hello, private readonly on: RoomEvents) {}

  static async join(code: string, me: Hello, on: RoomEvents): Promise<NetRoom> {
    const r = new NetRoom(code, me, on);
    const t = await import('trystero');
    if (r.closed) return r;
    r.selfId = t.selfId;
    r.members.set(t.selfId, { id: t.selfId, ...me, me: true });
    const room = t.joinRoom({ appId: APP_ID }, code, { onJoinError: (e) => on.error(e.error) });
    r.room = room;
    r.hi = room.makeAction<JsonValue>('hi');
    r.cfgA = room.makeAction<JsonValue>('cfg');
    r.goA = room.makeAction<JsonValue>('go');
    r.st = room.makeAction<JsonValue>('st');
    room.onPeerJoin = (id) => { void r.hi?.send(me, { target: id }); };
    room.onPeerLeave = (id) => {
      r.members.delete(id);
      on.leave(id);
      on.change();
    };
    r.hi.onMessage = (d, { peerId }) => {
      const h = parseHello(d);
      if (!h) return;
      const fresh = !r.members.has(peerId);
      r.members.set(peerId, { id: peerId, ...h, me: false });
      on.change();
      if (fresh) on.joined(peerId);
    };
    r.cfgA.onMessage = (d, { peerId }) => {
      const c = parseCfg(d);
      if (c && peerId === r.host) on.cfg(c);
    };
    r.goA.onMessage = (d, { peerId }) => {
      const g = parseGo(d);
      if (g && peerId === r.host) on.go(g);
    };
    r.st.onMessage = (d, { peerId }) => {
      const s = parseSnap(d);
      if (s && r.members.has(peerId)) on.snap(peerId, s);
    };
    on.change();
    return r;
  }

  get host(): string | null { return hostOf([...this.members.values()]); }
  get isHost(): boolean { return this.host === this.selfId; }
  get peers(): number { return this.members.size - 1; }
  nameOf(id: string): string { return this.members.get(id)?.name ?? 'Jugador'; }

  sendCfg(c: RoomCfg, target?: string): void { void this.cfgA?.send(c, target ? { target } : undefined); }
  sendGo(g: Go): void { void this.goA?.send(g); }
  sendSnap(s: NetSnap): void { if (this.peers > 0) void this.st?.send(s); }

  leave(): void {
    this.closed = true;
    void this.room?.leave();
    this.room = null;
    this.members.clear();
  }
}
