import { CodexClient } from '@raylin01/codex-client';

const client = await CodexClient.init({
	cwd: process.cwd(),
	approvalPolicy: 'on-request'
});

const turn = client.send('Summarize this repository and mention the riskiest area.');

for await (const update of turn.updates()) {
	if (update.kind === 'output' && update.snapshot.currentOutputKind === 'text') {
		process.stdout.write(`\r${update.snapshot.text}`);
	}

	if (update.kind === 'request') {
		console.log('\nrequest:', update.snapshot.currentMessage.content);
	}
}

const result = await turn.done;
console.log('\nstatus:', result.status, 'thread:', client.providerThreadId);
await client.close();
