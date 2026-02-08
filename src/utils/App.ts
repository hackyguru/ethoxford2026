import { RtcPairSocket } from 'rtc-pair-socket';
import AsyncQueue from './AsyncQueue';
import assert from './assert';
import generateProtocol from './generateProtocol';
import UsableField from './UsableField';

function jsonReplacer(key: string, value: any) {
  if (typeof value === 'bigint') {
    return { __bigint: value.toString() };
  }
  return value;
}

function jsonReviver(key: string, value: any) {
  if (value && typeof value === 'object' && value.__bigint) {
    return BigInt(value.__bigint);
  }
  return value;
}

export default class App {
  step = new UsableField(1);
  party = new UsableField<'alice' | 'bob' | undefined>(undefined);
  progress = new UsableField(0);
  joiningCode = new UsableField('');

  socket?: RtcPairSocket;
  msgQueue = new AsyncQueue<unknown>();

  static generateJoiningCode() {
    // 128 bits of entropy
    return [
      Math.random().toString(36).substring(2, 12),
      Math.random().toString(36).substring(2, 12),
      Math.random().toString(36).substring(2, 7),
    ].join('');
  }

  host() {
    const joiningCode = App.generateJoiningCode();
    this.joiningCode.set(joiningCode);
    this.step.set(2);

    this.connect(joiningCode, 'alice');
  }

  join() {
    this.step.set(2);
    this.party.set('bob');
  }

  async connect(code: string, party: 'alice' | 'bob') {
    this.party.set(party);
    const socket = new RtcPairSocket(code, party);
    this.socket = socket;

    socket.on('message', (msg: unknown) => {
      // Using a message queue instead of passing messages directly to the MPC
      // protocol ensures that we don't miss anything sent before we begin.
      this.msgQueue.push(msg);
    });

    await new Promise<void>((resolve, reject) => {
      socket.on('open', resolve);
      socket.on('error', reject);
    });

    this.step.set(3);
  }

  async sendData(data: any) {
    if (!this.socket) throw new Error('No connection');
    this.socket.send(JSON.stringify({ type: 'DATA', payload: data }, jsonReplacer));
  }

  onData(callback: (data: any) => void) {
    this.msgQueue.stream((msg: unknown) => {
      if (typeof msg === 'string') {
        try {
          const parsed = JSON.parse(msg, jsonReviver);
          if (parsed.type === 'DATA') {
            callback(parsed.payload);
          }
        } catch (e) { }
      }
    });
  }

  async runVerification(inputs: { age?: number; residency?: number; minAge?: number; requiredResidency?: number }): Promise<boolean> {
    const { socket } = this;
    const party = this.party.value;

    assert(party !== undefined, 'Party must be set');
    assert(socket !== undefined, 'Socket must be set');

    const TOTAL_BYTES = 150000;
    let currentBytes = 0;

    const input = party === 'alice'
      ? { minAge: inputs.minAge, requiredResidency: inputs.requiredResidency }
      : { age: inputs.age, residency: inputs.residency };

    const otherParty = party === 'alice' ? 'bob' : 'alice';

    const protocol = await generateProtocol();

    const session = protocol.join(party, input, (to, msg) => {
      assert(to === otherParty, 'Unexpected party');
      socket.send(msg);

      currentBytes += msg.byteLength;
      this.progress.set(currentBytes / TOTAL_BYTES);
    });

    this.msgQueue.stream((msg: unknown) => {
      if (!(msg instanceof Uint8Array)) {
        throw new Error('Unexpected message type');
      }

      session.handleMessage(otherParty, msg);

      currentBytes += msg.byteLength;

      this.progress.set(currentBytes / TOTAL_BYTES);
    });

    const output = await session.output();

    if (currentBytes !== TOTAL_BYTES) {
      // Log for info, but don't error
      // console.warn(`Bytes mismatch: ${currentBytes} vs ${TOTAL_BYTES}`);
    }

    if (
      output === null ||
      typeof output !== 'object' ||
      typeof output.valid !== 'number'
    ) {
      throw new Error('Unexpected output');
    }

    return output.valid === 1;
  }
}
