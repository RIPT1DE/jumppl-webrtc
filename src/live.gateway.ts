import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  first,
  firstValueFrom,
  map,
  mapTo,
  startWith,
  Subject,
  switchMap,
  timer,
  merge,
  scan,
  shareReplay,
  combineLatest,
  lastValueFrom,
  distinctUntilChanged,
  concat,
  of,
  mergeMap,
  withLatestFrom,
  filter,
} from 'rxjs';

import type { RemoteSocket, Server } from 'socket.io';
import { Tuple } from './util';

interface Events {
  join: void;
}

enum ResponseCodes {
  CALL_ANSWERED = 2,
  CALL_NOT_ANSWERED = 3,
}

interface User {
  userId: string;
}

const CALL_TIMEOUT = process.env.CALL_TIMEOUT
  ? Number.parseInt(process.env.CALL_TIMEOUT)
  : 15000;

@WebSocketGateway({ path: '/socket.io' })
export class LiveGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server: Server;

  private readonly _isOnline$ = new Subject<void>();

  private readonly _callAnswered$ = new Subject<{
    from: RemoteSocket<Events>;
    to: RemoteSocket<Events>;
  }>();
  private readonly _callInitiated$ = new Subject<{
    from: RemoteSocket<Events>;
    to: RemoteSocket<Events>;
  }>();
  private readonly _callEnded$ = new Subject<{
    sock: RemoteSocket<Events>;
  }>();
  private readonly _callMessage$ = new Subject<{
    from: RemoteSocket<Events>;
    data: any;
  }>();
  private readonly _callMissed$ = new Subject<{
    from: RemoteSocket<Events>;
    to: RemoteSocket<Events>;
  }>();

  private readonly _pendingCalls$ = merge(
    this._callInitiated$.pipe(
      mergeMap((d) =>
        concat(
          of({ type: 'init' as const, data: d }),
          timer(CALL_TIMEOUT).pipe(mapTo({ type: 'rej' as const, data: d })),
        ),
      ),
    ),
    this._callEnded$.pipe(map((d) => ({ type: 'ended' as const, data: d }))),
    this._callAnswered$.pipe(map((d) => ({ type: 'ans' as const, data: d }))),
    this._isOnline$.pipe(
      switchMap(() => this.server.fetchSockets()),
      map((d) => ({ data: d, type: 'onl' as const })),
    ),
  ).pipe(
    scan((acc, val) => {
      if (val.type == 'init') {
        return [...acc, { from: val.data.from, to: val.data.to }];
      } else if (val.type == 'rej') {
        return acc.filter((pCall) => {
          const timedOut =
            pCall.from.id == val.data.from.id && pCall.to.id == val.data.to.id;
          if (timedOut) {
            this._callMissed$.next({
              from: pCall.from,
              to: pCall.to,
            });
          }
          return !timedOut;
        });
      } else if (val.type == 'ans') {
        return acc.filter(
          (pCall) =>
            !(
              pCall.from.id == val.data.from.id && pCall.to.id == val.data.to.id
            ),
        );
      } else if (val.type == 'onl') {
        return acc.filter(
          (call) =>
            val.data.some((socket) => socket.id == call.from.id) &&
            val.data.some((socket) => socket.id == call.to.id),
        );
      } else if (val.type == 'ended') {
        return acc.filter(
          (call) =>
            !(
              call.from.id == val.data.sock.id || call.to.id == val.data.sock.id
            ),
        );
      }
      return acc;
    }, [] as Array<{ from: RemoteSocket<Event>; to: RemoteSocket<Events> }>),
    startWith([]),
    shareReplay({
      refCount: false,
      bufferSize: 1,
    }),
  );

  private readonly _calls$ = merge(
    this._callAnswered$.pipe(map((d) => ({ type: 'ans' as const, data: d }))),
    this._isOnline$.pipe(
      switchMap(() => this.server.fetchSockets()),
      map((d) => ({ data: d, type: 'onl' as const })),
    ),
    this._callEnded$.pipe(map((d) => ({ type: 'end' as const, data: d }))),
  ).pipe(
    scan((acc, val) => {
      if (val.type == 'ans') {
        return [...acc, Tuple([val.data.from, val.data.to])];
      } else if (val.type == 'onl') {
        return acc.filter((call) =>
          call.every((member) =>
            val.data.some((socket) => socket.id == member.id),
          ),
        );
      } else if (val.type == 'end') {
        return acc.filter(
          (call) => !call.some((member) => member.id == val.data.sock.id),
        );
      }
      return acc;
    }, [] as Array<[RemoteSocket<Events>, RemoteSocket<Events>]>),
    startWith([]),
    shareReplay({
      refCount: false,
      bufferSize: 1,
    }),
  );

  @SubscribeMessage('join')
  handleJoin(
    @MessageBody() userId: string,
    @ConnectedSocket() client: RemoteSocket<Events>,
  ) {
    (client.data as User)['userId'] = userId;
    this._isOnline$.next();

    return merge(
      this.listenCallAccepted(userId),
      this.listenIncomingCall(userId),
      this.listenOutCall(userId),
      this.listenCallMessages(client),
      this.listenMissedCall(client),
    );
  }

  handleDisconnect() {
    this._isOnline$.next();
  }

  @SubscribeMessage('isOnline')
  isOnline(@MessageBody() userId: string[]) {
    return this._isOnline$.pipe(
      startWith(null),
      switchMap(async () => {
        const s = await this.server.fetchSockets();
        return userId.filter((id) =>
          s.some((socket) => (socket.data as User).userId == id),
        );
      }),
      map((ids) => ({ event: 'onlineList', data: ids })),
    );
  }

  @SubscribeMessage('initiateCall')
  async initiateCall(
    @MessageBody() userId: string,
    @ConnectedSocket() socket: RemoteSocket<Events>,
  ) {
    return await firstValueFrom(
      combineLatest([this._calls$, this._pendingCalls$]).pipe(
        first(),
        switchMap(async ([calls, pendingCalls]) => {
          const fromUserId = (socket.data as User).userId;

          if (
            calls.some((call) =>
              call.some(
                (part) =>
                  (part.data as User).userId == userId ||
                  fromUserId == (part.data as User).userId,
              ),
            ) ||
            pendingCalls.some((pCall) => pCall.from.data.userId == fromUserId)
          ) {
            return {
              error: {
                code: 430,
                message: 'Already In Call',
              },
            };
          }
          const existingPCall = pendingCalls.find(
            (pCall) => pCall.to.data.userId == fromUserId,
          );
          if (existingPCall) {
            this._callAnswered$.next(existingPCall);
            return {
              code: ResponseCodes.CALL_ANSWERED,
              message: 'Call Answered',
            };
          }
          const allSockets = await this.server.fetchSockets();
          const toSocket = allSockets.find((s) => s.data.userId == userId);
          if (!toSocket) {
            return {
              error: {
                code: 431,
                message: 'User offline',
              },
            };
          }
          const newCall = { from: socket, to: toSocket };
          this._callInitiated$.next(newCall);
        }),
      ),
    );
  }

  @SubscribeMessage('answerCall')
  async answerCall(@ConnectedSocket() socket: RemoteSocket<Events>) {
    return await lastValueFrom(
      combineLatest([this._pendingCalls$, this._calls$]).pipe(
        first(),
        switchMap(async ([pendingCalls, calls]) => {
          const thisUserId = socket.data.userId;
          const pendingCall = pendingCalls.find(
            (pCall) => pCall.to.data.userId == thisUserId,
          );

          if (!pendingCall) {
            return {
              message: 'No Incoming Call',
            };
          }

          this._callAnswered$.next(pendingCall);
          return {
            code: ResponseCodes.CALL_ANSWERED,
            message: 'Call Answered',
          };
        }),
      ),
    );
  }

  @SubscribeMessage('endCall')
  async endCall(@ConnectedSocket() socket: RemoteSocket<Events>) {
    await lastValueFrom(
      this._calls$.pipe(
        first(),
        switchMap(async (calls) => {
          const thisUserId = socket.data.userId;
          const call = calls.find((c) =>
            c.some((member) => member.id == socket.id),
          );
          if (!call) {
            return {
              message: 'No ongoing call',
            };
          }

          this._callEnded$.next({
            sock: call[0],
          });
        }),
      ),
    );
  }

  @SubscribeMessage('callMessage')
  sendCallMessage(
    @MessageBody() data: any,
    @ConnectedSocket() sock: RemoteSocket<Events>,
  ) {
    this._callMessage$.next({ from: sock, data });
  }

  listenIncomingCall(userId: string) {
    return this._pendingCalls$.pipe(
      map((pCalls) => pCalls.find((pCall) => pCall.to.data.userId == userId)),
      distinctUntilChanged(),
      map((pCall) => ({
        event: 'incomingCall',
        data: {
          userId: pCall?.from.data.userId ?? false,
        },
      })),
    );
  }

  listenOutCall(userId: string) {
    return this._pendingCalls$.pipe(
      map((pCalls) => pCalls.find((pCall) => pCall.from.data.userId == userId)),
      distinctUntilChanged(),
      map((pCall) => ({
        event: 'outCall',
        data: {
          userId: pCall?.to.data.userId ?? false,
        },
      })),
    );
  }

  listenCallAccepted(userId: string) {
    return this._calls$.pipe(
      map((calls) =>
        calls.find((call) => call.some((s) => s.data.userId == userId)),
      ),
      distinctUntilChanged((a, b) => !a === !b || !!a === !!b),
      map((call) => ({
        event: 'callActive',
        data: {
          userId:
            call?.find((s) => s.data.userId != userId)?.data.userId ?? false,
        },
      })),
    );
  }

  listenCallMessages(socket: RemoteSocket<Events>) {
    return this._callMessage$.pipe(
      withLatestFrom(this._calls$),
      filter(
        ([mes, calls]) =>
          mes.from.id != socket.id &&
          calls.some(
            (call) =>
              call.some((member) => member.id == socket.id) &&
              call.some((member) => member.id == mes.from.id),
          ),
      ),
      map(([mes]) => ({
        event: 'callMessage',
        data: mes.data,
      })),
    );
  }

  listenMissedCall(socket: RemoteSocket<Events>) {
    return this._callMissed$.pipe(
      filter((missed) => missed.to.id == socket.id),
      map((missed) => missed.from.data.userId),
      map((id) => ({
        event: 'callMissed',
        data: id,
      })),
    );
  }
}
