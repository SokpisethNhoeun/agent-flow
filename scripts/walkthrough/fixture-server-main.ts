// Runs the stand-in server in its own process (the walkthrough's Orca calls are synchronous and
// would otherwise block it). Prints one JSON line with its address; stops when stdin closes.
import { startFixtureServer, UI_DIR } from './fixture-server.ts'

// FIXTURE_UI_DIR: serve another build (e.g. a non-minified one while debugging).
const server = await startFixtureServer(process.env.FIXTURE_UI_DIR || UI_DIR)
process.stdout.write(JSON.stringify({ origin: server.origin, url: server.url }) + '\n')
const stop = () => void server.stop().finally(() => process.exit(0))
process.stdin.on('end', stop)
process.stdin.resume()
process.on('SIGTERM', stop)
