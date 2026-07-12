import WebSocketBackend from "../../backends/websocket";
import type { MockResponseInit } from "jest-fetch-mock";
import fetchMock from "jest-fetch-mock";
import { waitFor } from "../test-utils";
import * as connectionActions from "../../ducks/connection";
import type { UnknownAction } from "@reduxjs/toolkit";
import type { EventLogItem } from "../../ducks/eventLog";
import { EVENTS_ADD, EVENTS_RECEIVE, LogLevel } from "../../ducks/eventLog";
import { OPTIONS_RECEIVE } from "../../ducks/options";
import { FLOWS_RECEIVE } from "../../ducks/flows";
import { STATE_RECEIVE } from "../../ducks/backendState";
import { setFilter } from "../../ducks/ui/filter";
import { TStore } from "../ducks/tutils";
import { ConnectionState } from "../../ducks/connection";

let mockClose: jest.Mock;

beforeEach(() => {
    fetchMock.enableMocks();
    fetchMock.mockClear();
    const WebSocketOrig = WebSocket;
    mockClose = jest.fn();
    // @ts-expect-error jest mock stuff
    jest.spyOn(global, "WebSocket").mockImplementation(() => ({
        addEventListener: () => 0,
        send: () => 0,
        close: mockClose,
        readyState: WebSocketOrig.CONNECTING,
    }));
    // @ts-expect-error jest mock stuff
    global.WebSocket.OPEN = WebSocketOrig.OPEN;
    // @ts-expect-error jest mock stuff
    global.WebSocket.CONNECTING = WebSocketOrig.CONNECTING;
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

describe("websocket backend", () => {
    test("message queueing", async () => {
        let resolve;
        const events: Promise<MockResponseInit> = new Promise((r) => {
            resolve = r;
        });
        const never = async () => new Promise<MockResponseInit>(() => {});
        fetchMock.mockOnceIf("./state", never);
        fetchMock.mockOnceIf("./flows", never);
        fetchMock.mockOnceIf("./events", () => events);
        fetchMock.mockOnceIf("./options", never);

        const store = TStore(null);
        const backend = new WebSocketBackend(store);

        backend.sendMessage({
            type: "unknown",
            payload: {},
        });
        expect(backend.messageQueue.length).toBe(1);
        // @ts-expect-error jest mock stuff
        backend.socket.readyState = WebSocket.OPEN;
        backend.onOpen();
        expect(store.getState().connection.state).toEqual(
            ConnectionState.FETCHING,
        );
        expect(backend.messageQueue.length).toBe(0);

        backend.sendMessage({
            type: "unknown",
            payload: {},
        });
        expect(backend.messageQueue.length).toBe(0);

        let payload: EventLogItem = {
            message: "test",
            level: LogLevel.debug,
            id: "123",
        };
        backend.onMessage({
            type: "events/add",
            payload,
        });

        expect(store.getState().eventLog.list.length).toBe(0);

        resolve("[]");
        await waitFor(() =>
            expect(store.getState().eventLog.list.length).toBe(1),
        );

        backend.clearReconnect();
    });

    test("basic", async () => {
        fetchMock.mockOnceIf("./state", "{}");
        fetchMock.mockOnceIf("./flows", "[]");
        fetchMock.mockOnceIf("./events", "[]");
        fetchMock.mockOnceIf("./options", "{}");

        const actions: Array<UnknownAction> = [];
        const backend = new WebSocketBackend({
            dispatch: (e) => actions.push(e),
            subscribe: () => {},
            getState: () => ({
                connection: { state: ConnectionState.ESTABLISHED },
            }),
        });

        await backend.onOpen();

        expect(actions).toEqual([
            connectionActions.startFetching(),
            // @ts-expect-error mocked
            STATE_RECEIVE({}),
            FLOWS_RECEIVE([]),
            EVENTS_RECEIVE([]),
            // @ts-expect-error mocked
            OPTIONS_RECEIVE({}),
            connectionActions.finishFetching(),
        ]);

        actions.length = 0;
        backend.onMessage({
            type: "events/add",
            payload: {
                id: "42",
                message: "test",
                level: LogLevel.info,
            } as EventLogItem,
        });
        expect(actions).toEqual([
            EVENTS_ADD({ id: "42", level: LogLevel.info, message: "test" }),
        ]);
        actions.length = 0;

        fetchMock.mockOnceIf("./events", "[]");
        backend.onMessage({
            type: "events/reset",
        });
        await waitFor(() => expect(actions).toEqual([EVENTS_RECEIVE([])]));
        actions.length = 0;
        expect(fetchMock.mock.calls).toHaveLength(5);

        console.error = jest.fn();
        console.log = jest.fn();
        backend.onClose(new CloseEvent("Connection closed"));
        expect(console.error).toHaveBeenCalledTimes(1);
        expect(actions[0].type).toBe(connectionActions.connectionError.type);
        expect(backend.reconnectAttempts).toBe(1);
        // Clear the reconnect timer so it doesn't fire
        backend.clearReconnect();
        actions.length = 0;

        backend.onError(null);
        // onError calls socket.close() -> triggers onClose -> triggers scheduleReconnect
        expect(console.error).toHaveBeenCalledTimes(2);
        expect(mockClose).toHaveBeenCalled();
        backend.clearReconnect();

        jest.restoreAllMocks();
    });

    test("onMessage handling", async () => {
        fetchMock.mockOnceIf("./flows", "[]");
        fetchMock.mockOnceIf("./events", "[]");
        // Not useful, only for coverage
        const backend = new WebSocketBackend({
            dispatch: () => {},
            subscribe: () => {},
            getState: () => ({
                connection: { state: ConnectionState.ESTABLISHED },
            }),
        });
        backend.onMessage({ type: "flows/add" });
        backend.onMessage({ type: "flows/update" });
        backend.onMessage({ type: "flows/remove" });
        backend.onMessage({ type: "flows/reset" });
        backend.onMessage({ type: "flows/filterUpdate" });
        backend.onMessage({ type: "events/add" });
        backend.onMessage({ type: "events/reset" });
        backend.onMessage({ type: "options/update" });
        backend.onMessage({ type: "state/update" });
        expect(fetchMock.mock.calls.length).toBe(2);
        backend.clearReconnect();
    });

    test("filter updates", () => {
        const store = TStore(null);
        const backend = new WebSocketBackend(store);
        store.dispatch(setFilter("foo"));
        expect(backend.messageQueue).toEqual([
            {
                type: "flows/updateFilter",
                payload: { expr: "foo", name: "search" },
            },
        ]);
        backend.clearReconnect();
    });

    test("reconnection on close", () => {
        const actions: Array<UnknownAction> = [];
        const backend = new WebSocketBackend({
            dispatch: (e) => actions.push(e),
            subscribe: () => {},
            getState: () => ({
                connection: { state: ConnectionState.ESTABLISHED },
            }),
        });

        console.error = jest.fn();
        console.log = jest.fn();

        // Initially no reconnect scheduled
        expect(backend.reconnectTimer).toBeNull();
        expect(backend.reconnectAttempts).toBe(0);

        // Trigger close
        backend.onClose(new CloseEvent("Connection lost"));
        expect(backend.reconnectAttempts).toBe(1);
        expect(backend.reconnectTimer).not.toBeNull();
        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining("WebSocket reconnecting in 1000ms (attempt 1)"),
        );

        // Advance timer to trigger reconnect
        const mockSocket = backend.socket;
        jest.advanceTimersByTime(1000);
        // connect() should have been called again, creating a new WebSocket
        expect(backend.socket).not.toBe(mockSocket);
        expect(backend.reconnectTimer).toBeNull();

        backend.clearReconnect();
    });

    test("exponential backoff on reconnect", () => {
        const backend = new WebSocketBackend({
            dispatch: () => {},
            subscribe: () => {},
            getState: () => ({
                connection: { state: ConnectionState.ESTABLISHED },
            }),
        });

        console.log = jest.fn();
        console.error = jest.fn();

        // First close -> 1s delay
        backend.onClose(new CloseEvent("close"));
        expect(backend.reconnectAttempts).toBe(1);
        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining("1000ms (attempt 1)"),
        );
        backend.clearReconnect();

        // Second close -> 2s delay
        backend.onClose(new CloseEvent("close"));
        expect(backend.reconnectAttempts).toBe(2);
        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining("2000ms (attempt 2)"),
        );
        backend.clearReconnect();

        // Third close -> 4s delay
        backend.onClose(new CloseEvent("close"));
        expect(backend.reconnectAttempts).toBe(3);
        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining("4000ms (attempt 3)"),
        );
        backend.clearReconnect();
    });


    test("onError with closed socket triggers reconnect directly", () => {
        const actions: Array<UnknownAction> = [];
        const backend = new WebSocketBackend({
            dispatch: (e) => actions.push(e),
            subscribe: () => {},
            getState: () => ({
                connection: { state: ConnectionState.ESTABLISHED },
            }),
        });

        console.error = jest.fn();
        console.log = jest.fn();

        // after connection failure, the socket may already be CLOSED
        backend.onError(null);
        // should schedule reconnect directly since socket is already CLOSED
        expect(backend.reconnectTimer).not.toBeNull();
        expect(backend.reconnectAttempts).toBe(1);
        backend.clearReconnect();
    });
    test("reset reconnect attempts on successful open", async () => {
        fetchMock.mockOnceIf("./state", "{}");
        fetchMock.mockOnceIf("./flows", "[]");
        fetchMock.mockOnceIf("./events", "[]");
        fetchMock.mockOnceIf("./options", "{}");

        const backend = new WebSocketBackend({
            dispatch: () => {},
            subscribe: () => {},
            getState: () => ({
                connection: { state: ConnectionState.INIT },
            }),
        });

        console.log = jest.fn();
        console.error = jest.fn();

        // Simulate a few reconnection attempts
        backend.reconnectAttempts = 5;

        // Successfully connect
        // @ts-expect-error jest mock stuff
        backend.socket.readyState = WebSocket.OPEN;
        await backend.onOpen();

        // Attempts should be reset
        expect(backend.reconnectAttempts).toBe(0);

        backend.clearReconnect();
    });
});

