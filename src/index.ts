import readline from 'node:readline/promises';
import fs from 'node:fs';
import { execa } from 'execa';
import { minimatch } from 'minimatch';

function execaLog(command: string, arguments_: string[]) {
	console.error('+', command, ...arguments_);
	return execa(command, arguments_, {
		stdin: 'ignore',
		stdout: 'pipe',
		stderr: 'inherit',
	});
}

type RgRegion = {
	filepath: string;
	firstLineNumber: number;
	lastLineNumber: number;
	lines: string[];
};

async function * rgLinesToRegions(lines: AsyncIterable<string>) {
	let region: undefined | RgRegion = undefined;

	for await (const line of lines) {
		const [ filepath, lineNumber, ...rest ] = line.split(':');

		if (
			region
				&& filepath === region.filepath
				&& Number(lineNumber) === region.lastLineNumber + 1
		) {
			region.lastLineNumber = Number(lineNumber);
			region.lines.push(rest.join(':'));
			continue;
		}

		if (region) {
			yield region;
			region = undefined;
		}

		region = {
			filepath,
			firstLineNumber: Number(lineNumber),
			lastLineNumber: Number(lineNumber),
			lines: [ rest.join(':') ],
		};
	}

	if (region) {
		yield region;
	}
}

type RgScript = {
	type: 'rg';
	pattern: string;
	flags: string;
};

type SedScript = {
	type: 'sed';
	separator: string;
	pattern: string;
	replacement: string;
	flags: string;
};

type PrintFilesScript = {
	type: 'print-files';
};

type PrintRegionsScript = {
	type: 'print-regions';
};

type GlobScript = {
	type: 'glob';
	pattern: string;
};

type RgNegatedScript = {
	type: 'rg-negated';
	pattern: string;
	flags: string;
};

type FilesFromStdinScript = {
	type: 'files-from-stdin';
};

type Script =
	| RgScript
	| SedScript
	| PrintFilesScript
	| PrintRegionsScript
	| GlobScript
	| RgNegatedScript
	| FilesFromStdinScript
;

async function * executeRg(pattern: string, flags: string, files?: string[]) {
	const baseArgs = [
		'--line-buffered',
		...(
			flags.includes('s')
				? [
					'--multiline',
					'--multiline-dotall',
				]
				: []
		),
		'--line-number',
		pattern,
	];
	const args = [...baseArgs, ...(files || [])];

	if (files && files.length > 0) {
		console.error('+', 'rg', ...baseArgs, `(${files.length} files)`);
	} else {
		console.error('+', 'rg', ...baseArgs);
	}

	const subprocess = execa('rg', args, {
		stdin: 'ignore',
		stdout: 'pipe',
		stderr: 'inherit',
		lines: true,
	});

	for await (const line of subprocess) {
		if (line.trim()) {
			yield line;
		}
	}
}


async function sedRegion(region: RgRegion, script: SedScript) {
	await execaLog('sed', [
		'--in-place',
		'--regexp-extended',
		[
			[
				region.firstLineNumber,
				region.lastLineNumber,
			].join(',') + 's',
			script.pattern,
			script.replacement,
			script.flags,
		].join(script.separator),
		region.filepath,
	]);
}

async function * readLines(filepath: string) {
	const input = fs.createReadStream(filepath, 'utf8');

	const lines = readline.createInterface({
		input,
		crlfDelay: Infinity,
	});

	yield * lines;
}

async function readFilesFromStdin(): Promise<string[]> {
	const files: string[] = [];
	const rl = readline.createInterface({
		input: process.stdin,
		crlfDelay: Infinity,
	});

	for await (const line of rl) {
		const trimmed = line.trim();
		if (trimmed) {
			files.push(trimmed);
		}
	}

	return files;
}

function parseScript(script: string): Script {
	if (script.startsWith('sed')) {
		const separator = script[3];

		const [ _, function_, pattern, replacement, flags ] = script.split(separator);

		const reconstructedScript = [
			'sed',
			function_,
			pattern,
			replacement,
			flags,
		].join(separator);

		if (pattern && reconstructedScript === script) {
			return {
				type: 'sed',
				separator,
				pattern,
				replacement,
				flags,
			};
		}
	}

	if (script.startsWith('!rg')) {
		const separator = script[3];

		const [ _, pattern, flags ] = script.split(separator);

		return {
			type: 'rg-negated',
			pattern,
			flags: flags || '',
		};
	}

	if (script.startsWith('rg')) {
		const separator = script[2];

		const [ _, pattern, flags ] = script.split(separator);

		return {
			type: 'rg',
			pattern,
			flags,
		};
	}

	if (script === 'print-files') {
		return {
			type: 'print-files',
		};
	}

	if (script === 'print-regions') {
		return {
			type: 'print-regions',
		};
	}

	if (script.startsWith('glob')) {
		const separator = script[4];
		const [ _, pattern ] = script.split(separator);

		if (pattern) {
			return {
				type: 'glob',
				pattern,
			};
		}
	}

	if (script === 'files-from-stdin') {
		return {
			type: 'files-from-stdin',
		};
	}

	throw new Error(`Unknown script type: ${script}`);
}

export async function main(scriptStrings: string[]) {
	const scripts = scriptStrings.map(parseScript);

	const hasExplicitPrintCommand = scripts.some(script =>
		script.type === 'print-files' || script.type === 'print-regions'
	);
	if (!hasExplicitPrintCommand) {
		scripts.push({
			type: 'print-regions',
		});
	}

	let rgRegions: RgRegion[] = [];

	for (const [index, script] of scripts.entries()) {
		const isFirstScript = index === 0;

		if (script.type === 'rg') {
			if (isFirstScript) {
				const lines = executeRg(script.pattern, script.flags);
				const regions = rgLinesToRegions(lines);

				rgRegions = [];
				for await (const region of regions) {
					rgRegions.push(region);
				}
			} else {
				const uniqueFiles = [...new Set(rgRegions.map(region => region.filepath))];
				const lines = executeRg(script.pattern, script.flags, uniqueFiles);
				const regions = rgLinesToRegions(lines);

				const newRegionsByFile = new Map<string, RgRegion[]>();
				for await (const region of regions) {
					const fileRegions = newRegionsByFile.get(region.filepath) || [];
					fileRegions.push(region);
					newRegionsByFile.set(region.filepath, fileRegions);
				}

				rgRegions = rgRegions.filter(existingRegion => {
					const newRegions = newRegionsByFile.get(existingRegion.filepath) || [];
					return newRegions.some(newRegion =>
						newRegion.firstLineNumber <= existingRegion.lastLineNumber &&
						newRegion.lastLineNumber >= existingRegion.firstLineNumber
					);
				});
			}

			continue;
		}

		if (script.type === 'sed') {
			for (const region of rgRegions) {
				await sedRegion(region, script);
			}

			continue;
		}

		if (script.type === 'print-files') {
			const printedFiles = new Set<string>();

			for (const region of rgRegions) {
				if (!printedFiles.has(region.filepath)) {
					console.log(region.filepath);
					printedFiles.add(region.filepath);
				}
			}

			continue;
		}

		if (script.type === 'print-regions') {
			for (const region of rgRegions) {
				let lineNumber = 1;
				for await (const line of readLines(region.filepath)) {
					if (lineNumber >= region.firstLineNumber && lineNumber <= region.lastLineNumber) {
						console.log([
							region.filepath,
							lineNumber,
							line,
						].join(':'));
					}

					lineNumber += 1;
				}
			}

			continue;
		}

		if (script.type === 'glob') {
			rgRegions = rgRegions.filter(region =>
				minimatch(region.filepath, script.pattern)
			);

			continue;
		}

		if (script.type === 'rg-negated') {
			const uniqueFiles = [...new Set(rgRegions.map(region => region.filepath))];
			const lines = executeRg(script.pattern, script.flags, uniqueFiles.length > 0 ? uniqueFiles : undefined);
			const regions = rgLinesToRegions(lines);

			const negatedRegionsByFile = new Map<string, RgRegion[]>();
			for await (const region of regions) {
				const fileRegions = negatedRegionsByFile.get(region.filepath) || [];
				fileRegions.push(region);
				negatedRegionsByFile.set(region.filepath, fileRegions);
			}

			rgRegions = rgRegions.filter(region => {
				const negatedRegions = negatedRegionsByFile.get(region.filepath) || [];
				return !negatedRegions.some(negatedRegion =>
					negatedRegion.firstLineNumber <= region.lastLineNumber &&
					negatedRegion.lastLineNumber >= region.firstLineNumber
				);
			});

			continue;
		}

		if (script.type === 'files-from-stdin') {
			const filesFromStdin = await readFilesFromStdin();

			if (isFirstScript) {
				// Initialize regions from stdin files (first script in pipeline)
				for (const filepath of filesFromStdin) {
					// Create a region representing the entire file
					rgRegions.push({
						filepath,
						firstLineNumber: 1,
						lastLineNumber: Number.MAX_SAFE_INTEGER,
						lines: [],
					});
				}
			} else {
				// Filter existing regions to only include files from stdin
				rgRegions = rgRegions.filter(region =>
					filesFromStdin.includes(region.filepath)
				);
			}

			continue;
		}

		throw new Error(`Unknown script type: ${(script as Script).type}`);
	}
}
