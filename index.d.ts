type Environment = { [key:string]: string }
type out = Buffer | string
type cb = (error: Error | null, stdout: out, stderr: out) => void

export interface Opts {
  encoding?: string
  timeout?: number
  env?: Environment
  cwd?: string
}

export interface Exec {
  (cmd: string)
  (cmd: string, cb: cb)
  (cmd: string, opts: Opts): void
  (cmd: string, opts: Opts, cb: cb): void
}

export declare const exec: Exec
export declare function close (cb?: (error: Error) => void)
export declare function pid (env?: Environment): number
export declare const promises: {
  exec (cmd: string, opts?: Opts): PromiseLike<{
    stdout: out
    stderr: out
  }>
  close(): PromiseLike<void>
  pid(env?: Environment): number
}
