import test from 'node:test';
import assert from 'node:assert/strict';
import { describeStatus } from '../src/lib/status.js';

const idle = { initializing: false, activity: null, building: false, elapsed: 0, done: null };

test('quick builds stay hidden; slow builds show a label, then elapsed time', () => {
	assert.equal(describeStatus({ ...idle, building: true, elapsed: 249 }).kind, 'hidden');
	assert.deepEqual(describeStatus({ ...idle, building: true, elapsed: 250 }), { kind: 'progress', label: 'Updating model…', time: null });
	assert.deepEqual(describeStatus({ ...idle, building: true, elapsed: 1540 }), { kind: 'progress', label: 'Updating model…', time: '1.5 s' });
});

test('start-up and file processing show immediately and take precedence', () => {
	assert.deepEqual(describeStatus({ ...idle, initializing: true }), { kind: 'progress', label: 'Loading geometry engine…', time: null });
	assert.equal(describeStatus({ ...idle, activity: 'Importing mesh…', building: true }).label, 'Importing mesh…');
	assert.equal(describeStatus({ ...idle, initializing: true, activity: 'Opening project…' }).label, 'Loading geometry engine…');
});

test('a slow build reports its duration once finished', () => {
	assert.deepEqual(describeStatus({ ...idle, done: 3260 }), { kind: 'done', label: 'Updated in 3.3 s', time: null });
	assert.equal(describeStatus({ ...idle, done: 900 }).kind, 'hidden');
	assert.equal(describeStatus(idle).kind, 'hidden');
});
