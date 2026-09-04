const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

writeFileSync(join(process.cwd(), '.journey-tests', 'package.json'), '{"type":"commonjs"}\n');
require('../.journey-tests/tests/journey-engine.test.js');
