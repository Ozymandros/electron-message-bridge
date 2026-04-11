/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
// Lightweight shims for optional adapter packages.
// These declarations allow the main package to typecheck when adapters
// are not installed (CI or consumers who don't use adapters).

declare module '@electron-ipc-helper/adapter-stdio' {
  export function createStdioServerTransport(...args: any[]): any;
  export function createStdioClientTransport(...args: any[]): any;
  export class StdioPlugin { constructor(...args: any[]); name: string; getManifest(): any; init?(): any; dispose?(): any }
  export type StdioServerTransport = any;
  export type StdioClientTransport = any;
  export type StdioServerTransportOptions = any;
  export type StdioClientTransportOptions = any;
  export type StdioCapabilities = any;
  export type StdioRequest = any;
  export type StdioResponse = any;
  export type StdioFrame = any;
}

declare module '@electron-ipc-helper/adapter-grpc' {
  export function createGrpcServerTransport(...args: any[]): any;
  export function createGrpcClientTransport(...args: any[]): any;
  export class GrpcPlugin { constructor(...args: any[]); name: string; getManifest(): any }
  export const BridgeServiceDefinition: any;
  export type GrpcServerTransport = any;
  export type GrpcClientTransport = any;
  export type GrpcServerTransportOptions = any;
  export type GrpcClientTransportOptions = any;
  export type GrpcCapabilities = any;
  export type InvokeRequest = any;
  export type InvokeResponse = any;
}

declare module '@electron-ipc-helper/adapter-named-pipe' {
  export function createNamedPipeServerTransport(...args: any[]): any;
  export function createNamedPipeClientTransport(...args: any[]): any;
  export class NamedPipePlugin { constructor(...args: any[]); name: string; getManifest(): any }
  export type NamedPipeServerTransport = any;
  export type NamedPipeClientTransport = any;
  export type NamedPipeServerTransportOptions = any;
  export type NamedPipeClientTransportOptions = any;
  export type NamedPipeCapabilities = any;
}

declare module 'electron-message-bridge-adapter-assemblyscript' {
  export type AscFnDescriptor = any;
  export type AscSchema = any;
  export type AscRuntimeExports = any;
  export type AscInstanceExports = any;
  export type AscValueType = any;
  export type InferAscHandler<D> = any;
  export type InferAscHandlers<S> = any;
  export type AssemblyScriptAdapterOptions = any;
  export interface AssemblyScriptAdapter<S> { handlers: any; instance: any; runtime: any; dispose(): void }
  export function createAssemblyScriptAdapter(...args: any[]): Promise<any>;
  export function wrapLoaderInstance(...args: any[]): any;
  export const asc: any;
  export class AssemblyScriptPlugin { constructor(...args: any[]); name: string; capabilities: any; getManifest?(): any }
}

// Generic catch-all so other optional adapters in the '@electron-ipc-helper'
// scope don't block typechecking. Keep this conservative to avoid masking real
// missing types in other places.
declare module '@electron-ipc-helper/*' {
  const ns: any;
  export = ns;
}
