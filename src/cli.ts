#!/usr/bin/env node

import { program } from 'commander';
import { main } from './index.js';

const programName = 'rgrs';

program
	.name(programName)
	.argument('[scripts...]')
	.action(main);

program.parse(process.argv);
