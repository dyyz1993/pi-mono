import { program } from 'commander'
import { registerModules } from './modules'
import { setBaseUrl } from './utils/api'
import { createLogger } from './utils/logger'

program
  .name('biomimic')
  .description('Biomimic CLI - RPC service & code generation tools')
  .version('0.1.0')
  .option('-v, --verbose', 'Enable verbose output')
  .option('-u, --url <url>', 'Server URL', 'http://localhost:3000')
  .hook('preAction', thisCommand => {
    const options = thisCommand.opts()
    createLogger({ verbose: options.verbose })
    if (options.url) {
      setBaseUrl(options.url)
    }
  })

registerModules(program)

program.parse()
