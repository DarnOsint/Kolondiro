/// <reference types="vite/client" />

// Web Serial API
interface SerialPort {
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
  readable: ReadableStream
  writable: WritableStream
}
interface Serial {
  requestPort(options?: object): Promise<SerialPort>
}
interface Navigator {
  serial: Serial
}
