import readline from 'node:readline/promises';
import { execa } from 'execa';

function execaLog(command: string, arguments_: string[]) {
	console.error('+', command, ...arguments_);
	return execa(command, arguments_, {
		stdin: 'ignore',
		stdout: 'pipe',
		stderr: 'inherit',
	});
}

type RgChunk = {
	filepath: string;
	firstLineNumber: number;
	lastLineNumber: number;
	lines: string[];
};

async function * rgLinesToChunks(lines: AsyncIterable<string>) {
	let chunk: undefined | RgChunk = undefined;

	for await (const line of lines) {
		const [ filepath, lineNumber, ...rest ] = line.split(':');

		if (
			chunk
				&& filepath === chunk.filepath
				&& Number(lineNumber) === chunk.lastLineNumber + 1
		) {
			chunk.lastLineNumber = Number(lineNumber);
			chunk.lines.push(rest.join(':'));
			continue;
		}

		if (chunk) {
			yield chunk;
			chunk = undefined;
		}

		chunk = {
			filepath,
			firstLineNumber: Number(lineNumber),
			lastLineNumber: Number(lineNumber),
			lines: [ rest.join(':') ],
		};
	}

	if (chunk) {
		yield chunk;
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

type Script =
	| RgScript
	| SedScript
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

async function sedChunk(chunk: RgChunk, script: SedScript) {
	await execaLog('sed', [
		'--in-place',
		'--regexp-extended',
		[
			[
				chunk.firstLineNumber,
				chunk.lastLineNumber,
			].join(',') + 's',
			script.pattern,
			script.replacement,
			script.flags,
		].join(script.separator),
		chunk.filepath,
	]);
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

	throw new Error(`Unknown script type: ${script}`);
}

export async function main(scriptStrings: string[]) {
	const scripts = scriptStrings.map(parseScript);

	let rgChunks: RgChunk[] = [];

	for (const script of scripts) {
		if (script.type === 'rg') {
			const lines = rgLines(script);
			const chunks = rgLinesToChunks(lines);

			rgChunks = [];
			for await (const chunk of chunks) {
				rgChunks.push(chunk);
			}

			continue;
		}

		if (script.type === 'sed') {
			for (const chunk of rgChunks) {
				await sedChunk(chunk, script);
			}

			continue;
		}

		throw new Error(`Unknown script type: ${(script as Script).type}`);
	}
}
