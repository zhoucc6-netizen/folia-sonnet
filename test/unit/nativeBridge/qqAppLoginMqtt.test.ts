import { describe, expect, it } from 'vitest';
import {
    buildConnectPacket,
    buildSubscribePacket,
    createPacketQueue,
    decodeVarint,
    encodeVarint,
    openQrListener,
    parseConnack,
    parsePublish,
    splitPackets,
} from '../../../src/nativeBridge/api/qq/mqtt.js';

// test/unit/nativeBridge/qqAppLoginMqtt.test.ts
// 三合一扫码的字节层：连错一个字节，手机上就是「码显示出来了，扫了没反应」——
// 而那种现象在真机上只能靠猜。所以这里把 CONNECT 的属性、订阅主题、CONNACK 重定向、
// 事件解析和「订阅先于显示」全部钉成断言。

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const join = (chunks: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
};
const utf8 = (value: string): Uint8Array => join([
    Uint8Array.of((text(value).length >> 8) & 0xff, text(value).length & 0xff),
    text(value),
]);
const packet = (header: number, body: Uint8Array): Uint8Array => join([
    Uint8Array.of(header),
    encodeVarint(body.length),
    body,
]);
const userProperties = (pairs: Array<[string, string]>): Uint8Array => {
    const body = join(pairs.flatMap(([key, value]) => [Uint8Array.of(0x26), utf8(key), utf8(value)]));
    return join([encodeVarint(body.length), body]);
};
const publish = (type: string, payload: unknown, topic = 'management.qrcode_login/abc'): Uint8Array => packet(0x30, join([
    utf8(topic),
    userProperties([['type', type]]),
    text(JSON.stringify(payload)),
]));
const connack = (reasonCode: number, serverReference?: string): Uint8Array => {
    const properties = serverReference
        ? join([encodeVarint(utf8(serverReference).length + 1), Uint8Array.of(0x1c), utf8(serverReference)])
        : Uint8Array.of(0x00);
    return packet(0x20, join([Uint8Array.of(0x00, reasonCode), properties]));
};
const suback = (reasonCode: number): Uint8Array => packet(0x90, Uint8Array.of(0x00, 0x01, reasonCode));

type Listener = (event: any) => void;

const createFakeSocket = () => {
    const listeners = new Map<string, Listener[]>();
    const socket = {
        sent: [] as Uint8Array[],
        closed: false,
        onSend: null as null | ((bytes: Uint8Array) => void),
        send(bytes: Uint8Array) {
            socket.sent.push(bytes);
            socket.onSend?.(bytes);
        },
        close() {
            if (socket.closed) return;
            socket.closed = true;
            socket.emit('close', {});
        },
        addEventListener(name: string, listener: Listener) {
            const list = listeners.get(name) || [];
            list.push(listener);
            listeners.set(name, list);
        },
        emit(name: string, event: unknown) {
            for (const listener of [...(listeners.get(name) || [])]) listener(event);
        },
        message(bytes: Uint8Array) {
            socket.emit('message', { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
        },
    };
    return socket;
};

describe('MQTT 5 packets for the QQ Music app QR', () => {
    it('CONNECT declares protocol 5, clean session and the tme auth properties', () => {
        const bytes = buildConnectPacket('1699999999123', 'QRID-1');
        expect(bytes[0]).toBe(0x10);
        const body = bytes.subarray(1 + decodeVarint(bytes, 1)!.bytes);
        const decoded = new TextDecoder().decode(body);
        expect(decoded).toContain('MQTT');
        expect(body[6]).toBe(0x05);
        // clean session
        expect(body[7]).toBe(0x02);
        expect(decoded).toContain('pass');
        for (const property of ['tmeAppID', 'qqmusic', 'business', 'management', 'hashTag', 'QRID-1', 'clientTag', 'management.user', 'userID']) {
            expect(decoded).toContain(property);
        }
        expect(decoded.endsWith('1699999999123')).toBe(true);
    });

    it('SUBSCRIBE targets the per-code topic with tmelogin/unicast', () => {
        const bytes = buildSubscribePacket('QRID-1');
        expect(bytes[0]).toBe(0x82);
        const decoded = new TextDecoder().decode(bytes.subarray(1 + decodeVarint(bytes, 1)!.bytes));
        expect(decoded).toContain('management.qrcode_login/QRID-1');
        expect(decoded).toContain('authorization');
        expect(decoded).toContain('tmelogin');
        expect(decoded).toContain('pubsub');
        expect(decoded).toContain('unicast');
    });

    it('CONNACK carries the server reference used for the redirect', () => {
        expect(parseConnack(connack(0))).toMatchObject({ reasonCode: 0 });
        expect(parseConnack(connack(0x9c, 'node-7'))).toMatchObject({ reasonCode: 0x9c, serverReference: 'node-7' });
    });

    it('PUBLISH exposes the event type and parses the payload', () => {
        const event = parsePublish(publish('scanned', { uin: 0 }));
        expect(event.type).toBe('scanned');
        expect(event.payload).toEqual({ uin: 0 });
    });

    it('keeps a partial packet for the next chunk', () => {
        const whole = join([publish('waiting', null), publish('scanned', {})]);
        const first = splitPackets(whole.subarray(0, whole.length - 3));
        expect(first.packets).toHaveLength(1);
        expect(first.rest.length).toBeGreaterThan(0);
        const rest = splitPackets(join([first.rest, whole.subarray(whole.length - 3)]));
        expect(rest.packets).toHaveLength(1);
        expect(parsePublish(rest.packets[0]).type).toBe('scanned');
    });

    it('queues packets that arrive before anyone awaits them', async () => {
        const queue = createPacketQueue();
        queue.push(publish('waiting', null));
        const first = await queue.next(50);
        expect(parsePublish(first).type).toBe('waiting');
        await expect(queue.next(10)).rejects.toThrow('MQTT packet timeout');
    });
});

describe('openQrListener', () => {
    const sockets: ReturnType<typeof createFakeSocket>[] = [];
    const openSocket = async () => {
        const socket = createFakeSocket();
        socket.onSend = (bytes) => {
            if (bytes[0] === 0x10) socket.message(connack(0));
            if (bytes[0] === 0x82) socket.message(suback(0x00));
        };
        sockets.push(socket);
        return socket;
    };

    it('waits for SUBACK before handing the handle out, then reports events in order', async () => {
        const events: string[] = [];
        const handle = await openQrListener('QRID-2', (event: any) => events.push(event.type), 5_000, { openSocket });
        const socket = sockets[sockets.length - 1];
        expect(events).toEqual(['waiting']);
        socket.message(publish('scanned', {}));
        socket.message(publish('cookies', { cookies: { qqmusic_uin: { value: '123' } } }));
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(events).toEqual(['waiting', 'scanned', 'cookies']);
        // 终态之后自己关连接：留着就是一条按秒计费的空连接。
        expect(socket.closed).toBe(true);
        handle.close();
    });

    it('fails instead of showing a code nobody is subscribed to', async () => {
        const rejecting = async () => {
            const socket = createFakeSocket();
            socket.onSend = (bytes) => {
                if (bytes[0] === 0x10) socket.message(connack(0));
                if (bytes[0] === 0x82) socket.message(suback(0x80));
            };
            sockets.push(socket);
            return socket;
        };
        await expect(openQrListener('QRID-3', () => undefined, 1_000, { openSocket: rejecting })).rejects.toThrow('SUBACK');
    });

    it('follows a server reference redirect before subscribing', async () => {
        const socketsSeen: Uint8Array[] = [];
        const redirecting = async () => {
            const socket = createFakeSocket();
            socket.onSend = (bytes) => {
                if (bytes[0] === 0x82) {
                    socket.message(suback(0x00));
                    return;
                }
                if (bytes[0] !== 0x10) return;
                socketsSeen.push(bytes);
                if (socketsSeen.length === 1) socket.message(connack(0x9c, 'node-7'));
                else socket.message(connack(0));
            };
            sockets.push(socket);
            return socket;
        };
        const opened: string[] = [];
        const handle = await openQrListener('QRID-4', () => undefined, 1_000, {
            openSocket: async () => {
                const socket = await redirecting();
                opened.push('x');
                return socket;
            },
        });
        expect(opened).toHaveLength(2);
        handle.close();
    });
});
