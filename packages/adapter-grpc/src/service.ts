/**
 * gRPC service definition for the Electron Bridge protocol.
 *
 * Uses JSON-encoded payloads so **no .proto file or proto-loader dependency
 * is required**. The service descriptor is compatible with `@grpc/grpc-js`'s
 * `ServiceDefinition` API but expressed without static type-level dependency
 * on grpc-js, keeping the adapter usable even if grpc-js is not installed.
 *
 * Service: `electronbridge.Bridge`
 * Method:  `Invoke(InvokeRequest) returns (InvokeResponse)` — unary RPC
 */

// ─── Wire types ───────────────────────────────────────────────────────────────

export interface InvokeRequest {
  /** Channel name to dispatch to. */
  readonly channel: string;
  /** JSON-encoded BridgePayload. */
  readonly payload: string;
}

export interface InvokeResponse {
  /** JSON-encoded BridgePayload result (present on success). */
  readonly result: string;
  /** Serialised error message (present on failure, empty string otherwise). */
  readonly error: string;
}

// ─── Minimal grpc-compatible interfaces ──────────────────────────────────────

/** Minimal structural interface matching grpc.MethodDefinition (unary). */
export interface UnaryMethodDefinition<Req, Res> {
  path: string;
  requestStream: false;
  responseStream: false;
  requestSerialize: (value: Req) => Buffer;
  requestDeserialize: (value: Buffer) => Req;
  responseSerialize: (value: Res) => Buffer;
  responseDeserialize: (value: Buffer) => Res;
}

// ─── JSON codec helpers ───────────────────────────────────────────────────────

function serialize<T>(value: T): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function deserialize<T>(buffer: Buffer): T {
  return JSON.parse(buffer.toString('utf8')) as T;
}

// ─── ServiceDefinition ────────────────────────────────────────────────────────

/**
 * gRPC `ServiceDefinition` for the `Bridge.Invoke` unary RPC.
 *
 * Compatible with `grpc.Server.addService()` and `grpc.makeGenericClientConstructor()`.
 * Typed as `Record<string, unknown>` at the root level to avoid a hard dependency
 * on `@grpc/grpc-js` types; cast to the grpc service definition at call sites
 * after the dynamic import resolves.
 */
export const BridgeServiceDefinition: {
  invoke: UnaryMethodDefinition<InvokeRequest, InvokeResponse>;
} = {
  invoke: {
    path: '/electronbridge.Bridge/Invoke',
    requestStream: false,
    responseStream: false,
    requestSerialize: serialize<InvokeRequest>,
    requestDeserialize: (buf: Buffer) => deserialize<InvokeRequest>(buf),
    responseSerialize: serialize<InvokeResponse>,
    responseDeserialize: (buf: Buffer) => deserialize<InvokeResponse>(buf),
  },
};

export type BridgeServiceDefinitionType = typeof BridgeServiceDefinition;

// ─── Client constructor ───────────────────────────────────────────────────────

/**
 * Build the gRPC client constructor for `BridgeServiceDefinition`.
 * Called lazily so `@grpc/grpc-js` is only imported when the adapter is used.
 *
 * Returns `unknown` here because we cannot depend on grpc-js types statically;
 * callers cast appropriately after verifying the type at runtime.
 */
export function makeBridgeClientConstructor(grpcLib: {
  makeGenericClientConstructor(
    methods: unknown,
    serviceName: string,
    classOptions: unknown,
  ): unknown;
}): unknown {
  return grpcLib.makeGenericClientConstructor(
    BridgeServiceDefinition as Record<string, unknown>,
    'Bridge',
    {},
  );
}
