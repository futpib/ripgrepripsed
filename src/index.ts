import readline from 'node:readline/promises';
import fs from 'node:fs';
import { execa } from 'execa';

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

type Script =
	| RgScript
	| SedScript
	| PrintFilesScript
	| PrintRegionsScript
;

async function * rgLines(script: RgScript) {
	const subprocess = execaLog('rg', [
		'--line-buffered',
		...(
			script.flags.includes('s')
				? [
					'--multiline',
					'--multiline-dotall',
				]
				: []
		),
		'--line-number',
		script.pattern,
	]);

	const lines = subprocess.stdout && readline.createInterface({
		input: subprocess.stdout,
		crlfDelay: Infinity,
	});

	for await (const line of (lines ?? [])) {
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

	throw new Error(`Unknown script type: ${script}`);
}

export async function main(scriptStrings: string[]) {
	const scripts = scriptStrings.map(parseScript);

	if (scripts.at(-1)?.type === 'rg') {
		scripts.push({
			type: 'print-regions',
		});
	}

	let rgRegions: RgRegion[] = [];

	for (const script of scripts) {
		if (script.type === 'rg') {
			const lines = rgLines(script);
			const regions = rgLinesToRegions(lines);

			rgRegions = [];
			for await (const region of regions) {
				rgRegions.push(region);
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

		throw new Error(`Unknown script type: ${(script as Script).type}`);
	}
}
